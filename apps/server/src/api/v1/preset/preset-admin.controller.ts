import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  CreatePresetResponseDto,
  PresetDto,
  PresetImpactResponseDto,
  PresetListResponseDto,
  UserRoleId,
  CreatePresetRequestDto,
  PresetImpactRequestDto,
  PresetListRequestDto,
  UpdatePresetRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { PresetAdminService } from './preset-admin.service';

@Controller('api/v1/admin/preset')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class PresetAdminController {
  constructor(private readonly presetAdminService: PresetAdminService) {}

  @Patch('list')
  getPresetList(
    @Body(new ZodPipe(PresetListRequestDto)) presetListRequest: PresetListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<PresetListResponseDto> {
    return this.presetAdminService.getPresetList(presetListRequest, page);
  }

  @Post()
  createPreset(
    @GetUser() user: User,
    @Body(new ZodPipe(CreatePresetRequestDto)) createPresetRequest: CreatePresetRequestDto
  ): Promise<CreatePresetResponseDto> {
    return this.presetAdminService.createPreset(createPresetRequest, user.id);
  }

  @Get(':presetId')
  getPreset(@Param('presetId', new ZodPipe(IdParamDto)) presetId: number): Promise<PresetDto> {
    return this.presetAdminService.getPreset(presetId);
  }

  @Patch(':presetId/impact')
  getPresetImpact(
    @Param('presetId', new ZodPipe(IdParamDto)) presetId: number,
    @Body(new ZodPipe(PresetImpactRequestDto)) presetImpactRequest: PresetImpactRequestDto
  ): Promise<PresetImpactResponseDto> {
    return this.presetAdminService.getPresetImpact(presetId, presetImpactRequest);
  }

  @Patch(':presetId')
  updatePreset(
    @GetUser() user: User,
    @Param('presetId', new ZodPipe(IdParamDto)) presetId: number,
    @Body(new ZodPipe(UpdatePresetRequestDto)) updatePresetRequest: UpdatePresetRequestDto
  ): Promise<void> {
    return this.presetAdminService.updatePreset(presetId, updatePresetRequest, user.id);
  }

  @Delete(':presetId')
  deletePreset(@GetUser() user: User, @Param('presetId', new ZodPipe(IdParamDto)) presetId: number): Promise<void> {
    return this.presetAdminService.deletePreset(presetId, user.id);
  }
}
