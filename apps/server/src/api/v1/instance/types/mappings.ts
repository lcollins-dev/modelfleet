import { InstanceState as ProtocolInstanceState } from '@libs/agent-protocol';
import { InstanceState } from '@libs/dto';

export const INSTANCE_STATES: Record<ProtocolInstanceState, InstanceState> = {
  [ProtocolInstanceState.STARTING]: InstanceState.STARTING,
  [ProtocolInstanceState.READY]: InstanceState.READY,
  [ProtocolInstanceState.FAILED]: InstanceState.FAILED,
};
