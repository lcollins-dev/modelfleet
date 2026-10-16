/** The only path the server upgrades. */
export const AGENT_SOCKET_PATH = '/agent';

/** The 4000-4999 range WebSocket leaves to the application. */
export enum AgentCloseCode {
  REJECTED = 4001,
  HEARTBEAT_TIMEOUT = 4002,
  SUPERSEDED = 4003,
  SHUTDOWN = 4004,
}

/** The text sent alongside a close code. A rejection sends its `RejectReason` here instead. */
export enum AgentCloseReason {
  HANDSHAKE_TIMEOUT = 'handshake-timeout',
  HEARTBEAT_TIMEOUT = 'heartbeat-timeout',
  SUPERSEDED = 'superseded',
  SHUTDOWN = 'shutdown',
}
