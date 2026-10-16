import { Module } from '@nestjs/common';

import { RelayModule } from '../relay/relay.module';
import { ServerClient } from './server-client';
import { ServerConnectionService } from './server-connection.service';
import { ServerSessionService } from './server-session.service';
import { ServerController } from './server.controller';
import { ServerTransport } from './server.transport';

@Module({
  imports: [RelayModule],
  controllers: [ServerController],
  providers: [ServerTransport, ServerSessionService, ServerClient, ServerConnectionService],
  exports: [ServerConnectionService],
})
export class ServerModule {}
