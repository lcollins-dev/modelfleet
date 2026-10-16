import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentMessageType, AgentTelemetry, TelemetryState } from '@libs/agent-protocol';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { TelemetryGateway } from '@/core/telemetry/telemetry.gateway';

const NODE_ID = 7;
const CLIENT = {} as WebSocket;

const envelope = (payload: AgentTelemetry) =>
  ({
    protocolVersion: 1,
    messageId: '22222222-2222-4222-8222-222222222222',
    type: AgentMessageType.TELEMETRY,
    sentAt: '2026-08-20T12:00:00.000Z',
    payload,
  }) as never;

const TELEMETRY: AgentTelemetry = {
  capturedAt: '2026-08-20T12:00:00.000Z',
  telemetryState: TelemetryState.OK,
  devices: [],
  host: { cpuModel: null, cpuCount: 8, loadAverage1m: null, memoryTotalBytes: 16, memoryFreeBytes: 8 },
  errors: [],
};

describe('TelemetryGateway', () => {
  let readyNodeId: ReturnType<typeof vi.fn>;
  let sessionClosed: Subject<number>;
  let telemetryService: {
    recordTelemetry: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };
  let gateway: TelemetryGateway;

  beforeEach(() => {
    readyNodeId = vi.fn().mockReturnValue(NODE_ID);
    sessionClosed = new Subject<number>();

    telemetryService = {
      recordTelemetry: vi.fn(),
      forget: vi.fn(),
    };

    gateway = new TelemetryGateway(
      {
        readyNodeId,
        sessionClosed: () => sessionClosed.asObservable(),
      } as unknown as AgentConnectionService,
      telemetryService as unknown as TelemetryService
    );

    gateway.onModuleInit();
  });

  it('holds the readings an agent reported', () => {
    gateway.handleTelemetry(CLIENT, envelope(TELEMETRY));

    expect(telemetryService.recordTelemetry).toHaveBeenCalledWith(NODE_ID, TELEMETRY);
  });

  it('holds nothing where the session refuses an unwelcomed report', () => {
    readyNodeId.mockReturnValue(null);

    gateway.handleTelemetry(CLIENT, envelope(TELEMETRY));

    expect(telemetryService.recordTelemetry).not.toHaveBeenCalled();
  });

  it('drops the readings of a node whose session ended', () => {
    sessionClosed.next(NODE_ID);

    expect(telemetryService.forget).toHaveBeenCalledWith(NODE_ID);
  });

  it('stops listening for closed sessions once destroyed', () => {
    gateway.onModuleDestroy();
    sessionClosed.next(NODE_ID);

    expect(telemetryService.forget).not.toHaveBeenCalled();
  });
});
