import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';
import { ActivationPolicy, PresetDto, UserRoleId } from '@libs/dto';

import { createDeployment } from '../../clients/deployment.client';
import {
  createPreset,
  deletePreset,
  getPreset,
  getPresetImpact,
  getPresetList,
  updatePreset,
} from '../../clients/preset.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const PRESET_ROUTE = '/api/v1/admin/preset';

const DOCUMENT = `# Tuned for a single 4090
image: ghcr.io/ggml-org/llama.cpp:server
contextSize: 8192

threads: 16
`;

interface IPresetRow {
  schemaVersion: number;
  document: string;
  configuration: Record<string, unknown>;
}

describe('Preset admin routes (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;

  const uniqueName = (prefix: string = 'preset'): string => `${prefix}-${randomUUID()}`;

  const create = async (body: Record<string, unknown> = {}): Promise<number> => {
    const response = await createPreset(app, adminToken, {
      name: uniqueName(),
      backend: BackendId.LLAMA_CPP,
      document: DOCUMENT,
      ...body,
    }).expect(201);

    return response.body.id;
  };

  const insertModel = async (): Promise<number> => {
    const rows = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name")
       VALUES ($1, 'gguf', 'model', 1000, 1, 'Llama 3 8B') RETURNING id`,
      [randomUUID().replaceAll('-', '').padEnd(64, '0')]
    );

    return rows[0].id;
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  describe('access', () => {
    it('rejects an unauthenticated list', async () => {
      await request(app.getHttpServer()).patch(`${PRESET_ROUTE}/list`).send({}).expect(401);
    });

    it('rejects an unauthenticated create', async () => {
      await request(app.getHttpServer()).post(PRESET_ROUTE).send({}).expect(401);
    });
  });

  describe('create', () => {
    it('stores the document as authored and the form derived from it in one row', async () => {
      const presetId = await create();

      const rows = await dbQuery<IPresetRow>(
        app,
        'SELECT "schemaVersion", "document", "configuration" FROM "preset" WHERE "id" = $1',
        [presetId]
      );

      expect(rows[0].document).toBe(DOCUMENT);
      expect(rows[0].configuration).toEqual({
        image: 'ghcr.io/ggml-org/llama.cpp:server',
        contextSize: 8192,
        threads: 16,
      });
      expect(rows[0].schemaVersion).toBe(1);
    });

    it('refuses a name another preset already holds, whatever its case', async () => {
      const name = uniqueName();
      await create({ name });

      const response = await createPreset(app, adminToken, {
        name: name.toUpperCase(),
        backend: BackendId.LLAMA_CPP,
        document: DOCUMENT,
      }).expect(400);

      expect(response.body.message).toContain('already exists');
    });

    it('refuses a document the backend declaration rejects', async () => {
      await createPreset(app, adminToken, {
        name: uniqueName(),
        backend: BackendId.LLAMA_CPP,
        document: 'image: llama:latest\ncontextSize: plenty\n',
      }).expect(400);
    });

    it('refuses a backend Modelfleet does not serve', async () => {
      await createPreset(app, adminToken, {
        name: uniqueName(),
        backend: 'sglang',
        document: DOCUMENT,
      }).expect(400);
    });
  });

  describe('read', () => {
    it('returns the document and the derived configuration together', async () => {
      const presetId = await create();

      const response = await getPreset(app, adminToken, presetId).expect(200);
      const preset: PresetDto = response.body;

      expect(preset.document).toBe(DOCUMENT);
      expect(preset.configuration.threads).toBe(16);
      expect(preset.backend).toBe(BackendId.LLAMA_CPP);
    });

    it('lists a preset it can be searched for by name', async () => {
      const name = uniqueName('searchable');
      await create({ name });

      const response = await getPresetList(app, adminToken, { search: name }).expect(200);

      expect(response.body.presetList).toHaveLength(1);
      expect(response.body.presetList[0].name).toBe(name);
      expect(response.body.presetList[0].deployments).toBe(0);
    });

    it('narrows the list to a backend', async () => {
      const name = uniqueName('narrowed');
      await create({ name });

      const matched = await getPresetList(app, adminToken, { search: name, backend: [BackendId.LLAMA_CPP] });
      const missed = await getPresetList(app, adminToken, { search: name, backend: ['sglang'] });

      expect(matched.status).toBe(200);
      expect(matched.body.presetList).toHaveLength(1);
      expect(missed.status).toBe(400);
    });

    it('counts the deployments applying each listed preset', async () => {
      const name = uniqueName('counted');
      const presetId = await create({ name });

      await createDeployment(app, adminToken, {
        name: uniqueName('deployment'),
        modelId: await insertModel(),
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: 'threads: 8\n',
      }).expect(201);

      const response = await getPresetList(app, adminToken, { search: name }).expect(200);

      expect(response.body.presetList[0].deployments).toBe(1);
    });
  });

  describe('update', () => {
    it('rewrites the document and the derived form in the same write', async () => {
      const presetId = await create();
      const name = uniqueName();

      await updatePreset(app, adminToken, presetId, {
        name,
        description: 'Now with more context',
        document: 'image: llama:latest\ncontextSize: 16384\n',
      }).expect(200);

      const response = await getPreset(app, adminToken, presetId).expect(200);

      expect(response.body.document).toBe('image: llama:latest\ncontextSize: 16384\n');
      expect(response.body.configuration).toEqual({ image: 'llama:latest', contextSize: 16384 });
      expect(response.body.description).toBe('Now with more context');
    });

    it('leaves the stored row untouched when the document is refused', async () => {
      const presetId = await create();

      await updatePreset(app, adminToken, presetId, {
        name: uniqueName(),
        description: '',
        document: 'image: llama:latest\nthreads: 0\n',
      }).expect(400);

      const response = await getPreset(app, adminToken, presetId).expect(200);

      expect(response.body.document).toBe(DOCUMENT);
    });
  });

  describe('impact', () => {
    const deploy = async (impactPresetId: number, document: string): Promise<void> => {
      await createDeployment(app, adminToken, {
        name: uniqueName('deployment'),
        modelId: await insertModel(),
        presetId: impactPresetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document,
      }).expect(201);
    };

    it('counts the deployments inheriting each field the save would change', async () => {
      const presetId = await create();

      await deploy(presetId, '');
      await deploy(presetId, 'threads: 4\n');

      const response = await getPresetImpact(app, adminToken, presetId, {
        document: 'image: ghcr.io/ggml-org/llama.cpp:server\ncontextSize: 16384\nthreads: 32\n',
      }).expect(200);

      expect(response.body.deployments).toBe(2);
      expect(response.body.affectedDeployments).toBe(2);
      expect(response.body.changedFields).toEqual([
        { key: 'contextSize', inheritingDeployments: 2 },
        { key: 'threads', inheritingDeployments: 1 },
      ]);
    });

    it('reports no changed field where the document is the one the preset already holds', async () => {
      const presetId = await create();

      await deploy(presetId, '');

      const response = await getPresetImpact(app, adminToken, presetId, { document: DOCUMENT }).expect(200);

      expect(response.body).toEqual({ deployments: 1, affectedDeployments: 0, changedFields: [] });
    });

    it('refuses a document the save itself would refuse', async () => {
      const presetId = await create();

      await getPresetImpact(app, adminToken, presetId, { document: 'image: llama:latest\nthreads: 0\n' }).expect(400);
    });
  });

  describe('delete', () => {
    it('deletes a preset no deployment names', async () => {
      const presetId = await create();

      await deletePreset(app, adminToken, presetId).expect(200);
      await getPreset(app, adminToken, presetId).expect(400);
    });

    it('refuses a preset a deployment names, naming the deployment', async () => {
      const presetId = await create();
      const modelId = await insertModel();
      const name = uniqueName('deployment');

      await createDeployment(app, adminToken, {
        name,
        modelId,
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: '',
      }).expect(201);

      const response = await deletePreset(app, adminToken, presetId).expect(400);

      expect(response.body.message).toContain(name);
    });
  });
});
