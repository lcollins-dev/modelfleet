import { Server, createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayListenerService } from '@/gateway/gateway-listener.service';

describe('GatewayListenerService', () => {
  const servers: Server[] = [];

  const listening = async (): Promise<Server> => {
    const server = createServer();

    servers.push(server);

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    return server;
  };

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('closes every server it holds on shutdown, cutting the connections still open', async () => {
    const service = new GatewayListenerService();
    const server = await listening();
    const closeAllConnections = vi.spyOn(server, 'closeAllConnections');

    service.hold(server);
    service.beforeApplicationShutdown();

    expect(server.listening).toBe(false);
    expect(closeAllConnections).toHaveBeenCalled();
  });

  it('lets go of a server closed before shutdown', async () => {
    const service = new GatewayListenerService();
    const server = await listening();

    service.hold(server);

    await new Promise(resolve => server.close(resolve));

    const close = vi.spyOn(server, 'close');

    service.beforeApplicationShutdown();

    expect(close).not.toHaveBeenCalled();
  });
});
