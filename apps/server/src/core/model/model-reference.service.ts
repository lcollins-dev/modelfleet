import { BadRequestException, Injectable } from '@nestjs/common';

import { BackendId, declarationFor, referencedModels } from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

import { ModelService } from './model.service';

import { modelReferenceProblem, IResolvedModelReference } from './model-reference';

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

    this.refuseProblems(resolved.filter(reference => !held.has(this.claim(reference.field, reference.fingerprint))));
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
