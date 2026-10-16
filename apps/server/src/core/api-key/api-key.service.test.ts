import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeyListStatus, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';
import { User } from '@/core/user/entities/user.entity';

import { ApiKeyTokenService } from '@/core/api-key/api-key-token.service';
import { ApiKeyService } from '@/core/api-key/api-key.service';
import { EventService } from '@/core/event/event.service';
import { UserService } from '@/core/user/user.service';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

interface IRecordedEvent {
  actorId?: string;
  subjectType?: EventPartyType;
  subjectId?: string;
  detail: Record<string, unknown>;
}

const apiKeyTokenService = new ApiKeyTokenService();

const OWNER_ID = 7;
const API_KEY_ID = 31;

const buildOwner = (overrides: Partial<User> = {}): User => {
  const user = new User({ name: 'Ada', email: 'ada@modelfleet.test', passwordHash: 'hash' });

  user.id = OWNER_ID;

  return Object.assign(user, overrides);
};

const buildApiKey = (overrides: Partial<ApiKey> = {}): ApiKey => {
  const apiKey = new ApiKey({
    keyId: 'a'.repeat(24),
    name: 'Chat app',
    secretHash: apiKeyTokenService.hash('s'),
    userId: OWNER_ID,
  });

  apiKey.id = API_KEY_ID;
  apiKey.createdDate = new Date('2026-01-01T00:00:00.000Z');
  apiKey.user = buildOwner();

  return Object.assign(apiKey, overrides);
};

