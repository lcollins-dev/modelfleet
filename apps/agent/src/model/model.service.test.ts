import { firstValueFrom } from 'rxjs';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModelInventory } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { ModelService } from '@/model/model.service';
import { ModelScannerService } from '@/model/scan/model-scanner.service';

function inventoryOf(directories: readonly string[]): AgentModelInventory {
  return {
    scannedAt: '2026-08-20T12:00:00.000Z',
    directories: [...directories],
    models: [],
    errors: [],
  };
}

describe('ModelService', () => {
  let scan: Mock<ModelScannerService['scan']>;

  beforeEach(() => {
    scan = vi.fn(directories => Promise.resolve(inventoryOf(directories)));
  });

  function serviceFor(...modelDirs: string[]): ModelService {
    return new ModelService({ modelDirs } as unknown as ConfigService, { scan } as unknown as ModelScannerService);
  }

  async function started(...modelDirs: string[]): Promise<ModelService> {
    const service = serviceFor(...modelDirs);
    const first = firstValueFrom(service.changes());

    service.onApplicationBootstrap();
    await first;

    return service;
  }

  it('scans nothing before the bootstrap hook, so no subscriber misses the first sweep', () => {
    const service = serviceFor('/models');

    expect(scan).not.toHaveBeenCalled();

    service.onApplicationBootstrap();

    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('scans the configured directories on start', async () => {
    const service = serviceFor('/weights');
    const first = firstValueFrom(service.changes());

    service.onApplicationBootstrap();

    expect(await first).toEqual(inventoryOf(['/weights']));
  });

  it('holds the last inventory for a session that opens after the scan', async () => {
    expect(serviceFor('/weights').currentInventory()).toBeNull();

    const service = await started('/weights');

    expect(service.currentInventory()).toEqual(inventoryOf(['/weights']));
  });

  it('scans nothing but still reports where no directory is configured', async () => {
    const service = serviceFor();
    const first = firstValueFrom(service.changes());

    service.onApplicationBootstrap();

    expect(await first).toEqual(inventoryOf([]));
  });

  it('scans again on a request', async () => {
    const service = await started('/weights');
    const second = firstValueFrom(service.changes());

    service.requestScan();
    await second;

    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('follows a sweep with one more where a request arrived during it, rather than running both', async () => {
    let release = (): void => {};

    scan.mockImplementationOnce(
      directories =>
        new Promise(resolve => {
          release = () => {
            resolve(inventoryOf(directories));
          };
        })
    );

    const service = serviceFor('/weights');

    service.onApplicationBootstrap();

    service.requestScan();
    service.requestScan();

    expect(scan).toHaveBeenCalledTimes(1);

    const second = firstValueFrom(service.changes());

    release();
    await second;

    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('keeps running after a sweep that throws', async () => {
    scan.mockRejectedValueOnce(new Error('the disk went away'));

    const service = serviceFor('/weights');

    service.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(scan).toHaveBeenCalledTimes(1);
    });

    const next = firstValueFrom(service.changes());

    service.requestScan();

    expect(await next).toEqual(inventoryOf(['/weights']));
  });
});
