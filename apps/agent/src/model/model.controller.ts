import { Controller } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';

import { ServerMessageType } from '@libs/agent-protocol';

import { ModelService } from './model.service';

@Controller()
export class ModelController {
  constructor(private readonly modelService: ModelService) {}

  @EventPattern(ServerMessageType.SCAN_MODELS)
  handleScanModels(): void {
    this.modelService.requestScan();
  }
}
