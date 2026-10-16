import { z } from 'zod';

import { ModelType } from '../model';

export enum BackendFieldType {
  BOOLEAN = 'boolean',
  INTEGER = 'integer',
  NUMBER = 'number',
  TEXT = 'text',
  CHOICE = 'choice',
  NUMBER_LIST = 'numberList',
  TEXT_LIST = 'textList',
  MODEL_REFERENCE = 'modelReference',
}

const text = z.string().min(1);

const fieldBase = {
  /** The key the field takes in a stored configuration document. */
  name: text,

  /** The backend's own command line flag. Absent where the field is not one argument, as `extraFlags` is not. */
  flag: text.optional(),

  label: text,
  description: z.string(),

  /** A group the declaration lists. Group ids are the backend's own, not a set shared between backends. */
  group: text,
};

const bounds = { min: z.number().optional(), max: z.number().optional() };

export const BackendField = z.discriminatedUnion('type', [
  z.strictObject({
    ...fieldBase,
    type: z.literal(BackendFieldType.BOOLEAN),
    default: z.boolean().optional(),

    /** The flag passed in place of `flag` where the value is false, for a setting the backend defaults to on. */
    offFlag: text.optional(),
  }),
  z.strictObject({
    ...fieldBase,
    ...bounds,
    type: z.literal(BackendFieldType.INTEGER),
    default: z.number().optional(),
  }),
  z.strictObject({ ...fieldBase, ...bounds, type: z.literal(BackendFieldType.NUMBER), default: z.number().optional() }),
  z.strictObject({
    ...fieldBase,
    type: z.literal(BackendFieldType.TEXT),
    default: z.string().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal(BackendFieldType.CHOICE),
    choices: z.array(text).min(1),
    default: z.string().optional(),
  }),
  z.strictObject({
    ...fieldBase,

    /** `min` and `max` bound each entry rather than the list's length. */
    ...bounds,
    type: z.literal(BackendFieldType.NUMBER_LIST),
    default: z.array(z.number()).optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal(BackendFieldType.TEXT_LIST),
    default: z.array(z.string()).optional(),
  }),

  /** The stored value is a catalogued file's fingerprint, which the server resolves to a path per node. */
  z.strictObject({
    ...fieldBase,
    type: z.literal(BackendFieldType.MODEL_REFERENCE),

    /** A fingerprint belongs to one fleet, so no declaration can name a default. */
    default: z.undefined().optional(),

    /** A document naming a catalogued row of any other type is refused on save. */
    modelType: z.enum(ModelType),
  }),
]);

export type BackendField = z.infer<typeof BackendField>;

type FieldOf<TType extends BackendFieldType> = Extract<BackendField, { type: TType }>;

export type BooleanBackendField = FieldOf<BackendFieldType.BOOLEAN>;
export type TextBackendField = FieldOf<BackendFieldType.TEXT>;
export type TextListBackendField = FieldOf<BackendFieldType.TEXT_LIST>;
export type ModelReferenceBackendField = FieldOf<BackendFieldType.MODEL_REFERENCE>;

/** Declared with no flag: the image names the container, not an argument the backend takes. */
export const IMAGE_FIELD = 'image';

/** The key every backend reserves for flags it does not model. One entry splits into the arguments it holds. */
export const EXTRA_FLAGS_FIELD = 'extraFlags';

export function extraFlagsField(group: string): TextListBackendField {
  return {
    name: EXTRA_FLAGS_FIELD,
    label: 'Extra flags',
    description:
      'Add command-line flags that are not listed above. Put a flag and its value in one entry. Quote values that ' +
      'contain spaces.',
    group,
    type: BackendFieldType.TEXT_LIST,
  };
}
