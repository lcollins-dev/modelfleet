import { BadRequestException, Injectable } from '@nestjs/common';
import { upperFirst } from 'lodash';
import { isMap, parse, parseDocument } from 'yaml';
import { z } from 'zod';

import {
  BackendId,
  CONFIGURATION_SCHEMA_VERSION,
  configurationSchema,
  declarationFor,
  definitionFor,
  IInstancePins,
  pinsRefusal,
  PinsRefusal,
} from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

import { configurationDocumentSchema } from './schema/document';
import { fleetSchema, placementSchema, splitByOwner } from './schema/fleet';
import { fieldRefusal, toValidationErrors } from '@/common/validation-errors';

const PLACEMENT_KEY = 'placement';

const PINS_REFUSAL_MESSAGES: Record<PinsRefusal, string> = {
  [PinsRefusal.SEVERAL_DEVICES]: 'Pins several GPUs on one node, and this backend runs on a single GPU.',
  [PinsRefusal.CPU_BESIDE_DEVICES]:
    "Pins a node's CPU beside its GPUs, and this backend cannot offload to host memory.",
};

interface IConfigurationIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** The three columns a stored configuration occupies. Only `derive` builds one, so they cannot disagree. */
export interface IStoredConfiguration {
  schemaVersion: number;
  document: string;
  configuration: ConfigurationDocument;
}

@Injectable()
export class ConfigurationService {
  /** Throws on any issue, so a write never lands half validated. */
  derive(document: string, backend: BackendId): IStoredConfiguration {
    const parsed = this.parseDocument(document);
    const halves = splitByOwner(parsed);

    const fleetIssues = this.parseIssues(fleetSchema(), halves.fleet);
    const issues = [
      ...fleetIssues,
      ...(fleetIssues.length > 0 ? [] : this.placementIssues(halves.fleet[PLACEMENT_KEY], backend)),
      ...this.parseIssues(configurationSchema(declarationFor(backend)), halves.backend),
    ];

    if (issues.length > 0) {
      throw fieldRefusal(toValidationErrors(issues));
    }

    return { schemaVersion: CONFIGURATION_SCHEMA_VERSION, document, configuration: parsed };
  }

  /** Rewrites the authored YAML, so the comments and key order around the removed keys survive. */
  withoutKeys(document: string, keys: string[]): string {
    if (keys.length === 0) {
      return document;
    }

    const parsed = parseDocument(document);

    if (!isMap(parsed.contents)) {
      return document;
    }

    for (const key of keys) {
      parsed.delete(key);
    }

    return String(parsed);
  }

  parseDocument(document: string): ConfigurationDocument {
    let parsed: unknown;

    try {
      parsed = parse(document);
    } catch (error) {
      throw new BadRequestException(`The configuration contains invalid YAML: ${this.parseErrorMessage(error)}`);
    }

    if (parsed === null || parsed === undefined) {
      return {};
    }

    const result = configurationDocumentSchema.safeParse(parsed);

    if (!result.success) {
      throw new BadRequestException('The configuration must contain settings as key-value pairs');
    }

    return result.data;
  }

  private placementIssues(value: unknown, backend: BackendId): IConfigurationIssue[] {
    const placement = placementSchema.nullish().parse(value);
    const pinsByNode = new Map<number, IInstancePins>();

    for (const nodeId of placement?.nodeIds ?? []) {
      pinsByNode.set(nodeId, { cpu: true, gpus: [] });
    }

    for (const gpu of placement?.gpus ?? []) {
      const pins = pinsByNode.get(gpu.nodeId) ?? { cpu: false, gpus: [] };

      pinsByNode.set(gpu.nodeId, { ...pins, gpus: [...pins.gpus, gpu.deviceKey] });
    }

    const container = definitionFor(backend).container;
    const refusals = new Set([...pinsByNode.values()].map(pins => pinsRefusal(container, pins)));

    return [...refusals]
      .filter(refusal => refusal !== null)
      .map(refusal => ({ path: [PLACEMENT_KEY], message: PINS_REFUSAL_MESSAGES[refusal] }));
  }

  private parseErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message.split('\n')[0] : 'it could not be read';
  }

  private parseIssues(schema: z.ZodType, document: ConfigurationDocument): IConfigurationIssue[] {
    const result = schema.safeParse(document);

    if (result.success) {
      return [];
    }

    return result.error.issues.map(issue => ({
      path: issue.path,
      message: this.issueMessage(issue.path, issue.message),
    }));
  }

  private issueMessage(path: readonly PropertyKey[], message: string): string {
    const inside = this.pathLabel(path.slice(1));

    return inside === '' ? `${upperFirst(message)}.` : `${inside} ${message}.`;
  }

  private pathLabel(path: readonly PropertyKey[]): string {
    return path
      .map((segment, index) =>
        typeof segment === 'number' ? `[${segment}]` : `${index === 0 ? '' : '.'}${String(segment)}`
      )
      .join('');
  }
}
