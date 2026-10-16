import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';

import {
  ModelDto,
  ModelListResponseDto,
  UserRoleId,
  ModelListRequestDto,
  UpdateModelRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { ModelAdminService } from './model-admin.service';

@Controller('api/v1/admin/model')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class ModelAdminController {
  constructor(private readonly modelAdminService: ModelAdminService) {}

  @Patch('list')
  getModelList(
    @Body(new ZodPipe(ModelListRequestDto)) modelListRequest: ModelListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<ModelListResponseDto> {
    return this.modelAdminService.getModelList(modelListRequest, page);
  }

  @Get(':modelId')
  getModel(@Param('modelId', new ZodPipe(IdParamDto)) modelId: number): Promise<ModelDto> {
    return this.modelAdminService.getModel(modelId);
  }

  @Patch(':modelId')
  updateModel(
    @GetUser() user: User,
    @Param('modelId', new ZodPipe(IdParamDto)) modelId: number,
    @Body(new ZodPipe(UpdateModelRequestDto)) updateModelRequest: UpdateModelRequestDto
  ): Promise<void> {
    return this.modelAdminService.updateModel(modelId, updateModelRequest, user.id);
  }

  @Delete(':modelId')
  deleteModel(@GetUser() user: User, @Param('modelId', new ZodPipe(IdParamDto)) modelId: number): Promise<void> {
    return this.modelAdminService.deleteModel(modelId, user.id);
  }
}
