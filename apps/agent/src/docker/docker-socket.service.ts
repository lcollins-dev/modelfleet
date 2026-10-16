import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';

import { ConfigService } from '../config/config.service';

export class DockerSocketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerSocketError';
  }
}

function missingMessage(path: string): string {
  return `The agent needs the host's Docker socket at ${path}, and nothing is mounted there. Mount it with -v ${path}:${path}, or name a different path in DOCKER_SOCKET_PATH.`;
}

function notASocketMessage(path: string): string {
  return `The agent needs the host's Docker socket at ${path}, and that path is not a socket.`;
}

function unreadableMessage(path: string): string {
  return `The agent needs read and write access to the Docker socket at ${path}. Add the user it runs as to the group owning the socket.`;
}

@Injectable()
export class DockerSocketService implements OnModuleInit {
  private readonly logger = new Logger(DockerSocketService.name);

  constructor(private readonly configService: ConfigService) {}

  /** Nest runs this before any module bootstraps. */
  async onModuleInit(): Promise<void> {
    const path = this.configService.dockerSocketPath;

    await this.checkSocket(path);

    this.logger.log(`onModuleInit(): The Docker socket at ${path} is reachable`);
  }

  async checkSocket(path: string): Promise<void> {
    let stats;

    try {
      stats = await stat(path);
    } catch {
      throw new DockerSocketError(missingMessage(path));
    }

    if (!stats.isSocket()) {
      throw new DockerSocketError(notASocketMessage(path));
    }

    try {
      await access(path, constants.R_OK | constants.W_OK);
    } catch {
      throw new DockerSocketError(unreadableMessage(path));
    }
  }
}
