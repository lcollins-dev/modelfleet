import { NestExpressApplication } from '@nestjs/platform-express';

import { EventDetail, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { dbQuery } from '../utils/db';

export interface ICreateTestEventOptions {
  type?: EventType;
  severity?: EventSeverity;
  actorType?: EventPartyType | null;
  actorId?: string | null;
  subjectType?: EventPartyType | null;
  subjectId?: string | null;
  message?: string | null;
  detail?: EventDetail;
  minutesAgo?: number;
}

export const createTestEvent = async (
  app: NestExpressApplication,
  options: ICreateTestEventOptions = {}
): Promise<number> => {
  const {
    type = EventType.USER_SIGNED_IN,
    severity = EventSeverity.INFO,
    actorType = null,
    actorId = null,
    subjectType = null,
    subjectId = null,
    message = null,
    detail = {},
    minutesAgo = 0,
  } = options;

  const rows = await dbQuery<{ id: number }>(
    app,
    `INSERT INTO "event" ("type", "severity", "actorType", "actorId", "subjectType", "subjectId", "message", "detail", "createdDate")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - ($9 || ' minutes')::interval)
     RETURNING id`,
    [type, severity, actorType, actorId, subjectType, subjectId, message, JSON.stringify(detail), minutesAgo]
  );

  return rows[0].id;
};
