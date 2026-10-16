import { BadRequestException, MessageEvent } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Subject, Subscription, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeTelemetryStatusDto, NodeTelemetryState } from '@libs/dto';

import { TelemetryAdminService } from '@/api/v1/telemetry/telemetry-admin.service';

import { TelemetryAdminController } from '@/api/v1/telemetry/telemetry-admin.controller';

const NODE_ID = 7;

const STATUS: NodeTelemetryStatusDto = {
  telemetryState: NodeTelemetryState.OK,
  capturedAt: new Date('2026-08-20T12:00:00.000Z'),
  receivedAt: new Date('2026-08-20T12:00:00.000Z'),
  host: {
    cpuModel: 'AMD Ryzen 9 5950X',
    cpuCount: 32,
    loadAverage1m: 1.2,
    memoryTotalBytes: 67_386_753_024,
    memoryFreeBytes: 41_231_686_144,
    modelDirectories: [],
  },
  devices: [],
  errors: [],
  headroomBytes: 1_073_741_824,
};

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('TelemetryAdminController', () => {
  let controller: TelemetryAdminController;
  let getNodeTelemetryStatusMock: ReturnType<typeof vi.fn>;
  let watchNodeTelemetryStatusMock: ReturnType<typeof vi.fn>;
  let statuses: Subject<NodeTelemetryStatusDto>;
  let subscription: Subscription | null = null;

  beforeEach(async () => {
    statuses = new Subject<NodeTelemetryStatusDto>();
    getNodeTelemetryStatusMock = vi.fn().mockResolvedValue(STATUS);
    watchNodeTelemetryStatusMock = vi.fn().mockResolvedValue(of(STATUS));

    const moduleRef = await Test.createTestingModule({
      controllers: [TelemetryAdminController],
      providers: [
        {
          provide: TelemetryAdminService,
          useValue: {
            getNodeTelemetryStatus: getNodeTelemetryStatusMock,
            watchNodeTelemetryStatus: watchNodeTelemetryStatusMock,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(TelemetryAdminController);
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
  });

  it('answers with the node status', async () => {
    await expect(controller.getNodeTelemetryStatus(NODE_ID)).resolves.toEqual(STATUS);
    expect(getNodeTelemetryStatusMock).toHaveBeenCalledWith(NODE_ID);
  });

  it('answers the stream request itself rather than opening a stream that errors', async () => {
    watchNodeTelemetryStatusMock.mockRejectedValue(new BadRequestException());

    await expect(controller.streamNodeTelemetryStatus(NODE_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('opens the stream with the current status', async () => {
    const seen: MessageEvent[] = [];
    const stream = await controller.streamNodeTelemetryStatus(NODE_ID);

    subscription = stream.subscribe(frame => seen.push(frame));

    await settle();

    expect(seen).toEqual([{ data: STATUS }]);
  });

  it('sends a frame for each status the domain emits', async () => {
    watchNodeTelemetryStatusMock.mockResolvedValue(statuses.asObservable());

    const seen: MessageEvent[] = [];
    const stream = await controller.streamNodeTelemetryStatus(NODE_ID);

    subscription = stream.subscribe(frame => seen.push(frame));

    statuses.next(STATUS);
    statuses.next(STATUS);

    await settle();

    expect(seen).toHaveLength(2);
  });
});
