import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';

import { GgufMetadata, GpuProcess, ProcessAttribution, TelemetryState } from '@libs/agent-protocol';
import { BackendId, GIB } from '@libs/backends';
import { ActivationPolicy } from '@libs/dto';

import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { createDeployment } from '../clients/deployment.client';
import { registerNode } from '../clients/node.client';
import { dbQuery } from './db';

const WEIGHTS_PATH = '/srv/models/llama-3-8b.gguf';

/** Enough for the llama.cpp adapter to estimate a deployment, which admission refuses to start without. */
export const ESTIMABLE_METADATA: GgufMetadata = {
  architecture: 'llama',
  quantisation: 'Q4_K_M',
  quantisationMixed: false,
  layerCount: 32,
  embeddingLength: 4096,
  headCount: 32,
  headCountKv: 8,
  contextLength: 8192,
};

export interface IDeployedModel {
  sizeBytes: number;
  metadata: GgufMetadata;

  document?: string;
}

export interface ICardReading {
  deviceKey: string;
  totalBytes?: number;
  usedBytes?: number;
  processes?: GpuProcess[];
}

export const registerNodeWithCard = (app: NestExpressApplication, token: string, deviceKey: string): Promise<number> =>
  registerNodeWithCards(app, token, [deviceKey]);

export const registerNodeWithCards = async (
  app: NestExpressApplication,
  token: string,
  deviceKeys: string[]
): Promise<number> => {
  const response = await registerNode(app, token, { name: `node-${randomUUID()}` }).expect(201);
  const nodeId: number = response.body.id;

  for (const deviceKey of deviceKeys) {
    await dbQuery(
      app,
      `INSERT INTO "gpu" ("nodeId", "deviceKey", "vendor", "lastReportedDate") VALUES ($1, $2, 'nvidia', now())`,
      [nodeId, deviceKey]
    );
  }

  await dbQuery(app, 'UPDATE "node" SET "lastSeenDate" = now() WHERE id = $1', [nodeId]);

  return nodeId;
};

export const deployOnCard = (
  app: NestExpressApplication,
  token: string,
  nodeId: number,
  deviceKey: string
): Promise<number> => deployOnCards(app, token, nodeId, [deviceKey], { sizeBytes: 1000, metadata: ESTIMABLE_METADATA });

export const deployOnCards = async (
  app: NestExpressApplication,
  token: string,
  nodeId: number,
  deviceKeys: string[],
  model: IDeployedModel
): Promise<number> => {
  const models = await dbQuery<{ id: number }>(
    app,
    `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name", "ggufMetadata")
     VALUES ($1, 'gguf', 'model', $2, 1, 'Llama 3 8B', $3) RETURNING id`,
    [randomUUID().replaceAll('-', '').padEnd(64, '0'), model.sizeBytes, JSON.stringify(model.metadata)]
  );

  await dbQuery(
    app,
    `INSERT INTO "availability" ("modelId", "nodeId", "path", "lastConfirmedDate") VALUES ($1, $2, $3, now())`,
    [models[0].id, nodeId, WEIGHTS_PATH]
  );

  const deployment = await createDeployment(app, token, {
    name: `deployment-${randomUUID()}`,
    modelId: models[0].id,
    backend: BackendId.LLAMA_CPP,
    activationPolicy: ActivationPolicy.ON_DEMAND,
    document: `image: ghcr.io/ggml-org/llama.cpp:server-cuda
contextSize: 4096
${model.document ?? ''}
placement:
  gpus:
${deviceKeys.map(deviceKey => `    - nodeId: ${nodeId}\n      deviceKey: ${deviceKey}`).join('\n')}
`,
  }).expect(201);

  return deployment.body.id;
};

/**
 * Gives a card its total and has the node report it holding `usedBytes`, which is what admission reads. Readings are
 * held in memory, so this reaches the app under test rather than the database.
 */
export const reportCard = (
  app: NestExpressApplication,
  nodeId: number,
  deviceKey: string,
  options: Omit<ICardReading, 'deviceKey'> = {}
): Promise<void> => reportCards(app, nodeId, [{ deviceKey, ...options }]);

export const reportCards = async (
  app: NestExpressApplication,
  nodeId: number,
  cards: ICardReading[]
): Promise<void> => {
  for (const card of cards) {
    await dbQuery(app, 'UPDATE "gpu" SET "memoryTotalBytes" = $1 WHERE "nodeId" = $2 AND "deviceKey" = $3', [
      card.totalBytes ?? 24 * GIB,
      nodeId,
      card.deviceKey,
    ]);
  }

  app.get(TelemetryService).recordTelemetry(nodeId, {
    capturedAt: new Date().toISOString(),
    telemetryState: TelemetryState.OK,
    devices: cards.map((card, index) => ({
      deviceKey: card.deviceKey,
      index,
      memoryUsedBytes: card.usedBytes ?? 0,
      utilisationPercent: null,
      temperatureC: null,
      powerDrawWatts: null,
      processAttribution: ProcessAttribution.EXACT,
      processes: card.processes ?? [],
    })),
    host: { cpuModel: null, cpuCount: 8, loadAverage1m: null, memoryTotalBytes: 32 * GIB, memoryFreeBytes: 16 * GIB },
    errors: [],
  });
};
