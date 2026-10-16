import { Body, Controller, Get, MessageEvent, Patch, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import {
  InstanceListResponseDto,
  PlacementPreviewResponseDto,
  UserRoleId,
  PlacementPreviewRequestDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { InstanceAdminService } from './instance-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/instance')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class InstanceAdminController {
  constructor(private readonly instanceAdminService: InstanceAdminService) {}

  @Get()
  getInstances(): Promise<InstanceListResponseDto> {
    return this.instanceAdminService.getInstances();
  }

  /** Writes nothing, so a form can ask while it is being edited. */
  @Patch('placement-preview')
  previewPlacement(
    @Body(new ZodPipe(PlacementPreviewRequestDto)) placementPreviewRequest: PlacementPreviewRequestDto
  ): Promise<PlacementPreviewResponseDto> {
    return this.instanceAdminService.previewPlacement(placementPreviewRequest);
  }

  /** Emits the current set on connect, then again on every write to any instance. */
  @Sse('stream')
  async streamInstances(): Promise<Observable<MessageEvent>> {
    return withHeartbeat(await this.instanceAdminService.watchInstances());
  }
}
