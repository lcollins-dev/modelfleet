import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DownloadFile } from './entities/download-file.entity';
import { DownloadTarget } from './entities/download-target.entity';
import { Download } from './entities/download.entity';

import { DownloadAdmissionService } from './download-admission.service';
import { DownloadDesiredStateService } from './download-desired-state.service';
import { DownloadProgressService } from './download-progress.service';
import { DownloadService } from './download.service';
import { HubReaderService } from './hub-reader.service';

import { AgentModule } from '../agent/agent.module';
import { EventModule } from '../event/event.module';
import { NodeModule } from '../node/node.module';

import { DownloadGateway } from './download.gateway';
import { DownloadPublisher } from './download.publisher';

@Module({
  imports: [TypeOrmModule.forFeature([Download, DownloadFile, DownloadTarget]), AgentModule, EventModule, NodeModule],
  providers: [
    DownloadGateway,
    DownloadPublisher,
    DownloadService,
    DownloadAdmissionService,
    DownloadDesiredStateService,
    DownloadProgressService,
    HubReaderService,
  ],
  exports: [DownloadService, DownloadAdmissionService, DownloadProgressService, HubReaderService],
})
export class DownloadModule {}
