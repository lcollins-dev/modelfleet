import {
  BadGatewayException,
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Writable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { Observable, catchError, concat, finalize, of } from 'rxjs';

import { AgentRelay } from '@libs/agent-protocol';
import { EventPartyType, EventSeverity, EventType, InstanceOutputEndReason, InstanceOutputFrameDto } from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';
import { Instance } from '@/core/instance/entities/instance.entity';
import { Node } from '@/core/node/entities/node.entity';

import { ConfigService } from '@/config/config.service';
import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { IRelayLogsResponse, RelayClientService } from '@/core/agent/relay-client.service';
import { EventService } from '@/core/event/event.service';
import { InstanceService } from '@/core/instance/instance.service';

import { InstanceOutputReader } from './instance-output-reader';

const INSTANCE_MISSING_MESSAGE = 'This instance does not exist';
const NODE_NOT_CONNECTED_MESSAGE = "This instance's node is not connected, so its output cannot be read";
const NO_CONTAINER_MESSAGE =
  'The node holds no container for this instance. It may still be pulling its image, or it has been removed';
const RELAY_FAILED_MESSAGE = "The instance's node could not be asked for its output";

const LOGGED_BODY_CHARACTERS = 500;

export interface IOutputViewer {
  userId: number;

  /** Aborts once the viewer has gone, even while the stream is still opening. */
  signal: AbortSignal;

  response: Writable;
}

@Injectable()
export class InstanceOutputAdminService {
  private readonly logger = new Logger(InstanceOutputAdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly agentConnectionService: AgentConnectionService,
    private readonly eventService: EventService,
    private readonly instanceService: InstanceService,
    private readonly relayClientService: RelayClientService
  ) {}

  /**
   * Refuses before the stream opens, so a viewer reads why rather than a stream that closes at once. Records the read
   * once the node has answered, so every stream opened is recorded, a reconnect's included. The relay request lives
   * until the viewer's signal aborts it or the stream is unsubscribed. Ends with an `ended` frame however the node's
   * stream stops, so the viewer does not reconnect and record another read.
   */
  async watchOutput(
    deploymentId: number,
    instanceKey: string,
    viewer: IOutputViewer
  ): Promise<Observable<InstanceOutputFrameDto>> {
    const instance = await this.instanceService.findInDeployment(deploymentId, instanceKey);

    if (instance === null) {
      throw new NotFoundException(INSTANCE_MISSING_MESSAGE);
    }

    const { deployment, node } = this.partiesOf(instance);
    const relay = this.agentConnectionService.relayFor(instance.nodeId);

    if (relay === null) {
      throw new ConflictException(NODE_NOT_CONNECTED_MESSAGE);
    }

    const tailLines = this.configService.instanceOutputTailLines;

    const controller = new AbortController();
    const signal = AbortSignal.any([viewer.signal, controller.signal]);

    const response = await this.openLogs(relay, instanceKey, tailLines, signal);

    try {
      await this.recordRead(instanceKey, deployment, node, viewer.userId);
    } catch (error: unknown) {
      controller.abort();

      throw error;
    }

    const lines = new InstanceOutputReader().frames(response.stream, viewer.response).pipe(
      catchError((error: unknown) => {
        if (!signal.aborted) {
          this.logger.warn({ error, instanceKey }, "watchOutput(): The node's output stream broke off");
        }

        return of<InstanceOutputFrameDto>({ kind: 'ended', reason: InstanceOutputEndReason.LOST });
      })
    );

    return concat(
      of<InstanceOutputFrameDto>({ kind: 'opened', tailLines, complete: response.tailComplete }),
      lines
    ).pipe(finalize(() => controller.abort()));
  }

  private partiesOf(instance: Instance): { deployment: Deployment; node: Node } {
    const { deployment, node } = instance;

    if (deployment === undefined || node === undefined) {
      this.logger.error({ instanceKey: instance.instanceKey }, 'partiesOf(): An instance was read without its parties');

      throw new InternalServerErrorException();
    }

    return { deployment, node };
  }

  private async openLogs(
    relay: AgentRelay,
    instanceKey: string,
    tail: number,
    signal: AbortSignal
  ): Promise<IRelayLogsResponse> {
    let response: IRelayLogsResponse;

    try {
      response = await this.relayClientService.logs({ relay, instanceKey, tail, signal });
    } catch (error: unknown) {
      if (!signal.aborted) {
        this.logger.error({ error, instanceKey }, 'openLogs(): The node relay could not be reached');
      }

      throw new BadGatewayException(RELAY_FAILED_MESSAGE);
    }

    if (response.status === HttpStatus.OK) {
      return response;
    }

    if (response.status === HttpStatus.NOT_FOUND) {
      response.stream.resume();

      throw new NotFoundException(NO_CONTAINER_MESSAGE);
    }

    const body = await text(response.stream).catch(() => '');

    this.logger.error(
      { instanceKey, status: response.status, body: body.slice(0, LOGGED_BODY_CHARACTERS) },
      "openLogs(): The node relay refused to read the instance's output"
    );

    throw new BadGatewayException(RELAY_FAILED_MESSAGE);
  }

  private recordRead(instanceKey: string, deployment: Deployment, node: Node, actorId: number): Promise<void> {
    return this.eventService.recordEvent(EventType.INSTANCE_OUTPUT_READ, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DEPLOYMENT,
      subjectId: `${deployment.id}`,
      message: `Read the output of an instance of **${deployment.name}** on **${node.name}**`,
      detail: { name: deployment.name, instanceKey, nodeId: node.id, nodeName: node.name },
    });
  }
}
