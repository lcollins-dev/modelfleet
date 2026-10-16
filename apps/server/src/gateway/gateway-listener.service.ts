import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Server } from 'node:http';

/** Nest closes only the server it listens on, so the gateway's closes here, cutting open streams it would wait on. */
@Injectable()
export class GatewayListenerService implements BeforeApplicationShutdown {
  private readonly servers = new Set<Server>();

  hold(server: Server): void {
    this.servers.add(server);

    server.once('close', () => this.servers.delete(server));
  }

  beforeApplicationShutdown(): void {
    for (const server of this.servers) {
      server.close();
      server.closeAllConnections();
    }
  }
}
