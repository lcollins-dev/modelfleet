import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';

import { Instance } from '@/core/instance/entities/instance.entity';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { InstanceLeaseService } from '@/core/supervisor/instance-lease.service';

import { buildInstance } from '@/test/instance.factory';

const DEPLOYMENT_ID = 7;

const RELAY = { url: 'http://node', token: 'token' };

const instanceOf = (id: number, instanceState = InstanceState.READY): Instance =>
  buildInstance({ id, nodeId: id, instanceKey: `0199999${id}-3333-7333-8333-333333333333`, instanceState });

describe('InstanceLeaseService', () => {
  let agentConnectionService: { relayFor: ReturnType<typeof vi.fn> };
  let deploymentService: { stampLastUsed: Mock<DeploymentService['stampLastUsed']> };
  let instanceLeaseService: InstanceLeaseService;

  beforeEach(() => {
    agentConnectionService = { relayFor: vi.fn().mockReturnValue(RELAY) };
    deploymentService = { stampLastUsed: vi.fn<DeploymentService['stampLastUsed']>().mockResolvedValue(undefined) };

    instanceLeaseService = new InstanceLeaseService(
      agentConnectionService as unknown as AgentConnectionService,
      deploymentService as unknown as DeploymentService
    );
  });

  it('leases the ready instance carrying the fewest requests, and counts each once however often released', async () => {
    const instances = [instanceOf(1), instanceOf(2)];

    const first = await instanceLeaseService.lease(DEPLOYMENT_ID, instances);
    const second = await instanceLeaseService.lease(DEPLOYMENT_ID, instances);

    first?.release();
    first?.release();

    const third = await instanceLeaseService.lease(DEPLOYMENT_ID, instances);

    expect([first?.nodeId, second?.nodeId, third?.nodeId]).toEqual([1, 2, 1]);
    expect(instanceLeaseService.inFlightAcross(instances)).toBe(2);
  });

  it('skips a ready instance whose node dropped, and leases the one still connected', async () => {
    agentConnectionService.relayFor.mockImplementation((nodeId: number) => (nodeId === 1 ? null : RELAY));

    const lease = await instanceLeaseService.lease(DEPLOYMENT_ID, [instanceOf(1), instanceOf(2)]);

    expect(lease?.nodeId).toBe(2);
  });

  it('leases nothing, and stamps nothing, where no ready instance is on a reachable node', async () => {
    agentConnectionService.relayFor.mockReturnValue(null);

    await expect(instanceLeaseService.lease(DEPLOYMENT_ID, [instanceOf(1)])).resolves.toBeNull();
    expect(deploymentService.stampLastUsed).not.toHaveBeenCalled();
  });

  it('stamps the deployment as used, and serves the request when stamping fails', async () => {
    deploymentService.stampLastUsed.mockRejectedValue(new Error('the database went away'));

    const lease = await instanceLeaseService.lease(DEPLOYMENT_ID, [instanceOf(1)]);

    expect(deploymentService.stampLastUsed).toHaveBeenCalledWith(DEPLOYMENT_ID);
    expect(lease).not.toBeNull();
  });

  it('counts the request before stamping, so a reconcile mid-stamp reads the instance as busy', async () => {
    const instances = [instanceOf(1)];
    let busyWhileStamping = 0;

    deploymentService.stampLastUsed.mockImplementation(() => {
      busyWhileStamping = instanceLeaseService.inFlightAcross(instances);

      return Promise.resolve();
    });

    await instanceLeaseService.lease(DEPLOYMENT_ID, instances);

    expect(busyWhileStamping).toBe(1);
  });

  it('finds a ready instance on a reachable node without counting or stamping a request', () => {
    const instances = [instanceOf(1, InstanceState.STARTING), instanceOf(2), instanceOf(3)];

    agentConnectionService.relayFor.mockImplementation((nodeId: number) => (nodeId === 2 ? null : RELAY));

    expect(instanceLeaseService.reachable(instances)).toEqual({
      instanceKey: instances[2].instanceKey,
      relay: RELAY,
      configurationRevision: instances[2].configurationRevision,
    });
    expect(instanceLeaseService.inFlightAcross(instances)).toBe(0);
    expect(deploymentService.stampLastUsed).not.toHaveBeenCalled();
  });

  it('finds nothing where every ready instance is draining', () => {
    const instances = [instanceOf(1)];

    instanceLeaseService.quietOnceDraining(instances);

    expect(instanceLeaseService.reachable(instances)).toBeNull();
  });

  it('passes over an instance being drained for one that is not', async () => {
    const instances = [instanceOf(1), instanceOf(2)];

    instanceLeaseService.quietOnceDraining([instances[0]]);

    await expect(instanceLeaseService.lease(DEPLOYMENT_ID, instances)).resolves.toMatchObject({ nodeId: 2 });
  });

  it('leaves no count behind when the stamp fails and the request is released', async () => {
    const instances = [instanceOf(1)];

    deploymentService.stampLastUsed.mockRejectedValue(new Error('the database went away'));

    const lease = await instanceLeaseService.lease(DEPLOYMENT_ID, instances);

    lease?.release();

    expect(instanceLeaseService.inFlightAcross(instances)).toBe(0);
  });

  it('leases nothing from a draining instance, and does again once the drain is lifted', async () => {
    const instances = [instanceOf(1)];

    expect(instanceLeaseService.quietOnceDraining(instances)).toBe(true);
    await expect(instanceLeaseService.lease(DEPLOYMENT_ID, instances)).resolves.toBeNull();

    instanceLeaseService.stopDraining(instances);

    await expect(instanceLeaseService.lease(DEPLOYMENT_ID, instances)).resolves.not.toBeNull();
  });

  it('reads a draining instance with a request in flight as not quiet, and says when the last one leaves', async () => {
    const instances = [instanceOf(1)];
    const drained = vi.fn();

    instanceLeaseService.drainedChanges().subscribe(drained);

    const lease = await instanceLeaseService.lease(DEPLOYMENT_ID, instances);

    expect(instanceLeaseService.quietOnceDraining(instances)).toBe(false);

    lease?.release();

    expect(drained).toHaveBeenCalledWith(DEPLOYMENT_ID);
  });

  it('counts an instance starting as holding an idle stop off only while its node is in contact', () => {
    expect(instanceLeaseService.startingOnLiveNode(instanceOf(1, InstanceState.STARTING))).toBe(true);

    agentConnectionService.relayFor.mockReturnValue(null);

    expect(instanceLeaseService.startingOnLiveNode(instanceOf(1, InstanceState.STARTING))).toBe(false);
  });
});
