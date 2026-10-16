import { ServerResponse } from 'node:http';

import { RELAY_REFUSAL_HEADER, relayError, RelayErrorCode } from '@libs/agent-protocol';

/** Does nothing once a response has begun. */
export function refuse(response: ServerResponse, status: number, code: RelayErrorCode, message: string): void {
  if (response.writableEnded || response.headersSent || response.destroyed) {
    return;
  }

  const body = JSON.stringify(relayError(code, message));

  response.setHeader('content-type', 'application/json');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.setHeader(RELAY_REFUSAL_HEADER, code);
  response.writeHead(status);
  response.end(body);
}
