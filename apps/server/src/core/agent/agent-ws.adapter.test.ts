import { WsAdapter } from '@nestjs/platform-ws';
import { MessageMappingProperties } from '@nestjs/websockets';
import { EventEmitter } from 'node:events';
import { from, Observable } from 'rxjs';
import { describe, expect, it, Mock, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { AgentWsAdapter } from './agent-ws.adapter';

const GATEWAYS = 5;

type GatewayCallback = MessageMappingProperties['callback'];

const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve));

describe('AgentWsAdapter', () => {
  const parser = vi.fn((data: unknown) => JSON.parse(String(data)) as { event: string; data: unknown });

  const fakeClient = () => {
    const client = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn> };

    client.readyState = WebSocket.OPEN;
    client.send = vi.fn();

    return client as unknown as WebSocket & EventEmitter & { send: ReturnType<typeof vi.fn> };
  };

  const transform = (data: unknown): Observable<unknown> => from(Promise.resolve(data));

  const handler = (message: string, callback: GatewayCallback = vi.fn()): MessageMappingProperties => ({
    message,
    methodName: message,
    callback,
    isAckHandledManually: false,
  });

  const bindGateways = (adapter: WsAdapter, client: WebSocket, callbacks: Mock<GatewayCallback>[]) => {
    const disconnects = callbacks.map(() => vi.fn<() => void>());

    callbacks.forEach((callback, i) => {
      adapter.bindMessageHandlers(client, [handler(`gateway.${i}`, callback)], transform);
      adapter.bindClientDisconnect(client, disconnects[i]);
    });

    return disconnects;
  };

  const callbacks = () => Array.from({ length: GATEWAYS }, () => vi.fn<GatewayCallback>());

  it('adds listeners per gateway under the stock adapter, which is what the warning counted', () => {
    const client = fakeClient();

    bindGateways(new WsAdapter(undefined, { messageParser: parser }), client, callbacks());

    expect(client.listenerCount('message')).toBe(GATEWAYS);
    expect(client.listenerCount('close')).toBe(GATEWAYS * 2);
  });

  it('adds one message and two close listeners per socket, whatever the number of gateways', () => {
    const client = fakeClient();

    bindGateways(new AgentWsAdapter(undefined, { messageParser: parser }), client, callbacks());

    expect(client.listenerCount('message')).toBe(1);
    expect(client.listenerCount('close')).toBe(2);
  });

  it('parses a frame once and hands it to the one gateway handling its event', async () => {
    const client = fakeClient();
    const handlers = callbacks();

    bindGateways(new AgentWsAdapter(undefined, { messageParser: parser }), client, handlers);
    parser.mockClear();

    client.emit('message', { data: JSON.stringify({ event: 'gateway.3', data: { ok: true } }) });
    await flushPromises();

    expect(parser).toHaveBeenCalledOnce();
    expect(handlers[3]).toHaveBeenCalledExactlyOnceWith({ ok: true }, 'gateway.3');
    expect(handlers.filter(callback => callback.mock.calls.length > 0)).toHaveLength(1);
  });

  it('sends what a handler answers back down the socket', async () => {
    const client = fakeClient();
    const adapter = new AgentWsAdapter(undefined, { messageParser: parser });

    adapter.bindMessageHandlers(client, [handler('ping', vi.fn().mockResolvedValue({ event: 'pong' }))], transform);

    client.emit('message', { data: JSON.stringify({ event: 'ping', data: null }) });
    await flushPromises();

    expect(client.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'pong' }));
  });

  it('drops a frame no gateway handles', async () => {
    const client = fakeClient();
    const handlers = callbacks();

    bindGateways(new AgentWsAdapter(undefined, { messageParser: parser }), client, handlers);

    client.emit('message', { data: JSON.stringify({ event: 'unknown', data: null }) });
    await flushPromises();

    expect(handlers.some(callback => callback.mock.calls.length > 0)).toBe(false);
  });

  it('calls every gateway disconnect callback on close, and handles no frame after it', async () => {
    const client = fakeClient();
    const handlers = callbacks();
    const disconnects = bindGateways(new AgentWsAdapter(undefined, { messageParser: parser }), client, handlers);

    client.emit('close', 1000);
    client.emit('message', { data: JSON.stringify({ event: 'gateway.0', data: null }) });
    await flushPromises();

    for (const disconnect of disconnects) {
      expect(disconnect).toHaveBeenCalledOnce();
    }

    expect(handlers[0]).not.toHaveBeenCalled();
  });

  it('adds one connection listener to the server, whatever the number of gateways, and runs every gateway on it', () => {
    const adapter = new AgentWsAdapter(undefined, { messageParser: parser });
    const server = new EventEmitter() as unknown as WebSocketServer & EventEmitter;
    const connects = Array.from({ length: GATEWAYS }, () => vi.fn());
    const client = fakeClient();

    for (const connect of connects) {
      adapter.bindClientConnect(server, connect);
    }

    server.emit('connection', client, 'request');

    expect(server.listenerCount('connection')).toBe(1);

    for (const connect of connects) {
      expect(connect).toHaveBeenCalledExactlyOnceWith(client, 'request');
    }
  });

  it('keeps the first gateway subscribing an event, rather than letting a later one replace it', async () => {
    const adapter = new AgentWsAdapter(undefined, { messageParser: parser });
    const client = fakeClient();
    const first = vi.fn<GatewayCallback>();
    const second = vi.fn<GatewayCallback>();

    adapter.bindMessageHandlers(client, [handler('report', first)], transform);
    adapter.bindMessageHandlers(client, [handler('report', second)], transform);

    client.emit('message', { data: JSON.stringify({ event: 'report', data: null }) });
    await flushPromises();

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('keeps each socket to its own handlers', async () => {
    const adapter = new AgentWsAdapter(undefined, { messageParser: parser });
    const first = fakeClient();
    const second = fakeClient();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    adapter.bindMessageHandlers(first, [handler('report', firstHandler)], transform);
    adapter.bindMessageHandlers(second, [handler('report', secondHandler)], transform);

    second.emit('message', { data: JSON.stringify({ event: 'report', data: null }) });
    await flushPromises();

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});
