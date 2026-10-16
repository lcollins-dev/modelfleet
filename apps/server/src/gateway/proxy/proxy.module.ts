import { Module } from '@nestjs/common';

import { InferenceRequestService } from './inference-request.service';
import { MultipartUploadService } from './multipart-upload.service';
import { RelayProxyService } from './relay-proxy.service';

import { AgentModule } from '@/core/agent/agent.module';
import { InferenceModule } from '@/core/inference/inference.module';
import { SupervisorModule } from '@/core/supervisor/supervisor.module';

@Module({
  imports: [AgentModule, InferenceModule, SupervisorModule],
  providers: [InferenceRequestService, MultipartUploadService, RelayProxyService],
  exports: [InferenceRequestService, MultipartUploadService, RelayProxyService],
})
export class ProxyModule {}
