import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

import { RELAY_REFUSAL_HEADER } from '@libs/agent-protocol';

/** Headers that belong to one hop and never travel to the next (RFC 9110 7.6.1). Node reframes the body itself. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** What the relay authenticates with. Sending it on would hand the backend a credential it has no use for. */
const RELAY_ONLY = new Set(['authorization', 'host']);

/** Marks the relay's own refusals, so a backend's answer never carries it. */
const RELAY_REFUSAL_ONLY = new Set([RELAY_REFUSAL_HEADER]);

function namedByConnection(headers: IncomingHttpHeaders): Set<string> {
  return new Set(
    (headers.connection ?? '')
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(entry => entry.length > 0)
  );
}

function without(headers: IncomingHttpHeaders, dropped: ReadonlySet<string>): OutgoingHttpHeaders {
  const listed = namedByConnection(headers);
  const kept: OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase();

    if (value === undefined || dropped.has(lowered) || HOP_BY_HOP.has(lowered) || listed.has(lowered)) {
      continue;
    }

    kept[name] = value;
  }

  return kept;
}

/** Adds the authority the backend is asked for, since the caller's own `Host` names this relay. */
export function forwardableHeaders(headers: IncomingHttpHeaders, authority: string): OutgoingHttpHeaders {
  return { ...without(headers, RELAY_ONLY), host: authority };
}

export function returnableHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  return without(headers, RELAY_REFUSAL_ONLY);
}
