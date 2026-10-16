import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { EventPartyType, EventType, EventDto, ListNodeDto, NodeDto, NodeState, UserRoleId } from '@libs/dto';

import { getEventList } from '../../clients/event.client';
import { deleteNode, getNode, getNodeList, registerNode, updateNode, updateNodeState } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const NODE_ROUTE = '/api/v1/admin/node';
const UNKNOWN_NODE_ID = 999999999;

describe('Node admin routes (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let adminId: number;

  // Node names are unique fleet-wide, so every test names its own.
  const uniqueName = (prefix: string = 'rig'): string => `${prefix}-${randomUUID()}`;

  const register = async (
    name: string = uniqueName()
  ): Promise<{ id: number; name: string; nodeKey: string; secret: string }> => {
    const response = await registerNode(app, adminToken, { name }).expect(201);

    return response.body;
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminId = admin.id;
    adminToken = await login(app, admin.email);
  });

  describe('access', () => {
    it('rejects an unauthenticated registration', async () => {
      await request(app.getHttpServer()).post(NODE_ROUTE).send({ name: uniqueName() }).expect(401);
    });

    it('rejects an unauthenticated list', async () => {
      await request(app.getHttpServer()).patch(`${NODE_ROUTE}/list`).send({}).expect(401);
    });

    it('rejects a user without the SYSTEM_ADMIN role', async () => {
      const user = await createTestUser(app);
      const token = await login(app, user.email);

      await registerNode(app, token, { name: uniqueName() }).expect(403);
      await getNodeList(app, token).expect(403);
      await getNode(app, token, UNKNOWN_NODE_ID).expect(403);
      await deleteNode(app, token, UNKNOWN_NODE_ID).expect(403);
    });

    it('rejects a user holding only the USER_ADMIN role', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const token = await login(app, user.email);

      await getNodeList(app, token).expect(403);
    });
  });

  describe('registration', () => {
    it('issues a key and a secret alongside the row identifier', async () => {
      const node = await register();

      expect(node.id).toBeGreaterThan(0);
      expect(node.nodeKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(node.secret).toMatch(/^mfn_[\w-]{43}$/);
    });

    it('issues a different key and secret to every node', async () => {
      const first = await register();
      const second = await register();

      expect(first.secret).not.toBe(second.secret);
      expect(first.nodeKey).not.toBe(second.nodeKey);
    });

    it('stores a hash of the secret rather than the secret', async () => {
      const node = await register();

      const rows = await dbQuery<{ secretHash: string }>(app, 'SELECT "secretHash" FROM "node" WHERE "id" = $1', [
        node.id,
      ]);

      expect(rows[0].secretHash).toMatch(/^\$2[aby]\$/);
      expect(rows[0].secretHash).not.toContain(node.secret);
    });

    it('never hands the secret back afterwards', async () => {
      const node = await register();

      const read = await getNode(app, adminToken, node.id).expect(200);
      const listed = await getNodeList(app, adminToken, { search: node.name }).expect(200);

      expect(JSON.stringify(read.body)).not.toContain(node.secret);
      expect(JSON.stringify(listed.body)).not.toContain(node.secret);
      expect(read.body).not.toHaveProperty('secretHash');
    });

    it('hands the key back afterwards, since the agent config is the operator record of it', async () => {
      const node = await register();

      const read = await getNode(app, adminToken, node.id).expect(200);

      expect(read.body.nodeKey).toBe(node.nodeKey);
    });

    it('keeps the key out of the list, which the detail screen answers for', async () => {
      const node = await register();

      const listed = await getNodeList(app, adminToken, { search: node.name }).expect(200);

      expect(JSON.stringify(listed.body)).not.toContain(node.nodeKey);
    });

    it('keeps the description it was registered with', async () => {
      const registered = await registerNode(app, adminToken, {
        name: uniqueName(),
        description: 'The rack A head node',
      }).expect(201);

      const response = await getNode(app, adminToken, registered.body.id).expect(200);

      expect(response.body.description).toBe('The rack A head node');
    });

    it('registers a node with no description at all', async () => {
      const registered = await register();

      const response = await getNode(app, adminToken, registered.id).expect(200);

      expect(response.body.description).toBeNull();
    });

    it('refuses a name another node already holds', async () => {
      const node = await register();

      await registerNode(app, adminToken, { name: node.name }).expect(400);
    });

    it('refuses a name that differs only in case', async () => {
      const node = await register();

      await registerNode(app, adminToken, { name: node.name.toUpperCase() }).expect(400);
    });

    it('refuses a name too short to identify a machine', async () => {
      await registerNode(app, adminToken, { name: 'a' }).expect(400);
    });

    it('refuses a body key the dto does not declare', async () => {
      await registerNode(app, adminToken, { name: uniqueName(), secret: 'chosen-by-the-caller' }).expect(400);
    });
  });

  describe('lifecycle', () => {
    it('reads a node back by its identifier', async () => {
      const node = await register();

      const response = await getNode(app, adminToken, node.id).expect(200);
      const read = NodeDto.parse(response.body);

      expect(read.id).toBe(node.id);
      expect(read.name).toBe(node.name);
      expect(read.state).toBe(NodeState.REGISTERED);
      expect(read.lastSeenDate).toBeNull();
      expect(read.createdDate.getTime()).toBeGreaterThan(0);
    });

    it('lists a node it registered', async () => {
      const node = await register();

      const response = await getNodeList(app, adminToken, { search: node.name }).expect(200);
      const nodeList = response.body.nodeList as ListNodeDto[];

      expect(nodeList.map(listed => listed.id)).toEqual([node.id]);
    });

    it('carries the last heartbeat and the agent version into the list', async () => {
      const node = await register();

      const response = await getNodeList(app, adminToken, { search: node.name }).expect(200);
      const [listed] = response.body.nodeList as ListNodeDto[];

      expect(listed.lastSeenDate).toBeNull();
      expect(listed.agentVersion).toBeNull();
    });

    it('renames a node', async () => {
      const node = await register();
      const renamed = uniqueName('renamed');

      await updateNode(app, adminToken, node.id, { name: renamed, description: '' }).expect(200);

      const response = await getNode(app, adminToken, node.id).expect(200);

      expect(response.body.name).toBe(renamed);
    });

    it('refuses a rename onto a name another node holds', async () => {
      const first = await register();
      const second = await register();

      await updateNode(app, adminToken, second.id, { name: first.name, description: '' }).expect(400);
    });

    it('holds a node back and lets it work again', async () => {
      const node = await register();

      await updateNodeState(app, adminToken, node.id, { enabled: false }).expect(200);

      const disabled = await getNode(app, adminToken, node.id).expect(200);
      expect(disabled.body.state).toBe(NodeState.DISABLED);
      expect(disabled.body.enabled).toBe(false);

      await updateNodeState(app, adminToken, node.id, { enabled: true }).expect(200);

      const enabled = await getNode(app, adminToken, node.id).expect(200);
      expect(enabled.body.state).toBe(NodeState.REGISTERED);
    });

    it('deletes a node', async () => {
      const node = await register();

      await deleteNode(app, adminToken, node.id).expect(200);
      await getNode(app, adminToken, node.id).expect(400);
    });

    it('refuses an identifier no node holds', async () => {
      await getNode(app, adminToken, UNKNOWN_NODE_ID).expect(400);
      await deleteNode(app, adminToken, UNKNOWN_NODE_ID).expect(400);
    });

    it('refuses an identifier that is not a number', async () => {
      await request(app.getHttpServer())
        .get(`${NODE_ROUTE}/not-a-number`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .expect(400);
    });
  });

  describe('state', () => {
    const setLastSeen = (nodeId: number, secondsAgo: number): Promise<unknown[]> =>
      dbQuery(app, `UPDATE "node" SET "lastSeenDate" = now() - ($2 || ' seconds')::interval WHERE "id" = $1`, [
        nodeId,
        secondsAgo,
      ]);

    it('reads a node heard from within the threshold as online', async () => {
      const node = await register();
      await setLastSeen(node.id, 1);

      const response = await getNode(app, adminToken, node.id).expect(200);

      expect(response.body.state).toBe(NodeState.ONLINE);
    });

    it('reads a node past the threshold as offline', async () => {
      const node = await register();
      await setLastSeen(node.id, 600);

      const response = await getNode(app, adminToken, node.id).expect(200);

      expect(response.body.state).toBe(NodeState.OFFLINE);
      expect(response.body.lastSeenDate).not.toBeNull();
    });

    it('reads a held-back node as disabled however recently it was heard from', async () => {
      const node = await register();
      await setLastSeen(node.id, 1);
      await updateNodeState(app, adminToken, node.id, { enabled: false }).expect(200);

      const response = await getNode(app, adminToken, node.id).expect(200);

      expect(response.body.state).toBe(NodeState.DISABLED);
    });

    it('narrows a list to the states asked for', async () => {
      const prefix = randomUUID();
      const online = await register(`${prefix}-online`);
      const offline = await register(`${prefix}-offline`);
      await register(`${prefix}-waiting`);

      await setLastSeen(online.id, 1);
      await setLastSeen(offline.id, 600);

      const response = await getNodeList(app, adminToken, { search: prefix, state: [NodeState.ONLINE] }).expect(200);
      const nodeList = response.body.nodeList as ListNodeDto[];

      expect(nodeList.map(listed => listed.id)).toEqual([online.id]);
    });

    it('narrows a list to nodes past the threshold', async () => {
      const prefix = randomUUID();
      const online = await register(`${prefix}-online`);
      const offline = await register(`${prefix}-offline`);
      await register(`${prefix}-waiting`);

      await setLastSeen(online.id, 1);
      await setLastSeen(offline.id, 600);

      const response = await getNodeList(app, adminToken, { search: prefix, state: [NodeState.OFFLINE] }).expect(200);
      const nodeList = response.body.nodeList as ListNodeDto[];

      expect(nodeList.map(listed => listed.id)).toEqual([offline.id]);
    });

    it('narrows a list to nodes awaiting first contact', async () => {
      const prefix = randomUUID();
      const online = await register(`${prefix}-online`);
      const waiting = await register(`${prefix}-waiting`);

      await setLastSeen(online.id, 1);

      const response = await getNodeList(app, adminToken, { search: prefix, state: [NodeState.REGISTERED] }).expect(
        200
      );
      const nodeList = response.body.nodeList as ListNodeDto[];

      expect(nodeList.map(listed => listed.id)).toEqual([waiting.id]);
    });

    it('rejects a state that is not a node state', async () => {
      await getNodeList(app, adminToken, { state: ['melted'] }).expect(400);
    });
  });

  describe('recording', () => {
    it('records the registration against the node and the administrator', async () => {
      const node = await register();

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
        type: [EventType.NODE_REGISTERED],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList).toHaveLength(1);
      expect(eventList[0].actorType).toBe(EventPartyType.USER);
      expect(eventList[0].actorId).toBe(`${adminId}`);
      expect(eventList[0].detail).toEqual({ name: node.name });
    });

    it('keeps the secret out of the event log', async () => {
      const node = await register();

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
      }).expect(200);

      expect(JSON.stringify(response.body)).not.toContain(node.secret);
    });

    it('records the name a node had before a rename', async () => {
      const node = await register();
      const renamed = uniqueName('renamed');

      await updateNode(app, adminToken, node.id, { name: renamed, description: '' }).expect(200);

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
        type: [EventType.NODE_RENAMED],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList[0].detail).toEqual({ name: renamed, previousName: node.name });
    });

    it('records a node being held back and let go separately', async () => {
      const node = await register();

      await updateNodeState(app, adminToken, node.id, { enabled: false }).expect(200);
      await updateNodeState(app, adminToken, node.id, { enabled: true }).expect(200);

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.map(event => event.type)).toEqual([
        EventType.NODE_ENABLED,
        EventType.NODE_DISABLED,
        EventType.NODE_REGISTERED,
      ]);
    });

    it('records a deletion, which outlives the node it names', async () => {
      const node = await register();

      await deleteNode(app, adminToken, node.id).expect(200);

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
        type: [EventType.NODE_DELETED],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList).toHaveLength(1);
      expect(eventList[0].detail).toEqual({ name: node.name });
    });
  });
});
