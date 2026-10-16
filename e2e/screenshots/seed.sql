-- The fleet the README screenshots show. Run against a freshly cleaned instance database, whose test admin becomes
-- Alex Morgan with the same password. The node keeps its key and secret, so the local agent still connects.
UPDATE "user"
SET "name" = 'Alex Morgan', "email" = 'alex@example.com', "lastLoginSuccess" = now() - interval '1 day'
WHERE "email" = 'admin@modelfleet.test';

UPDATE "node" SET "name" = 'rig-01', "description" = 'Workstation under the desk' WHERE "name" = 'Development node';

-- Two more nodes, so the fleet has a state besides online: one that went quiet, one whose agent has not connected yet.
-- They share the development node's secret hash, which never answers a connection here.
INSERT INTO "node" ("nodeKey", "name", "description", "secretHash", "enabled", "lastSeenDate", "agentVersion",
  "createdDate")
SELECT gen_random_uuid(), "rigs"."name", "rigs"."description", "rig01"."secretHash", true, now() - "rigs"."lastSeen",
  "rigs"."agentVersion", now() - "rigs"."age"
FROM "node" AS "rig01", (
  VALUES
    ('rig-02', 'Spare box in the rack', interval '3 days', '0.0.0', interval '9 days'),
    ('rig-03', 'Waiting on its agent', NULL, NULL, interval '1 day')
) AS "rigs" ("name", "description", "lastSeen", "agentVersion", "age")
WHERE "rig01"."name" = 'rig-01';

INSERT INTO "gpu" ("nodeId", "deviceKey", "vendor", "name", "pciBusId", "memoryTotalBytes", "index", "lastReportedDate")
SELECT "id", 'GPU-' || gen_random_uuid(), 'nvidia', 'NVIDIA GeForce RTX 4090', NULL, 25757220864, 0,
  now() - interval '3 days'
FROM "node"
WHERE "name" = 'rig-02';

-- The same password hash as Alex, so any of them could sign in.
INSERT INTO "user" ("name", "email", "passwordHash", "enabled", "lastLoginSuccess", "createdDate")
SELECT "people"."name", "people"."email", "admin"."passwordHash", true, now() - "people"."lastLogin",
  now() - "people"."age"
FROM "user" AS "admin", (
  VALUES
    ('Jordan Lee', 'jordan@example.com', interval '2 hours', interval '40 days'),
    ('Riley Evans', 'riley@example.com', interval '3 days', interval '31 days'),
    ('Sam Carter', 'sam@example.com', interval '12 days', interval '19 days')
) AS "people" ("name", "email", "lastLogin", "age")
WHERE "admin"."email" = 'alex@example.com';

-- Jordan holds both admin roles, as Alex does; Riley manages users alone.
INSERT INTO "user_user_role" ("userId", "userRoleId")
SELECT "id", "roleId"
FROM "user", (VALUES (9100), (9200)) AS "roles" ("roleId")
WHERE "email" = 'jordan@example.com';

INSERT INTO "user_user_role" ("userId", "userRoleId")
SELECT "id", 9100 FROM "user" WHERE "email" = 'riley@example.com';

-- Alex's keys. The secret half is never shown again, so any hash will do.
INSERT INTO "api_key" ("keyId", "name", "secretHash", "userId", "lastUsedDate", "createdDate")
SELECT substr(md5("keys"."name"), 1, 24), "keys"."name", encode(sha256(convert_to("keys"."name", 'UTF8')), 'hex'),
  "user"."id", now() - "keys"."lastUsed", now() - "keys"."age"
FROM "user", (
  VALUES
    ('production-chat', interval '4 minutes', interval '12 days'),
    ('staging-eval', interval '2 days', interval '5 days')
) AS "keys" ("name", "lastUsed", "age")
WHERE "user"."email" = 'alex@example.com';

-- The history the dashboard's Recent activity and the event log show, oldest first. The events recorded while the
-- node was still called Development node go, since they name it.
DELETE FROM "event";

INSERT INTO "event" ("type", "severity", "actorType", "actorId", "subjectType", "subjectId", "message", "detail",
  "createdDate")
SELECT "events"."type", 'info', "events"."actorType", "events"."actorId", "events"."subjectType", "events"."subjectId",
  "events"."message", "events"."detail"::jsonb, now() - "events"."age"
FROM (
  VALUES
    ('node.registered', 'user', '1', 'node', '1', 'Registered node **rig-01**', '{"name": "rig-01"}',
      interval '12 days 3 hours'),
    ('node.connected', NULL, NULL, 'node', '1',
      'Node **rig-01** connected from `203.0.113.10` running agent `0.0.0`',
      '{"name": "rig-01", "agentVersion": "0.0.0", "protocolVersion": 3, "remoteAddress": "203.0.113.10"}',
      interval '12 days 2 hours'),
    ('node.registered', 'user', '1', 'node', '2', 'Registered node **rig-02**', '{"name": "rig-02"}',
      interval '9 days 2 hours'),
    ('node.connected', NULL, NULL, 'node', '2',
      'Node **rig-02** connected from `203.0.113.11` running agent `0.0.0`',
      '{"name": "rig-02", "agentVersion": "0.0.0", "protocolVersion": 3, "remoteAddress": "203.0.113.11"}',
      interval '9 days 1 hour'),
    ('node.disconnected', NULL, NULL, 'node', '2', 'Node **rig-02** disconnected with close code `1006`',
      '{"name": "rig-02", "closeCode": 1006}', interval '3 days'),
    ('node.registered', 'user', '2', 'node', '3', 'Registered node **rig-03**', '{"name": "rig-03"}',
      interval '1 day'),
    ('api-key.created', 'user', '1', 'api-key', '1', 'Created API key **production-chat**',
      '{"name": "production-chat", "keyId": "1e4d1a0f8c3b2e6a9d7c5b4a", "ownerName": "Alex Morgan"}',
      interval '12 days 1 hour'),
    ('api-key.created', 'user', '1', 'api-key', '2', 'Created API key **staging-eval**',
      '{"name": "staging-eval", "keyId": "7a2c9e5b1d4f8a6c3e0b2d9f", "ownerName": "Alex Morgan"}', interval '5 days'),
    ('user.signed-in', 'user', '2', 'user', '2', '**Jordan Lee** signed in as `jordan@example.com`',
      '{"email": "jordan@example.com"}', interval '2 hours')
) AS "events" ("type", "actorType", "actorId", "subjectType", "subjectId", "message", "detail", "age");
