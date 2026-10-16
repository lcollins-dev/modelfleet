import { WsAdapter } from '@nestjs/platform-ws';
import { MessageMappingProperties } from '@nestjs/websockets';
import { filter, first, fromEvent, mergeMap, Observable, share, takeUntil } from 'rxjs';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Every agent gateway shares one socket path, so Nest hands the server and each socket to every gateway in turn, and
 * `WsAdapter` adds a connection listener to the server, and a message listener and two close listeners to each socket,
 * per gateway. This binds a fixed set whatever the number of gateways, and parses each frame once. An event is handled
 * by one gateway only, so a second subscription to it is refused.
 *
 * `bindMessageHandlers` restates `WsAdapter`'s own from @nestjs/platform-ws 11.1.10 over a shared handler map.
 * Check it against the new version on a Nest upgrade.
 */
export class AgentWsAdapter extends WsAdapter {
  private readonly connectsByServer = new WeakMap<WebSocketServer, ((...args: unknown[]) => void)[]>();
  private readonly handlersByClient = new WeakMap<WebSocket, Map<string, MessageMappingProperties>>();
  private readonly disconnectsByClient = new WeakMap<WebSocket, (() => void)[]>();

  override bindClientConnect(server: WebSocketServer, callback: (...args: unknown[]) => void): void {
    const bound = this.connectsByServer.get(server);

    if (bound !== undefined) {
      bound.push(callback);

      return;
    }

    const callbacks = [callback];

    this.connectsByServer.set(server, callbacks);

    server.on('connection', (...args: unknown[]) => {
      for (const connect of callbacks) {
        connect(...args);
      }
    });
  }

  override bindMessageHandlers(
    client: WebSocket,
    handlers: MessageMappingProperties[],
    transform: (data: unknown) => Observable<unknown>
  ): void {
    const bound = this.handlersByClient.get(client);

    if (bound !== undefined) {
      for (const handler of handlers) {
        const event = String(handler.message);

        if (bound.has(event)) {
          this.logger.error(
            `bindMessageHandlers(): "${event}" is subscribed by more than one gateway; keeping the first`
          );
          continue;
        }

        bound.set(event, handler);
      }

      return;
    }

    const handlersMap = new Map(handlers.map(handler => [String(handler.message), handler]));

    this.handlersByClient.set(client, handlersMap);

    const close$ = fromEvent(client, 'close').pipe(share(), first());

    fromEvent(client, 'message')
      .pipe(
        mergeMap(data =>
          this.bindMessageHandler(data, handlersMap, transform).pipe(
            filter(result => result !== null && result !== undefined)
          )
        ),
        takeUntil(close$)
      )
      .subscribe(response => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(response));
        }
      });
  }

  override bindClientDisconnect(client: WebSocket, callback: () => void): void {
    const bound = this.disconnectsByClient.get(client);

    if (bound !== undefined) {
      bound.push(callback);

      return;
    }

    const callbacks = [callback];

    this.disconnectsByClient.set(client, callbacks);

    client.on('close', () => {
      for (const disconnect of callbacks) {
        disconnect();
      }
    });
  }
}
