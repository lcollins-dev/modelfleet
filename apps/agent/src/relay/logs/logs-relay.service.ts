import { Injectable, Logger } from '@nestjs/common';
import { ServerResponse } from 'node:http';
import { pipeline, Readable } from 'node:stream';

import { RELAY_MAX_LOG_TAIL, RELAY_TAIL_COMPLETE_HEADER, RelayErrorCode } from '@libs/agent-protocol';

import { describeDockerError, DockerFault } from '../../docker/api/errors';
import { ContainerService } from '../../docker/container.service';
import { refuse } from '../relay-error';

const BAD_TAIL_MESSAGE = `A log is read with ?tail=<lines>, a whole number from 0 to ${RELAY_MAX_LOG_TAIL}`;

const NOT_FOUND = 404;

@Injectable()
export class LogsRelayService {
  private readonly logger = new Logger(LogsRelayService.name);

  constructor(private readonly containerService: ContainerService) {}

  /** Holds the response open, following the container until it stops or the caller goes. */
  serve(response: ServerResponse, instanceKey: string, tail: number | null): void {
    if (tail === null) {
      refuse(response, 400, RelayErrorCode.BAD_REQUEST, BAD_TAIL_MESSAGE);

      return;
    }

    this.stream(response, instanceKey, tail).catch((error: unknown) => {
      this.logger.error({ error, instanceKey }, 'serve(): Streaming a container log failed');
      response.destroy();
    });
  }

  private async stream(response: ServerResponse, instanceKey: string, tail: number): Promise<void> {
    let followed: Readable;
    let entries: number;

    try {
      const containerId = await this.containerService.findInstanceContainer(instanceKey);

      if (containerId === null) {
        refuse(response, 404, RelayErrorCode.INSTANCE_NOT_FOUND, `This node holds no container for ${instanceKey}`);

        return;
      }

      // One past the tail tells a tail that holds the whole log from one cut short. A line written between the two
      // calls can leave the count stale, which only words the viewer's header.
      entries = await this.containerService.countLogEntries(containerId, tail + 1);
      followed = await this.containerService.followStampedLog(containerId, tail);
    } catch (error: unknown) {
      this.refuseDockerError(response, instanceKey, error);

      return;
    }

    if (response.destroyed) {
      followed.destroy();

      return;
    }

    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      [RELAY_TAIL_COMPLETE_HEADER]: String(entries <= tail),
    });
    response.flushHeaders();

    let callerGone = false;

    response.on('close', () => {
      callerGone = !response.writableEnded;
    });

    // A caller going away closes the response, and the pipeline destroys the daemon's follow with it.
    pipeline(followed, response, (error: unknown) => {
      if (error !== undefined && error !== null && !callerGone) {
        this.logger.warn({ error, instanceKey }, 'stream(): A followed container log ended early');
      }
    });
  }

  private refuseDockerError(response: ServerResponse, instanceKey: string, error: unknown): void {
    const fault = describeDockerError(error);

    if (fault.status === NOT_FOUND) {
      refuse(response, 404, RelayErrorCode.INSTANCE_NOT_FOUND, `This node holds no container for ${instanceKey}`);

      return;
    }

    this.logger.warn({ error, instanceKey }, 'stream(): A container log could not be read');

    const reason = fault.fault === DockerFault.UNREACHABLE ? fault.message : `Docker refused: ${fault.message}`;

    refuse(
      response,
      502,
      RelayErrorCode.INSTANCE_UNREACHABLE,
      `The log of instance ${instanceKey} could not be read: ${reason}`
    );
  }
}
