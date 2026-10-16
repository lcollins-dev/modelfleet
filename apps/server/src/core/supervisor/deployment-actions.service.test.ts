import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';
import { ActivationPolicy, EventType, InstanceChangeReason } from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';
import { Instance } from '@/core/instance/entities/instance.entity';

import { EventService } from '@/core/event/event.service';
import { InstanceAdmissionService } from '@/core/instance/instance-admission.service';
import { INodePlacement } from '@/core/instance/instance-launch.service';
import { InstanceService } from '@/core/instance/instance.service';
import { IFitReport } from '@/core/ledger/vram-ledger.service';
import { NodeService } from '@/core/node/node.service';
import { DeploymentActionsService } from '@/core/supervisor/deployment-actions.service';

import { AcquireRefusal } from '@/core/supervisor/supervisor.types';
import { buildDeployment } from '@/test/deployment.factory';
import { buildInstance } from '@/test/instance.factory';

const refusedOn = (problem: string, capacity?: IFitReport): INodePlacement =>
  ({ nodeId: 1, problem, ...(capacity === undefined ? {} : { capacity }) }) as INodePlacement;

describe('DeploymentActionsService', () => {
  let deployment: Deployment;
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let instanceService: { takeDown: ReturnType<typeof vi.fn>; bringUp: ReturnType<typeof vi.fn> };
  let deploymentActionsService: DeploymentActionsService;

  beforeEach(() => {
    deployment = buildDeployment({ activationPolicy: ActivationPolicy.ON_DEMAND });
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    instanceService = {
      takeDown: vi.fn().mockResolvedValue(undefined),
      bringUp: vi.fn().mockResolvedValue({ started: [buildInstance()], refused: [] }),
    };

    deploymentActionsService = new DeploymentActionsService(
      eventService as unknown as EventService,
      { capacityDetail: vi.fn().mockReturnValue({ expectedBytes: 1 }) } as unknown as InstanceAdmissionService,
      instanceService as unknown as InstanceService,
      { find: vi.fn().mockResolvedValue({ name: 'gpu-box' }) } as unknown as NodeService
    );
  });

  describe('start', () => {
    it('drops the failed instances before the start, so the replacement is created against a node short again', async () => {
      const failed = buildInstance({ instanceState: InstanceState.FAILED });

      await deploymentActionsService.start(deployment, [failed], 0);

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        [failed],
        expect.objectContaining({ reason: InstanceChangeReason.INSTANCE_FAILED })
      );
      expect(instanceService.takeDown.mock.invocationCallOrder[0]).toBeLessThan(
        instanceService.bringUp.mock.invocationCallOrder[0]
      );
    });

    it.each([
      [ActivationPolicy.ON_DEMAND, InstanceChangeReason.ON_REQUEST],
      [ActivationPolicy.ALWAYS, InstanceChangeReason.ALWAYS_POLICY],
    ])('records a start of an %s deployment under the rule that asked for it', async (activationPolicy, reason) => {
      deployment.activationPolicy = activationPolicy;

      await deploymentActionsService.start(deployment, [], 0);

      expect(instanceService.bringUp).toHaveBeenCalledWith(deployment.id, expect.objectContaining({ reason }));
    });

    it('refuses nothing where something started', async () => {
      await expect(deploymentActionsService.start(deployment, [], 0)).resolves.toBeNull();
    });

    it('refuses nothing where a node was passed over but an instance was already on its way', async () => {
      instanceService.bringUp.mockResolvedValue({ started: [], refused: [refusedOn('full', {} as IFitReport)] });

      const refused = await deploymentActionsService.start(
        deployment,
        [buildInstance({ instanceState: InstanceState.STARTING })],
        1
      );

      expect(refused).toBeNull();
    });

    it('refuses as not fitting where the ledger refused any node, since memory freeing would change the answer', async () => {
      instanceService.bringUp.mockResolvedValue({
        started: [],
        refused: [refusedOn('This node does not hold the model'), refusedOn('Needs 20.0 GiB', {} as IFitReport)],
      });

      await expect(deploymentActionsService.start(deployment, [], 0)).resolves.toEqual({
        refusal: AcquireRefusal.DOES_NOT_FIT,
        problem: 'This node does not hold the model. Needs 20.0 GiB',
      });
    });

    it('refuses as unable to start where the start refuses outright, with its reason', async () => {
      instanceService.bringUp.mockRejectedValue(new BadRequestException('This deployment is disabled'));

      await expect(deploymentActionsService.start(deployment, [], 0)).resolves.toEqual({
        refusal: AcquireRefusal.CANNOT_START,
        problem: 'This deployment is disabled',
      });
    });

    it('refuses nothing where nothing started and nothing was refused, as when a start by hand got there first', async () => {
      instanceService.bringUp.mockResolvedValue({ started: [], refused: [] });

      await expect(deploymentActionsService.start(deployment, [], 0)).resolves.toBeNull();
    });
  });

  describe('the refusal it records', () => {
    const refuse = (problem: string) =>
      instanceService.bringUp.mockResolvedValue({ started: [], refused: [refusedOn(problem, {} as IFitReport)] });

    it('records a standing refusal once, naming the node and carrying the ledger figures', async () => {
      refuse('Needs 20.0 GiB');

      await deploymentActionsService.start(deployment, [], 0);
      await deploymentActionsService.start(deployment, [], 0);

      expect(eventService.recordEvent).toHaveBeenCalledTimes(1);
      const [type, , event] = eventService.recordEvent.mock.calls[0] as [EventType, unknown, { detail: unknown }];

      expect(type).toBe(EventType.INSTANCE_START_REFUSED);
      expect(event.detail).toMatchObject({ problem: 'gpu-box: Needs 20.0 GiB', nodeName: 'gpu-box', expectedBytes: 1 });
    });

    it('records it again once the constraint changes', async () => {
      refuse('Needs 20.0 GiB');
      await deploymentActionsService.start(deployment, [], 0);

      refuse('Needs 30.0 GiB');
      await deploymentActionsService.start(deployment, [], 0);

      expect(eventService.recordEvent).toHaveBeenCalledTimes(2);
    });

    it('records it again after a start that went ahead, or after the deployment was let go of', async () => {
      refuse('Needs 20.0 GiB');
      await deploymentActionsService.start(deployment, [], 0);

      instanceService.bringUp.mockResolvedValueOnce({ started: [buildInstance()], refused: [] });
      await deploymentActionsService.start(deployment, [], 0);
      await deploymentActionsService.start(deployment, [], 0);

      deploymentActionsService.forget(deployment.id);
      await deploymentActionsService.start(deployment, [], 0);

      expect(eventService.recordEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe('stops', () => {
    it('stops an idle deployment, saying how long it idled', async () => {
      const instances: Instance[] = [buildInstance()];

      await deploymentActionsService.stopIdle(instances, 1_800_000);

      expect(instanceService.takeDown).toHaveBeenCalledWith(instances, {
        actorId: null,
        reason: InstanceChangeReason.IDLE_TIMEOUT,
        note: ' after 30m idle',
      });
    });

    it('stops a disabled deployment, saying why', async () => {
      await deploymentActionsService.stopDisabled([buildInstance()]);

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ reason: InstanceChangeReason.DEPLOYMENT_DISABLED })
      );
    });
  });
});
