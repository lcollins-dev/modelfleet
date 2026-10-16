import { z } from 'zod';

import { BackendFieldType, BackendDeclaration, IMAGE_FIELD, backendField, declarationIssues } from '../configuration';
import { isReservedEnvironment } from './container';
import { BackendDefinition } from './definition';
import { sharedImage } from './image';
import { BackendOperation, MULTIPART_OPERATIONS } from './operation';
import { ArgumentGroup, elementProblems } from './template';
import { VramSource } from './vram';

const NUMERIC_FIELDS: readonly BackendFieldType[] = [BackendFieldType.INTEGER, BackendFieldType.NUMBER];

export interface IDefinitionIssue {
  path: string;

  message: string;
}

export interface IDefinitionValidation {
  definition: BackendDefinition | null;

  issues: readonly IDefinitionIssue[];
}

const definitionSchema = BackendDefinition.superRefine((definition, context) => {
  for (const issue of crossIssues(definition)) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

export function validateDefinition(value: unknown): IDefinitionValidation {
  const parsed = definitionSchema.safeParse(value);

  if (!parsed.success) {
    return { definition: null, issues: parsed.error.issues.map(reportIssue) };
  }

  return { definition: parsed.data, issues: [] };
}

interface ICrossIssue {
  path: PropertyKey[];
  message: string;
}

function crossIssues(definition: BackendDefinition): ICrossIssue[] {
  const declaration = definition.declaration;

  return [
    ...declarationIssues(declaration).map(issue => ({ ...issue, path: ['declaration', ...issue.path] })),
    ...groupIssues(definition.argv, ['argv'], declaration),
    ...Object.entries(definition.launchModeArgv).flatMap(([mode, groups]) =>
      groupIssues(groups, ['launchModeArgv', mode], declaration)
    ),
    ...environmentIssues(definition.environment, declaration),
    ...imageIssues(definition, declaration),
    ...(definition.entrypoint ?? []).flatMap((element, index) =>
      element.includes('{{')
        ? [{ path: ['entrypoint', index], message: 'is passed as written, so it takes no placeholder' }]
        : []
    ),
    ...vramIssues(definition, declaration),
    ...launchIssues(definition),
    ...upstreamModelIssues(definition),
    ...voicesIssues(definition),
    ...weightsNameIssues(definition, declaration),
  ];
}

function groupIssues(
  groups: readonly ArgumentGroup[],
  path: PropertyKey[],
  declaration: BackendDeclaration
): ICrossIssue[] {
  return groups.flatMap((group, groupIndex) =>
    group.flatMap((element, elementIndex) =>
      elementProblems(element, declaration).map(message => ({ path: [...path, groupIndex, elementIndex], message }))
    )
  );
}

function environmentIssues(
  environment: Readonly<Record<string, string>>,
  declaration: BackendDeclaration
): ICrossIssue[] {
  return Object.entries(environment).flatMap(([name, value]) => {
    const path = ['environment', name];
    const reserved = isReservedEnvironment(name)
      ? [{ path, message: "is reserved for the agent's device presentation" }]
      : [];

    return [...reserved, ...elementProblems(value, declaration).map(message => ({ path, message }))];
  });
}

function imageIssues(definition: BackendDefinition, declaration: BackendDeclaration): ICrossIssue[] {
  const index = declaration.fields.findIndex(field => field.name === IMAGE_FIELD);
  const shared = sharedImage(definition.images);

  if (index === -1 || declaration.fields[index].default === shared) {
    return [];
  }

  const path = ['declaration', 'fields', index, 'default'];

  return [
    {
      path,
      message: shared === undefined ? 'must be unset, since no one image serves every placement' : `must be ${shared}`,
    },
  ];
}

function vramIssues(definition: BackendDefinition, declaration: BackendDeclaration): ICrossIssue[] {
  const estimate = definition.vram.estimate;

  switch (estimate.source) {
    case VramSource.CONFIGURATION:
      return fractionFieldIssues(declaration, estimate.fractionField);

    case VramSource.SIZE:
      return gibFieldIssues(declaration, estimate.gibField);

    default:
      return [];
  }
}

function gibFieldIssues(declaration: BackendDeclaration, name: string): ICrossIssue[] {
  const field = backendField(declaration, name);
  const path = ['vram', 'estimate', 'gibField'];

  if (field === undefined || !NUMERIC_FIELDS.includes(field.type)) {
    return [{ path, message: `${name} names no declared number field` }];
  }

  const bounded = 'min' in field && field.min !== undefined && field.min > 0;

  return bounded ? [] : [{ path, message: `${name} must be bounded above 0` }];
}

/** Stage shares are fractions of the stated size, so they need a size to divide. */
function launchIssues(definition: BackendDefinition): ICrossIssue[] {
  const vram = definition.vram;

  if (vram.launch === undefined || vram.estimate.source === VramSource.SIZE) {
    return [];
  }

  return [{ path: ['vram', 'launch'], message: 'splits a stated size, so it takes a size estimate' }];
}

function fractionFieldIssues(declaration: BackendDeclaration, name: string): ICrossIssue[] {
  const field = backendField(declaration, name);
  const path = ['vram', 'estimate', 'fractionField'];

  if (field === undefined || !NUMERIC_FIELDS.includes(field.type)) {
    return [{ path, message: `${name} names no declared number field` }];
  }

  const bounded =
    'min' in field && field.min !== undefined && field.min > 0 && field.max !== undefined && field.max <= 1;

  return bounded ? [] : [{ path, message: `${name} must be bounded above 0 and to at most 1` }];
}

function upstreamModelIssues(definition: BackendDefinition): ICrossIssue[] {
  return MULTIPART_OPERATIONS.flatMap(operation =>
    definition.operations[operation]?.upstreamModel === undefined
      ? []
      : [
          {
            path: ['operations', operation, 'upstreamModel'],
            message: 'is relayed as a multipart form, which the gateway does not rewrite',
          },
        ]
  );
}

function voicesIssues(definition: BackendDefinition): ICrossIssue[] {
  return Object.entries(definition.operations).flatMap(([operation, capability]) =>
    operation === BackendOperation.SPEECH || capability.voices === undefined
      ? []
      : [{ path: ['operations', operation, 'voices'], message: 'is listed for speech alone' }]
  );
}

function weightsNameIssues(definition: BackendDefinition, declaration: BackendDeclaration): ICrossIssue[] {
  const name = definition.weightsName;
  const companion = declaration.fields.some(
    field => field.type === BackendFieldType.MODEL_REFERENCE && field.name === name
  );

  return companion ? [{ path: ['weightsName'], message: `is where the ${String(name)} companion mounts` }] : [];
}

function reportIssue(issue: z.core.$ZodIssue): IDefinitionIssue {
  return { path: pathLabel(issue.path), message: issue.message };
}

function pathLabel(path: readonly PropertyKey[]): string {
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }

      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join('');
}
