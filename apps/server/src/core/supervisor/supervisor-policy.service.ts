import { Injectable } from '@nestjs/common';
import ms from 'ms';

import { ActivationPolicy, ConfigurationDocument, ResidencyRule } from '@libs/dto';
import { durationValue } from '@libs/runtime';

const IDLE_TIMEOUT_KEY = 'idleTimeout';

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 600_000;

export enum SupervisorAction {
  NONE = 'none',

  /** Replace what has failed, and bring the deployment up to the replicas its placement declares. */
  START = 'start',

  /** The deployment is wanted, but its last start failed too recently to try another. */
  BACK_OFF = 'back-off',

  /** The deployment is wanted, but its starts have failed too often in a row to try another until one by hand. */
  GIVEN_UP = 'given-up',

  /** Drain what the deployment holds and drop it, abandoning the stop if a request arrives. */
  STOP_IDLE = 'stop-idle',

  /** Drain what the deployment holds and drop it, holding the drain until the last request finishes. */
  STOP_DISABLED = 'stop-disabled',
}

export interface ISupervisorFacts {
  activationPolicy: ActivationPolicy;
  enabled: boolean;
  resident: number;

  /** Instances starting or ready, as opposed to failed. */
  live: number;

  starting: number;
  inFlight: number;

  waiting: number;

  idleTimeoutMs: number;
  idleSince: Date | null;
  backoffUntil: Date | null;
  givenUp: boolean;
  now: Date;
}

/** Reads no rows and writes none: every answer follows from what it is handed. */
@Injectable()
export class SupervisorPolicyService {
  /**
   * An `always` deployment is kept up, and an `onDemand` one is started while a request waits on it with nothing live.
   * A waiting request, a request in flight or an instance still starting holds an idle stop off, however long a launch
   * takes.
   */
  decide(facts: ISupervisorFacts): SupervisorAction {
    if (!facts.enabled) {
      return facts.resident === 0 ? SupervisorAction.NONE : SupervisorAction.STOP_DISABLED;
    }

    const always = facts.activationPolicy === ActivationPolicy.ALWAYS;

    if (always || (facts.waiting > 0 && facts.live === 0)) {
      return this.startOrHold(facts);
    }

    if (facts.resident === 0 || facts.waiting > 0 || facts.inFlight > 0 || facts.starting > 0) {
      return SupervisorAction.NONE;
    }

    return facts.idleSince !== null && this.idleFor(facts.idleSince, facts.now) >= facts.idleTimeoutMs
      ? SupervisorAction.STOP_IDLE
      : SupervisorAction.NONE;
  }

  private startOrHold(facts: ISupervisorFacts): SupervisorAction {
    if (facts.givenUp) {
      return SupervisorAction.GIVEN_UP;
    }

    return this.backingOff(facts) ? SupervisorAction.BACK_OFF : SupervisorAction.START;
  }

  ruleFor(activationPolicy: ActivationPolicy, enabled: boolean): ResidencyRule {
    if (!enabled) {
      return ResidencyRule.DISABLED;
    }

    return activationPolicy === ActivationPolicy.ON_DEMAND ? ResidencyRule.IDLE_TIMEOUT : ResidencyRule.ALWAYS;
  }

  /**
   * A deployment idles from its last request, or from when its newest instance became ready where that is later, so
   * one started by hand gets its whole timeout, and one whose launch outlasted the timeout is not taken the moment it
   * is ready. An instance never ready counts from its creation.
   */
  idleSince(lastUsedDate: Date | null, newestInstanceDate: Date | null): Date | null {
    if (lastUsedDate === null || newestInstanceDate === null) {
      return lastUsedDate ?? newestInstanceDate;
    }

    return lastUsedDate.getTime() > newestInstanceDate.getTime() ? lastUsedDate : newestInstanceDate;
  }

  idleFor(idleSince: Date, now: Date): number {
    return Math.max(now.getTime() - idleSince.getTime(), 0);
  }

  /** Falls back to the configured default where the document names no duration this can read. */
  idleTimeoutMsFor(configuration: ConfigurationDocument, fallbackMs: number): number {
    const declared = durationValue().safeParse(configuration[IDLE_TIMEOUT_KEY]);
    const timeout = declared.success ? ms(declared.data) : Number.NaN;

    return Number.isFinite(timeout) && timeout > 0 ? timeout : fallbackMs;
  }

  /**
   * When a run of failed starts lets the next one go: 30s after the last failure, doubling with each failed start in a
   * row to 10m. Null where the last start did not fail.
   */
  backoffUntil(launchFailures: number, lastLaunchFailureDate: Date | null): Date | null {
    if (launchFailures === 0 || lastLaunchFailureDate === null) {
      return null;
    }

    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (launchFailures - 1), BACKOFF_MAX_MS);

    return new Date(lastLaunchFailureDate.getTime() + delay);
  }

  /** A deployment given up on stays so until a start by hand, an edit or an instance ready clears its run. */
  givenUp(launchFailures: number, limit: number): boolean {
    return launchFailures >= limit;
  }

  /** Pass only a count a failed start has just reached, so it holds for one start in a run. */
  givesUpAt(launchFailures: number, limit: number): boolean {
    return launchFailures === limit;
  }

  backingOff(facts: ISupervisorFacts): boolean {
    return facts.backoffUntil !== null && facts.backoffUntil.getTime() > facts.now.getTime();
  }
}
