import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { EventPartyType, EventSeverity, EventType, EventDto, UserRoleId } from '@libs/dto';

import { getEventList, getEventStream } from '../../clients/event.client';
import { login, loginRequest } from '../../clients/user.client';
import { createTestEvent } from '../../factories/event.factory';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { openSse } from '../../utils/sse';

const EVENT_LIST_ROUTE = '/api/v1/admin/event/list';
const EVENT_STREAM_ROUTE = '/api/v1/admin/event/stream';

describe('Event admin routes (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;

  // Events are fleet-wide, so every filter is scoped to a subject this run owns.
  const subjectId = randomUUID();

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  describe('access', () => {
    it('rejects an unauthenticated list', async () => {
      await request(app.getHttpServer()).patch(EVENT_LIST_ROUTE).send({}).expect(401);
    });

    it('rejects an unauthenticated stream', async () => {
      await request(app.getHttpServer()).get(EVENT_STREAM_ROUTE).expect(401);
    });

    it('rejects a user without the SYSTEM_ADMIN role', async () => {
      const user = await createTestUser(app);
      const token = await login(app, user.email);

      await getEventList(app, token).expect(403);
      await getEventStream(app, token).expect(403);
    });
  });

  describe('list', () => {
    it('reads the newest event first', async () => {
      const olderId = await createTestEvent(app, { subjectType: EventPartyType.USER, subjectId, minutesAgo: 10 });
      const newerId = await createTestEvent(app, { subjectType: EventPartyType.USER, subjectId });

      const response = await getEventList(app, adminToken, { subjectId }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.map(event => event.id)).toEqual([newerId, olderId]);
    });

    it('carries the subject and the structured detail back', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, {
        subjectType: EventPartyType.USER,
        subjectId: ownSubjectId,
        detail: { email: 'tester@modelfleet.test', attempt: 2 },
      });

      const response = await getEventList(app, adminToken, { subjectId: ownSubjectId }).expect(200);
      const [event] = response.body.eventList as EventDto[];

      expect(event.subjectType).toBe(EventPartyType.USER);
      expect(event.subjectId).toBe(ownSubjectId);
      expect(event.detail).toEqual({ email: 'tester@modelfleet.test', attempt: 2 });
    });

    it('carries the message a row was written with back', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, {
        subjectType: EventPartyType.USER,
        subjectId: ownSubjectId,
        message: 'Sign-in refused for `tester@modelfleet.test`',
      });

      const response = await getEventList(app, adminToken, { subjectId: ownSubjectId }).expect(200);
      const [event] = response.body.eventList as EventDto[];

      expect(event.message).toBe('Sign-in refused for `tester@modelfleet.test`');
    });

    it('reads a row written before messages existed as one carrying none', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, { subjectType: EventPartyType.USER, subjectId: ownSubjectId });

      const response = await getEventList(app, adminToken, { subjectId: ownSubjectId }).expect(200);
      const [event] = response.body.eventList as EventDto[];

      expect(event.message).toBeUndefined();
    });

    it('narrows to the given type', async () => {
      const ownSubjectId = randomUUID();
      const failedId = await createTestEvent(app, {
        type: EventType.USER_SIGN_IN_FAILED,
        severity: EventSeverity.WARNING,
        subjectId: ownSubjectId,
      });
      await createTestEvent(app, { type: EventType.USER_SIGNED_IN, subjectId: ownSubjectId });

      const response = await getEventList(app, adminToken, {
        subjectId: ownSubjectId,
        type: [EventType.USER_SIGN_IN_FAILED],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.map(event => event.id)).toEqual([failedId]);
    });

    it('narrows to the given severity', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, { severity: EventSeverity.INFO, subjectId: ownSubjectId });
      const warningId = await createTestEvent(app, {
        type: EventType.USER_SIGN_IN_FAILED,
        severity: EventSeverity.WARNING,
        subjectId: ownSubjectId,
      });

      const response = await getEventList(app, adminToken, {
        subjectId: ownSubjectId,
        severity: [EventSeverity.WARNING],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.map(event => event.id)).toEqual([warningId]);
    });

    it('narrows to what one actor did', async () => {
      const ownActorId = randomUUID();
      const actedId = await createTestEvent(app, { actorType: EventPartyType.USER, actorId: ownActorId });
      await createTestEvent(app, { subjectType: EventPartyType.USER, subjectId: ownActorId });

      const response = await getEventList(app, adminToken, {
        actorType: EventPartyType.USER,
        actorId: ownActorId,
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.map(event => event.id)).toEqual([actedId]);
    });

    it('narrows to a window of time', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, { subjectId: ownSubjectId, minutesAgo: 120 });
      const recentId = await createTestEvent(app, { subjectId: ownSubjectId, minutesAgo: 1 });

      const fromDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const response = await getEventList(app, adminToken, { subjectId: ownSubjectId, fromDate }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.map(event => event.id)).toEqual([recentId]);
    });

    it('reports the pages a filtered log holds', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, { subjectId: ownSubjectId, minutesAgo: 20 });
      await createTestEvent(app, { subjectId: ownSubjectId, minutesAgo: 10 });
      await createTestEvent(app, { subjectId: ownSubjectId });

      const response = await getEventList(app, adminToken, { subjectId: ownSubjectId }).expect(200);

      expect(response.body.eventList).toHaveLength(3);
      expect(response.body.pages).toBe(1);
    });

    it('answers a page beyond the end with nothing', async () => {
      const ownSubjectId = randomUUID();
      await createTestEvent(app, { subjectId: ownSubjectId });

      const response = await getEventList(app, adminToken, { subjectId: ownSubjectId }, 2).expect(200);

      expect(response.body.eventList).toEqual([]);
    });

    it('rejects a page below the first', async () => {
      await getEventList(app, adminToken, {}, 0).expect(400);
    });

    it('rejects a filter key the dto does not declare', async () => {
      await getEventList(app, adminToken, { notAFilter: 'nope' }).expect(400);
    });

    it('rejects a type that is not an event type', async () => {
      await getEventList(app, adminToken, { type: ['not-an-event-type'] }).expect(400);
    });
  });

  describe('recording', () => {
    it('records a successful sign-in against the user who made it', async () => {
      const user = await createTestUser(app);
      await login(app, user.email);

      const response = await getEventList(app, adminToken, {
        subjectId: `${user.id}`,
        type: [EventType.USER_SIGNED_IN],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList).toHaveLength(1);
      expect(eventList[0].severity).toBe(EventSeverity.INFO);
      expect(eventList[0].detail).toEqual({ email: user.email });
      expect(eventList[0].message).toBe(`**${user.name}** signed in as \`${user.email}\``);
      expect(eventList[0].actorType).toBe(EventPartyType.USER);
      expect(eventList[0].actorId).toBe(`${user.id}`);
    });

    it('records a refused sign-in as one nobody is the actor of', async () => {
      const user = await createTestUser(app);

      await loginRequest(app, { email: user.email, password: 'WrongPass123!' }).expect(400);

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.USER,
        type: [EventType.USER_SIGN_IN_FAILED],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];
      const refused = eventList.find(event => event.detail.email === user.email);

      expect(refused?.actorType).toBeUndefined();
      expect(refused?.actorId).toBeUndefined();
    });

    it('records a refused sign-in without issuing a session', async () => {
      const user = await createTestUser(app);

      await loginRequest(app, { email: user.email, password: 'WrongPass123!' }).expect(400);

      const response = await getEventList(app, adminToken, {
        type: [EventType.USER_SIGN_IN_FAILED],
        severity: [EventSeverity.WARNING],
      }).expect(200);
      const eventList = response.body.eventList as EventDto[];

      expect(eventList.some(event => event.detail.email === user.email)).toBe(true);
    });
  });

  describe('stream', () => {
    it('carries an event to a stream that is already open', async () => {
      const stream = await openSse(app, EVENT_STREAM_ROUTE, authHeaders(adminToken));

      expect(await stream.status).toBe(200);
      expect((await stream.headers)['content-type']).toContain('text/event-stream');

      const user = await createTestUser(app);
      await login(app, user.email);

      const [payload] = await stream.take(1);
      const event = JSON.parse(payload) as EventDto;

      expect(event.type).toBe(EventType.USER_SIGNED_IN);
      expect(event.detail.email).toBe(user.email);
      expect(event.message).toBe(`**${user.name}** signed in as \`${user.email}\``);

      // The insert fills the generated columns in, so a streamed event is complete without a reread.
      expect(event.id).toBeGreaterThan(0);
      expect(new Date(event.createdDate).getTime()).toBeGreaterThan(0);

      stream.close();
    });
  });
});
