import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  UserDto,
  UserListResponseDto,
  UserRoleDto,
  UserStatsResponseDto,
  UserRoleId,
  CreateUserRequestDto,
  UpdateStateRequestDto,
  UpdateUserRequestDto,
  UserListRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from './decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { UserAdminService } from './user-admin.service';
import { UserService } from '@/core/user/user.service';

@Controller('api/v1/admin/user')
@AllowedRoles(UserRoleId.USER_ADMIN)
export class UserAdminController {
  constructor(
    private readonly userService: UserService,
    private readonly userAdminService: UserAdminService
  ) {}

  @Get('role/list')
  getRoleList(): Promise<UserRoleDto[]> {
    return this.userAdminService.getRoleList();
  }

  @Get('stats')
  getUserStats(): Promise<UserStatsResponseDto> {
    return this.userAdminService.getUserStats();
  }

  @Patch('list')
  getUserList(
    @Body(new ZodPipe(UserListRequestDto)) userListRequest: UserListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<UserListResponseDto> {
    return this.userAdminService.getUserList(userListRequest, page);
  }

  @Post()
  async createUser(@Body(new ZodPipe(CreateUserRequestDto)) createUserRequest: CreateUserRequestDto): Promise<number> {
    const user = await this.userService.createUser(
      createUserRequest.name,
      createUserRequest.email,
      createUserRequest.password,
      createUserRequest.userRoleIds
    );

    return user.id;
  }

  @Get(':userId')
  getUser(@Param('userId', new ZodPipe(IdParamDto)) userId: number): Promise<UserDto> {
    return this.userAdminService.getUser(userId);
  }

  @Patch(':userId')
  async updateUser(
    @Param('userId', new ZodPipe(IdParamDto)) userId: number,
    @Body(new ZodPipe(UpdateUserRequestDto)) updateUserRequest: UpdateUserRequestDto
  ): Promise<void> {
    await this.userService.updateProfile(
      updateUserRequest.name,
      updateUserRequest.email,
      updateUserRequest.password,
      userId
    );
    await this.userService.updateRoles(updateUserRequest.userRoleIds, userId);
  }

  @Patch(':userId/state')
  async updateState(
    @Param('userId', new ZodPipe(IdParamDto)) userId: number,
    @Body(new ZodPipe(UpdateStateRequestDto)) updateStateRequest: UpdateStateRequestDto
  ): Promise<void> {
    await this.userAdminService.updateState(updateStateRequest.enabled, userId);
  }

  @Patch(':userId/logout-all-sessions')
  async logoutAllSessions(@Param('userId', new ZodPipe(IdParamDto)) userId: number): Promise<void> {
    await this.userService.invalidateSessions(userId);
  }
}
