import { Controller, Delete, Get, MessageEvent, Param, Post, Res, Sse, SseSignal } from '@nestjs/common';
import { ServerResponse } from 'node:http';
import { Observable } from 'rxjs';

import {
  DeploymentInstancesResponseDto,
  InstanceKeyParamDto,
  StartInstanceResponseDto,
  UserRoleId,
  IdParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { InstanceAdminService } from './instance-admin.service';
import { InstanceOutputAdminService } from './instance-output-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/deployment/:deploymentId/instance')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class DeploymentInstanceAdminController {
  constructor(
    private readonly instanceAdminService: InstanceAdminService,
    private readonly instanceOutputAdminService: InstanceOutputAdminService
  ) {}

  @Get()
  getDeploymentInstances(
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<DeploymentInstancesResponseDto> {
    return this.instanceAdminService.getDeploymentInstances(deploymentId);
  }

  /**
   * Emits the current set on connect, then again on every write to any instance, this deployment's or not, on an
   * edit, enable or disable of this deployment, and at most once a second on telemetry from the nodes its placement
   * refuses.
   */
  @Sse('stream')
  async streamDeploymentInstances(
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<Observable<MessageEvent>> {
    return withHeartbeat(await this.instanceAdminService.watchDeploymentInstances(deploymentId));
  }

  /**
   * The container's latest lines, then its output as it is written, until it ends. The response is taken alongside
   * Nest's handling of it, so the stream can stop reading the node while the viewer is backed up.
   */
  @Sse(':instanceKey/output/stream')
  async streamInstanceOutput(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number,
    @Param('instanceKey', new ZodPipe(InstanceKeyParamDto)) instanceKey: string,
    @SseSignal() signal: AbortSignal,
    @Res({ passthrough: true }) response: ServerResponse
  ): Promise<Observable<MessageEvent>> {
    const frames = await this.instanceOutputAdminService.watchOutput(deploymentId, instanceKey, {
      userId: user.id,
      signal,
      response,
    });

    return withHeartbeat(frames, { endWithPayloads: true });
  }

  @Post()
  startDeployment(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<StartInstanceResponseDto> {
    return this.instanceAdminService.startDeployment(deploymentId, user.id);
  }

  @Delete()
  stopDeployment(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<void> {
    return this.instanceAdminService.stopDeployment(deploymentId, user.id);
  }
}
