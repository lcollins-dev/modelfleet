import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { ServerMessageOf, ServerMessageType } from '@libs/agent-protocol';

import { DownloadService } from './download.service';

@Controller()
export class DownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  @EventPattern(ServerMessageType.DESIRED_DOWNLOADS)
  async handleDesiredDownloads(
    @Payload() message: ServerMessageOf<ServerMessageType.DESIRED_DOWNLOADS>
  ): Promise<void> {
    await this.downloadService.applyDesiredDownloads(message.payload);
  }
}
