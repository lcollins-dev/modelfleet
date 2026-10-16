import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { ModelEntry, ModelFormat, ModelTask, ModelType, ProjectorModality } from '@libs/agent-protocol';
import {
  EventType,
  ListModelDto,
  ModelAvailabilityDto,
  NodeModelDto,
  LicenceTerms,
  ModelState,
  NodeState,
  UNKNOWN_MODEL_TASK,
  UserRoleId,
} from '@libs/dto';

import { ModelCatalogueService } from '@/core/model/model-catalogue.service';

import { getEventList } from '../../clients/event.client';
import { deleteModel, getModel, getModelList, getNodeModelInventory, updateModel } from '../../clients/model.client';
import { deleteNode, registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

interface IAvailabilityRow {
  nodeId: number;
  path: string;
  lastConfirmedDate: Date;
}

const entry = (fingerprint: string, overrides: Partial<ModelEntry> = {}): ModelEntry => ({
  fingerprint,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  sizeBytes: 4_920_000_000,
  path: '/models/llama-3-8b.gguf',
  shardCount: 1,
  name: 'Llama 3 8B',
  ggufMetadata: null,
  safetensorsMetadata: null,
  ...overrides,
});

describe('Model catalogue (integration)', () => {
  let app: NestExpressApplication;
  let modelCatalogueService: ModelCatalogueService;
  let adminToken: string;

  const uniqueFingerprint = (): string => randomUUID().replaceAll('-', '').padEnd(64, '0');

  const register = async (): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: `rig-${randomUUID()}` }).expect(201);

    return response.body.id;
  };

  const markOnline = (nodeId: number): Promise<unknown[]> =>
    dbQuery(app, 'UPDATE "node" SET "lastSeenDate" = now() WHERE "id" = $1', [nodeId]);

  const merge = (nodeId: number, models: ModelEntry[]): Promise<void> =>
    modelCatalogueService.mergeInventory(nodeId, {
      scannedAt: new Date().toJSON(),
      directories: ['/models'],
      models,
      errors: [],
    });

  const findModel = async (fingerprint: string): Promise<ListModelDto> => {
    const response = await getModelList(app, adminToken, { search: fingerprint }).expect(200);

    return response.body.modelList[0];
  };

  const typeRowsFor = async (...fingerprints: string[]): Promise<ModelType[]> => {
    const rows = await dbQuery<{ fingerprint: string; type: ModelType }>(
      app,
      'SELECT "fingerprint", "type" FROM "model" WHERE "fingerprint" = ANY($1)',
      [fingerprints]
    );
    const byFingerprint = new Map(rows.map(row => [row.fingerprint, row.type]));

    return fingerprints.flatMap(fingerprint => byFingerprint.get(fingerprint) ?? []);
  };

  const availabilityRowsFor = (fingerprint: string): Promise<IAvailabilityRow[]> =>
    dbQuery<IAvailabilityRow>(
      app,
      `SELECT availability."nodeId", availability."path", availability."lastConfirmedDate"
         FROM "availability" availability
         JOIN "model" model ON model."id" = availability."modelId"
        WHERE model."fingerprint" = $1
        ORDER BY availability."nodeId"`,
      [fingerprint]
    );

  beforeAll(async () => {
    app = await bootstrapApp();
    modelCatalogueService = app.get(ModelCatalogueService);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  it('holds the same weights on two nodes as one model with an entry each', async () => {
    const fingerprint = uniqueFingerprint();
    const first = await register();
    const second = await register();

    await merge(first, [entry(fingerprint, { path: '/models/llama.gguf' })]);
    await merge(second, [entry(fingerprint, { path: '/srv/weights/llama.gguf' })]);

    const rows = await availabilityRowsFor(fingerprint);

    expect(await dbQuery(app, 'SELECT "id" FROM "model" WHERE "fingerprint" = $1', [fingerprint])).toHaveLength(1);
    expect(rows.map(row => row.path)).toEqual(['/models/llama.gguf', '/srv/weights/llama.gguf']);
  });

  it('holds two fine-tunes of one size and quantisation as two models', async () => {
    const nodeId = await register();
    const base = uniqueFingerprint();
    const tuned = uniqueFingerprint();

    await merge(nodeId, [
      entry(base, { path: '/models/base.gguf', name: 'Base' }),
      entry(tuned, { path: '/models/tuned.gguf', name: 'Tuned' }),
    ]);

    expect(await findModel(base)).toBeDefined();
    expect(await findModel(tuned)).toBeDefined();
  });

  it('keeps one entry per node rather than growing on every report', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint)]);
    await merge(nodeId, [entry(fingerprint)]);
    await merge(nodeId, [entry(fingerprint)]);

    expect(await availabilityRowsFor(fingerprint)).toHaveLength(1);
  });

  it('takes the new path on the entry a moved model already has', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint, { path: '/models/old/llama.gguf' })]);
    await merge(nodeId, [entry(fingerprint, { path: '/models/new/llama.gguf' })]);

    const rows = await availabilityRowsFor(fingerprint);

    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/models/new/llama.gguf');
  });

  it('drops the entry of a file the node no longer holds, and records the removal', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint)]);
    await merge(nodeId, []);

    const model = await findModel(fingerprint);
    const events = await getEventList(app, adminToken, {
      type: [EventType.MODEL_AVAILABILITY_REMOVED],
      subjectId: `${model.id}`,
    }).expect(200);

    expect(await availabilityRowsFor(fingerprint)).toHaveLength(0);
    expect(events.body.eventList).toHaveLength(1);
    expect(events.body.eventList[0].detail.fingerprint).toBe(fingerprint);
  });

  it('catalogues a vision model and its projector as two rows, each carrying its own type', async () => {
    const model = uniqueFingerprint();
    const projector = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [
      entry(model),
      entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj-F32.gguf' }),
    ]);

    expect(await typeRowsFor(model, projector)).toEqual([ModelType.MODEL, ModelType.PROJECTOR]);
    expect(await availabilityRowsFor(projector)).toHaveLength(1);
  });

  it('gives a projector an earlier agent catalogued as a model its real type, in the row it already has', async () => {
    const projector = uniqueFingerprint();
    const nodeId = await register();
    const path = '/models/mmproj-F32.gguf';

    await merge(nodeId, [entry(projector, { path })]);
    await merge(nodeId, [entry(projector, { type: ModelType.PROJECTOR, path })]);

    expect(await typeRowsFor(projector)).toEqual([ModelType.PROJECTOR]);
    expect(await availabilityRowsFor(projector)).toHaveLength(1);
  });

  it('reads a catalogued file back over the v1 API with the type it is', async () => {
    const projector = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj-F32.gguf' })]);

    expect((await findModel(projector)).type).toBe(ModelType.PROJECTOR);
  });

  it('narrows the catalogue to the requested type, leaving the rest out of the page', async () => {
    const model = uniqueFingerprint();
    const projector = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [
      entry(model, { name: 'Qwen 2.5 VL' }),
      entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj-F32.gguf', name: 'Qwen 2.5 VL' }),
    ]);

    const models = await getModelList(app, adminToken, {
      search: 'Qwen 2.5 VL',
      type: [ModelType.MODEL],
    }).expect(200);

    expect(models.body.modelList.map((listed: ListModelDto) => listed.fingerprint)).toEqual([model]);
  });

  it('lists every type where the request narrows to none, so a companion is seen rather than hidden', async () => {
    const model = uniqueFingerprint();
    const projector = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [
      entry(model, { name: 'Gemma 3 27B' }),
      entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj-F32.gguf', name: 'Gemma 3 27B' }),
    ]);

    const listed = await getModelList(app, adminToken, { search: 'Gemma 3 27B' }).expect(200);

    expect(listed.body.modelList.map((row: ListModelDto) => row.type).sort()).toEqual([
      ModelType.MODEL,
      ModelType.PROJECTOR,
    ]);
  });

  it('narrows to several types at once', async () => {
    const model = uniqueFingerprint();
    const projector = uniqueFingerprint();
    const adapter = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [
      entry(model, { name: 'Mistral Small' }),
      entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj-F32.gguf', name: 'Mistral Small' }),
      entry(adapter, { type: ModelType.LORA, path: '/models/mistral-lora.gguf', name: 'Mistral Small' }),
    ]);

    const listed = await getModelList(app, adminToken, {
      search: 'Mistral Small',
      type: [ModelType.PROJECTOR, ModelType.LORA],
    }).expect(200);

    expect(listed.body.modelList.map((row: ListModelDto) => row.fingerprint).sort()).toEqual(
      [projector, adapter].sort()
    );
  });

  it('narrows by type and by state together', async () => {
    const held = uniqueFingerprint();
    const dropped = uniqueFingerprint();
    const onlineNode = await register();
    const offlineNode = await register();

    await markOnline(onlineNode);

    await merge(onlineNode, [entry(held, { type: ModelType.PROJECTOR, name: 'Phi 4 vision' })]);
    await merge(offlineNode, [
      entry(dropped, { type: ModelType.PROJECTOR, path: '/models/other-mmproj.gguf', name: 'Phi 4 vision' }),
    ]);

    const listed = await getModelList(app, adminToken, {
      search: 'Phi 4 vision',
      type: [ModelType.PROJECTOR],
      state: [ModelState.AVAILABLE],
    }).expect(200);

    expect(listed.body.modelList.map((row: ListModelDto) => row.fingerprint)).toEqual([held]);
  });

  it('narrows before it pages, so a companion behind a page of models is still found', async () => {
    const projector = uniqueFingerprint();
    const nodeId = await register();
    const name = `Fleet ${randomUUID()}`;

    const models = Array.from({ length: 21 }, (_, index) =>
      entry(uniqueFingerprint(), { path: `/models/member-${index}.gguf`, name })
    );

    await merge(nodeId, [
      ...models,
      entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj.gguf', name }),
    ]);

    const listed = await getModelList(app, adminToken, { search: name, type: [ModelType.PROJECTOR] }).expect(200);

    expect(listed.body.modelList.map((row: ListModelDto) => row.fingerprint)).toEqual([projector]);
  });

  it('finds a model by the file name a node holds it under, keeping every node that holds it', async () => {
    const fingerprint = uniqueFingerprint();
    const first = await register();
    const second = await register();
    const quant = `Q8_K_XL-${randomUUID()}`;

    await merge(first, [entry(fingerprint, { path: `/models/qwen3-${quant}.gguf` })]);
    await merge(second, [entry(fingerprint, { path: '/srv/weights/qwen3.gguf' })]);

    const listed = await getModelList(app, adminToken, { search: quant.toLowerCase() }).expect(200);

    expect(listed.body.modelList.map((row: ListModelDto) => row.fingerprint)).toEqual([fingerprint]);
    expect(listed.body.modelList[0].availability.map((row: ModelAvailabilityDto) => row.path).sort()).toEqual([
      `/models/qwen3-${quant}.gguf`,
      '/srv/weights/qwen3.gguf',
    ]);
  });

  it('matches the file name alone, not the directories above it', async () => {
    const directory = `shelf-${randomUUID()}`;
    const nodeId = await register();

    await merge(nodeId, [entry(uniqueFingerprint(), { path: `/models/${directory}/llama.gguf` })]);

    const listed = await getModelList(app, adminToken, { search: directory }).expect(200);

    expect(listed.body.modelList).toEqual([]);
  });

  describe('tasks and licence', () => {
    it('reads tasks, a licence and its mark back over v1, as a node reported them', async () => {
      const fingerprint = uniqueFingerprint();
      const nodeId = await register();

      await merge(nodeId, [
        entry(fingerprint, {
          format: ModelFormat.SAFETENSORS,
          path: '/models/qwen3-omni',
          tasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION, ModelTask.SPEECH],
          licence: { id: 'cc-by-nc-4.0', name: null, link: null },
        }),
      ]);

      const listed = await findModel(fingerprint);

      expect(listed.tasks).toEqual([ModelTask.CHAT, ModelTask.TRANSCRIPTION, ModelTask.SPEECH]);
      expect(listed.licence).toEqual({
        id: 'cc-by-nc-4.0',
        name: null,
        link: null,
        terms: LicenceTerms.NON_COMMERCIAL,
      });
    });

    it("stores a projector's modalities and reads them back on the model", async () => {
      const fingerprint = uniqueFingerprint();
      const nodeId = await register();

      await merge(nodeId, [
        entry(fingerprint, {
          type: ModelType.PROJECTOR,
          path: '/models/mmproj-omni.gguf',
          modalities: [ProjectorModality.VISION, ProjectorModality.AUDIO],
        }),
      ]);

      const model = await getModel(app, adminToken, (await findModel(fingerprint)).id).expect(200);

      expect(model.body.modalities).toEqual([ProjectorModality.VISION, ProjectorModality.AUDIO]);
    });

    it('narrows to models holding a task, and to models whose tasks are unknown', async () => {
      const name = `Tasks ${randomUUID()}`;
      const whisper = uniqueFingerprint();
      const omni = uniqueFingerprint();
      const kokoro = uniqueFingerprint();
      const unknown = uniqueFingerprint();
      const nodeId = await register();

      await merge(nodeId, [
        entry(whisper, { name, path: '/models/whisper.gguf', tasks: [ModelTask.TRANSCRIPTION] }),
        entry(omni, { name, path: '/models/omni.gguf', tasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION] }),
        entry(kokoro, { name, path: '/models/kokoro.gguf', tasks: [ModelTask.SPEECH] }),
        entry(unknown, { name, path: '/models/unknown.gguf', tasks: [] }),
      ]);

      const transcription = await getModelList(app, adminToken, {
        search: name,
        task: [ModelTask.TRANSCRIPTION],
      }).expect(200);
      const unstated = await getModelList(app, adminToken, {
        search: name,
        task: [ModelTask.SPEECH, UNKNOWN_MODEL_TASK],
      }).expect(200);

      expect(transcription.body.modelList.map((row: ListModelDto) => row.fingerprint).sort()).toEqual(
        [whisper, omni].sort()
      );
      expect(unstated.body.modelList.map((row: ListModelDto) => row.fingerprint).sort()).toEqual(
        [kokoro, unknown].sort()
      );
    });

    it("narrows by an admin's tasks over the ones the scans read", async () => {
      const name = `Assigned ${randomUUID()}`;
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint, { name, tasks: [] })]);
      await updateModel(app, adminToken, (await findModel(fingerprint)).id, {
        tasks: [ModelTask.SPEECH],
      }).expect(200);

      const speech = await getModelList(app, adminToken, { search: name, task: [ModelTask.SPEECH] }).expect(200);
      const unstated = await getModelList(app, adminToken, { search: name, task: [UNKNOWN_MODEL_TASK] }).expect(200);

      expect(speech.body.modelList).toHaveLength(1);
      expect(unstated.body.modelList).toEqual([]);
    });

    it('narrows to a format', async () => {
      const name = `Formats ${randomUUID()}`;
      const gguf = uniqueFingerprint();
      const safetensors = uniqueFingerprint();
      const nodeId = await register();

      await merge(nodeId, [
        entry(gguf, { name, path: '/models/model.gguf' }),
        entry(safetensors, { name, path: '/models/repository', format: ModelFormat.SAFETENSORS }),
      ]);

      const listed = await getModelList(app, adminToken, { search: name, format: [ModelFormat.GGUF] }).expect(200);

      expect(listed.body.modelList.map((row: ListModelDto) => row.fingerprint)).toEqual([gguf]);
    });

    it('rejects a task that is not a model task', async () => {
      await getModelList(app, adminToken, { task: ['translation'] }).expect(400);
    });
  });

  it('rejects a type that is not a model type', async () => {
    await getModelList(app, adminToken, { type: ['adapter'] }).expect(400);
  });

  it('answers a node inventory with the type of each file it holds', async () => {
    const model = uniqueFingerprint();
    const projector = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [
      entry(model, { name: 'Pixtral' }),
      entry(projector, { type: ModelType.PROJECTOR, path: '/models/mmproj-F32.gguf', name: 'Pixtral mmproj' }),
    ]);

    const inventory = await getNodeModelInventory(app, adminToken, nodeId).expect(200);

    expect(inventory.body.models.map((row: NodeModelDto) => [row.name, row.type])).toEqual([
      ['Pixtral', ModelType.MODEL],
      ['Pixtral mmproj', ModelType.PROJECTOR],
    ]);
  });

  it('lists a model no online node holds as unavailable', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint)]);

    const offline = await findModel(fingerprint);

    await markOnline(nodeId);

    const online = await findModel(fingerprint);

    expect(offline.state).toBe(ModelState.UNAVAILABLE);
    expect(offline.availability).toHaveLength(1);
    expect(online.state).toBe(ModelState.AVAILABLE);
    expect(online.availability[0].nodeState).toBe(NodeState.ONLINE);
  });

  it('records when each entry was last confirmed', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint)]);

    const [first] = await availabilityRowsFor(fingerprint);

    await merge(nodeId, [entry(fingerprint)]);

    const [second] = await availabilityRowsFor(fingerprint);

    expect(second.lastConfirmedDate >= first.lastConfirmedDate).toBe(true);
  });

  it('reads a model back over the v1 API with its parsed metadata', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [
      entry(fingerprint, {
        ggufMetadata: {
          architecture: 'llama',
          quantisation: 'Q4_K',
          quantisationMixed: true,
          layerCount: 32,
          embeddingLength: 4096,
          headCount: 32,
          headCountKv: 8,
          contextLength: 8192,
        },
      }),
    ]);

    const listed = await findModel(fingerprint);
    const response = await getModel(app, adminToken, listed.id).expect(200);

    expect(response.body.ggufMetadata.quantisation).toBe('Q4_K');
    expect(response.body.safetensorsMetadata).toBeNull();
    expect(response.body.sizeBytes).toBe(4_920_000_000);
  });

  it('drops the entries of a node when that node is deleted, keeping the model', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint)]);
    await deleteNode(app, adminToken, nodeId).expect(200);

    expect(await availabilityRowsFor(fingerprint)).toHaveLength(0);
    expect(await findModel(fingerprint)).toBeDefined();
  });

  describe('assigned tasks', () => {
    it("sets an admin's tasks over the scans', keeps them through a later scan, and clears them back", async () => {
      const fingerprint = uniqueFingerprint();
      const nodeId = await register();

      await merge(nodeId, [entry(fingerprint, { tasks: [ModelTask.CHAT] })]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { tasks: [ModelTask.CHAT, ModelTask.SPEECH] }).expect(200);
      await merge(nodeId, [entry(fingerprint, { tasks: [ModelTask.EMBEDDING] })]);

      const assigned = await getModel(app, adminToken, id).expect(200);

      await updateModel(app, adminToken, id, { tasks: [] }).expect(200);

      const cleared = await getModel(app, adminToken, id).expect(200);

      expect(assigned.body).toMatchObject({
        tasks: [ModelTask.CHAT, ModelTask.SPEECH],
        detectedTasks: [ModelTask.EMBEDDING],
        tasksAssigned: true,
      });
      expect(cleared.body).toMatchObject({
        tasks: [ModelTask.EMBEDDING],
        detectedTasks: [ModelTask.EMBEDDING],
        tasksAssigned: false,
      });
    });

    it('records each change against the model', async () => {
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { tasks: [ModelTask.CHAT] }).expect(200);

      const events = await getEventList(app, adminToken, {
        type: [EventType.MODEL_TASKS_CHANGED],
        subjectId: `${id}`,
      }).expect(200);

      expect(events.body.eventList.map((event: { message: string }) => event.message)).toEqual([
        'Set the tasks of model **Llama 3 8B** to chat',
      ]);
    });

    it('refuses a task that is not a model task, more tasks than there are, or tasks that are not a list', async () => {
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { tasks: ['translation'] }).expect(400);
      await updateModel(app, adminToken, id, { tasks: null }).expect(400);
      await updateModel(app, adminToken, id, { tasks: ModelTask.CHAT }).expect(400);
      await updateModel(app, adminToken, id, { tasks: [...Object.values(ModelTask), ModelTask.CHAT] }).expect(400);
    });
  });

  describe('display name', () => {
    it('sets a display name beside the scanned name, and clears it back to null', async () => {
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { displayName: 'Llama chat' }).expect(200);

      const named = await getModel(app, adminToken, id).expect(200);

      await updateModel(app, adminToken, id, { displayName: '' }).expect(200);

      const cleared = await getModel(app, adminToken, id).expect(200);

      expect([named.body.name, named.body.displayName]).toEqual(['Llama 3 8B', 'Llama chat']);
      expect([cleared.body.name, cleared.body.displayName]).toEqual(['Llama 3 8B', null]);
    });

    it('records each rename against the model', async () => {
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { displayName: 'Llama chat' }).expect(200);

      const events = await getEventList(app, adminToken, {
        type: [EventType.MODEL_RENAMED],
        subjectId: `${id}`,
      }).expect(200);

      expect(events.body.eventList.map((event: { message: string }) => event.message)).toEqual([
        'Renamed model **Llama 3 8B** to **Llama chat**',
      ]);
      expect(events.body.eventList[0].subjectName).toBe('Llama chat');
    });

    it('keeps the display name through a later scan', async () => {
      const fingerprint = uniqueFingerprint();
      const nodeId = await register();

      await merge(nodeId, [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { displayName: 'Llama chat' }).expect(200);
      await merge(nodeId, [entry(fingerprint, { name: 'Renamed upstream' })]);

      expect((await findModel(fingerprint)).displayName).toBe('Llama chat');
    });

    it('refuses a display name longer than 256 characters, or null', async () => {
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      await updateModel(app, adminToken, id, { displayName: 'x'.repeat(257) }).expect(400);
      await updateModel(app, adminToken, id, { displayName: null }).expect(400);
    });

    it('measures a display name in code points after trimming, as the column stores it', async () => {
      const fingerprint = uniqueFingerprint();

      await merge(await register(), [entry(fingerprint)]);

      const { id } = await findModel(fingerprint);

      const refused = await updateModel(app, adminToken, id, { displayName: '☀️'.repeat(200) }).expect(400);

      expect(refused.body.message.map((error: { path: string }) => error.path)).toEqual(['displayName']);

      await updateModel(app, adminToken, id, { displayName: `  ${'x'.repeat(256)}  ` }).expect(200);

      expect((await findModel(fingerprint)).displayName).toBe('x'.repeat(256));
    });

    it('finds a model by its display name, and orders the catalogue by what it shows', async () => {
      const nodeId = await register();
      const tag = randomUUID();
      const zulu = uniqueFingerprint();
      const alpha = uniqueFingerprint();

      await merge(nodeId, [
        entry(zulu, { path: '/models/zulu.gguf', name: `A ${tag}` }),
        entry(alpha, { path: '/models/alpha.gguf', name: `B ${tag}` }),
      ]);

      await updateModel(app, adminToken, (await findModel(zulu)).id, { displayName: `Z ${tag}` }).expect(200);

      const byName = await getModelList(app, adminToken, { search: tag }).expect(200);
      const byDisplayName = await getModelList(app, adminToken, { search: `Z ${tag}` }).expect(200);

      expect(byName.body.modelList.map((row: ListModelDto) => row.fingerprint)).toEqual([alpha, zulu]);
      expect(byDisplayName.body.modelList.map((row: ListModelDto) => row.fingerprint)).toEqual([zulu]);
    });
  });

  it('deletes a model nothing references, dropping its entries with it', async () => {
    const fingerprint = uniqueFingerprint();
    const nodeId = await register();

    await merge(nodeId, [entry(fingerprint)]);

    const model = await findModel(fingerprint);

    await deleteModel(app, adminToken, model.id).expect(200);

    expect(await dbQuery(app, 'SELECT "id" FROM "model" WHERE "fingerprint" = $1', [fingerprint])).toHaveLength(0);
    expect(await availabilityRowsFor(fingerprint)).toHaveLength(0);
  });
});
