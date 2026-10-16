import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { AgentObservedState, DesiredInstance, ObservedInstance, ServerDesiredState } from '@libs/agent-protocol';

export interface INodeObservedState {
  desiredGeneration: number | null;
  instances: ObservedInstance[];
  reportedDate: Date;
}

const EMPTY_DESIRED_STATE: ServerDesiredState = { instances: [], generation: 0 };

@Injectable()
export class NodeStateService {
  private readonly logger = new Logger(NodeStateService.name);

  private readonly desired = new Map<number, ServerDesiredState>();
  private readonly observed = new Map<number, INodeObservedState>();

  private readonly desiredChanged = new Subject<number>();
  private readonly observedReported = new Subject<number>();

  getDesiredStateChanges(): Observable<number> {
    return this.desiredChanged.asObservable();
  }

  getObservedReports(): Observable<number> {
    return this.observedReported.asObservable();
  }

  /** Every node the server has published a set to, so all of them can be republished at once. */
  getPublishedNodeIds(): number[] {
    return [...this.desired.keys()];
  }

  getDesiredState(nodeId: number): ServerDesiredState {
    return this.desired.get(nodeId) ?? EMPTY_DESIRED_STATE;
  }

  /** Raises the node's generation and publishes it to `getDesiredStateChanges`. */
  setDesiredInstances(nodeId: number, instances: DesiredInstance[]): ServerDesiredState {
    const next: ServerDesiredState = {
      instances,
      generation: this.getDesiredState(nodeId).generation + 1,
    };

    this.desired.set(nodeId, next);
    this.desiredChanged.next(nodeId);

    return next;
  }

  replaceObserved(nodeId: number, report: AgentObservedState): void {
    this.observed.set(nodeId, {
      desiredGeneration: report.desiredGeneration,
      instances: report.instances,
      reportedDate: new Date(),
    });

    this.logger.debug(
      { nodeId, instances: report.instances.length, desiredGeneration: report.desiredGeneration },
      'replaceObserved(): A node reported what it holds'
    );

    this.observedReported.next(nodeId);
  }

  /** Null means the set this node holds is unknown. */
  getObserved(nodeId: number): INodeObservedState | null {
    return this.observed.get(nodeId) ?? null;
  }

  clearObserved(nodeId: number): void {
    this.observed.delete(nodeId);
  }

  forget(nodeId: number): void {
    this.desired.delete(nodeId);
    this.observed.delete(nodeId);
  }
}
