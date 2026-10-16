import { Controller, Get, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import { NodeTelemetryStatusDto, UserRoleId, IdParamDto } from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { TelemetryAdminService } from './telemetry-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/node/:nodeId/telemetry')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class TelemetryAdminController {
  constructor(private readonly telemetryAdminService: TelemetryAdminService) {}

  @Get()
  getNodeTelemetryStatus(@Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number): Promise<NodeTelemetryStatusDto> {
    return this.telemetryAdminService.getNodeTelemetryStatus(nodeId);
  }

  /** Emits the current status on connect, then again on each reading the node reports. */
  @Sse('stream')
  async streamNodeTelemetryStatus(
    @Param('nodeId', new ZodPipe(IdParamDto)) nodeId: number
  ): Promise<Observable<MessageEvent>> {
    return withHeartbeat(await this.telemetryAdminService.watchNodeTelemetryStatus(nodeId));
  }
}
