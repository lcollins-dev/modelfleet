import { z } from 'zod';

import { BackendField, BackendFieldType, BackendDeclaration, backendField } from '../configuration';

/** A placeholder is `{{name}}` exactly, with no filters, defaults or escapes. */
export enum Placeholder {
  /** The first shard, or the directory where the format is one. */
  MODEL_PATH = 'model_path',

  SERVED_MODEL = 'served_model',

  PORT = 'port',

  /** No value on a CPU-only placement. */
  GPU_COUNT = 'gpu_count',

  /** Vendor UUIDs, comma-joined in pin order. No value on a CPU-only placement. */
  GPU_IDS = 'gpu_ids',
}

export const PARAM_PREFIX = 'param.';

export const COMPANION_PREFIX = 'companion.';

const PLACEHOLDER = /\{\{(.*?)\}\}/g;

const OPENING = '{{';

/** Dropped whole where any placeholder in it has no value. */
export const ArgumentGroup = z.array(z.string()).min(1);

export type ArgumentGroup = z.infer<typeof ArgumentGroup>;

export function placeholdersIn(element: string): string[] {
  return [...element.matchAll(PLACEHOLDER)].map(match => match[1]);
}

/** One pass: a substituted value is never rescanned, split or quoted. Undefined where any placeholder has no value. */
export function fillPlaceholders(element: string, valueOf: (name: string) => string | undefined): string | undefined {
  const values = new Map(placeholdersIn(element).map(name => [name, valueOf(name)]));

  if ([...values.values()].some(value => value === undefined)) {
    return undefined;
  }

  return element.replace(PLACEHOLDER, (_match, name: string) => values.get(name) ?? '');
}

export function placeholderProblem(name: string, declaration: BackendDeclaration): string | null {
  if (Object.values<string>(Placeholder).includes(name)) {
    return null;
  }

  if (name.startsWith(PARAM_PREFIX)) {
    const field = backendField(declaration, name.slice(PARAM_PREFIX.length));

    return field === undefined ? `{{${name}}} names no declared field` : passedTwice(name, field);
  }

  if (name.startsWith(COMPANION_PREFIX)) {
    const field = backendField(declaration, name.slice(COMPANION_PREFIX.length));

    return field?.type === BackendFieldType.MODEL_REFERENCE
      ? passedTwice(name, field)
      : `{{${name}}} names no model reference field`;
  }

  return `{{${name}}} is not a placeholder`;
}

function passedTwice(name: string, field: BackendField): string | null {
  return field.flag === undefined ? null : `{{${name}}} names a field that already passes its own flag`;
}

export function elementProblems(element: string, declaration: BackendDeclaration): string[] {
  const problems = placeholdersIn(element)
    .map(name => placeholderProblem(name, declaration))
    .filter(problem => problem !== null);

  return element.replace(PLACEHOLDER, '').includes(OPENING)
    ? [...problems, `${OPENING} opens no placeholder`]
    : problems;
}
