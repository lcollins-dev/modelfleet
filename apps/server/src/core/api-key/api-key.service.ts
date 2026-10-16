import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Not, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { ApiKeyListStatus, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { ApiKey } from './entities/api-key.entity';

import { EventService } from '../event/event.service';
import { UserService } from '../user/user.service';
import { ApiKeyTokenService } from './api-key-token.service';

const API_KEY_MISSING_MESSAGE = 'This API key does not exist';
const API_KEY_NAME_EMPTY_MESSAGE = 'Enter a name for this API key';
const API_KEY_REVOKED_MESSAGE = 'This API key has already been revoked';

/** The stamp is coarse: a busy key would otherwise write on every inference request. */
const LAST_USED_STAMP_INTERVAL_MS = 60_000;

export interface IApiKeyCriteria {
  search?: string;
  status?: ApiKeyListStatus;
}

export interface IApiKeyCounts {
  total: number;
  active: number;
  revoked: number;
}

export interface IIssuedApiKey {
  apiKey: ApiKey;

  /** The only readable copy; the row keeps a hash of the secret half alone. */
  token: string;
}

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly eventService: EventService,
    private readonly userService: UserService,
    private readonly apiKeyTokenService: ApiKeyTokenService,
    @InjectRepository(ApiKey) private readonly apiKeyRepository: Repository<ApiKey>
  ) {}

  @Transactional()
  async issue(name: string, ownerId: number): Promise<IIssuedApiKey> {
    name = name.trim();

    if (name.length === 0) {
      throw new BadRequestException(API_KEY_NAME_EMPTY_MESSAGE);
    }

    const owner = await this.userService.findWithThrow(ownerId);
    const { keyId, secretHash, token } = this.apiKeyTokenService.issue();

    const apiKey = new ApiKey({ keyId, name, secretHash, userId: owner.id });
    await this.apiKeyRepository.insert(apiKey);

    await this.eventService.recordEvent(EventType.API_KEY_CREATED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${owner.id}`,
      subjectType: EventPartyType.API_KEY,
      subjectId: `${apiKey.id}`,
      message: `Created API key **${apiKey.name}**`,
      detail: { name: apiKey.name, keyId: apiKey.keyId, ownerName: owner.name },
    });

    return { apiKey, token };
  }

  /** Newest first. */
  findAndCount(criteria: IApiKeyCriteria, skip: number, take: number): Promise<[ApiKey[], number]> {
    const queryBuilder = this.apiKeyRepository.createQueryBuilder('apiKey');

    if (criteria.search !== undefined) {
      queryBuilder.andWhere(
        new Brackets(where => {
          where
            .where('LOWER(apiKey.name) LIKE LOWER(:search)', { search: `%${criteria.search}%` })
            .orWhere('LOWER(apiKey.keyId) LIKE LOWER(:search)', { search: `%${criteria.search}%` });
        })
      );
    }

    if (criteria.status === ApiKeyListStatus.ACTIVE) {
      queryBuilder.andWhere('apiKey.revokedDate IS NULL');
    }

    if (criteria.status === ApiKeyListStatus.REVOKED) {
      queryBuilder.andWhere('apiKey.revokedDate IS NOT NULL');
    }

    return queryBuilder
      .orderBy('apiKey.createdDate', 'DESC')
      .addOrderBy('apiKey.id', 'DESC')
      .take(take)
      .skip(skip)
      .getManyAndCount();
  }

  async countByState(): Promise<IApiKeyCounts> {
    const total = await this.apiKeyRepository.count();
    const revoked = await this.apiKeyRepository.count({ where: { revokedDate: Not(IsNull()) } });

    return { total, active: total - revoked, revoked };
  }

  async findWithThrow(apiKeyId: number): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepository.findOne({ where: { id: apiKeyId } });

    if (!apiKey) {
      throw new BadRequestException(API_KEY_MISSING_MESSAGE);
    }

    return apiKey;
  }

  /** A key that no longer exists is absent from the map, not an error. */
  async findNames(apiKeyIds: number[]): Promise<Map<number, string>> {
    if (apiKeyIds.length === 0) {
      return new Map();
    }

    const apiKeys = await this.apiKeyRepository.find({ select: ['id', 'name'], where: { id: In(apiKeyIds) } });

    return new Map(apiKeys.map(apiKey => [apiKey.id, apiKey.name]));
  }

  /** A user that no longer exists is absent from the map, not an error. */
  findOwnerNames(apiKeys: ApiKey[]): Promise<Map<number, string>> {
    return this.userService.findNames([...new Set(apiKeys.map(apiKey => apiKey.userId))]);
  }

  @Transactional()
  async revoke(apiKeyId: number, actorId: number): Promise<void> {
    const apiKey = await this.findWithThrow(apiKeyId);

    if (apiKey.revokedDate !== null) {
      throw new BadRequestException(API_KEY_REVOKED_MESSAGE);
    }

    await this.apiKeyRepository.update({ id: apiKey.id }, { revokedDate: new Date() });

    const ownerNames = await this.userService.findNames([apiKey.userId]);

    await this.eventService.recordEvent(EventType.API_KEY_REVOKED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.API_KEY,
      subjectId: `${apiKey.id}`,
      message: `Revoked API key **${apiKey.name}**`,
      detail: { name: apiKey.name, keyId: apiKey.keyId, ownerName: ownerNames.get(apiKey.userId) ?? '' },
    });
  }

  /**
   * Answers null for every refusal alike - a malformed token, an unknown identifier, a wrong secret,
   * a revoked key and a disabled owner - so a caller cannot tell them apart.
   *
   * Stamps `lastUsedDate` on success, at most once per `LAST_USED_STAMP_INTERVAL_MS`.
   */
  async verify(token: string): Promise<ApiKey | null> {
    const presented = this.apiKeyTokenService.parse(token);

    if (!presented) {
      return null;
    }

    const apiKey = await this.apiKeyRepository.findOne({
      where: { keyId: presented.keyId },
      relations: { user: true },
    });

    if (!apiKey || !this.apiKeyTokenService.matches(presented.secret, apiKey.secretHash)) {
      return null;
    }

    if (apiKey.revokedDate !== null || apiKey.user?.enabled !== true) {
      return null;
    }

    await this.stampLastUsed(apiKey);

    return apiKey;
  }

  private async stampLastUsed(apiKey: ApiKey): Promise<void> {
    const now = new Date();

    if (apiKey.lastUsedDate !== null && now.getTime() - apiKey.lastUsedDate.getTime() < LAST_USED_STAMP_INTERVAL_MS) {
      return;
    }

    await this.apiKeyRepository.update({ id: apiKey.id }, { lastUsedDate: now });
    apiKey.lastUsedDate = now;
  }
}
