import { Body, Controller, MessageEvent, Patch, Query, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { EventListResponseDto, UserRoleId, EventFilterRequestDto, PageParamDto } from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { EventAdminService } from './event-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/event')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class EventAdminController {
  constructor(private readonly eventAdminService: EventAdminService) {}

  @Patch('list')
  getEventList(
    @Body(new ZodPipe(EventFilterRequestDto)) eventFilterRequest: EventFilterRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<EventListResponseDto> {
    return this.eventAdminService.getEventList(eventFilterRequest, page);
  }

  @Sse('stream')
  getEventStream(): Observable<MessageEvent> {
    return withHeartbeat(this.eventAdminService.getEventStream().pipe(map(event => ({ ...event }))));
  }
}
