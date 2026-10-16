import { Body, Controller, Get, Logger, Patch, Post, SetMetadata } from '@nestjs/common';

import {
  EventPartyType,
  EventSeverity,
  EventType,
  ProfileResponseDto,
  TokenResponseDto,
  UpdateProfileResponseDto,
  LoginRequestDto,
  UpdateProfileRequestDto,
} from '@libs/dto';

import { GetUser } from './decorators/user.decorator';
import { ALLOWED_DURING_SETUP_METADATA_KEY } from './guards/auth.guard';
import { NoAuth } from '@/api/v1/user/decorators/no-auth.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { EventService } from '@/core/event/event.service';
import { UserService } from '@/core/user/user.service';

@Controller('api/v1/user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly eventService: EventService,
    private readonly userService: UserService
  ) {}

  @NoAuth()
  @Post('login')
  async login(@Body(new ZodPipe(LoginRequestDto)) loginUserRequest: LoginRequestDto): Promise<TokenResponseDto> {
    // The check runs in its own transaction, so a failure event is recorded once that has rolled back.
    const user = await this.userService
      .checkLoginWithThrow(loginUserRequest.email, loginUserRequest.password)
      .catch(async (error: unknown) => {
        // The refusal reaches the caller even where recording it fails.
        await this.eventService
          .recordEvent(EventType.USER_SIGN_IN_FAILED, EventSeverity.WARNING, {
            subjectType: EventPartyType.USER,
            message: `Sign-in refused for \`${loginUserRequest.email}\``,
            detail: { email: loginUserRequest.email },
          })
          .catch((recordError: unknown) => {
            this.logger.error({ error: recordError }, 'login(): Failed to record the refused sign-in');
          });

        throw error;
      });

    await this.eventService.recordEvent(EventType.USER_SIGNED_IN, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${user.id}`,
      subjectType: EventPartyType.USER,
      subjectId: `${user.id}`,
      message: `**${user.name}** signed in as \`${user.email}\``,
      detail: { email: user.email },
    });

    return {
      token: await this.userService.createLoginToken(user),
    };
  }

  @Get('profile')
  @SetMetadata(ALLOWED_DURING_SETUP_METADATA_KEY, true)
  getProfile(@GetUser() user: User): ProfileResponseDto {
    return {
      name: user.name,
      email: user.email,
      userRoleIds: (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId),
      mustChangePassword: user.mustChangePassword,
    };
  }

  @Patch('profile')
  @SetMetadata(ALLOWED_DURING_SETUP_METADATA_KEY, true)
  async updateProfile(
    @GetUser() user: User,
    @Body(new ZodPipe(UpdateProfileRequestDto)) updateProfileRequest: UpdateProfileRequestDto
  ): Promise<UpdateProfileResponseDto> {
    await this.userService.updateProfile(
      updateProfileRequest.name,
      updateProfileRequest.email,
      updateProfileRequest.password,
      user.id
    );

    // Changing the password drops the session it was made from, so the caller is given the
    // replacement rather than being signed out mid-edit.
    if (updateProfileRequest.password !== undefined) {
      return { token: await this.userService.startSession(user) };
    }

    return {};
  }

  @Post('logout')
  @SetMetadata(ALLOWED_DURING_SETUP_METADATA_KEY, true)
  async doLogout(@GetUser() user: User): Promise<void> {
    await this.userService.invalidateSessions(user.id);
  }
}
