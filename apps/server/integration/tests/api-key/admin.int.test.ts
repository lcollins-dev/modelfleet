import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { ApiKeyListStatus, EventPartyType, EventType, EventDto, ListApiKeyDto, UserRoleId } from '@libs/dto';

import { ApiKeyService } from '@/core/api-key/api-key.service';

import { createApiKey, getApiKeyList, getApiKeyStats, revokeApiKey } from '../../clients/api-key.client';
import { getEventList } from '../../clients/event.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const API_KEY_ROUTE = '/api/v1/admin/api-key';
const UNKNOWN_API_KEY_ID = 999999999;

describe('API key admin routes (integration)', () => {
  let app: NestExpressApplication;
  let apiKeyService: ApiKeyService;
  let adminToken: string;
  let adminId: number;

  const issue = async (name: string = 'Chat app'): Promise<{ apiKey: ListApiKeyDto; token: string }> => {
    const response = await createApiKey(app, adminToken, { name }).expect(201);

    return response.body;
  };

  beforeAll(async () => {
    app = await bootstrapApp();
    apiKeyService = app.get(ApiKeyService);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN], name: 'Key admin' });
    adminId = admin.id;
    adminToken = await login(app, admin.email);
  });

  describe('access', () => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer()).post(API_KEY_ROUTE).send({ name: 'Chat app' }).expect(401);
      await request(app.getHttpServer()).patch(`${API_KEY_ROUTE}/list`).send({}).expect(401);
    });

    it('rejects a user without the SYSTEM_ADMIN role', async () => {
      const user = await createTestUser(app);
      const token = await login(app, user.email);

      await createApiKey(app, token, { name: 'Chat app' }).expect(403);
      await getApiKeyList(app, token).expect(403);
      await getApiKeyStats(app, token).expect(403);
      await revokeApiKey(app, token, UNKNOWN_API_KEY_ID).expect(403);
    });
  });

  describe('issuance', () => {
    it('answers with the token and the key it belongs to', async () => {
      const { apiKey, token } = await issue('Issuance app');

      expect(token.startsWith('mfk_')).toBe(true);
      expect(apiKey.keyId).toHaveLength(24);
      expect(token).toContain(apiKey.keyId);
      expect(apiKey.ownerId).toBe(adminId);
      expect(apiKey.ownerName).toBe('Key admin');
      expect(apiKey.revokedDate).toBeNull();
      expect(apiKey.lastUsedDate).toBeNull();
    });

    it('stores a hash of the secret rather than any part of the token', async () => {
      const { apiKey, token } = await issue('Hashed app');

      const rows = await dbQuery<{ secretHash: string }>(app, 'SELECT "secretHash" FROM "api_key" WHERE "id" = $1', [
        apiKey.id,
      ]);

      expect(rows[0].secretHash).toHaveLength(64);
      expect(token).not.toContain(rows[0].secretHash);
      expect(rows[0].secretHash).not.toContain(token);
    });

    it('never returns the token a second time', async () => {
      const { apiKey, token } = await issue('Once only');

      const listResponse = await getApiKeyList(app, adminToken, { search: apiKey.keyId }).expect(200);
      const statsResponse = await getApiKeyStats(app, adminToken).expect(200);

      expect(JSON.stringify(listResponse.body)).not.toContain(token);
      expect(JSON.stringify(statsResponse.body)).not.toContain(token);
    });

    it('records an event carrying no part of the token', async () => {
      const { apiKey, token } = await issue('Evented app');

      const response = await getEventList(app, adminToken, {
        type: [EventType.API_KEY_CREATED],
        subjectType: EventPartyType.API_KEY,
        subjectId: `${apiKey.id}`,
      }).expect(200);

      const events = response.body.eventList as EventDto[];

      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(token);
      expect(events[0].detail).toMatchObject({ keyId: apiKey.keyId, name: 'Evented app', ownerName: 'Key admin' });
    });

    it('rejects a name outside the allowed length', async () => {
      await createApiKey(app, adminToken, { name: '' }).expect(400);
      await createApiKey(app, adminToken, { name: 'a'.repeat(129) }).expect(400);
    });
  });

  describe('listing', () => {
    it('narrows by status', async () => {
      const active = await issue('Listed active');
      const revoked = await issue('Listed revoked');

      await revokeApiKey(app, adminToken, revoked.apiKey.id).expect(200);

      const activeResponse = await getApiKeyList(app, adminToken, {
        search: active.apiKey.keyId,
        status: ApiKeyListStatus.ACTIVE,
      }).expect(200);
      const revokedResponse = await getApiKeyList(app, adminToken, {
        search: active.apiKey.keyId,
        status: ApiKeyListStatus.REVOKED,
      }).expect(200);

      expect(activeResponse.body.apiKeyList).toHaveLength(1);
      expect(revokedResponse.body.apiKeyList).toHaveLength(0);
    });

    it('keeps a revoked key listed with its state', async () => {
      const { apiKey } = await issue('Kept for audit');
      await revokeApiKey(app, adminToken, apiKey.id).expect(200);

      const response = await getApiKeyList(app, adminToken, { search: apiKey.keyId }).expect(200);
      const listed = response.body.apiKeyList as ListApiKeyDto[];

      expect(listed).toHaveLength(1);
      expect(listed[0].revokedDate).not.toBeNull();
    });
  });

  describe('revocation', () => {
    it('refuses a second revocation of the same key', async () => {
      const { apiKey } = await issue('Revoked twice');

      await revokeApiKey(app, adminToken, apiKey.id).expect(200);
      await revokeApiKey(app, adminToken, apiKey.id).expect(400);
    });

    it('refuses a key that does not exist', async () => {
      await revokeApiKey(app, adminToken, UNKNOWN_API_KEY_ID).expect(400);
    });
  });

  describe('verification', () => {
    it('accepts the token it issued and stamps last use', async () => {
      const { apiKey, token } = await issue('Verified app');

      expect(await apiKeyService.verify(token)).not.toBeNull();

      const response = await getApiKeyList(app, adminToken, { search: apiKey.keyId }).expect(200);

      expect((response.body.apiKeyList as ListApiKeyDto[])[0].lastUsedDate).not.toBeNull();
    });

    it('refuses a revoked key from that moment', async () => {
      const { apiKey, token } = await issue('Revoked app');

      expect(await apiKeyService.verify(token)).not.toBeNull();

      await revokeApiKey(app, adminToken, apiKey.id).expect(200);

      expect(await apiKeyService.verify(token)).toBeNull();
    });

    it('refuses a key whose owner is disabled', async () => {
      const owner = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
      const ownerToken = await login(app, owner.email);

      const response = await createApiKey(app, ownerToken, { name: 'Disabled owner' }).expect(201);
      const { token } = response.body;

      expect(await apiKeyService.verify(token)).not.toBeNull();

      await dbQuery(app, 'UPDATE "user" SET "enabled" = false WHERE "id" = $1', [owner.id]);

      expect(await apiKeyService.verify(token)).toBeNull();
    });

    it('refuses an unknown or malformed token', async () => {
      const { token } = await issue('Tampered app');

      expect(await apiKeyService.verify('not-a-key')).toBeNull();
      expect(await apiKeyService.verify(`${token}x`)).toBeNull();
      expect(await apiKeyService.verify(`mfk_${'0'.repeat(24)}_absent`)).toBeNull();
    });

    it('drops a key with its owner', async () => {
      const owner = await createTestUser(app);
      const { apiKey } = await apiKeyService.issue('Cascaded app', owner.id);

      await dbQuery(app, 'DELETE FROM "user" WHERE "id" = $1', [owner.id]);

      const rows = await dbQuery(app, 'SELECT "id" FROM "api_key" WHERE "id" = $1', [apiKey.id]);

      expect(rows).toHaveLength(0);
    });
  });
});
