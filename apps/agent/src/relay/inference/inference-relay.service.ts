import { Injectable, Logger } from '@nestjs/common';
import { Agent, IncomingMessage, request as httpRequest, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';

import { asksForStream, InstanceState, IRelayRoute, RelayErrorCode } from '@libs/agent-protocol';

import { ConfigService } from '../../config/config.service';
import { IInstanceAddress, InstanceEndpointService } from '../../instance/instance-endpoint.service';
import { refuse } from '../relay-error';
import { forwardableHeaders, returnableHeaders } from './relay-headers';

const HEADERS_TIMEOUT_MESSAGE = 'The backend sent no response line in time';

@Injectable()
export class InferenceRelayService {
  private readonly logger = new Logger(InferenceRelayService.name);

  /**
   * Reused across requests, so a relayed call costs no TCP handshake to the container. Nagle is off, since a
   * streamed token is a small write that must leave immediately rather than wait for company.
   */
  private readonly upstream = new Agent({ keepAlive: true, noDelay: true });

  constructor(
    private readonly configService: ConfigService,
    private readonly instanceEndpointService: InstanceEndpointService
  ) {}

  serve(request: IncomingMessage, response: ServerResponse, route: IRelayRoute): void {
    const reach = this.instanceEndpointService.resolve(route.instanceKey);

    if (reach === null) {
      refuse(response, 404, RelayErrorCode.INSTANCE_NOT_FOUND, `This node holds no instance ${route.instanceKey}`);

      return;
    }

    if (reach.instanceState !== InstanceState.READY || reach.address === null) {
      refuse(
        response,
        503,
        RelayErrorCode.INSTANCE_NOT_READY,
        `Instance ${route.instanceKey} is ${reach.instanceState} rather than ready`
      );

      return;
    }

    this.forward(request, response, route, reach.address);
  }

  closeUpstream(): void {
    this.upstream.destroy();
  }

  private forward(
    request: IncomingMessage,
    response: ServerResponse,
    route: IRelayRoute,
    address: IInstanceAddress
  ): void {
    const authority = `${address.host}:${address.port}`;
    const upstreamRequest = httpRequest({
      host: address.host,
      port: address.port,
      method: request.method,
      path: route.path,
      headers: forwardableHeaders(request.headers, authority),
      agent: this.upstream,
    });

    let cancelled = false;

    // Only a stream's head is due at once. A whole answer's head waits on the work, however long it takes.
    const deadline = asksForStream(request.headers.accept ?? '')
      ? setTimeout(() => {
          upstreamRequest.destroy(new Error(HEADERS_TIMEOUT_MESSAGE));
        }, this.configService.relayHeadersTimeoutMs)
      : undefined;

    // A caller that goes away takes the generation with it, so an abandoned request stops consuming the instance.
    response.on('close', () => {
      clearTimeout(deadline);

      if (!response.writableEnded) {
        cancelled = true;
        upstreamRequest.destroy();
      }
    });

    upstreamRequest.on('response', upstreamResponse => {
      clearTimeout(deadline);

      response.writeHead(upstreamResponse.statusCode ?? 502, returnableHeaders(upstreamResponse.headers));

      // Puts the head on the wire before the first chunk, which is what a streamed response is measured from.
      response.flushHeaders();

      pipeline(upstreamResponse, response, (error: unknown) => {
        if (error !== undefined && error !== null && !cancelled) {
          this.logger.warn({ error, instanceKey: route.instanceKey }, 'forward(): A relayed response ended early');
        }
      });
    });

    upstreamRequest.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(deadline);

      if (cancelled || response.headersSent || response.writableEnded || response.destroyed) {
        response.destroy();

        return;
      }

      this.logger.warn({ error, instanceKey: route.instanceKey }, 'forward(): A backend could not be reached');

      refuse(
        response,
        502,
        RelayErrorCode.INSTANCE_UNREACHABLE,
        `Instance ${route.instanceKey} could not be reached at ${authority}: ${error.code ?? error.message}`
      );
    });

    // A body that stops arriving destroys the upstream request, which the error handler above answers for.
    pipeline(request, upstreamRequest, () => {});
  }
}
