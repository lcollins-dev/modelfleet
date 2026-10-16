import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { ServerMessageType } from '@libs/agent-protocol';

import { NodeStateService } from '../node/node-state.service';
import { AgentConnectionService } from './agent-connection.service';

@Injectable()
export class DesiredStatePublisher implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription | null = null;

  constructor(
    private readonly nodeStateService: NodeStateService,
    private readonly agentConnectionService: AgentConnectionService
  ) {}

  onModuleInit(): void {
    this.subscription = this.nodeStateService.getDesiredStateChanges().subscribe(nodeId => {
      this.agentConnectionService.send(
        nodeId,
        ServerMessageType.DESIRED_STATE,
        this.nodeStateService.getDesiredState(nodeId)
      );
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
