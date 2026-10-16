import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ModelType } from '@libs/agent-protocol';
import { BackendId } from '@libs/backends';
import {
  ActivationPolicy,
  ConfigurationSource,
  DeploymentDto,
  DeploymentConfigurationDto,
  LicenceTerms,
  UserRoleId,
} from '@libs/dto';

import {
  applyDeployment,
  applyDeployments,
  createDeployment,
  deleteDeployment,
  getDeployment,
  getDeploymentConfiguration,
  getDeploymentList,
  getOutOfDateDeployments,
  previewPresetSwap,
  updateDeployment,
} from '../../clients/deployment.client';
import { deleteModel, updateModel } from '../../clients/model.client';
import { createPreset, updatePreset } from '../../clients/preset.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const DEPLOYMENT_ROUTE = '/api/v1/admin/deployment';

const PRESET_DOCUMENT = 'image: ghcr.io/ggml-org/llama.cpp:server\nthreads: 16\n';

const OVERRIDE_DOCUMENT = `# This box has fewer cores
threads: 8
`;

interface IDeploymentRow {
  schemaVersion: number;
  document: string;
  configuration: Record<string, unknown>;
  backend: string | null;
  presetId: number | null;
}

describe('Deployment admin routes (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let presetId: number;

  const uniqueName = (prefix: string = 'deployment'): string => `${prefix}-${randomUUID()}`;

  const uniqueFingerprint = (): string => randomUUID().replaceAll('-', '').padEnd(64, '0');

  const insertModel = async (type: ModelType = ModelType.MODEL, fingerprint = uniqueFingerprint()): Promise<number> => {
    const rows = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name")
       VALUES ($1, 'gguf', $2, 1000, 1, 'Llama 3 8B') RETURNING id`,
      [fingerprint, type]
    );

    return rows[0].id;
  };

  const create = async (body: Record<string, unknown> = {}): Promise<number> => {
    const response = await createDeployment(app, adminToken, {
      name: uniqueName(),
      modelId: await insertModel(),
      presetId,
      activationPolicy: ActivationPolicy.ALWAYS,
      document: OVERRIDE_DOCUMENT,
      ...body,
    }).expect(201);

    return response.body.id;
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    const preset = await createPreset(app, adminToken, {
      name: `preset-${randomUUID()}`,
      backend: BackendId.LLAMA_CPP,
      document: PRESET_DOCUMENT,
    }).expect(201);

    presetId = preset.body.id;
  });

  describe('access', () => {
    it('rejects an unauthenticated list', async () => {
      await request(app.getHttpServer()).patch(`${DEPLOYMENT_ROUTE}/list`).send({}).expect(401);
    });

    it('rejects an unauthenticated create', async () => {
      await request(app.getHttpServer()).post(DEPLOYMENT_ROUTE).send({}).expect(401);
    });
  });

  describe('create', () => {
    it('stores the authored document and the derived overrides in one row', async () => {
      const deploymentId = await create();

      const rows = await dbQuery<IDeploymentRow>(
        app,
        'SELECT "schemaVersion", "document", "configuration", "backend", "presetId" FROM "deployment" WHERE "id" = $1',
        [deploymentId]
      );

      expect(rows[0].document).toBe(OVERRIDE_DOCUMENT);
      expect(rows[0].configuration).toEqual({ threads: 8 });
      expect(rows[0].schemaVersion).toBe(1);
      expect(rows[0].backend).toBeNull();
      expect(rows[0].presetId).toBe(presetId);
    });

    it('publishes the name a caller addresses it by', async () => {
      const name = uniqueName();

      const deploymentId = await create({ name });
      const response = await getDeployment(app, adminToken, deploymentId).expect(200);
      const deployment: DeploymentDto = response.body;

      expect(deployment.name).toBe(name);
      expect(deployment.backend).toBe(BackendId.LLAMA_CPP);
    });

    it("labels the model it serves by the model's display name", async () => {
      const modelId = await insertModel();

      await updateModel(app, adminToken, modelId, { displayName: 'Llama chat' }).expect(200);

      const deploymentId = await create({ modelId });
      const response = await getDeployment(app, adminToken, deploymentId).expect(200);

      expect(response.body.modelName).toBe('Llama chat');
    });

    it('holds its whole configuration where it names no preset', async () => {
      const deploymentId = await create({ presetId: null, backend: BackendId.LLAMA_CPP, document: PRESET_DOCUMENT });

      const rows = await dbQuery<IDeploymentRow>(
        app,
        'SELECT "backend", "presetId" FROM "deployment" WHERE "id" = $1',
        [deploymentId]
      );

      expect(rows[0].backend).toBe(BackendId.LLAMA_CPP);
      expect(rows[0].presetId).toBeNull();
    });

    it('refuses a name another deployment already holds, whatever its case', async () => {
      const name = uniqueName();
      await create({ name });

      const response = await createDeployment(app, adminToken, {
        name: name.toUpperCase(),
        modelId: await insertModel(),
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: '',
      }).expect(400);

      expect(response.body.message).toContain('already exists');
    });

    it('refuses a deployment naming a model that does not exist', async () => {
      await createDeployment(app, adminToken, {
        name: uniqueName(),
        modelId: 999999999,
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: '',
      }).expect(400);
    });

    it('refuses a deployment against a catalogued file that is not a model', async () => {
      const response = await createDeployment(app, adminToken, {
        name: uniqueName(),
        modelId: await insertModel(ModelType.PROJECTOR),
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: OVERRIDE_DOCUMENT,
      }).expect(400);

      expect(response.body.message).toContain('multimodal projector');
    });

    it('refuses a deployment whose projector field names a catalogued file of another type', async () => {
      const fingerprint = uniqueFingerprint();

      await insertModel(ModelType.MODEL, fingerprint);

      await createDeployment(app, adminToken, {
        name: uniqueName(),
        modelId: await insertModel(),
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: `threads: 8\nmmproj: ${fingerprint}\n`,
      }).expect(400);
    });

    it('stores a projector the catalogue holds, keeping the fingerprint rather than a path', async () => {
      const fingerprint = uniqueFingerprint();

      await insertModel(ModelType.PROJECTOR, fingerprint);

      const deploymentId = await create({ document: `threads: 8\nmmproj: ${fingerprint}\n` });
      const [row] = await dbQuery<IDeploymentRow>(app, 'SELECT "configuration" FROM "deployment" WHERE "id" = $1', [
        deploymentId,
      ]);

      expect(row.configuration).toMatchObject({ mmproj: fingerprint });
    });

    it('refuses a name holding a space', async () => {
      await createDeployment(app, adminToken, {
        name: 'llama chat',
        modelId: await insertModel(),
        presetId,
        activationPolicy: ActivationPolicy.ALWAYS,
        document: '',
      }).expect(400);
    });
  });

  describe('update', () => {
    it('rewrites the name and the document together', async () => {
      const deploymentId = await create();
      const name = uniqueName();
      const modelId = await insertModel();

      await updateDeployment(app, adminToken, deploymentId, {
        name,
        modelId,
        presetId,
        backend: null,
        activationPolicy: ActivationPolicy.ON_DEMAND,
        description: '',
        document: 'threads: 4\n',
      }).expect(200);

      const response = await getDeployment(app, adminToken, deploymentId).expect(200);

      expect(response.body.name).toBe(name);
      expect(response.body.activationPolicy).toBe(ActivationPolicy.ON_DEMAND);
      expect(response.body.overrides).toEqual({ threads: 4 });
    });

    it('lets a deployment keep the name it already holds', async () => {
      const name = uniqueName();
      const deploymentId = await create({ name });

      await updateDeployment(app, adminToken, deploymentId, {
        name,
        modelId: await insertModel(),
        presetId,
        backend: null,
        activationPolicy: ActivationPolicy.ALWAYS,
        description: '',
        document: '',
      }).expect(200);
    });
  });

  describe('effective configuration', () => {
    it('overlays the deployment on its preset, attributing each value to the layer it came from', async () => {
      const deploymentId = await create();

      const response = await getDeploymentConfiguration(app, adminToken, deploymentId).expect(200);
      const configuration: DeploymentConfigurationDto = response.body;

      expect(configuration.presetId).toBe(presetId);
      expect(configuration.backend).toBe(BackendId.LLAMA_CPP);
      expect(configuration.configuration).toEqual({
        image: 'ghcr.io/ggml-org/llama.cpp:server',
        threads: 8,
      });
      expect(configuration.entries).toEqual([
        {
          key: 'image',
          value: 'ghcr.io/ggml-org/llama.cpp:server',
          source: ConfigurationSource.PRESET,
          modelled: true,
        },
        { key: 'contextSize', value: 4096, source: ConfigurationSource.DECLARATION, modelled: true },
        { key: 'ubatchSize', value: 512, source: ConfigurationSource.DECLARATION, modelled: true },
        { key: 'parallel', value: 1, source: ConfigurationSource.DECLARATION, modelled: true },
        { key: 'cacheTypeK', value: 'f16', source: ConfigurationSource.DECLARATION, modelled: true },
        { key: 'cacheTypeV', value: 'f16', source: ConfigurationSource.DECLARATION, modelled: true },
        { key: 'threads', value: 8, source: ConfigurationSource.DEPLOYMENT, presetValue: 16, modelled: true },
        { key: 'jinja', value: true, source: ConfigurationSource.DECLARATION, modelled: true },
      ]);
    });

    it('replaces a list whole rather than merging it element-wise', async () => {
      const listPresetId = await createPreset(app, adminToken, {
        name: uniqueName('preset'),
        backend: BackendId.LLAMA_CPP,
        document: 'image: ghcr.io/ggml-org/llama.cpp:server\nextraFlags:\n  - --no-mmap\n',
      })
        .expect(201)
        .then(response => response.body.id);

      const deploymentId = await create({
        presetId: listPresetId,
        document: 'extraFlags:\n  - --mlock\n',
      });

      const response = await getDeploymentConfiguration(app, adminToken, deploymentId).expect(200);

      expect(response.body.configuration.extraFlags).toEqual(['--mlock']);
    });

    it('attributes every value to a deployment naming no preset', async () => {
      const deploymentId = await create({ presetId: null, backend: BackendId.LLAMA_CPP, document: PRESET_DOCUMENT });

      const response = await getDeploymentConfiguration(app, adminToken, deploymentId).expect(200);
      const configuration: DeploymentConfigurationDto = response.body;

      const fromDocument = configuration.entries.filter(entry => entry.source !== ConfigurationSource.DECLARATION);

      expect(configuration.presetId).toBeNull();
      expect(fromDocument.map(entry => entry.source)).toEqual(
        Object.keys(configuration.configuration).map(() => ConfigurationSource.DEPLOYMENT)
      );
    });
  });

  describe('preset swap', () => {
    it('carries every override across where the new preset runs the same backend', async () => {
      const deploymentId = await create();
      const otherPresetId = await createPreset(app, adminToken, {
        name: uniqueName('preset'),
        backend: BackendId.LLAMA_CPP,
        document: PRESET_DOCUMENT,
      })
        .expect(201)
        .then(response => response.body.id);

      const preview = await previewPresetSwap(app, adminToken, deploymentId, {
        presetId: otherPresetId,
        backend: null,
        document: OVERRIDE_DOCUMENT,
      }).expect(200);

      expect(preview.body.droppedKeys).toEqual([]);

      await updateDeployment(app, adminToken, deploymentId, {
        name: uniqueName(),
        modelId: await insertModel(),
        presetId: otherPresetId,
        backend: null,
        activationPolicy: ActivationPolicy.ALWAYS,
        description: '',
        document: OVERRIDE_DOCUMENT,
      }).expect(200);

      const response = await getDeployment(app, adminToken, deploymentId).expect(200);

      expect(response.body.presetId).toBe(otherPresetId);
      expect(response.body.overrides).toEqual({ threads: 8 });
    });

    it('refuses a swap naming a backend beside a preset', async () => {
      const deploymentId = await create();

      await previewPresetSwap(app, adminToken, deploymentId, {
        presetId,
        backend: BackendId.LLAMA_CPP,
        document: OVERRIDE_DOCUMENT,
      }).expect(400);
    });
  });

  describe('model references', () => {
    it('refuses to delete a model a deployment serves, naming the deployment', async () => {
      const modelId = await insertModel();
      const name = uniqueName();

      await create({ modelId, name });

      const response = await deleteModel(app, adminToken, modelId).expect(400);

      expect(response.body.message).toContain(name);
    });

    it('releases the model once the deployment is gone', async () => {
      const modelId = await insertModel();
      const deploymentId = await create({ modelId });

      await deleteDeployment(app, adminToken, deploymentId).expect(200);
      await deleteModel(app, adminToken, modelId).expect(200);
    });

    it('refuses to delete a projector a deployment names as its companion, naming the deployment', async () => {
      const fingerprint = uniqueFingerprint();
      const projectorId = await insertModel(ModelType.PROJECTOR, fingerprint);
      const name = uniqueName();

      await create({ name, document: `threads: 8\nmmproj: ${fingerprint}\n` });

      const response = await deleteModel(app, adminToken, projectorId).expect(400);

      expect(response.body.message).toContain(name);
    });

    it('releases the projector once the deployment naming it is gone', async () => {
      const fingerprint = uniqueFingerprint();
      const projectorId = await insertModel(ModelType.PROJECTOR, fingerprint);
      const deploymentId = await create({ document: `threads: 8\nmmproj: ${fingerprint}\n` });

      await deleteDeployment(app, adminToken, deploymentId).expect(200);
      await deleteModel(app, adminToken, projectorId).expect(200);
    });
  });

  describe('out of date and apply', () => {
    let outOfDatePresetId: number;
    let outOfDateModelId: number;

    const edit = (deploymentId: number, document: string, name: string = uniqueName()) =>
      updateDeployment(app, adminToken, deploymentId, {
        name,
        modelId: outOfDateModelId,
        presetId: outOfDatePresetId,
        backend: null,
        activationPolicy: ActivationPolicy.ALWAYS,
        description: '',
        document,
      });

    const createFrom = (document: string, name: string = uniqueName()): Promise<number> =>
      create({ name, modelId: outOfDateModelId, presetId: outOfDatePresetId, document });

    const isOutOfDate = async (deploymentId: number): Promise<boolean> => {
      const response = await getDeployment(app, adminToken, deploymentId).expect(200);

      return response.body.outOfDate;
    };

    const countOutOfDate = async (): Promise<number> => {
      const response = await getOutOfDateDeployments(app, adminToken).expect(200);

      return response.body.outOfDate;
    };

    beforeEach(async () => {
      outOfDateModelId = await insertModel();

      const preset = await createPreset(app, adminToken, {
        name: `preset-${randomUUID()}`,
        backend: BackendId.LLAMA_CPP,
        document: PRESET_DOCUMENT,
      }).expect(201);

      outOfDatePresetId = preset.body.id;
    });

    it('reads a newly created deployment as up to date', async () => {
      await expect(isOutOfDate(await createFrom(OVERRIDE_DOCUMENT))).resolves.toBe(false);
    });

    it('marks a deployment out of date when an edit moves a relaunch-required field', async () => {
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT);

      await edit(deploymentId, 'threads: 4\n').expect(200);

      await expect(isOutOfDate(deploymentId)).resolves.toBe(true);
    });

    it('leaves a deployment up to date when an edit moves a hot field alone', async () => {
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT);

      await edit(deploymentId, 'threads: 8\nreplicas: 4\n').expect(200);

      await expect(isOutOfDate(deploymentId)).resolves.toBe(false);
    });

    it('marks the deployment inheriting a preset field it changed, and leaves the one overriding it alone', async () => {
      const inheriting = await createFrom('threads: 8\n');
      const overriding = await createFrom("threads: 8\nflashAttn: 'on'\n");

      await updatePreset(app, adminToken, outOfDatePresetId, {
        name: `preset-${randomUUID()}`,
        description: '',
        document: `${PRESET_DOCUMENT}flashAttn: 'off'\n`,
      }).expect(200);

      await expect(isOutOfDate(inheriting)).resolves.toBe(true);
      await expect(isOutOfDate(overriding)).resolves.toBe(false);
    });

    it('leaves every deployment alone when a preset edit moves a hot field alone', async () => {
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT);

      await updatePreset(app, adminToken, outOfDatePresetId, {
        name: `preset-${randomUUID()}`,
        description: '',
        document: `${PRESET_DOCUMENT}replicas: 4\n`,
      }).expect(200);

      await expect(isOutOfDate(deploymentId)).resolves.toBe(false);
    });

    it('brings a deployment back up to date on apply', async () => {
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT);
      await edit(deploymentId, 'threads: 4\n').expect(200);

      await applyDeployment(app, adminToken, deploymentId).expect(201);

      await expect(isOutOfDate(deploymentId)).resolves.toBe(false);
    });

    it('counts the out-of-date deployments fleet-wide', async () => {
      const before = await countOutOfDate();
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT);

      await edit(deploymentId, 'threads: 4\n').expect(200);

      await expect(countOutOfDate()).resolves.toBe(before + 1);
    });

    it('applies every out-of-date deployment across the fleet', async () => {
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT);
      await edit(deploymentId, 'threads: 4\n').expect(200);

      const response = await applyDeployments(app, adminToken).expect(201);

      expect(response.body.applied).toBeGreaterThanOrEqual(1);
      await expect(countOutOfDate()).resolves.toBe(0);
    });

    it('flags an out-of-date deployment in the list', async () => {
      const name = uniqueName();
      const deploymentId = await createFrom(OVERRIDE_DOCUMENT, name);

      await edit(deploymentId, 'threads: 4\n', name).expect(200);

      const list = await getDeploymentList(app, adminToken, { search: name }).expect(200);

      expect(list.body.deploymentList[0].outOfDate).toBe(true);
    });
  });

  describe('list', () => {
    it('finds a deployment by name, counting every match', async () => {
      const name = uniqueName();
      const deploymentId = await create({ name });

      const response = await getDeploymentList(app, adminToken, { search: name }).expect(200);

      expect(response.body.deploymentList).toHaveLength(1);
      expect(response.body.deploymentList[0].id).toBe(deploymentId);
      expect(response.body.total).toBe(1);
    });

    it("carries its model's licence mark, in the list and on the deployment", async () => {
      const name = uniqueName();
      const modelId = await insertModel();

      await dbQuery(
        app,
        `UPDATE "model" SET "detectedTasks" = '{speech}', "licence" = '{"id":"cc-by-nc-4.0","name":null,"link":null}' WHERE "id" = $1`,
        [modelId]
      );

      const deploymentId = await create({ name, modelId });
      const expected = {
        modelLicence: { id: 'cc-by-nc-4.0', name: null, link: null, terms: LicenceTerms.NON_COMMERCIAL },
      };

      const list = await getDeploymentList(app, adminToken, { search: name }).expect(200);
      const deployment = await getDeployment(app, adminToken, deploymentId).expect(200);

      expect(list.body.deploymentList[0]).toMatchObject(expected);
      expect(deployment.body).toMatchObject(expected);
    });
  });
});
