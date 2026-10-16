import { BackendId } from '../backend-id';
import { llamaCppHooks } from '../backends/llama-cpp/hooks';
import { BackendOperation, BackendDefinition, IDefinitionIssue, VramSource, validateDefinition } from '../definition';
import { backendDefinitions } from '../definitions';
import { BackendHook, HookKind, HookRegistry } from './hooks';
import { IBackendMapping, backendErrorFrom } from './mapping';
import { VramSizer, builtInSizing } from './sizing';

export const backendHooks: HookRegistry = mergeHooks([llamaCppHooks]);

export interface IBackend {
  definition: BackendDefinition;
  sizeVram: VramSizer;
  mapping: IBackendMapping;
}

export function hookIssues(definition: BackendDefinition, hooks: HookRegistry = backendHooks): IDefinitionIssue[] {
  const issues: IDefinitionIssue[] = [];
  const estimate = definition.vram.estimate;

  if (estimate.source === VramSource.HOOK) {
    const problem = kindProblem(hooks.get(estimate.hook), estimate.hook, HookKind.SIZING, 'a sizing');

    if (problem !== null) {
      issues.push({ path: 'vram.estimate.hook', message: problem });
    }
  }

  for (const [operation, entry] of Object.entries(definition.operations)) {
    const problem =
      entry.mapping === undefined ? null : mappingProblem(hooks.get(entry.mapping), entry.mapping, operation);

    if (problem !== null) {
      issues.push({ path: `operations.${operation}.mapping`, message: problem });
    }
  }

  return issues;
}

export function resolveBackend(definition: BackendDefinition, hooks: HookRegistry = backendHooks): IBackend {
  const issues = [...validateDefinition(definition).issues, ...hookIssues(definition, hooks)];

  if (issues.length > 0) {
    const named = issues.map(issue => `${issue.path} ${issue.message}`).join('; ');

    throw new Error(`The ${definition.id} definition does not resolve: ${named}`);
  }

  return {
    definition,
    sizeVram: sizerOf(definition, hooks),
    mapping: mappingOf(definition, hooks),
  };
}

const resolvedBackends = new Map(
  Object.values(backendDefinitions).map(definition => [definition.id, resolveBackend(definition)])
);

export function backendFor(backend: BackendId): IBackend {
  const resolved = resolvedBackends.get(backend);

  if (resolved === undefined) {
    throw new Error(`No definition is registered for the ${backend} backend`);
  }

  return resolved;
}

export function mergeHooks(modules: readonly HookRegistry[]): HookRegistry {
  const hooks = new Map<string, BackendHook>();

  for (const [name, hook] of modules.flatMap(module => [...module])) {
    if (hooks.has(name)) {
      throw new Error(`The hook ${name} is registered twice`);
    }

    hooks.set(name, hook);
  }

  return hooks;
}

function kindProblem(hook: BackendHook | undefined, name: string, kind: HookKind, label: string): string | null {
  if (hook === undefined) {
    return `${name} is not a registered hook`;
  }

  return hook.kind === kind ? null : `${name} is not ${label} hook`;
}

function mappingProblem(hook: BackendHook | undefined, name: string, operation: string): string | null {
  if (hook?.kind === HookKind.MAPPING) {
    return hook.operation === operation ? null : `${name} maps ${hook.operation}, not ${operation}`;
  }

  return kindProblem(hook, name, HookKind.MAPPING, 'a mapping');
}

function sizerOf(definition: BackendDefinition, hooks: HookRegistry): VramSizer {
  const declaration = definition.declaration;
  const estimate = definition.vram.estimate;

  if (estimate.source !== VramSource.HOOK) {
    return input => builtInSizing(declaration, estimate, input);
  }

  const hook = hooks.get(estimate.hook);

  if (hook?.kind !== HookKind.SIZING) {
    throw new Error(`${estimate.hook} is not a sizing hook`);
  }

  return input => hook.size(input, declaration);
}

function mappingOf(definition: BackendDefinition, hooks: HookRegistry): IBackendMapping {
  const mapping: IBackendMapping = { error: backendErrorFrom };

  for (const entry of Object.values(definition.operations)) {
    const hook = entry.mapping === undefined ? undefined : hooks.get(entry.mapping);

    if (hook?.kind !== HookKind.MAPPING) {
      continue;
    }

    switch (hook.operation) {
      case BackendOperation.CHAT_COMPLETIONS:
        mapping.chatCompletions = hook.mapping;
        break;

      case BackendOperation.EMBEDDINGS:
        mapping.embeddings = hook.mapping;
        break;

      case BackendOperation.TRANSCRIPTION:
        mapping.transcription = hook.mapping;
        break;

      case BackendOperation.SPEECH:
        mapping.speech = hook.mapping;
        break;
    }
  }

  return mapping;
}
