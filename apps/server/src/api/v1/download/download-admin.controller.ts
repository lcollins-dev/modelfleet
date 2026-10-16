import { Body, Controller, Delete, Get, MessageEvent, Param, Patch, Post, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import {
  DownloadDto,
  DownloadListResponseDto,
  RepositoryListingResponseDto,
  UserRoleId,
  CreateDownloadRequestDto,
  DownloadListRequestDto,
  RepositoryListingRequestDto,
  StopDownloadRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { DownloadAdminService } from './download-admin.service';

import { withHeartbeat } from '@/common/sse';

@Controller('api/v1/admin/download')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class DownloadAdminController {
  constructor(private readonly downloadAdminService: DownloadAdminService) {}

  @Patch('list')
  getDownloadList(
    @Body(new ZodPipe(DownloadListRequestDto)) downloadListRequest: DownloadListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<DownloadListResponseDto> {
    return this.downloadAdminService.getDownloadList(downloadListRequest, page);
  }

  @Patch('listing')
  getRepositoryListing(
    @Body(new ZodPipe(RepositoryListingRequestDto)) repositoryListingRequest: RepositoryListingRequestDto
  ): Promise<RepositoryListingResponseDto> {
    return this.downloadAdminService.getRepositoryListing(repositoryListingRequest);
  }

  /** Declared ahead of the `:downloadId` routes, which would otherwise read `progress` as an id. */
  @Sse('progress/stream')
  streamDownloadProgress(): Observable<MessageEvent> {
    return withHeartbeat(this.downloadAdminService.watchDownloadProgress());
  }

  @Get(':downloadId')
  getDownload(@Param('downloadId', new ZodPipe(IdParamDto)) downloadId: number): Promise<DownloadDto> {
    return this.downloadAdminService.getDownload(downloadId);
  }

  @Post()
  createDownload(
    @GetUser() user: User,
    @Body(new ZodPipe(CreateDownloadRequestDto)) createDownloadRequest: CreateDownloadRequestDto
  ): Promise<DownloadDto> {
    return this.downloadAdminService.createDownload(createDownloadRequest, user.id);
  }

  @Post(':downloadId/stop')
  stopDownload(
    @GetUser() user: User,
    @Param('downloadId', new ZodPipe(IdParamDto)) downloadId: number,
    @Body(new ZodPipe(StopDownloadRequestDto)) stopDownloadRequest: StopDownloadRequestDto
  ): Promise<void> {
    return this.downloadAdminService.stopDownload(downloadId, stopDownloadRequest, user.id);
  }

  @Post(':downloadId/retry')
  retryDownload(
    @GetUser() user: User,
    @Param('downloadId', new ZodPipe(IdParamDto)) downloadId: number
  ): Promise<void> {
    return this.downloadAdminService.retryDownload(downloadId, user.id);
  }

  @Delete(':downloadId')
  dismissDownload(
    @GetUser() user: User,
    @Param('downloadId', new ZodPipe(IdParamDto)) downloadId: number
  ): Promise<void> {
    return this.downloadAdminService.dismissDownload(downloadId, user.id);
  }
}
