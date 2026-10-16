export enum AgentMessageType {
  HELLO = 'agent.hello',
  HEARTBEAT = 'agent.heartbeat',
  OBSERVED_STATE = 'agent.observed-state',
  GPU_INVENTORY = 'agent.gpu-inventory',
  TELEMETRY = 'agent.telemetry',
  MODEL_INVENTORY = 'agent.model-inventory',
  DOWNLOAD_PROGRESS = 'agent.download-progress',
}

export enum ServerMessageType {
  WELCOME = 'server.welcome',
  REJECT = 'server.reject',
  DESIRED_STATE = 'server.desired-state',
  SCAN_MODELS = 'server.scan-models',
  DESIRED_DOWNLOADS = 'server.desired-downloads',
}
