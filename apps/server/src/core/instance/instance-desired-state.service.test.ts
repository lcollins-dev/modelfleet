import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Instance } from '@/core/instance/entities/instance.entity';

import { DeploymentService } from '@/core/deployment/deployment.service';
import { InstanceDesiredStateService } from '@/core/instance/instance-desired-state.service';
import { InstanceLaunchService } from '@/core/instance/instance-launch.service';
import { NodeStateService } from '@/core/node/node-state.service';

import { buildDeployment } from '@/test/deployment.factory';
import { buildDesiredInstance, buildInstance, TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

const OTHER_KEY = '01999999-2222-7222-8222-222222222222';

describe('InstanceDesiredStateService', () => {
  let instanceLaunchService: { describe: ReturnType<typeof vi.fn> };
  let nodeStateService: { setDesiredInstances: ReturnType<typeof vi.fn> };
  let instanceRepository: { find: ReturnType<typeof vi.fn> };
  let instanceDesiredStateService: InstanceDesiredStateService;

  beforeEach(async () => {
    instanceLaunchService = {
      describe: vi
        .fn()
        .mockImplementation((instance: Instance) =>
          Promise.resolve(buildDesiredInstance({ instanceKey: instance.instanceKey }))
        ),
    };

    nodeStateService = { setDesiredInstances: vi.fn() };
    instanceRepository = { find: vi.fn().mockResolvedValue([buildInstance({ deployment: buildDeployment() })]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceDesiredStateService,
        { provide: DeploymentService, useValue: { deploymentRemoved: () => new Subject<number>() } },
        { provide: InstanceLaunchService, useValue: instanceLaunchService },
        { provide: NodeStateService, useValue: nodeStateService },
        { provide: getRepositoryToken(Instance), useValue: instanceRepository },
      ],
    }).compile();

    instanceDesiredStateService = moduleRef.get(InstanceDesiredStateService);
  });

  it('sends the node every instance it holds a row for', async () => {
    await instanceDesiredStateService.publish(TEST_NODE_ID);

    expect(nodeStateService.setDesiredInstances).toHaveBeenCalledWith(TEST_NODE_ID, [
      expect.objectContaining({ instanceKey: TEST_INSTANCE_KEY }),
    ]);
  });

  it('leaves out an instance the server refuses to describe, so its container stops', async () => {
    instanceRepository.find.mockResolvedValue([
      buildInstance({ deployment: buildDeployment() }),
      buildInstance({ instanceKey: OTHER_KEY, deployment: buildDeployment() }),
    ]);
    instanceLaunchService.describe.mockRejectedValueOnce(new BadRequestException('the node no longer holds its model'));

    await instanceDesiredStateService.publish(TEST_NODE_ID);

    expect(nodeStateService.setDesiredInstances).toHaveBeenCalledWith(TEST_NODE_ID, [
      expect.objectContaining({ instanceKey: OTHER_KEY }),
    ]);
  });

  it('keeps the node its whole set rather than shrinking it when a read fails', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance({ deployment: buildDeployment() })]);
    instanceLaunchService.describe.mockRejectedValue(new Error('the connection dropped'));

    await expect(instanceDesiredStateService.publish(TEST_NODE_ID)).rejects.toThrow();

    expect(nodeStateService.setDesiredInstances).not.toHaveBeenCalled();
  });

  it('rebuilds every node holding an instance on boot, since desired state lives in memory', async () => {
    instanceRepository.find.mockResolvedValueOnce([
      buildInstance({ nodeId: 1 }),
      buildInstance({ nodeId: 2 }),
      buildInstance({ nodeId: 1 }),
    ]);

    await instanceDesiredStateService.onModuleInit();

    expect(nodeStateService.setDesiredInstances).toHaveBeenCalledTimes(2);
    expect(nodeStateService.setDesiredInstances).toHaveBeenCalledWith(1, expect.any(Array));
    expect(nodeStateService.setDesiredInstances).toHaveBeenCalledWith(2, expect.any(Array));
  });
});
