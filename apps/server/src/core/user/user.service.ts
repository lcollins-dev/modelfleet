import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { v4 as uuidv4 } from 'uuid';

import { UserRoleId } from '@libs/dto';

import { UserRole } from './entities/user-role.entity';
import { UserUserRole } from './entities/user-user-role.entity';
import { User } from './entities/user.entity';

import { TokenService } from './token.service';
import { ConfigService } from '@/config/config.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

import { fieldRefusal } from '@/common/validation-errors';

export const INVALID_LOGIN_MESSAGE = 'The email address or password is incorrect';
const USER_MISSING_MESSAGE = 'This user does not exist';
export const SESSION_EXPIRED_MESSAGE = 'Your session is invalid or has expired. Sign in to continue';
export const NOT_ALLOWED_MESSAGE = 'You do not have permission to do this';
export const ACCOUNT_DISABLED_MESSAGE = 'This account has been disabled';
export const INITIAL_PASSWORD_REUSED_MESSAGE = 'Choose a new password, not the one you signed in with';

export interface IUserCriteria {
  search?: string;
  enabled?: boolean;
}

export interface IUserCounts {
  total: number;
  enabled: number;
}

@Injectable()
export class UserService {
  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(UserUserRole)
    private readonly userUserRoleRepository: Repository<UserUserRole>
  ) {}

  async createUser(
    name: string,
    email: string,
    password: string,
    userRoleIds: UserRoleId[],
    sendWelcomeEmail = false
  ): Promise<User> {
    // Clean up email
    email = email.trim().toLowerCase();

    const emailUser = await this.userRepository.findOne({ where: { email } });

    if (emailUser) {
      throw new BadRequestException('A user with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(password, this.configService.userPasswordHashRounds);

    const user = new User({ name, email, passwordHash });
    await this.userRepository.insert(user);

    await this.updateRoles(userRoleIds, user.id);

    if (sendWelcomeEmail) {
      await this.emailService.sendEmail(email, EmailTemplate.WELCOME, {
        name,
        signInUrl: `${this.configService.webAppBaseUrl}/sign-in`,
      });
    }

    return user;
  }

  findRoles(): Promise<UserRole[]> {
    return this.userRoleRepository.find();
  }

  /** Ordered by name, each user carrying its roles. */
  findAndCount(criteria: IUserCriteria, skip: number, take: number): Promise<[User[], number]> {
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userUserRoles', 'userUserRole');

    if (criteria.search !== undefined) {
      queryBuilder.andWhere('(LOWER(user.name) LIKE LOWER(:search) OR LOWER(user.email) LIKE LOWER(:search))', {
        search: `%${criteria.search}%`,
      });
    }

    if (criteria.enabled !== undefined) {
      queryBuilder.andWhere('user.enabled = :enabled', { enabled: criteria.enabled });
    }

    return queryBuilder.orderBy('user.name', 'ASC').take(take).skip(skip).getManyAndCount();
  }

  async countByState(): Promise<IUserCounts> {
    const total = await this.userRepository.count();
    const enabled = await this.userRepository.count({ where: { enabled: true } });

    return { total, enabled };
  }

  /** The roles come back only where they were asked for. */
  async findWithThrow(userId: number, withRoles = false): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: withRoles ? { userUserRoles: true } : {},
    });

    if (!user) {
      throw new BadRequestException(USER_MISSING_MESSAGE);
    }

    return user;
  }

  async setEnabled(userId: number, enabled: boolean): Promise<void> {
    const user = await this.findWithThrow(userId);

    await this.userRepository.update({ id: user.id }, { enabled });
  }

  /**
   * Check users credentials throwing if they are invalid
   * @param email
   * @param password
   * @returns
   */
  @Transactional()
  async checkLoginWithThrow(email: string, password: string): Promise<User> {
    // Clean up email
    email = email.trim().toLowerCase();

    const user = await this.userRepository.findOne({ where: { email } });

    if (!user) {
      throw this.invalidLoginRefusal();
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await this.userRepository.update({ id: user.id }, { lastLoginFail: new Date() });
      throw this.invalidLoginRefusal();
    }

    if (!user.enabled) {
      throw new BadRequestException(ACCOUNT_DISABLED_MESSAGE);
    }

    return user;
  }

  // An unknown email and a wrong password answer alike, so a refusal never says which accounts exist.
  private invalidLoginRefusal(): BadRequestException {
    return fieldRefusal([{ path: 'password', name: 'Password', message: INVALID_LOGIN_MESSAGE }]);
  }

  /**
   * Create token for a user as part of the login flow
   * @param user
   * @returns
   */
  async createLoginToken(user: User): Promise<string> {
    const sessionUuid = uuidv4();

    await this.userRepository.update({ id: user.id }, { lastLoginSuccess: new Date(), sessionUuid });
    return this.tokenService.createToken(sessionUuid);
  }

  @Transactional()
  async checkToken(token: string): Promise<User> {
    const tokenPayload = await this.tokenService.decodeToken(token);

    if (!tokenPayload) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const user = await this.userRepository.findOne({
      where: { sessionUuid: tokenPayload.sub },
      relations: { userUserRoles: true },
    });

    if (!user) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    if (!user.enabled) {
      throw new UnauthorizedException('This account has been disabled');
    }

    if (new Date().getTime() - user.lastAccess.getTime() > this.configService.userIdleTimeoutMs) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    // Update last access
    await this.userRepository.update({ id: user.id }, {});

    return user;
  }

  @Transactional()
  async updateRoles(userRoleIds: UserRoleId[], userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new BadRequestException('This user does not exist');
    }

    await this.userUserRoleRepository.delete({ userId });

    const userRoles = await this.userRoleRepository.find({ where: { id: In(userRoleIds) } });

    if (userRoles.length < userRoleIds.length) {
      throw new BadRequestException('One or more selected roles are invalid');
    }

    for (const userRoleId of userRoleIds) {
      const userUserRole = new UserUserRole(user.id, userRoleId);
      await this.userUserRoleRepository.insert(userUserRole);
    }
  }

  @Transactional()
  async updateProfile(name: string, email: string, password: string | undefined, userId: number): Promise<void> {
    email = email.trim().toLowerCase();

    const user = await this.findWithThrow(userId);

    if (user.email !== email) {
      const emailUser = await this.userRepository.findOne({ where: { email } });
      if (emailUser) {
        throw new BadRequestException('A user with this email address already exists');
      }
    }

    if (password !== undefined && user.mustChangePassword && (await bcrypt.compare(password, user.passwordHash))) {
      throw fieldRefusal([{ path: 'password', name: 'Password', message: INITIAL_PASSWORD_REUSED_MESSAGE }]);
    }

    const passwordChange =
      password === undefined
        ? {}
        : {
            passwordHash: await bcrypt.hash(password, this.configService.userPasswordHashRounds),
            mustChangePassword: false,

            // A token issued against the old password stays valid until its session is dropped.
            sessionUuid: null,
          };

    await this.userRepository.update({ id: user.id }, { name, email, ...passwordChange });
  }

  /**
   * Start a session for a user, replacing any session they already hold
   * @param user
   * @returns Token for the new session
   */
  async startSession(user: User): Promise<string> {
    const sessionUuid = uuidv4();

    await this.userRepository.update({ id: user.id }, { sessionUuid });

    return this.tokenService.createToken(sessionUuid);
  }

  /**
   * Invalidate users old sessionUuid this will log out any existing sessions
   * @param userId
   */
  async invalidateSessions(userId: number): Promise<void> {
    await this.userRepository.update({ id: userId }, { sessionUuid: null });
  }

  /** A user that no longer exists is absent from the map, not an error. */
  async findNames(userIds: number[]): Promise<Map<number, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const users = await this.userRepository.find({ select: ['id', 'name'], where: { id: In(userIds) } });

    return new Map(users.map(user => [user.id, user.name]));
  }
}
