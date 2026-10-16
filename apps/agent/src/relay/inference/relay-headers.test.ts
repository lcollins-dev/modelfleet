import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';

import { RELAY_REFUSAL_HEADER } from '@libs/agent-protocol';

import { forwardableHeaders, returnableHeaders } from '@/relay/inference/relay-headers';

const AUTHORITY = '198.51.100.4:8000';

const headers = (...entries: [string, string][]): IncomingHttpHeaders & OutgoingHttpHeaders =>
  Object.fromEntries(entries);

describe('forwardableHeaders', () => {
  it('keeps what the backend needs and rewrites the authority to the container', () => {
    const sent = headers(['host', 'agent:3040'], ['content-type', 'application/json'], ['accept', 'text/event-stream']);

    expect(forwardableHeaders(sent, AUTHORITY)).toEqual(
      headers(['content-type', 'application/json'], ['accept', 'text/event-stream'], ['host', AUTHORITY])
    );
  });

  it('withholds the relay credential, which the backend has no use for', () => {
    const sent = headers(['authorization', 'Bearer relay-token'], ['accept', '*/*']);

    expect(forwardableHeaders(sent, AUTHORITY)).toEqual(headers(['accept', '*/*'], ['host', AUTHORITY]));
  });

  it('drops the headers that belong to this hop alone', () => {
    const sent = headers(
      ['connection', 'keep-alive'],
      ['keep-alive', 'timeout=5'],
      ['transfer-encoding', 'chunked'],
      ['upgrade', 'h2c'],
      ['te', 'trailers'],
      ['proxy-authorization', 'Basic anything'],
      ['accept', '*/*']
    );

    expect(forwardableHeaders(sent, AUTHORITY)).toEqual(headers(['accept', '*/*'], ['host', AUTHORITY]));
  });

  it('drops whatever the connection header names, since that is what makes a header hop-by-hop', () => {
    const sent = headers(['connection', 'x-secret, Close'], ['x-secret', 'held'], ['accept', '*/*']);

    expect(forwardableHeaders(sent, AUTHORITY)).toEqual(headers(['accept', '*/*'], ['host', AUTHORITY]));
  });
});

describe('returnableHeaders', () => {
  it('carries the backend answer back, framing aside', () => {
    const answered = headers(
      ['content-type', 'text/event-stream'],
      ['cache-control', 'no-cache'],
      ['transfer-encoding', 'chunked'],
      ['connection', 'keep-alive']
    );

    expect(returnableHeaders(answered)).toEqual(
      headers(['content-type', 'text/event-stream'], ['cache-control', 'no-cache'])
    );
  });

  it('leaves the backend its own authorization-shaped headers', () => {
    const answered = headers(['www-authenticate', 'Bearer']);

    expect(returnableHeaders(answered)).toEqual(answered);
  });

  it('drops a refusal mark the backend sent, which only the relay may set', () => {
    expect(
      returnableHeaders(headers(['content-type', 'application/json'], [RELAY_REFUSAL_HEADER, 'not_found']))
    ).toEqual(headers(['content-type', 'application/json']));
  });
});
