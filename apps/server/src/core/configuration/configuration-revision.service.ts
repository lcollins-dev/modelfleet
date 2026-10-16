import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { BackendId } from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

import { ConfigurationValueService } from './configuration-value.service';

import { HOT_FIELDS } from './schema/fleet';

export interface IRevisionInput {
  backend: BackendId;
  modelId: number;

  /** The effective configuration, not a deployment's own keys. */
  configuration: ConfigurationDocument;
}

@Injectable()
export class ConfigurationRevisionService {
  constructor(private readonly configurationValueService: ConfigurationValueService) {}

  /** Digests what a running instance would have to be relaunched to pick up, and nothing else. */
  revisionOf(input: IRevisionInput): string {
    const keys = Object.keys(input.configuration)
      .filter(key => !HOT_FIELDS.includes(key))
      .sort();

    const payload = [
      input.backend,
      `${input.modelId}`,
      ...keys.map(key => `${key}=${this.configurationValueService.canonical(input.configuration[key])}`),
    ].join('\n');

    return createHash('sha256').update(payload).digest('hex');
  }
}