describe('ApiKeyService', () => {
  let apiKeyRepository: {
    findOne: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let userService: { findWithThrow: ReturnType<typeof vi.fn>; findNames: ReturnType<typeof vi.fn> };
  let apiKeyService: ApiKeyService;
  let queryBuilder: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    queryBuilder = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[buildApiKey()], 1]),
    };

    apiKeyRepository = {
      findOne: vi.fn().mockResolvedValue(buildApiKey()),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
      createQueryBuilder: vi.fn(() => queryBuilder),
    };

    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    userService = {
      findWithThrow: vi.fn().mockResolvedValue(buildOwner()),
      findNames: vi.fn().mockResolvedValue(new Map([[OWNER_ID, 'Ada']])),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        { provide: EventService, useValue: eventService },
        { provide: UserService, useValue: userService },
        { provide: ApiKeyTokenService, useValue: apiKeyTokenService },
        { provide: getRepositoryToken(ApiKey), useValue: apiKeyRepository },
      ],
    }).compile();

    apiKeyService = moduleRef.get(ApiKeyService);
  });

  describe('issue', () => {
    it('stores a hash of the secret rather than the token', async () => {
      const { apiKey, token } = await apiKeyService.issue('Chat app', OWNER_ID);

      expect(apiKeyRepository.insert).toHaveBeenCalledWith(apiKey);
      expect(apiKey.secretHash).not.toContain(token);
      expect(token).not.toContain(apiKey.secretHash);
      expect(apiKey.secretHash).toBe(apiKeyTokenService.hash(apiKeyTokenService.parse(token)?.secret ?? ''));
    });

    it('records the owner the access epic will bound the key by', async () => {
      const { apiKey } = await apiKeyService.issue('Chat app', OWNER_ID);

      expect(apiKey.userId).toBe(OWNER_ID);
    });

    it('trims the name', async () => {
      const { apiKey } = await apiKeyService.issue('  Chat app  ', OWNER_ID);

      expect(apiKey.name).toBe('Chat app');
    });

    it('refuses a name that is only whitespace', async () => {
      await expect(apiKeyService.issue('   ', OWNER_ID)).rejects.toThrow(BadRequestException);
      expect(apiKeyRepository.insert).not.toHaveBeenCalled();
    });

    it('records an event that carries no part of the token', async () => {
      const { token } = await apiKeyService.issue('Chat app', OWNER_ID);

      const [type, , payload] = eventService.recordEvent.mock.calls[0] as [EventType, EventSeverity, IRecordedEvent];
      const secret = apiKeyTokenService.parse(token)?.secret ?? '';

      expect(type).toBe(EventType.API_KEY_CREATED);
      expect(payload.subjectType).toBe(EventPartyType.API_KEY);
      expect(JSON.stringify(payload)).not.toContain(secret);
      expect(JSON.stringify(payload)).not.toContain(token);
    });

    it('refuses an owner that does not exist', async () => {
      userService.findWithThrow.mockRejectedValue(new BadRequestException('This user does not exist'));

      await expect(apiKeyService.issue('Chat app', OWNER_ID)).rejects.toThrow(BadRequestException);
      expect(apiKeyRepository.insert).not.toHaveBeenCalled();
    });
  });

  describe('findAndCount', () => {
    it('narrows to keys that have not been revoked', async () => {
      await apiKeyService.findAndCount({ status: ApiKeyListStatus.ACTIVE }, 0, 10);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('apiKey.revokedDate IS NULL');
    });

    it('narrows to revoked keys', async () => {
      await apiKeyService.findAndCount({ status: ApiKeyListStatus.REVOKED }, 0, 10);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('apiKey.revokedDate IS NOT NULL');
    });

    it('leaves both in the list where no status is given', async () => {
      await apiKeyService.findAndCount({}, 0, 10);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('countByState', () => {
    it('reports the active count as the remainder', async () => {
      apiKeyRepository.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

      expect(await apiKeyService.countByState()).toEqual({ total: 5, active: 3, revoked: 2 });
    });
  });

  describe('revoke', () => {
    it('stamps the revocation and records an event', async () => {
      await apiKeyService.revoke(API_KEY_ID, OWNER_ID);

      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        { id: API_KEY_ID },
        { revokedDate: expect.any(Date) as Date }
      );
      expect((eventService.recordEvent.mock.calls[0] as [EventType])[0]).toBe(EventType.API_KEY_REVOKED);
    });

    it('refuses a key that is already revoked', async () => {
      apiKeyRepository.findOne.mockResolvedValue(buildApiKey({ revokedDate: new Date() }));

      await expect(apiKeyService.revoke(API_KEY_ID, OWNER_ID)).rejects.toThrow(BadRequestException);
      expect(apiKeyRepository.update).not.toHaveBeenCalled();
    });

    it('refuses a key that does not exist', async () => {
      apiKeyRepository.findOne.mockResolvedValue(null);

      await expect(apiKeyService.revoke(API_KEY_ID, OWNER_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('verify', () => {
    const presentable = () => {
      const issued = apiKeyTokenService.issue();
      apiKeyRepository.findOne.mockResolvedValue(buildApiKey({ keyId: issued.keyId, secretHash: issued.secretHash }));

      return issued.token;
    };

    it('accepts a token whose secret hashes to the stored value', async () => {
      const token = presentable();

      expect(await apiKeyService.verify(token)).not.toBeNull();
    });

    it('looks the row up by the identifier alone', async () => {
      const token = presentable();
      await apiKeyService.verify(token);

      expect(apiKeyRepository.findOne).toHaveBeenCalledWith({
        where: { keyId: apiKeyTokenService.parse(token)?.keyId },
        relations: { user: true },
      });
    });

    it('refuses a malformed token without reaching the database', async () => {
      expect(await apiKeyService.verify('not-a-key')).toBeNull();
      expect(apiKeyRepository.findOne).not.toHaveBeenCalled();
    });

    it('refuses an unknown identifier', async () => {
      apiKeyRepository.findOne.mockResolvedValue(null);

      expect(await apiKeyService.verify(apiKeyTokenService.issue().token)).toBeNull();
    });

    it('refuses a valid identifier presented with the wrong secret', async () => {
      const issued = apiKeyTokenService.issue();
      apiKeyRepository.findOne.mockResolvedValue(
        buildApiKey({ keyId: issued.keyId, secretHash: apiKeyTokenService.hash('other') })
      );

      expect(await apiKeyService.verify(issued.token)).toBeNull();
    });

    it('refuses a revoked key from that moment', async () => {
      const issued = apiKeyTokenService.issue();
      apiKeyRepository.findOne.mockResolvedValue(
        buildApiKey({ keyId: issued.keyId, secretHash: issued.secretHash, revokedDate: new Date() })
      );

      expect(await apiKeyService.verify(issued.token)).toBeNull();
    });

    it('refuses a key whose owner is disabled', async () => {
      const issued = apiKeyTokenService.issue();
      apiKeyRepository.findOne.mockResolvedValue(
        buildApiKey({ keyId: issued.keyId, secretHash: issued.secretHash, user: buildOwner({ enabled: false }) })
      );

      expect(await apiKeyService.verify(issued.token)).toBeNull();
    });

    it('stamps last use on a key that has never been used', async () => {
      await apiKeyService.verify(presentable());

      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        { id: API_KEY_ID },
        { lastUsedDate: expect.any(Date) as Date }
      );
    });

    it('leaves the stamp alone while it is still recent', async () => {
      const issued = apiKeyTokenService.issue();
      apiKeyRepository.findOne.mockResolvedValue(
        buildApiKey({ keyId: issued.keyId, secretHash: issued.secretHash, lastUsedDate: new Date() })
      );

      await apiKeyService.verify(issued.token);

      expect(apiKeyRepository.update).not.toHaveBeenCalled();
    });

    it('stamps again once the interval has passed', async () => {
      const issued = apiKeyTokenService.issue();
      apiKeyRepository.findOne.mockResolvedValue(
        buildApiKey({
          keyId: issued.keyId,
          secretHash: issued.secretHash,
          lastUsedDate: new Date(Date.now() - 120_000),
        })
      );

      await apiKeyService.verify(issued.token);

      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        { id: API_KEY_ID },
        { lastUsedDate: expect.any(Date) as Date }
      );
    });
  });
});
