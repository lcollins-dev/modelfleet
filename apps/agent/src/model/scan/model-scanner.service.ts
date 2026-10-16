import { Inject, Injectable } from '@nestjs/common';

import {
  AgentModelInventory,
  GgufTensor,
  MAX_ARCHITECTURE_LENGTH,
  MAX_DTYPE_LENGTH,
  MAX_INVENTORY_TENSORS,
  MAX_LICENCE_ID_LENGTH,
  MAX_LICENCE_LINK_LENGTH,
  MAX_LICENCE_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MODEL_NAME_LENGTH,
  MAX_MODELS_PER_NODE,
  MAX_QUANTISATION_LENGTH,
  MAX_MODEL_SCAN_ERRORS,
  ModelEntry,
  ModelFormat,
  ModelLicence,
  ModelScanError,
  ModelScanErrorScope,
} from '@libs/agent-protocol';

import { DirectoryWalkerService } from './directory-walker.service';
import { MODEL_FORMAT_READERS } from './format-registry';
import { ModelFingerprintService } from './model-fingerprint.service';
import { ShardReader } from './shard-reader';
import { IDirectoryTree } from './types/directory-tree';
import { IModelFormatReader, IModelSet, NO_DESCRIPTION, NO_FORMAT_FIELDS } from './types/format-reader';

@Injectable()
export class ModelScannerService {
  private readonly byFormat: Map<ModelFormat, IModelFormatReader>;
  private readonly claimedSuffixes: readonly string[];

  constructor(
    @Inject(MODEL_FORMAT_READERS) private readonly readers: readonly IModelFormatReader[],
    private readonly directoryWalkerService: DirectoryWalkerService,
    private readonly modelFingerprintService: ModelFingerprintService
  ) {
    this.byFormat = new Map(readers.map(reader => [reader.format, reader]));
    this.claimedSuffixes = [...new Set(readers.flatMap(reader => reader.suffixes))];
  }

  /** Yields between reads, so a large tree does not hold the event loop. */
  async scan(directories: readonly string[]): Promise<AgentModelInventory> {
    const errors: ModelScanError[] = [];
    const sets: IModelSet[] = [];

    for (const directory of directories) {
      const tree = await this.directoryWalkerService.walk(directory, this.claimedSuffixes);

      errors.push(...tree.errors.map(error => this.error(ModelScanErrorScope.DIRECTORY, error.path, error.message)));

      for (const reader of this.readers) {
        const grouping = reader.group(this.treeFor(tree, reader));

        sets.push(...grouping.sets);
        errors.push(...grouping.gaps.map(gap => this.error(ModelScanErrorScope.MODEL_SET, gap.path, gap.message)));
      }
    }

    return {
      scannedAt: new Date().toISOString(),
      directories: [...directories],
      models: await this.readEntries(sets, errors),
      errors: errors.slice(0, MAX_MODEL_SCAN_ERRORS),
    };
  }

  /** One reader never sees another's files, so no reader has to filter what it is handed. */
  private treeFor(tree: IDirectoryTree, reader: IModelFormatReader): IDirectoryTree {
    return {
      directories: tree.directories.map(node => ({
        path: node.path,
        files: node.files.filter(file => reader.suffixes.some(suffix => file.path.toLowerCase().endsWith(suffix))),
      })),
      errors: tree.errors,
    };
  }

  private async readEntries(sets: readonly IModelSet[], errors: ModelScanError[]): Promise<ModelEntry[]> {
    const ordered = [...sets].sort((left, right) => left.path.localeCompare(right.path));
    const read: ModelEntry[] = [];
    const seen = new Set<string>();

    for (const set of ordered) {
      const entry = await this.readEntry(set, errors);

      if (entry === null || seen.has(entry.fingerprint)) {
        continue;
      }

      seen.add(entry.fingerprint);
      read.push(entry);
    }

    return this.withinTensorBudget(this.capped(read, errors));
  }

