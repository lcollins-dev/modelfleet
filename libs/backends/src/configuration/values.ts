import { BackendConfiguration, BackendDeclaration, backendField } from './declaration';
import { BackendField } from './field';

/**
 * A key absent inherits the declared default; `null` is a value meaning the field is not applied at all. Both come
 * back as `undefined`, which is how a caller passes no flag and an estimate reports the input it wanted.
 */
export function configuredValue(field: BackendField, configuration: BackendConfiguration): unknown {
  const value = Object.hasOwn(configuration, field.name) ? configuration[field.name] : field.default;

  return value ?? undefined;
}

export function configuredNumber(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  name: string
): number | undefined {
  const value = declaredValue(declaration, configuration, name);

  return typeof value === 'number' ? value : undefined;
}

export function configuredBoolean(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  name: string
): boolean | undefined {
  const value = declaredValue(declaration, configuration, name);

  return typeof value === 'boolean' ? value : undefined;
}

export function configuredText(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  name: string
): string | undefined {
  const value = declaredValue(declaration, configuration, name);

  return typeof value === 'string' ? value : undefined;
}

/** Undefined where any entry is not text, so a caller never acts on part of a list. */
export function configuredTextList(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  name: string
): string[] | undefined {
  const value = declaredValue(declaration, configuration, name);

  return Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : undefined;
}

export function configuredNumberList(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  name: string
): number[] | undefined {
  const value = declaredValue(declaration, configuration, name);

  return Array.isArray(value) && value.every(entry => typeof entry === 'number') ? value : undefined;
}

function declaredValue(declaration: BackendDeclaration, configuration: BackendConfiguration, name: string): unknown {
  const field = backendField(declaration, name);

  return field === undefined ? undefined : configuredValue(field, configuration);
}

export interface IConfiguredValues {
  number: (name: string) => number | undefined;
  boolean: (name: string) => boolean | undefined;
  text: (name: string) => string | undefined;
  numberList: (name: string) => number[] | undefined;
  textList: (name: string) => string[] | undefined;
}

export function configuredValues(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration
): IConfiguredValues {
  return {
    number: name => configuredNumber(declaration, configuration, name),
    boolean: name => configuredBoolean(declaration, configuration, name),
    text: name => configuredText(declaration, configuration, name),
    numberList: name => configuredNumberList(declaration, configuration, name),
    textList: name => configuredTextList(declaration, configuration, name),
  };
}
