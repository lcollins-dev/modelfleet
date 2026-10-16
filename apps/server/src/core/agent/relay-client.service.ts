import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Agent, IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { text } from 'node:stream/consumers';

import {
  AgentRelay,
  asksForStream,
  RELAY_REFUSAL_HEADER,
  RELAY_TAIL_COMPLETE_HEADER,
  RelayErrorCode,
  RelayError,
  relayLogsPath,
  relayPath,
} from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';

const HTTPS_PROTOCOL = 'https:';

const PLAIN_TEXT_TYPE = 'text/plain';

const HEADERS_TIMEOUT_MESSAGE = 'The node relay did not return response headers before the request timed out';

export class RelayUnreachableError extends Error {
  constructor(readonly cause: NodeJS.ErrnoException) {
    super(cause.code ?? cause.message);
    this.name = 'RelayUnreachableError';
  }
}

export interface IRelayTarget {
  relay: AgentRelay;
  instanceKey: string;

  /** The backend path, leading slash included, that `/instances/<key>` is prefixed to. */
  path: string;

  accept: string;
  signal: AbortSignal;
}

interface IRelayBody {
  body: Buffer;
  contentType: string;
}

export interface IRelayCall extends IRelayTarget, IRelayBody {}

export interface IRelayAnswer {
  refusal: null;

  status: number;
  headers: IncomingHttpHeaders;
  stream: IncomingMessage;
}

export interface IRelayRefusal {
  refusal: IRelayRefusalDetail;

  status: number;
}

export interface IRelayRefusalDetail {
  /** Null where the relay named a code this server does not know. */
  code: RelayErrorCode | null;

  message: string;
}

export type RelayResponse = IRelayAnswer | IRelayRefusal;

interface IRawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  stream: IncomingMessage;
}

export interface IRelayLogsRequest {
  relay: AgentRelay;
  instanceKey: string;

  tail: number;

  signal: AbortSignal;
}

export interface IRelayLogsResponse {
  status: number;

  /** The tail reaches back to the container's start. */
  tailComplete: boolean;

  stream: IncomingMessage;
}

interface IRelayRequest {
  relay: AgentRelay;

  path: string;

  method: string;
  accept: string;
  signal: AbortSignal;

  headersDeadline: boolean;

  payload: IRelayBody | null;
}

@Injectable()
export class RelayClientService implements OnApplicationShutdown {
  /**
   * Reused across requests, so a relayed call costs no TCP handshake. Nagle is off, since a request
   * on an idle connection must leave immediately rather than wait for company.
   */
  private readonly httpAgent = new Agent({ keepAlive: true, noDelay: true });
  private readonly httpsAgent = new HttpsAgent({ keepAlive: true, noDelay: true });

  constructor(private readonly configService: ConfigService) {}

  onApplicationShutdown(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  async send(call: IRelayCall): Promise<RelayResponse> {
    return this.classify(
      await this.request(this.backendRequest('POST', call, { body: call.body, contentType: call.contentType }))
    );
  }

  async get(target: IRelayTarget): Promise<RelayResponse> {
    return this.classify(await this.request(this.backendRequest('GET', target, null)));
  }

  /** The body runs until the container's output ends, so only the viewer's signal closes it before then. */
  async logs(logsRequest: IRelayLogsRequest): Promise<IRelayLogsResponse> {
    const response = await this.request({
      relay: logsRequest.relay,
      path: relayLogsPath(logsRequest.instanceKey, logsRequest.tail),
      method: 'GET',
      accept: PLAIN_TEXT_TYPE,
      signal: logsRequest.signal,
      headersDeadline: true,
      payload: null,
    });

    return {
      status: response.status,
      tailComplete: response.headers[RELAY_TAIL_COMPLETE_HEADER] === 'true',
      stream: response.stream,
    };
  }

  private backendRequest(method: string, target: IRelayTarget, payload: IRelayBody | null): IRelayRequest {
    return {
      relay: target.relay,
      path: relayPath(target.instanceKey, target.path),
      method,
      accept: target.accept,
      signal: target.signal,

      // Only a stream's head is due at once. A whole answer's head waits on the work, however long it takes.
      headersDeadline: asksForStream(target.accept),

      payload,
    };
  }

  /** A refusal's body is the relay's own short JSON, so it is read here rather than handed on as a stream. */
  private async classify(response: IRawResponse): Promise<RelayResponse> {
    if (response.headers[RELAY_REFUSAL_HEADER] === undefined) {
      return { refusal: null, ...response };
    }

    // A read the caller's abort cuts short rejects, so the abort reaches the caller rather than reading as a refusal.
    const body = await text(response.stream);
    const code = RelayError.shape.error.shape.code.safeParse(response.headers[RELAY_REFUSAL_HEADER]);
    const parsed = RelayError.shape.error.pick({ message: true }).safeParse(this.errorOf(body));

    return {
      refusal: {
        code: code.success ? code.data : null,
        message: parsed.success ? parsed.data.message : body,
      },
      status: response.status,
    };
  }

  /** The `error` member of a JSON body, or null where the body is not one. */
  private errorOf(body: string): unknown {
    try {
      const parsed: unknown = JSON.parse(body);

      return typeof parsed === 'object' && parsed !== null && 'error' in parsed ? parsed.error : null;
    } catch {
      return null;
    }
  }

  private request(relayRequest: IRelayRequest): Promise<IRawResponse> {
    const url = new URL(`${relayRequest.relay.url.replace(/\/+$/, '')}${relayRequest.path}`);
    const secure = url.protocol === HTTPS_PROTOCOL;
    const send = secure ? httpsRequest : httpRequest;

    return new Promise<IRawResponse>((resolve, reject) => {
      const request = send(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: relayRequest.method,
          headers: this.headersFor(relayRequest),
          agent: secure ? this.httpsAgent : this.httpAgent,
          signal: relayRequest.signal,
        },
        response => {
          clearTimeout(deadline);

          resolve({ status: response.statusCode ?? 502, headers: response.headers, stream: response });
        }
      );

      const deadline = relayRequest.headersDeadline
        ? setTimeout(() => {
            request.destroy(new Error(HEADERS_TIMEOUT_MESSAGE));
          }, this.configService.gatewayUpstreamHeadersTimeoutMs)
        : undefined;

      request.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(deadline);
        reject(new RelayUnreachableError(error));
      });

      request.end(relayRequest.payload?.body);
    });
  }

  private headersFor(relayRequest: IRelayRequest): OutgoingHttpHeaders {
    const headers: OutgoingHttpHeaders = {
      authorization: `Bearer ${relayRequest.relay.token}`,
      accept: relayRequest.accept,
    };

    if (relayRequest.payload !== null) {
      headers['content-type'] = relayRequest.payload.contentType;
      headers['content-length'] = relayRequest.payload.body.length;
    }

    return headers;
  }
}
