import { ActivationPolicy } from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { buildModel, TEST_MODEL_ID } from '@/test/model.factory';
import { buildPreset, TEST_PRESET_ID } from '@/test/preset.factory';

export const TEST_DEPLOYMENT_ID = 3;

export const TEST_REVISION = 'a'.repeat(64);

/** Builds a deployment as a row read back from the database, its model and preset relations loaded. */
export const buildDeployment = (overrides: Partial<Deployment> = {}): Deployment => {
  const deployment = new Deployment({
    name: 'llama-chat',
    modelId: TEST_MODEL_ID,
    presetId: TEST_PRESET_ID,
    backend: null,
    activationPolicy: ActivationPolicy.ALWAYS,
    description: null,
    schemaVersion: 1,
    document: 'threads: 8\n',
    configuration: { threads: 8 },
    configurationRevision: TEST_REVISION,
    appliedRevision: TEST_REVISION,
  });

  deployment.id = TEST_DEPLOYMENT_ID;
  deployment.model = buildModel();
  deployment.preset = buildPreset();
  deployment.createdDate = new Date('2026-08-20T09:00:00Z');
  deployment.updatedDate = new Date('2026-08-20T09:00:00Z');

  Object.assign(deployment, overrides);

  return deployment;
};
