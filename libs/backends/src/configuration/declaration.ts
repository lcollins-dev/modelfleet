import { z } from 'zod';

import { ModelFormat } from '../model';
import { BackendField } from './field';

/** The declaration's own fields plus every key it does not model, which a caller carries through untouched. */
export type BackendConfiguration = Readonly<Record<string, unknown>>;

const text = z.string().min(1);

export const BackendDeclaration = z.strictObject({
  /** The document shape this declaration was written for, so a stored document can be migrated to it. */
  schemaVersion: z.number().int().min(1),

  formats: z.array(z.enum(ModelFormat)),

  /** The order the groups are presented in. Every field's group appears here. */
  groups: z.array(z.strictObject({ group: text, label: text })),

  fields: z.array(BackendField),
});

export type BackendDeclaration = z.infer<typeof BackendDeclaration>;

export type BackendGroup = BackendDeclaration['groups'][number];

export function servesFormat(declaration: BackendDeclaration, format: ModelFormat): boolean {
  return declaration.formats.includes(format);
}

export function backendField(declaration: BackendDeclaration, name: string): BackendField | undefined {
  return declaration.fields.find(field => field.name === name);
}