  /** Keeps the node's largest tensors. A model losing some from its list then has its estimate err high. */
  private withinTensorBudget(entries: ModelEntry[]): ModelEntry[] {
    const kept = new Set<GgufTensor>(
      entries
        .flatMap(entry => entry.ggufMetadata?.tensors ?? [])
        .sort((left, right) => right.sizeBytes - left.sizeBytes)
        .slice(0, MAX_INVENTORY_TENSORS)
    );

    return entries.map(entry => {
      const metadata = entry.ggufMetadata;

      if (metadata?.tensors === null || metadata?.tensors === undefined) {
        return entry;
      }

      return { ...entry, ggufMetadata: { ...metadata, tensors: metadata.tensors.filter(tensor => kept.has(tensor)) } };
    });
  }

  /** Appends to `errors` where the cap drops files. Every type counts against it alike. */
  private capped(read: readonly ModelEntry[], errors: ModelScanError[]): ModelEntry[] {
    if (read.length <= MAX_MODELS_PER_NODE) {
      return [...read];
    }

    errors.push(
      this.error(
        ModelScanErrorScope.INVENTORY,
        null,
        `This node holds ${String(read.length)} model files, of which only the first ${String(MAX_MODELS_PER_NODE)} are reported`
      )
    );

    return read.slice(0, MAX_MODELS_PER_NODE);
  }

  /** Appends to `errors` and returns null where the file cannot be read. */
  private async readEntry(set: IModelSet, errors: ModelScanError[]): Promise<ModelEntry | null> {
    const path = set.path;
    const reader = this.byFormat.get(set.format);

    if (reader === undefined) {
      errors.push(this.error(ModelScanErrorScope.MODEL, path, `No reader claims the ${set.format} format`));

      return null;
    }

    const stream = new ShardReader(set.files);

    try {
      const read = await reader.read(stream, set);

      if (read === null) {
        return null;
      }

      return this.boundedMetadata({
        fingerprint: await this.modelFingerprintService.digest(stream),
        format: set.format,
        type: read.type,
        sizeBytes: set.sizeBytes,
        path,
        shardCount: set.files.length,
        name: (read.name ?? set.name).slice(0, MAX_MODEL_NAME_LENGTH),
        ...NO_FORMAT_FIELDS,
        ...read.fields,
        ...NO_DESCRIPTION,
        ...read.description,
        licence: this.boundedLicence(read.description.licence ?? null),
      });
    } catch (error: unknown) {
      errors.push(this.error(ModelScanErrorScope.MODEL, path, this.messageOf(error)));

      return null;
    } finally {
      await stream.close();
    }
  }

  /** Past the protocol's caps, one file's header would fail the encode of the node's whole inventory. */
  private boundedMetadata(entry: ModelEntry): ModelEntry {
    const { ggufMetadata, safetensorsMetadata } = entry;

    return {
      ...entry,
      ggufMetadata:
        ggufMetadata === null
          ? null
          : {
              ...ggufMetadata,
              architecture: this.within(ggufMetadata.architecture, MAX_ARCHITECTURE_LENGTH),
              quantisation: this.within(ggufMetadata.quantisation, MAX_QUANTISATION_LENGTH),
            },
      safetensorsMetadata:
        safetensorsMetadata === null
          ? null
          : {
              ...safetensorsMetadata,
              dtype: this.within(safetensorsMetadata.dtype, MAX_DTYPE_LENGTH),
              architecture: this.within(safetensorsMetadata.architecture, MAX_ARCHITECTURE_LENGTH),
            },
    };
  }

  /** Null where the value runs past `limit`, since a cut name would name something else. */
  private within<TValue extends string | null | undefined>(value: TValue, limit: number): TValue | null {
    return typeof value === 'string' && value.length > limit ? null : value;
  }

  /** Past the protocol's caps, one card's licence would fail the encode of the node's whole inventory. */
  private boundedLicence(licence: ModelLicence | null): ModelLicence | null {
    if (licence === null || licence.id.length > MAX_LICENCE_ID_LENGTH) {
      return null;
    }

    return {
      id: licence.id,
      name: licence.name !== null && licence.name.length <= MAX_LICENCE_NAME_LENGTH ? licence.name : null,
      link: licence.link !== null && licence.link.length <= MAX_LICENCE_LINK_LENGTH ? licence.link : null,
    };
  }

  private error(scope: ModelScanErrorScope, path: string | null, message: string): ModelScanError {
    return { scope, path, message: message.slice(0, MAX_MESSAGE_LENGTH) };
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'The model could not be read';
  }
}
