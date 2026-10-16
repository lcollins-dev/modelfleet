import { Injectable } from '@nestjs/common';

import {
  UserDto,
  UserListRequestDto,
  UserListResponseDto,
  UserRoleDto,
  UserStatsResponseDto,
  UserListStatus,
} from '@libs/dto';

import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';
import { UserService } from '@/core/user/user.service';

@Injectable()
export class UserAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService
  ) {}

  async getRoleList(): Promise<UserRoleDto[]> {
    const userRoles = await this.userService.findRoles();

    return userRoles.map(userRole => ({ id: userRole.id, name: userRole.name }));
  }

  async getUserList(userListRequest: UserListRequestDto, page: number): Promise<UserListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [users, total] = await this.userService.findAndCount(
      {
        search: userListRequest.search,
        enabled:
          userListRequest.status === UserListStatus.ALL ? undefined : userListRequest.status === UserListStatus.ENABLED,
      },
      pageSize * (page - 1),
      pageSize
    );

    return {
      userList: users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        enabled: user.enabled,
        userRoleIds: this.getUserRoleIds(user),
      })),
      pages: Math.ceil(total / pageSize),
    };
  }

  async getUserStats(): Promise<UserStatsResponseDto> {
    const { total, enabled } = await this.userService.countByState();

    return {
      total,
      enabled,
      disabled: total - enabled,
    };
  }

  async getUser(userId: number): Promise<UserDto> {
    const user = await this.userService.findWithThrow(userId, true);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      enabled: user.enabled,
      userRoleIds: this.getUserRoleIds(user),
      lastLoginSuccess: user.lastLoginSuccess ?? null,
      lastLoginFail: user.lastLoginFail ?? null,
      lastAccess: user.lastAccess,
      createdDate: user.createdDate,
    };
  }

  updateState(enabled: boolean, userId: number): Promise<void> {
    return this.userService.setEnabled(userId, enabled);
  }

  private getUserRoleIds(user: User): number[] {
    return (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId);
  }
}
