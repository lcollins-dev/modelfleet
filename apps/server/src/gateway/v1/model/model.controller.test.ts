import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { DeploymentService } from '@/core/deployment/deployment.service';

import { ModelController } from './model.controller';

const buildDeployment = (id: number, name: string): Deployment => {
  const deployment = { id, name, createdDate: new Date('2026-09-01T00:00:00Z') } as Deployment;

  return deployment;
};

describe('ModelController', () => {
  let deploymentService: { findAll: ReturnType<typeof vi.fn> };
  let modelController: ModelController;

  beforeEach(() => {
    deploymentService = {
      findAll: vi.fn().mockResolvedValue([buildDeployment(1, 'chat-8b'), buildDeployment(2, 'embed-small')]),
    };
    modelController = new ModelController(deploymentService as unknown as DeploymentService);
  });

  it('lists every deployment as an OpenAI model, resident or not', async () => {
    const listed = await modelController.list();

    expect(listed.object).toBe('list');
    expect(listed.data).toEqual([
      { id: 'chat-8b', object: 'model', created: 1788220800, owned_by: 'modelfleet' },
      { id: 'embed-small', object: 'model', created: 1788220800, owned_by: 'modelfleet' },
    ]);
  });
});
