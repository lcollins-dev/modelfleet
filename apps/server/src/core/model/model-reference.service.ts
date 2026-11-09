import { BadRequestException, Injectable } from '@nestjs/common';

import {
  BackendId,
  configuredValues,
  declarationFor,
  ModelType,
  ReferenceRequirement,
  referencedModels,
} from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

import { ModelService } from './model.service';

import { modelReferenceProblem, IResolvedModelReference } from './model-reference';
import { fieldRefusal, IFieldIssue, toValidationErrors } from '@/common/validation-errors';

/** The backend travels with the configuration, since only its declaration says which keys are references. */
export interface IReferencingConfiguration {
  backend: BackendId;
  configuration: ConfigurationDocument;
}

@Injectable()
export class ModelReferenceService {
  constructor(private readonly modelService: ModelService) {}

  /** A fingerprint matching nothing leaves the row undefined rather than dropping the field. */
  async resolve(backend: BackendId, configuration: ConfigurationDocument): Promise<IResolvedModelReference[]> {
    const references = referencedModels(declarationFor(backend), configuration);

    if (references.length === 0) {
      return [];
    }

    const models = await this.modelService.findByFingerprints(references.map(reference => reference.fingerprint));

    return references.map(reference => ({
      field: reference.field.name,
      fingerprint: reference.fingerprint,
      label: reference.field.label,
      modelType: reference.field.modelType,
      model: models.get(reference.fingerprint),
    }));
  }

  /**
   * Refuses only what this write introduces; a file already named keeps whatever a later scan made of it, and
   * placement reports that instead. Held per field, since moving one file to a field of another type claims
   * something new about it.
   */
  async checkIntroduced(previous: IReferencingConfiguration, next: IReferencingConfiguration): Promise<void> {
    const held = new Set(
      referencedModels(declarationFor(previous.backend), previous.configuration).map(reference =>
        this.claim(reference.field.name, reference.fingerprint)
      )
    );
    const resolved = await this.resolve(next.backend, next.configuration);
    const introduced = resolved.filter(reference => !held.has(this.claim(reference.field, reference.fingerprint)));

    this.refuseProblems(introduced);

    const refusals = [...this.shardedDraftRefusals(introduced), ...this.requirementRefusals(previous, next, resolved)];

    if (refusals.length > 0) {
      throw fieldRefusal(toValidationErrors(refusals));
    }
  }

  /** A companion is mounted as one file, so the shards of a split draft would never reach the container. */
  private shardedDraftRefusals(references: readonly IResolvedModelReference[]): IFieldIssue[] {
    return references.flatMap(({ field, label, model, modelType }) =>
      model === undefined || modelType !== ModelType.DRAFT || model.shardCount <= 1
        ? []
        : [
            {
              path: [field],
              message: `${model.label} is split across ${String(model.shardCount)} files, and ${label} takes a single file`,
            },
          ]
    );
  }

  /** A pairing already saved stays, as a reference does, so an unrelated edit is never refused over it. */
  private requirementRefusals(
    previous: IReferencingConfiguration,
    next: IReferencingConfiguration,
    resolved: readonly IResolvedModelReference[]
  ): IFieldIssue[] {
    const declaration = declarationFor(next.backend);
    const values = configuredValues(declaration, next.configuration);

    return (declaration.referenceRequirements ?? []).flatMap(requirement => {
      const choice = values.text(requirement.choiceField);
      const reference = resolved.find(entry => entry.field === requirement.referenceField);
      const model = reference?.model;

      if (
        choice === undefined ||
        !requirement.choices.includes(choice) ||
        reference === undefined ||
        model === undefined ||
        model.architecture === requirement.architecture ||
        this.heldPairing(previous, requirement, choice, reference.fingerprint)
      ) {
        return [];
      }

      return [
        {
          path: [requirement.choiceField],
          message: `${choice} needs a ${requirement.architecture} file, and ${model.label} is ${model.architecture ?? 'of an unknown architecture'}`,
        },
      ];
    });
  }

  private heldPairing(
    previous: IReferencingConfiguration,
    requirement: ReferenceRequirement,
    choice: string,
    fingerprint: string
  ): boolean {
    const declaration = declarationFor(previous.backend);

    return (
      configuredValues(declaration, previous.configuration).text(requirement.choiceField) === choice &&
      referencedModels(declaration, previous.configuration).some(
        reference => reference.field.name === requirement.referenceField && reference.fingerprint === fingerprint
      )
    );
  }

  private claim(field: string, fingerprint: string): string {
    return `${field}:${fingerprint}`;
  }

  private refuseProblems(references: readonly IResolvedModelReference[]): void {
    for (const reference of references) {
      const problem = modelReferenceProblem(reference);

      if (problem !== null) {
        throw new BadRequestException(problem);
      }
    }
  }
}
