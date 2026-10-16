import { Injectable } from '@nestjs/common';

/** What holds a model, phrased for the refusal that names it. */
export interface IModelUsage {
  kind: string;
  name: string;
}

export interface IModelUsageSource {
  findModelUsage(modelId: number): Promise<IModelUsage[]>;
}

/**
 * The using side of a model. Every domain that can hold one registers here, and deleting a model asks all of them
 * first.
 */
@Injectable()
export class ModelUsageRegistry {
  private readonly sources: IModelUsageSource[] = [];

  register(source: IModelUsageSource): void {
    this.sources.push(source);
  }

  async findUsage(modelId: number): Promise<IModelUsage[]> {
    const found = await Promise.all(this.sources.map(source => source.findModelUsage(modelId)));

    return found.flat();
  }
}
