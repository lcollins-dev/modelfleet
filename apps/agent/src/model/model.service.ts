import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { AgentModelInventory } from '@libs/agent-protocol';

import { ConfigService } from '../config/config.service';
import { ModelScannerService } from './scan/model-scanner.service';

@Injectable()
export class ModelService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelService.name);

  private readonly inventories = new Subject<AgentModelInventory>();

  private directories: readonly string[] = [];
  private inventory: AgentModelInventory | null = null;

  private scanning = false;
  private rescanWanted = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelScannerService: ModelScannerService
  ) {}

  /** Every subscriber is listening by this hook, so none misses the first sweep. */
  onApplicationBootstrap(): void {
    this.directories = this.normalise(this.configService.modelDirs);

    this.requestScan();
  }

  changes(): Observable<AgentModelInventory> {
    return this.inventories.asObservable();
  }

  currentInventory(): AgentModelInventory | null {
    return this.inventory;
  }

  /** A sweep already running is followed by one more, so a request never reads a half-done one. */
  requestScan(): void {
    if (this.scanning) {
      this.rescanWanted = true;

      return;
    }

    this.sweep().catch((error: unknown) => {
      this.logger.error({ error }, 'requestScan(): Scanning this node for models failed');
    });
  }

  private async sweep(): Promise<void> {
    this.scanning = true;

    try {
      do {
        const inventory = await this.modelScannerService.scan(this.directories);

        this.logger.log(
          {
            directories: inventory.directories.length,
            models: inventory.models.length,
            errors: inventory.errors.length,
          },
          'sweep(): Reported what this node holds'
        );

        this.inventory = inventory;
        this.inventories.next(inventory);
      } while (this.takeRescanRequest());
    } finally {
      this.scanning = false;
    }
  }

  private normalise(directories: readonly string[]): readonly string[] {
    return [...new Set(directories)].sort();
  }

  private takeRescanRequest(): boolean {
    const wanted = this.rescanWanted;

    this.rescanWanted = false;

    return wanted;
  }
}
