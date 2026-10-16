import { Injectable, Logger } from '@nestjs/common';
import { access, open } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

import { MAX_ARCHITECTURE_LENGTH, ModelTask } from '@libs/agent-protocol';
import {
  ARCHITECTURE_SUFFIX_TASKS,
  ARCHITECTURE_TASKS,
  CONFIG_KEY_TASKS,
  FILE_TASKS,
  MODEL_TYPE_TASKS,
  PIPELINE_TAG_TASKS,
} from '@libs/backends';

import { ModelDescription } from './types/format-reader';

const CARD_NAME = 'README.md';
const CONFIG_NAME = 'config.json';

/** The card's front matter must close inside this many bytes. */
const MAX_CARD_BYTES = 64 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;

const FRONT_MATTER_FENCE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const NO_TASKS: readonly ModelTask[] = [];

type ICardMetadata = Pick<ModelDescription, 'tasks' | 'licence'>;

export interface IRepositoryMetadata extends ICardMetadata {
  architecture: string | null;
}

type ConfigJson = Record<string, unknown>;

/** Never throws: anything unreadable reads as unstated. */
@Injectable()
export class RepositoryMetadataService {
  private readonly logger = new Logger(RepositoryMetadataService.name);

  async read(directory: string): Promise<IRepositoryMetadata> {
    const config = await this.readConfig(directory);
    const card = await this.readCard(directory);

    // Keep this order in step with `task-detection.ts` in `@libs/backends`.
    let tasks = this.tasksOfArchitectures(config);

    if (tasks.length === 0) {
      tasks = card.tasks;
    }

    if (tasks.length === 0) {
      tasks = await this.tasksFromFiles(directory);
    }

    if (tasks.length === 0) {
      tasks = this.tasksFromConfig(config);
    }

    return { tasks: [...tasks], licence: card.licence, architecture: this.architectureOf(config) };
  }

  private async readCard(directory: string): Promise<ICardMetadata> {
    const unstated: ICardMetadata = { tasks: [], licence: null };
    const head = await this.readHead(join(directory, CARD_NAME), MAX_CARD_BYTES);
    const fenced = head === null ? null : FRONT_MATTER_FENCE.exec(head.toString('utf8'));

    if (fenced === null) {
      return unstated;
    }

    let matter: unknown;

    try {
      matter = parse(fenced[1], { maxAliasCount: 0 });
    } catch {
      this.logger.debug({ directory }, 'readCard(): The model card front matter is not YAML');

      return unstated;
    }

    if (!this.isRecord(matter)) {
      return unstated;
    }

    const tag = this.textOf(matter.pipeline_tag);
    const id = this.textOf(matter.license);

    return {
      tasks: tag === null ? [] : [...(PIPELINE_TAG_TASKS.get(tag) ?? NO_TASKS)],
      licence:
        id === null ? null : { id, name: this.textOf(matter.license_name), link: this.textOf(matter.license_link) },
    };
  }

  private async readConfig(directory: string): Promise<ConfigJson | null> {
    const head = await this.readHead(join(directory, CONFIG_NAME), MAX_CONFIG_BYTES + 1);

    if (head === null || head.length > MAX_CONFIG_BYTES) {
      return null;
    }

    let config: unknown;

    try {
      config = JSON.parse(head.toString('utf8'));
    } catch {
      return null;
    }

    return this.isRecord(config) ? config : null;
  }

  /** Past the protocol's cap, one architecture would fail the encode of the node's whole inventory. */
  private architectureOf(config: ConfigJson | null): string | null {
    const modelType = this.textOf(config?.model_type);

    return modelType === null || modelType.length > MAX_ARCHITECTURE_LENGTH ? null : modelType;
  }

  private architecturesOf(config: ConfigJson | null): string[] {
    const architectures = Array.isArray(config?.architectures) ? config.architectures : [];

    return architectures.filter(architecture => typeof architecture === 'string');
  }

  private tasksOfArchitectures(config: ConfigJson | null): readonly ModelTask[] {
    for (const architecture of this.architecturesOf(config)) {
      const tasks = ARCHITECTURE_TASKS.get(architecture);

      if (tasks !== undefined) {
        return tasks;
      }
    }

    return NO_TASKS;
  }

  private async tasksFromFiles(directory: string): Promise<readonly ModelTask[]> {
    for (const [name, tasks] of FILE_TASKS) {
      if (await this.exists(join(directory, name))) {
        return tasks;
      }
    }

    return NO_TASKS;
  }

  private tasksFromConfig(config: ConfigJson | null): readonly ModelTask[] {
    if (config === null) {
      return NO_TASKS;
    }

    for (const architecture of this.architecturesOf(config)) {
      for (const [suffix, tasks] of ARCHITECTURE_SUFFIX_TASKS) {
        if (architecture.endsWith(suffix)) {
          return tasks;
        }
      }
    }

    for (const { keys, tasks } of CONFIG_KEY_TASKS) {
      if (keys.every(key => this.isRecord(config[key]))) {
        return tasks;
      }
    }

    const modelType = this.textOf(config.model_type);

    return modelType === null ? NO_TASKS : (MODEL_TYPE_TASKS.get(modelType) ?? NO_TASKS);
  }

  private async readHead(path: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const handle = await open(path, 'r');

      try {
        const length = Math.min(maxBytes, (await handle.stat()).size);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);

        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);

      return true;
    } catch {
      return false;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private textOf(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }
}
