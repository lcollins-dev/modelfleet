import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket } from 'ws';

import { AGENT_SOCKET_PATH, AgentMessageOf, AgentMessageType, DownloadState } from '@libs/agent-protocol';
import { DownloadTargetState } from '@libs/dto';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { DownloadDesiredStateService } from './download-desired-state.service';
import { DownloadProgressService } from './download-progress.service';

@WebSocketGateway({ path: AGENT_SOCKET_PATH })
export class DownloadGateway {
  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly downloadProgressService: DownloadProgressService,
    private readonly downloadDesiredStateService: DownloadDesiredStateService
  ) {}

  @SubscribeMessage(AgentMessageType.DOWNLOAD_PROGRESS)
  async handleDownloadProgress(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() message: AgentMessageOf<AgentMessageType.DOWNLOAD_PROGRESS>
  ): Promise<void> {
    const nodeId = this.agentConnectionService.readyNodeId(client, message.type);

    if (nodeId === null) {
      return;
    }

    this.downloadProgressService.replace(nodeId, message.payload);

    for (const download of message.payload.downloads) {
      const report = {
        nodeId,
        downloadKey: download.downloadKey,
        attempt: download.attempt,
        message: download.message,
      };

      if (download.state === DownloadState.SUCCEEDED) {
        await this.downloadDesiredStateService.settle({ ...report, message: null }, DownloadTargetState.SUCCEEDED);
      } else if (download.state === DownloadState.FAILED) {
        await this.downloadDesiredStateService.settle(report, DownloadTargetState.FAILED);
      }
    }
  }
}
