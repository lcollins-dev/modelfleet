import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  ApplyDeploymentsResponseDto,
  CreateDeploymentResponseDto,
  DeploymentDto,
  DeploymentConfigurationDto,
  DeploymentListResponseDto,
  OutOfDateDeploymentsResponseDto,
  PresetSwapResponseDto,
  UserRoleId,
  CreateDeploymentRequestDto,
  DeploymentListRequestDto,
  PresetSwapRequestDto,
  UpdateDeploymentRequestDto,
  UpdateDeploymentStateRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { DeploymentAdminService } from './deployment-admin.service';

@Controller('api/v1/admin/deployment')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class DeploymentAdminController {
  constructor(private readonly deploymentAdminService: DeploymentAdminService) {}

  @Patch('list')
  getDeploymentList(
    @Body(new ZodPipe(DeploymentListRequestDto)) deploymentListRequest: DeploymentListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<DeploymentListResponseDto> {
    return this.deploymentAdminService.getDeploymentList(deploymentListRequest, page);
  }

  @Post()
  createDeployment(
    @GetUser() user: User,
    @Body(new ZodPipe(CreateDeploymentRequestDto)) createDeploymentRequest: CreateDeploymentRequestDto
  ): Promise<CreateDeploymentResponseDto> {
    return this.deploymentAdminService.createDeployment(createDeploymentRequest, user.id);
  }

  @Get('out-of-date')
  getOutOfDateDeployments(): Promise<OutOfDateDeploymentsResponseDto> {
    return this.deploymentAdminService.getOutOfDateDeployments();
  }

  @Post('apply')
  applyDeployments(@GetUser() user: User): Promise<ApplyDeploymentsResponseDto> {
    return this.deploymentAdminService.applyDeployments(user.id);
  }

  @Get(':deploymentId')
  getDeployment(@Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number): Promise<DeploymentDto> {
    return this.deploymentAdminService.getDeployment(deploymentId);
  }

  @Get(':deploymentId/configuration')
  getDeploymentConfiguration(
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<DeploymentConfigurationDto> {
    return this.deploymentAdminService.getDeploymentConfiguration(deploymentId);
  }

  @Post(':deploymentId/apply')
  applyDeployment(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<void> {
    return this.deploymentAdminService.applyDeployment(deploymentId, user.id);
  }

  @Patch(':deploymentId/preset-swap')
  previewPresetSwap(
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number,
    @Body(new ZodPipe(PresetSwapRequestDto)) presetSwapRequest: PresetSwapRequestDto
  ): Promise<PresetSwapResponseDto> {
    return this.deploymentAdminService.previewPresetSwap(deploymentId, presetSwapRequest);
  }

  @Patch(':deploymentId/state')
  updateState(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number,
    @Body(new ZodPipe(UpdateDeploymentStateRequestDto)) updateDeploymentStateRequest: UpdateDeploymentStateRequestDto
  ): Promise<void> {
    return this.deploymentAdminService.updateState(deploymentId, updateDeploymentStateRequest.enabled, user.id);
  }

  @Patch(':deploymentId')
  updateDeployment(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number,
    @Body(new ZodPipe(UpdateDeploymentRequestDto)) updateDeploymentRequest: UpdateDeploymentRequestDto
  ): Promise<void> {
    return this.deploymentAdminService.updateDeployment(deploymentId, updateDeploymentRequest, user.id);
  }

  @Delete(':deploymentId')
  deleteDeployment(
    @GetUser() user: User,
    @Param('deploymentId', new ZodPipe(IdParamDto)) deploymentId: number
  ): Promise<void> {
    return this.deploymentAdminService.deleteDeployment(deploymentId, user.id);
  }
}
