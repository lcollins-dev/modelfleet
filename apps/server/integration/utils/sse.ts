import { NestExpressApplication } from '@nestjs/platform-express';
import { IncomingMessage, Server, get } from 'node:http';
import { AddressInfo } from 'node:net';

export interface ISseConnection {
  /** Resolves once that many `data:` payloads have arrived, or rejects if the stream stalls. */
  take: (count: number, timeoutMs?: number) => Promise<string[]>;
  status: Promise<number>;
  headers: Promise<Record<string, string | string[] | undefined>>;
  close: () => void;
}

const TAKE_TIMEOUT_MS = 5000;

const listening = async (app: NestExpressApplication): Promise<number> => {
  const server: Server = app.getHttpServer();

  if (server.address() === null) {
    await new Promise<void>(resolve => server.listen(0, resolve));
  }

  return (server.address() as AddressInfo).port;
};

/** Supertest resolves on a response that ends, and an event stream never does. */
export const openSse = async (
  app: NestExpressApplication,
  path: string,
  requestHeaders: Record<string, string> = {}
): Promise<ISseConnection> => {
  const port = await listening(app);

  const payloads: string[] = [];
  const waiting: (() => void)[] = [];

  let request: ReturnType<typeof get> | null = null;

  const readPayloads = (response: IncomingMessage) => {
    let buffer = '';

    response.setEncoding('utf8');

    response.on('data', (chunk: string) => {
      buffer += chunk;

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice('data:'.length).trim())
          .join('');

        if (data !== '') {
          payloads.push(data);
        }
      }

      waiting.splice(0).forEach(resume => resume());
    });
  };

  let onHeaders: (value: Record<string, string | string[] | undefined>) => void = () => undefined;
  const headers = new Promise<Record<string, string | string[] | undefined>>(resolve => {
    onHeaders = resolve;
  });

  const status = new Promise<number>((resolve, reject) => {
    request = get(
      { host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream', ...requestHeaders } },
      response => {
        resolve(response.statusCode ?? 0);
        onHeaders(response.headers);

        readPayloads(response);
      }
    );

    request.on('error', reject);
  });

  const take = async (count: number, timeoutMs: number = TAKE_TIMEOUT_MS): Promise<string[]> => {
    const deadline = Date.now() + timeoutMs;

    while (payloads.length < count) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${count} event(s) on ${path}, saw ${payloads.length}`);
      }

      await new Promise<void>(resume => {
        waiting.push(resume);
        setTimeout(resume, 50);
      });
    }

    return payloads.slice(0, count);
  };

  return {
    take,
    status,
    headers,
    close: () => request?.destroy(),
  };
};
