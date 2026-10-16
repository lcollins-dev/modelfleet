import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { DockerSocketError, DockerSocketService } from '@/docker/docker-socket.service';

describe('DockerSocketService', () => {
  let directory: string;
  let server: ReturnType<typeof createServer> | null = null;
  let socketPath: string;

  const buildService = async (path: string): Promise<DockerSocketService> => {
    socketPath = path;

    const moduleRef = await Test.createTestingModule({
      providers: [
        DockerSocketService,
        {
          provide: ConfigService,
          useValue: {
            get dockerSocketPath() {
              return socketPath;
            },
          },
        },
      ],
    }).compile();

    return moduleRef.get(DockerSocketService);
  };

  const listenOn = async (path: string): Promise<void> => {
    server = createServer();

    await new Promise<void>(resolve => {
      server?.listen(path, resolve);
    });
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modelfleet-docker-'));
  });

  afterEach(async () => {
    server?.close();
    server = null;

    await rm(directory, { recursive: true, force: true });
  });

  it('accepts a socket the agent can read and write', async () => {
    const path = join(directory, 'docker.sock');
    await listenOn(path);

    const service = await buildService(path);

    await expect(service.checkSocket(path)).resolves.toBeUndefined();
  });

  it('names the mount when nothing is at the path', async () => {
    const path = join(directory, 'missing.sock');
    const service = await buildService(path);

    await expect(service.checkSocket(path)).rejects.toThrow(DockerSocketError);
    await expect(service.checkSocket(path)).rejects.toThrow(path);
  });

  it('refuses a path holding something other than a socket', async () => {
    const path = join(directory, 'docker.sock');
    await writeFile(path, '');

    const service = await buildService(path);

    await expect(service.checkSocket(path)).rejects.toThrow('not a socket');
  });

  it('passes startup when the socket is reachable', async () => {
    const path = join(directory, 'docker.sock');
    await listenOn(path);

    const service = await buildService(path);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('stops startup when the socket is missing, so the agent never dials', async () => {
    const service = await buildService(join(directory, 'missing.sock'));

    await expect(service.onModuleInit()).rejects.toThrow(DockerSocketError);
  });
});
