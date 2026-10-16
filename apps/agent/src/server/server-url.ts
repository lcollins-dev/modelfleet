import { AGENT_SOCKET_PATH } from '@libs/agent-protocol';

const WEB_SOCKET_SCHEMES = new Map<string, string>([
  ['http:', 'ws:'],
  ['https:', 'wss:'],
  ['ws:', 'ws:'],
  ['wss:', 'wss:'],
]);

export function isDialable(serverUrl: string): boolean {
  try {
    return WEB_SOCKET_SCHEMES.has(new URL(serverUrl).protocol);
  } catch {
    return false;
  }
}

/** The caller holds `isDialable`, which the config schema enforces. */
export function getServerSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);

  url.protocol = WEB_SOCKET_SCHEMES.get(url.protocol) ?? url.protocol;
  url.pathname = AGENT_SOCKET_PATH;
  url.search = '';
  url.hash = '';

  return url.toString();
}
