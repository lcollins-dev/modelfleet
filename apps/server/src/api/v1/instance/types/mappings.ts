import { InstanceState as ProtocolInstanceState } from '@libs/agent-protocol';
import { InstanceState, PlacementProblemReason } from '@libs/dto';

import { FitRefusal } from '@/core/ledger/vram-ledger.service';

export const INSTANCE_STATES: Record<ProtocolInstanceState, InstanceState> = {
  [ProtocolInstanceState.STARTING]: InstanceState.STARTING,
  [ProtocolInstanceState.READY]: InstanceState.READY,
  [ProtocolInstanceState.FAILED]: InstanceState.FAILED,
};

export const FIT_REFUSAL_REASONS: Record<FitRefusal, PlacementProblemReason> = {
  [FitRefusal.NO_TELEMETRY]: PlacementProblemReason.NO_READINGS,
  [FitRefusal.UNMEASURED_CARD]: PlacementProblemReason.GPU_NOT_MEASURED,
  [FitRefusal.TOO_LARGE]: PlacementProblemReason.NOT_ENOUGH_VRAM,
  [FitRefusal.HOST_MEMORY]: PlacementProblemReason.NOT_ENOUGH_RAM,
  [FitRefusal.CARD_TOO_SMALL]: PlacementProblemReason.NOT_ENOUGH_VRAM,
  [FitRefusal.CARD_OUTGROWN]: PlacementProblemReason.NOT_ENOUGH_VRAM,
  [FitRefusal.LOAD_IN_PROGRESS]: PlacementProblemReason.OTHER,
};
