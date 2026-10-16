import { BackendField, BackendFieldType, BackendImages, ImageVariant, sharedImage } from '@libs/backends';
import type { ConfigurationDocument, ConfigurationValue } from '@libs/dto';

import { DocumentEdits } from '../yaml';

/** `null` is the empty control, which saves as an absent key. */
export type ConfigurationFormValue = string | number | boolean | null;

export type ConfigurationFormValues = Record<string, ConfigurationFormValue>;

const NUMBER_LIST_SEPARATOR = /[\s,]+/;

const IMAGE_VARIANT_LABELS: Record<ImageVariant, string> = {
  [ImageVariant.CUDA]: 'NVIDIA GPUs',
  [ImageVariant.ROCM]: 'AMD GPUs',
  [ImageVariant.CPU]: 'CPU only',
};

export const readFieldValues = (
  fields: readonly BackendField[],
  configuration: ConfigurationDocument
): ConfigurationFormValues =>
  Object.fromEntries(fields.map(field => [field.name, readFieldValue(field, configuration)]));

export const writeFieldValues = (fields: readonly BackendField[], values: ConfigurationFormValues): DocumentEdits =>
  Object.fromEntries(fields.map(field => [field.name, writeFieldValue(field, values[field.name] ?? null)]));

export const describeDefault = (field: BackendField): string => {
  if (field.type === BackendFieldType.MODEL_REFERENCE) {
    return 'none';
  }

  if (field.default === undefined) {
    return 'the backend decides';
  }

  return Array.isArray(field.default) ? field.default.join(', ') : String(field.default);
};

export const describeImageDefault = (images: BackendImages): string | undefined => {
  if (sharedImage(images) !== undefined) {
    return undefined;
  }

  return Object.values(ImageVariant)
    .flatMap(variant => {
      const image = images[variant];

      return image === undefined ? [] : [`${image} on ${IMAGE_VARIANT_LABELS[variant]}`];
    })
    .join(', ');
};

/** Distinguishes a key set to null from one the document does not hold, which inherits instead. */
export const holdsKey = (configuration: ConfigurationDocument, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(configuration, key);

export const describeConfigurationValue = (value: ConfigurationValue): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }

  if (Array.isArray(value)) {
    return value.map(describeConfigurationValue).join(', ');
  }

  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export const tidyListText = (field: BackendField, text: string | null): string | null => {
  const saved = writeFieldValue(field, text);
  const tidied = readFieldValue(field, saved === undefined ? {} : { [field.name]: saved });

  return typeof tidied === 'string' ? tidied : null;
};

const readFieldValue = (field: BackendField, configuration: ConfigurationDocument): ConfigurationFormValue => {
  const value = configuration[field.name];

  switch (field.type) {
    case BackendFieldType.BOOLEAN:
      return typeof value === 'boolean' ? value : null;

    case BackendFieldType.INTEGER:
    case BackendFieldType.NUMBER:
      return typeof value === 'number' ? value : null;

    case BackendFieldType.TEXT:
    case BackendFieldType.CHOICE:
    case BackendFieldType.MODEL_REFERENCE:
      return typeof value === 'string' ? value : null;

    case BackendFieldType.NUMBER_LIST:
      return Array.isArray(value) ? value.join(', ') : null;

    case BackendFieldType.TEXT_LIST:
      return Array.isArray(value) ? value.join('\n') : null;
  }
};

const writeFieldValue = (field: BackendField, value: ConfigurationFormValue): ConfigurationValue | undefined => {
  if (value === null) {
    return undefined;
  }

  switch (field.type) {
    case BackendFieldType.BOOLEAN:
      return typeof value === 'boolean' ? value : undefined;

    case BackendFieldType.INTEGER:
    case BackendFieldType.NUMBER:
      return typeof value === 'number' ? value : undefined;

    case BackendFieldType.TEXT:
    case BackendFieldType.CHOICE:
    case BackendFieldType.MODEL_REFERENCE:
      return typeof value === 'string' && value.length > 0 ? value : undefined;

    case BackendFieldType.NUMBER_LIST:
      return emptyToUndefined(splitList(value, NUMBER_LIST_SEPARATOR).map(readNumber));

    case BackendFieldType.TEXT_LIST:
      return emptyToUndefined(splitList(value, '\n'));
  }
};

/** A cleared list control holds an empty string, so the key leaves the document rather than taking an empty list. */
const emptyToUndefined = (entries: ConfigurationValue[]): ConfigurationValue[] | undefined =>
  entries.length > 0 ? entries : undefined;

const splitList = (value: ConfigurationFormValue, separator: string | RegExp): string[] =>
  String(value)
    .split(separator)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

/** A non-numeric entry is carried through as text. */
const readNumber = (entry: string): ConfigurationValue => {
  const parsed = Number(entry);

  return Number.isFinite(parsed) ? parsed : entry;
};
