import { Module } from '@nestjs/common';

import { ModelModule } from '../model/model.module';
import { ServerModule } from '../server/server.module';
import { DownloadLocationService } from './download-location.service';
import { DownloadController } from './download.controller';
import { DownloadPublisher } from './download.publisher';
import { DownloadService } from './download.service';
import { FileDigestService } from './file-digest.service';
import { FileFetcherService } from './file-fetcher.service';

@Module({
  imports: [ServerModule, ModelModule],
  controllers: [DownloadController],
  providers: [DownloadService, DownloadPublisher, DownloadLocationService, FileFetcherService, FileDigestService],
})
export class DownloadModule {}
