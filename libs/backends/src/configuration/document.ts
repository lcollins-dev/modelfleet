import { z } from 'zod';

import { MODEL_FINGERPRINT_PATTERN } from '../model';
import { BackendDeclaration } from './declaration';
import { BackendField, BackendFieldType } from './field';

/**
 * Builds the schema a document for this backend parses against. Keys the declaration does not model survive the
 * parse, and every field accepts `null`, which is how a document says the flag is not passed at all.
 */
export function configurationSchema(declaration: BackendDeclaration): z.ZodType {
  const shape = Object.fromEntries(declaration.fields.map(field => [field.name, fieldSchema(field).nullish()]));

  return z.looseObject(shape);
}

function fieldSchema(field: BackendField): z.ZodType {
  switch (field.type) {
    case BackendFieldType.BOOLEAN:
      return z.boolean({ error: 'must be true or false' });

    case BackendFieldType.INTEGER:
      return bounded(z.number({ error: 'must be a number' }).int({ error: 'must be a whole number' }), field);

    case BackendFieldType.NUMBER:
      return bounded(z.number({ error: 'must be a number' }), field);

    case BackendFieldType.TEXT:
      return lengthBounded(z.string({ error: 'must be text' }), field);

    case BackendFieldType.CHOICE:
      return z.enum(field.choices, { error: `must be one of ${field.choices.join(', ')}` });

    case BackendFieldType.NUMBER_LIST:
      return z.array(bounded(z.number({ error: 'must be a number' }), field), { error: 'must be a list of numbers' });

    case BackendFieldType.TEXT_LIST:
      return z.array(z.string({ error: 'must be text' }), { error: 'must be a list of text entries' });

    case BackendFieldType.MODEL_REFERENCE:
      return z
        .string({ error: 'must be text' })
        .regex(MODEL_FINGERPRINT_PATTERN, { error: "must be a catalogued file's fingerprint" });
  }
}

function lengthBounded(schema: z.ZodString, bounds: { minLength?: number; maxLength?: number }): z.ZodString {
  const { minLength, maxLength } = bounds;
  const lower =
    minLength === undefined ? schema : schema.min(minLength, { error: `must be at least ${minLength} characters` });

  return maxLength === undefined ? lower : lower.max(maxLength, { error: `must be at most ${maxLength} characters` });
}

function bounded(schema: z.ZodNumber, bounds: { min?: number; max?: number }): z.ZodNumber {
  const { min, max } = bounds;
  const lower = min === undefined ? schema : schema.min(min, { error: `must be at least ${min}` });

  return max === undefined ? lower : lower.max(max, { error: `must be at most ${max}` });
}
