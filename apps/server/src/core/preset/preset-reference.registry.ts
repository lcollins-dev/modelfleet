import { Injectable } from '@nestjs/common';

/** What holds a preset, phrased for the refusal that names it. */
export interface IPresetReference {
  kind: string;
  name: string;
}

export interface IPresetReferenceSource {
  findPresetReferences(presetId: number): Promise<IPresetReference[]>;

  /** Called inside the write that changed the preset, so anything derived from its configuration catches up. */
  onPresetConfigurationChanged(presetId: number): Promise<void>;
}

/**
 * The referencing side of a preset. Every domain whose rows point at one registers here, so deleting a
 * preset asks all of them first and changing one tells all of them after.
 */
@Injectable()
export class PresetReferenceRegistry {
  private readonly sources: IPresetReferenceSource[] = [];

  register(source: IPresetReferenceSource): void {
    this.sources.push(source);
  }

  async findReferences(presetId: number): Promise<IPresetReference[]> {
    const found = await Promise.all(this.sources.map(source => source.findPresetReferences(presetId)));

    return found.flat();
  }

  async configurationChanged(presetId: number): Promise<void> {
    await Promise.all(this.sources.map(source => source.onPresetConfigurationChanged(presetId)));
  }
}
