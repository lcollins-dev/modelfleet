import { beforeEach, describe, expect, it } from 'vitest';

import { ActivationPolicy, ResidencyRule } from '@libs/dto';

import { ISupervisorFacts, SupervisorAction, SupervisorPolicyService } from './supervisor-policy.service';

const NOW = new Date('2026-09-20T12:00:00Z');

const IDLE_TIMEOUT_MS = 900_000;

const minutesBefore = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const minutesAfter = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

const facts = (overrides: Partial<ISupervisorFacts> = {}): ISupervisorFacts => ({
  activationPolicy: ActivationPolicy.ON_DEMAND,
  enabled: true,
  resident: 1,
  live: 1,
  starting: 0,
  inFlight: 0,
  waiting: 0,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  idleSince: minutesBefore(20),
  backoffUntil: null,
  givenUp: false,
  now: NOW,

  ...overrides,
});

describe('SupervisorPolicyService', () => {
  let supervisorPolicyService: SupervisorPolicyService;

  beforeEach(() => {
    supervisorPolicyService = new SupervisorPolicyService();
  });

  describe('decide', () => {
    it('keeps an always deployment resident', () => {
      const action = supervisorPolicyService.decide(facts({ activationPolicy: ActivationPolicy.ALWAYS, resident: 0 }));

      expect(action).toBe(SupervisorAction.START);
    });

    it('backs an always deployment off while its last start failed too recently', () => {
      const action = supervisorPolicyService.decide(
        facts({ activationPolicy: ActivationPolicy.ALWAYS, live: 0, backoffUntil: minutesAfter(1) })
      );

      expect(action).toBe(SupervisorAction.BACK_OFF);
    });

    it('starts an onDemand deployment a request waits on with nothing live', () => {
      expect(supervisorPolicyService.decide(facts({ waiting: 1, resident: 0, live: 0 }))).toBe(SupervisorAction.START);
    });

    it('replaces the failed instances of an onDemand deployment a request waits on', () => {
      expect(supervisorPolicyService.decide(facts({ waiting: 1, live: 0 }))).toBe(SupervisorAction.START);
    });

    it('backs off from starting an onDemand deployment whose last start failed too recently', () => {
      const action = supervisorPolicyService.decide(facts({ waiting: 1, live: 0, backoffUntil: minutesAfter(1) }));

      expect(action).toBe(SupervisorAction.BACK_OFF);
    });

    it('starts again once the backoff has passed', () => {
      const action = supervisorPolicyService.decide(facts({ waiting: 1, live: 0, backoffUntil: minutesBefore(1) }));

      expect(action).toBe(SupervisorAction.START);
    });

    it('starts nothing more for a request waiting on an instance already on its way', () => {
      expect(supervisorPolicyService.decide(facts({ waiting: 1, starting: 1 }))).toBe(SupervisorAction.NONE);
    });

    it('never starts an onDemand deployment nothing asks for', () => {
      expect(supervisorPolicyService.decide(facts({ resident: 0, live: 0, idleSince: null }))).toBe(
        SupervisorAction.NONE
      );
    });

    it('leaves a failed onDemand instance standing while nothing asks for it', () => {
      const action = supervisorPolicyService.decide(facts({ live: 0, idleSince: minutesBefore(1) }));

      expect(action).toBe(SupervisorAction.NONE);
    });

    it('stops what a disabled deployment is running, whatever its activation policy', () => {
      const action = supervisorPolicyService.decide(
        facts({ activationPolicy: ActivationPolicy.ALWAYS, enabled: false })
      );

      expect(action).toBe(SupervisorAction.STOP_DISABLED);
    });

    it('stops a disabled deployment even while it is serving, waited on or starting', () => {
      const action = supervisorPolicyService.decide(facts({ enabled: false, inFlight: 2, waiting: 1, starting: 1 }));

      expect(action).toBe(SupervisorAction.STOP_DISABLED);
    });

    it('takes no action on a disabled deployment that is running nothing', () => {
      const action = supervisorPolicyService.decide(facts({ enabled: false, resident: 0 }));

      expect(action).toBe(SupervisorAction.NONE);
    });

    it('stops an onDemand deployment idle past its timeout', () => {
      expect(supervisorPolicyService.decide(facts())).toBe(SupervisorAction.STOP_IDLE);
    });

    it('leaves an onDemand deployment alone until its timeout has elapsed', () => {
      expect(supervisorPolicyService.decide(facts({ idleSince: minutesBefore(10) }))).toBe(SupervisorAction.NONE);
    });

    it('stops an onDemand deployment the moment its timeout is reached', () => {
      expect(supervisorPolicyService.decide(facts({ idleSince: minutesBefore(15) }))).toBe(SupervisorAction.STOP_IDLE);
    });

    it('gives an always deployment up once its run has reached the limit, rather than backing off', () => {
      const action = supervisorPolicyService.decide(
        facts({ activationPolicy: ActivationPolicy.ALWAYS, live: 0, backoffUntil: minutesAfter(10), givenUp: true })
      );

      expect(action).toBe(SupervisorAction.GIVEN_UP);
    });

    it('gives up on an onDemand deployment a request waits on, even once its backoff has passed', () => {
      const action = supervisorPolicyService.decide(
        facts({ waiting: 1, live: 0, backoffUntil: minutesBefore(1), givenUp: true })
      );

      expect(action).toBe(SupervisorAction.GIVEN_UP);
    });

    it('stops a disabled deployment whatever its run of failures reached', () => {
      expect(supervisorPolicyService.decide(facts({ enabled: false, givenUp: true }))).toBe(
        SupervisorAction.STOP_DISABLED
      );
    });

    it('still stops an idle onDemand deployment given up on, as one with a replica left serving', () => {
      expect(supervisorPolicyService.decide(facts({ givenUp: true }))).toBe(SupervisorAction.STOP_IDLE);
    });

    it.each([
      ['a request is in flight', { inFlight: 1 }],
      ['a request is waiting', { waiting: 1 }],
      ['an instance is still starting, however long its launch takes', { starting: 1, idleSince: minutesBefore(90) }],
    ])('holds an idle stop off while %s', (_reason, overrides) => {
      expect(supervisorPolicyService.decide(facts(overrides))).toBe(SupervisorAction.NONE);
    });
  });

  describe('backoffUntil', () => {
    it('lets a start go 30s after one failure, doubling with each in a row, to ten minutes', () => {
      expect(supervisorPolicyService.backoffUntil(1, NOW)).toEqual(new Date(NOW.getTime() + 30_000));
      expect(supervisorPolicyService.backoffUntil(2, NOW)).toEqual(new Date(NOW.getTime() + 60_000));
      expect(supervisorPolicyService.backoffUntil(9, NOW)).toEqual(new Date(NOW.getTime() + 600_000));
    });

    it('holds nothing back where the last start did not fail', () => {
      expect(supervisorPolicyService.backoffUntil(0, null)).toBeNull();
    });
  });

  describe('givenUp', () => {
    it('gives up once the run reaches the limit, and stays given up past it', () => {
      expect(supervisorPolicyService.givenUp(9, 10)).toBe(false);
      expect(supervisorPolicyService.givenUp(10, 10)).toBe(true);
      expect(supervisorPolicyService.givenUp(11, 10)).toBe(true);
    });
  });

  describe('givesUpAt', () => {
    it('names only the failed start that reaches the limit', () => {
      expect(supervisorPolicyService.givesUpAt(9, 10)).toBe(false);
      expect(supervisorPolicyService.givesUpAt(10, 10)).toBe(true);
      expect(supervisorPolicyService.givesUpAt(11, 10)).toBe(false);
    });
  });

  describe('idleSince', () => {
    it('counts idleness from the last request where one has arrived', () => {
      expect(supervisorPolicyService.idleSince(minutesBefore(5), minutesBefore(60))).toEqual(minutesBefore(5));
    });

    it('counts idleness from the newest instance where no request has arrived, so a hand start gets its timeout', () => {
      expect(supervisorPolicyService.idleSince(null, minutesBefore(2))).toEqual(minutesBefore(2));
    });

    it('counts idleness from the newest instance where it is later than the last request', () => {
      expect(supervisorPolicyService.idleSince(minutesBefore(90), minutesBefore(1))).toEqual(minutesBefore(1));
    });

    it('has nothing to count idleness from where the deployment has never run or been called', () => {
      expect(supervisorPolicyService.idleSince(null, null)).toBeNull();
    });
  });

  describe('idleTimeoutMsFor', () => {
    it('reads the idle timeout the document names', () => {
      expect(supervisorPolicyService.idleTimeoutMsFor({ idleTimeout: '30m' }, IDLE_TIMEOUT_MS)).toBe(1_800_000);
    });

    it('falls back to the configured timeout where the document names none', () => {
      expect(supervisorPolicyService.idleTimeoutMsFor({}, IDLE_TIMEOUT_MS)).toBe(IDLE_TIMEOUT_MS);
    });

    it('falls back to the configured timeout where the document names a value it cannot read', () => {
      expect(supervisorPolicyService.idleTimeoutMsFor({ idleTimeout: 'soon' }, IDLE_TIMEOUT_MS)).toBe(IDLE_TIMEOUT_MS);
    });
  });

  describe('ruleFor', () => {
    it('names the rule an always deployment is held by', () => {
      expect(supervisorPolicyService.ruleFor(ActivationPolicy.ALWAYS, true)).toBe(ResidencyRule.ALWAYS);
    });

    it('names the idle timeout as what an onDemand deployment is held by', () => {
      expect(supervisorPolicyService.ruleFor(ActivationPolicy.ON_DEMAND, true)).toBe(ResidencyRule.IDLE_TIMEOUT);
    });

    it('names being disabled ahead of the activation policy', () => {
      expect(supervisorPolicyService.ruleFor(ActivationPolicy.ALWAYS, false)).toBe(ResidencyRule.DISABLED);
    });
  });
});
