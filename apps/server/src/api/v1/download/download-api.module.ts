import { Module } from '@nestjs/common';

import { DownloadAdminService } from './download-admin.service';

import { DownloadAdminController } from './download-admin.controller';

import { DownloadModule } from '@/core/download/download.module';
import { NodeModule } from '@/core/node/node.module';

@Module({
  imports: [DownloadModule, NodeModule],
  providers: [DownloadAdminService],
  controllers: [DownloadAdminController],
})
export class DownloadApiModule {}
