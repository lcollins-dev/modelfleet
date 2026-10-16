import {
  BackendConfiguration,
  BackendField,
  BackendFieldType,
  EXTRA_FLAGS_FIELD,
  BackendDeclaration,
  configuredValue,
} from '../configuration';

const SINGLE_QUOTE = "'";
const DOUBLE_QUOTE = '"';
const WHITESPACE = /\s/;

/** Each model reference field's document key against the path its file is bound at in the container. */
export type CompanionPaths = ReadonlyMap<string, string>;

/**
 * One flag and value per declared field that has one, in declaration order, then the arguments each `extraFlags`
 * entry holds. Extra flags come last so a backend that takes the final occurrence of a flag resolves them over the
 * declared fields.
 */
export function declaredArguments(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  companionPaths: CompanionPaths = new Map()
): readonly string[] {
  const declared = declaration.fields
    .filter(field => field.name !== EXTRA_FLAGS_FIELD)
    .flatMap(field => fieldArguments(field, configuration, companionPaths));

  return [...declared, ...extraFlags(declaration, configuration)];
}

/** What a field's flag would be followed by, else undefined. A boolean writes `true` or `false`. */
export function fieldValueText(
  field: BackendField,
  configuration: BackendConfiguration,
  companionPaths: CompanionPaths
): string | undefined {
  const value = configuredValue(field, configuration);

  if (value === undefined) {
    return undefined;
  }

  if (field.type === BackendFieldType.BOOLEAN) {
    return typeof value === 'boolean' ? String(value) : undefined;
  }

  return field.type === BackendFieldType.MODEL_REFERENCE ? companionPaths.get(field.name) : writtenValue(field, value);
}

function fieldArguments(
  field: BackendField,
  configuration: BackendConfiguration,
  companionPaths: CompanionPaths
): string[] {
  if (field.type === BackendFieldType.BOOLEAN) {
    return booleanArguments(field.flag, field.offFlag, configuredValue(field, configuration));
  }

  if (field.flag === undefined) {
    return [];
  }

  const written = fieldValueText(field, configuration, companionPaths);

  return written === undefined ? [] : [field.flag, written];
}

function booleanArguments(flag: string | undefined, offFlag: string | undefined, value: unknown): string[] {
  if (value !== true && value !== false) {
    return [];
  }

  const chosen = value ? flag : offFlag;

  return chosen === undefined ? [] : [chosen];
}

function writtenValue(field: BackendField, value: unknown): string | undefined {
  switch (field.type) {
    case BackendFieldType.INTEGER:
    case BackendFieldType.NUMBER:
      return typeof value === 'number' ? String(value) : undefined;

    case BackendFieldType.TEXT:
    case BackendFieldType.CHOICE:
      return typeof value === 'string' ? value : undefined;

    case BackendFieldType.NUMBER_LIST:
      return joined(value, entry => (typeof entry === 'number' ? String(entry) : undefined));

    case BackendFieldType.TEXT_LIST:
      return joined(value, entry => (typeof entry === 'string' ? entry : undefined));

    default:
      return undefined;
  }
}

function joined(value: unknown, write: (entry: unknown) => string | undefined): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const written = value.map(write);

  return written.every(entry => entry !== undefined) ? written.join(',') : undefined;
}

function extraFlags(declaration: BackendDeclaration, configuration: BackendConfiguration): string[] {
  const field = declaration.fields.find(candidate => candidate.name === EXTRA_FLAGS_FIELD);
  const value = field === undefined ? undefined : configuredValue(field, configuration);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(entry => typeof entry === 'string').flatMap(splitEntry);
}

/**
 * Whitespace outside quotes separates one argument from the next. A quoted run keeps its spaces and loses its quotes.
 */
function splitEntry(entry: string): string[] {
  const args: string[] = [];

  let current: string | undefined;
  let quote: string | undefined;

  for (const character of entry) {
    if (character === quote) {
      quote = undefined;
    } else if (quote !== undefined) {
      current = (current ?? '') + character;
    } else if (character === SINGLE_QUOTE || character === DOUBLE_QUOTE) {
      quote = character;
      current = current ?? '';
    } else if (WHITESPACE.test(character)) {
      if (current !== undefined) {
        args.push(current);
      }

      current = undefined;
    } else {
      current = (current ?? '') + character;
    }
  }

  return current === undefined ? args : [...args, current];
}
