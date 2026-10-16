import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassThrough, Writable } from 'node:stream';
import { firstValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventPartyType, EventSeverity, EventType, InstanceOutputEndReason } from '@libs/dto';

import { InstanceOutputAdminService } from './instance-output-admin.service';
import { ConfigService } from '@/config/config.service';
import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { IRelayLogsRequest, RelayClientService, RelayUnreachableError } from '@/core/agent/relay-client.service';
import { EventService } from '@/core/event/event.service';
import { InstanceService } from '@/core/instance/instance.service';

import { buildDeployment, TEST_DEPLOYMENT_ID } from '@/test/deployment.factory';
import { buildInstance, TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { buildNode, TEST_NODE_ID } from '@/test/node.factory';

const RELAY = { url: 'http://127.0.0.1:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const USER_ID = 7;

describe('InstanceOutputAdminService', () => {
  let instanceService: { findInDeployment: ReturnType<typeof vi.fn> };
  let agentConnectionService: { relayFor: ReturnType<typeof vi.fn> };
  let relayClientService: { logs: ReturnType<typeof vi.fn> };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let body: PassThrough;
  let viewer: AbortController;
  let instanceOutputAdminService: InstanceOutputAdminService;

  const resident = () => {
    const instance = buildInstance();

    instance.deployment = buildDeployment();
    instance.node = buildNode();

    return instance;
  };

  const answering = (status: number, tailComplete = false) => {
    relayClientService.logs.mockResolvedValue({ status, tailComplete, stream: body });
  };

  const watch = () =>
    instanceOutputAdminService.watchOutput(TEST_DEPLOYMENT_ID, TEST_INSTANCE_KEY, {
      userId: USER_ID,
      signal: viewer.signal,
      response: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
    });

  const relaySignal = (): AbortSignal => (relayClientService.logs.mock.calls[0][0] as IRelayLogsRequest).signal;

  beforeEach(async () => {
    body = new PassThrough();
    viewer = new AbortController();

    instanceService = { findInDeployment: vi.fn().mockResolvedValue(resident()) };
    agentConnectionService = { relayFor: vi.fn().mockReturnValue(RELAY) };
    relayClientService = { logs: vi.fn() };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };

    answering(200);

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceOutputAdminService,
        { provide: ConfigService, useValue: { instanceOutputTailLines: 1000 } },
        { provide: AgentConnectionService, useValue: agentConnectionService },
        { provide: EventService, useValue: eventService },
        { provide: InstanceService, useValue: instanceService },
        { provide: RelayClientService, useValue: relayClientService },
      ],
    }).compile();

    instanceOutputAdminService = moduleRef.get(InstanceOutputAdminService);
  });

  describe('refusals', () => {
    it('refuses an instance that does not exist in the deployment as not found', async () => {
      instanceService.findInDeployment.mockResolvedValue(null);

      await expect(watch()).rejects.toBeInstanceOf(NotFoundException);
      expect(instanceService.findInDeployment).toHaveBeenCalledWith(TEST_DEPLOYMENT_ID, TEST_INSTANCE_KEY);
      expect(relayClientService.logs).not.toHaveBeenCalled();
    });

    it('refuses as a conflict where the node holds no session', async () => {
      agentConnectionService.relayFor.mockReturnValue(null);

      const refusal = watch();

      await expect(refusal).rejects.toBeInstanceOf(ConflictException);
      await expect(refusal).rejects.toThrow('not connected');
      expect(relayClientService.logs).not.toHaveBeenCalled();
    });

    it('refuses as not found where the node holds no container for the instance', async () => {
      answering(404);

      const refusal = watch();

      await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
      await expect(refusal).rejects.toThrow('no container');
    });

    it('refuses as a bad gateway where the relay answers with anything else', async () => {
      answering(503);
      body.end('{"error":{"code":"docker_unavailable"}}');

      await expect(watch()).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('refuses as a bad gateway where the relay cannot be reached', async () => {
      relayClientService.logs.mockRejectedValue(new RelayUnreachableError(new Error('connect ECONNREFUSED')));

      await expect(watch()).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('records nothing for a refused stream', async () => {
      answering(404);

      await expect(watch()).rejects.toThrow();
      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });
  });

  describe('opening', () => {
    it('asks the node for the configured tail of the instance', async () => {
      await watch();

      expect(relayClientService.logs).toHaveBeenCalledWith(
        expect.objectContaining({ relay: RELAY, instanceKey: TEST_INSTANCE_KEY, tail: 1000 })
      );
    });

    it('records the read against the deployment, with the user as actor, once the node has answered', async () => {
      await watch();

      expect(eventService.recordEvent).toHaveBeenCalledWith(EventType.INSTANCE_OUTPUT_READ, EventSeverity.INFO, {
        actorType: EventPartyType.USER,
        actorId: `${USER_ID}`,
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${TEST_DEPLOYMENT_ID}`,
        message: 'Read the output of an instance of **llama-chat** on **rig-01**',
        detail: { name: 'llama-chat', instanceKey: TEST_INSTANCE_KEY, nodeId: TEST_NODE_ID, nodeName: 'rig-01' },
      });
    });

    it('aborts the relay request where recording fails', async () => {
      eventService.recordEvent.mockRejectedValue(new Error('database gone'));

      await expect(watch()).rejects.toThrow('database gone');
      expect(relaySignal().aborted).toBe(true);
    });
  });

  describe('the stream', () => {
    it('opens with the tail asked for and whether it reaches the container start', async () => {
      answering(200, true);

      const first = await firstValueFrom(await watch());

      expect(first).toEqual({ kind: 'opened', tailLines: 1000, complete: true });
    });

    it('carries the lines as written, then ends with the container output', async () => {
      const frames = firstValueFrom((await watch()).pipe(toArray()));

      body.end('--api-key sk-live-9f2a7c41\n');

      expect(await frames).toEqual([
        { kind: 'opened', tailLines: 1000, complete: false },
        { kind: 'lines', lines: [{ date: null, text: '--api-key sk-live-9f2a7c41', cut: false }] },
        { kind: 'ended', reason: InstanceOutputEndReason.EXITED },
      ]);
    });

    it('aborts the relay request when the viewer goes', async () => {
      const subscription = (await watch()).subscribe();

      subscription.unsubscribe();

      expect(relaySignal().aborted).toBe(true);
    });

    it("aborts the relay request on the viewer's own signal", async () => {
      await watch();

      viewer.abort();

      expect(relaySignal().aborted).toBe(true);
    });

    it('ends with the connection lost where the node stream breaks off, so the viewer does not reconnect', async () => {
      const frames = firstValueFrom((await watch()).pipe(toArray()));

      body.destroy(new Error('socket hang up'));

      expect(await frames).toEqual([
        { kind: 'opened', tailLines: 1000, complete: false },
        { kind: 'ended', reason: InstanceOutputEndReason.LOST },
      ]);
    });
  });
});
