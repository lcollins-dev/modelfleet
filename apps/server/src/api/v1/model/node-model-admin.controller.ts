import { Controller, Get, Param, Post } from '@nestjs/common';

import { NodeModelInventoryResponseDto, UserRoleId, IdParamDto } from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { ModelAdminService } from './model-admin.service';

@Controller('api/v1/admin/node/:nodeId/model')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class NodeModelAdminController {
  constructor(private readonly modelAdminService: ModelAdminService) {}

  @Get()
  getNodeModelInventory(
    @Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number
  ): Promise<NodeModelInventoryResponseDto> {
    return this.modelAdminService.getNodeModelInventory(nodeId);
  }

  @Post('scan')
  scanNodeModels(@Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number): Promise<void> {
    return this.modelAdminService.scanNodeModels(nodeId);
  }
}
