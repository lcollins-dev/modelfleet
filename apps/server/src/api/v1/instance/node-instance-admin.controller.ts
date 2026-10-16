import { Controller, Get, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import { NodeInstancesResponseDto, UserRoleId, IdParamDto } from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { InstanceAdminService } from './instance-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/node/:nodeId/instance')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class NodeInstanceAdminController {
  constructor(private readonly instanceAdminService: InstanceAdminService) {}

  @Get()
  getNodeInstances(@Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number): Promise<NodeInstancesResponseDto> {
    return this.instanceAdminService.getNodeInstances(nodeId);
  }

  /** Emits the current set on connect, then again on every write to any instance, this node's or not. */
  @Sse('stream')
  async streamNodeInstances(
    @Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number
  ): Promise<Observable<MessageEvent>> {
    return withHeartbeat(await this.instanceAdminService.watchNodeInstances(nodeId));
  }
}
