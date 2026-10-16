import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import { FleetTelemetryResponseDto, UserRoleId } from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';

import { TelemetryAdminService } from './telemetry-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/telemetry')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class FleetTelemetryAdminController {
  constructor(private readonly telemetryAdminService: TelemetryAdminService) {}

  @Get()
  getFleetTelemetry(): Promise<FleetTelemetryResponseDto> {
    return this.telemetryAdminService.getFleetTelemetry();
  }

  /** Emits the whole fleet on connect, then again at most once a second while nodes report. */
  @Sse('stream')
  async streamFleetTelemetry(): Promise<Observable<MessageEvent>> {
    return withHeartbeat(await this.telemetryAdminService.watchFleetTelemetry());
  }
}
