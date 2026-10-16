import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';
import { InstanceChangeReason } from '@libs/dto';

import { Instance } from '@/core/instance/entities/instance.entity';

import { DeploymentService } from '@/core/deployment/deployment.service';
import { InstanceObservationService } from '@/core/instance/instance-observation.service';
import { InstanceService } from '@/core/instance/instance.service';
import { NodeStateService } from '@/core/node/node-state.service';

import { TEST_DEPLOYMENT_ID } from '@/test/deployment.factory';
import { buildInstance, buildObservedInstance, TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

const REPORTED_DATE = new Date('2026-08-20T12:00:00.000Z');
const UNKNOWN_KEY = '01999999-3333-7333-8333-333333333333';

describe('InstanceObservationService', () => {
  let reports: Subject<number>;
  let nodeStateService: { getObservedReports: () => Subject<number>; getObserved: ReturnType<typeof vi.fn> };
  let instanceRepository: { find: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let instanceService: {
    announceChanged: ReturnType<typeof vi.fn>;
    findByNodeId: ReturnType<typeof vi.fn>;
    takeDown: ReturnType<typeof vi.fn>;
  };
  let deploymentService: {
    recordLaunchFailure: ReturnType<typeof vi.fn>;
    clearLaunchFailures: ReturnType<typeof vi.fn>;
  };
  let instanceObservationService: InstanceObservationService;

  const report = (...instances: ReturnType<typeof buildObservedInstance>[]) => ({
    desiredGeneration: 1,
    instances,
    reportedDate: REPORTED_DATE,
  });

  beforeEach(async () => {
    reports = new Subject<number>();

    nodeStateService = {
      getObservedReports: () => reports,
      getObserved: vi.fn().mockReturnValue(report(buildObservedInstance())),
    };

    instanceRepository = {
      find: vi.fn().mockResolvedValue([buildInstance()]),
      update: vi.fn().mockResolvedValue(undefined),
    };

    deploymentService = {
      recordLaunchFailure: vi.fn().mockResolvedValue(undefined),
      clearLaunchFailures: vi.fn().mockResolvedValue(undefined),
    };

    instanceService = {
      announceChanged: vi.fn(),
      findByNodeId: vi.fn().mockResolvedValue([buildInstance()]),
      takeDown: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceObservationService,
        { provide: DeploymentService, useValue: deploymentService },
        { provide: NodeStateService, useValue: nodeStateService },
        { provide: InstanceService, useValue: instanceService },
        { provide: getRepositoryToken(Instance), useValue: instanceRepository },
      ],
    }).compile();

    instanceObservationService = moduleRef.get(InstanceObservationService);
    instanceObservationService.onModuleInit();
  });

  /** Resolves once the write path has run to completion, so a negative assertion means nothing was written. */
  const reportArrives = async () => {
    reports.next(TEST_NODE_ID);

    await vi.waitFor(() => {
      expect(instanceRepository.find).toHaveBeenCalled();
    });

    await Promise.resolve();
  };

  it("writes the node's report onto the instance it names", async () => {
    await reportArrives();

    await vi.waitFor(() => {
      expect(instanceRepository.update).toHaveBeenCalledWith(
        { id: 5 },
        {
          instanceState: InstanceState.READY,
          message: null,
          exitCode: null,
          reportedDate: REPORTED_DATE,
          readyDate: REPORTED_DATE,
        }
      );
    });
  });

  it('announces the change against the deployment the instance belongs to', async () => {
    await reportArrives();

    await vi.waitFor(() => {
      expect(instanceService.announceChanged).toHaveBeenCalledWith([TEST_DEPLOYMENT_ID]);
    });
  });

  it('keeps when an instance first became ready, since its deployment idles from then', async () => {
    const readyBefore = new Date('2026-08-20T10:00:00.000Z');

    instanceRepository.find.mockResolvedValue([
      buildInstance({ instanceState: InstanceState.READY, readyDate: readyBefore, message: 'old' }),
    ]);

    await reportArrives();

    await vi.waitFor(() => expect(instanceRepository.update).toHaveBeenCalled());

    expect(instanceRepository.update.mock.calls[0][1]).not.toHaveProperty('readyDate');
  });

  it("ends the deployment's run of failed launches once an instance becomes ready", async () => {
    await reportArrives();

    await vi.waitFor(() => {
      expect(deploymentService.clearLaunchFailures).toHaveBeenCalledWith(TEST_DEPLOYMENT_ID);
    });
  });

  it("counts a failed launch against its deployment, with the backend's own output", async () => {
    nodeStateService.getObserved.mockReturnValue(
      report(
        buildObservedInstance({ instanceState: InstanceState.FAILED, message: 'CUDA out of memory', uptimeMs: null })
      )
    );

    await reportArrives();

    await vi.waitFor(() => {
      expect(deploymentService.recordLaunchFailure).toHaveBeenCalledWith(
        TEST_DEPLOYMENT_ID,
        new Date('2026-08-20T09:00:00Z'),
        REPORTED_DATE,
        'CUDA out of memory'
      );
    });
  });

  it('counts the failure before writing it, so whatever reads the failed row reads its backoff', async () => {
    nodeStateService.getObserved.mockReturnValue(
      report(buildObservedInstance({ instanceState: InstanceState.FAILED, uptimeMs: null }))
    );

    await reportArrives();
    await vi.waitFor(() => expect(instanceRepository.update).toHaveBeenCalled());

    expect(deploymentService.recordLaunchFailure.mock.invocationCallOrder[0]).toBeLessThan(
      instanceRepository.update.mock.invocationCallOrder[0]
    );
  });

  it('counts no launch failure for an instance that crashed after it was ready', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance({ instanceState: InstanceState.READY })]);
    nodeStateService.getObserved.mockReturnValue(
      report(buildObservedInstance({ instanceState: InstanceState.FAILED, uptimeMs: null, exitCode: 139 }))
    );

    await reportArrives();

    await vi.waitFor(() => expect(instanceRepository.update).toHaveBeenCalled());

    expect(deploymentService.recordLaunchFailure).not.toHaveBeenCalled();
  });

  it('counts a failure once, however many reports repeat it', async () => {
    instanceRepository.find.mockResolvedValue([
      buildInstance({ instanceState: InstanceState.FAILED, message: 'before' }),
    ]);
    nodeStateService.getObserved.mockReturnValue(
      report(buildObservedInstance({ instanceState: InstanceState.FAILED, message: 'after', uptimeMs: null }))
    );

    await reportArrives();
    await vi.waitFor(() => expect(instanceRepository.update).toHaveBeenCalled());

    expect(deploymentService.recordLaunchFailure).not.toHaveBeenCalled();
  });

  it('keeps the exit code and the message of an instance that exited on its own', async () => {
    nodeStateService.getObserved.mockReturnValue(
      report(
        buildObservedInstance({
          instanceState: InstanceState.FAILED,
          message: 'error: failed to load model',
          exitCode: 1,
          uptimeMs: null,
        })
      )
    );

    await reportArrives();

    await vi.waitFor(() => {
      expect(instanceRepository.update).toHaveBeenCalledWith(
        { id: 5 },
        expect.objectContaining({
          instanceState: InstanceState.FAILED,
          exitCode: 1,
          message: 'error: failed to load model',
        })
      );
    });
  });

  it('writes nothing where the report says what the row already holds', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance({ instanceState: InstanceState.READY })]);

    await reportArrives();

    expect(instanceRepository.update).not.toHaveBeenCalled();
  });

  it('creates nothing for an instance the node reports and the server has no row for', async () => {
    nodeStateService.getObserved.mockReturnValue(report(buildObservedInstance({ instanceKey: UNKNOWN_KEY })));
    instanceRepository.find.mockResolvedValue([buildInstance({ instanceKey: TEST_INSTANCE_KEY })]);

    await reportArrives();

    expect(instanceRepository.update).not.toHaveBeenCalled();
  });

  it('stops an instance whose launch overran its timeout, since its container still holds what it loaded', async () => {
    const overrun = buildInstance({ instanceState: InstanceState.FAILED });

    nodeStateService.getObserved.mockReturnValue(
      report(buildObservedInstance({ instanceState: InstanceState.FAILED, uptimeMs: null, overran: true }))
    );
    instanceService.findByNodeId.mockResolvedValue([overrun, buildInstance({ instanceKey: UNKNOWN_KEY })]);

    await reportArrives();

    await vi.waitFor(() => {
      expect(instanceService.takeDown).toHaveBeenCalledWith(
        [overrun],
        expect.objectContaining({ actorId: null, reason: InstanceChangeReason.LAUNCH_OVERRAN })
      );
    });
  });

  it('leaves a failed instance that exited on its own, which holds no memory', async () => {
    nodeStateService.getObserved.mockReturnValue(
      report(buildObservedInstance({ instanceState: InstanceState.FAILED, uptimeMs: null, exitCode: 1 }))
    );

    await reportArrives();
    await Promise.resolve();

    expect(instanceService.takeDown).not.toHaveBeenCalled();
  });
});
