import { BackendConfiguration, BackendDeclaration } from './declaration';
import { BackendFieldType, ModelReferenceBackendField } from './field';
import { configuredValue } from './values';

export interface IReferencedModel {
  field: ModelReferenceBackendField;
  fingerprint: string;
}

export function modelReferenceFields(declaration: BackendDeclaration): readonly ModelReferenceBackendField[] {
  return declaration.fields.filter(
    (field): field is ModelReferenceBackendField => field.type === BackendFieldType.MODEL_REFERENCE
  );
}

export function referencesModel(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration,
  fingerprint: string
): boolean {
  return referencedModels(declaration, configuration).some(reference => reference.fingerprint === fingerprint);
}

/** In declaration order, skipping a field the document applies no value to. */
export function referencedModels(
  declaration: BackendDeclaration,
  configuration: BackendConfiguration
): readonly IReferencedModel[] {
  return modelReferenceFields(declaration).flatMap(field => {
    const value = configuredValue(field, configuration);

    if (typeof value !== 'string' || value.length === 0) {
      return [];
    }

    return [{ field, fingerprint: value }];
  });
}
