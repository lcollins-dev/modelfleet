import { describe, expect, it } from 'vitest';

import { GIB, VramSource } from '../definition';
import { buildEstimatedModel } from '../test/container.factory';
import { buildDeclaration } from '../test/declaration.factory';
import {
  EstimateBasis,
  EstimateInputSource,
  IEstimatedDevice,
  IVramEstimateInput,
  configuredShareEstimate,
  configuredSizeEstimate,
  deviceTotals,
  fractionOfDevices,
  weightsEstimate,
  weightsOnDiskEstimate,
} from './estimate';

const input = (devices: IEstimatedDevice[]): IVramEstimateInput => ({
  model: buildEstimatedModel(),
  companions: [],
  configuration: {},
  deviceCount: devices.length,
  devices,
});

describe('deviceTotals', () => {
  it('names every card that has not reported its total', () => {
    const totals = deviceTotals(
      input([
        { deviceKey: 'GPU-0', totalBytes: 24 * GIB },
        { deviceKey: 'GPU-1', totalBytes: null },
      ])
    );

    expect(totals).toEqual([{ source: EstimateInputSource.DEVICE, field: 'GPU-1' }]);
  });
});

describe('fractionOfDevices', () => {
  it('takes the fraction of each card it is pinned to, labelled as configured', () => {
    const estimate = fractionOfDevices(input([{ deviceKey: 'GPU-0', totalBytes: 24 * GIB }]), 0.5);

    expect(estimate).toMatchObject({ computed: true, basis: EstimateBasis.CONFIGURATION, totalBytes: 12 * GIB });
  });

  it('sums each card on its own total, so cards of different sizes take different shares', () => {
    const estimate = fractionOfDevices(
      input([
        { deviceKey: 'GPU-0', totalBytes: 24 * GIB },
        { deviceKey: 'GPU-1', totalBytes: 48 * GIB },
      ]),
      0.5
    );

    expect(estimate).toMatchObject({ computed: true, totalBytes: 36 * GIB });
  });

  it('is unavailable naming the card where a total is unknown', () => {
    const estimate = fractionOfDevices(input([{ deviceKey: 'GPU-0', totalBytes: null }]), 0.5);

    expect(estimate).toEqual({
      computed: false,
      missing: [{ source: EstimateInputSource.DEVICE, field: 'GPU-0' }],
    });
  });
});

describe('weightsEstimate', () => {
  it('scales the bytes on disk and adds the overhead once per card', () => {
    const estimate = weightsEstimate({ bytes: 2 * GIB, factor: 1.5, overheadBytesPerDevice: GIB, deviceCount: 2 });

    expect(estimate).toMatchObject({
      basis: EstimateBasis.WEIGHTS,
      weightsBytes: 3 * GIB,
      overheadBytes: 2 * GIB,
      totalBytes: 5 * GIB,
    });
  });
});

describe('configuredShareEstimate', () => {
  const card = { deviceKey: 'GPU-0', totalBytes: 24 * GIB };
  const share = { source: VramSource.CONFIGURATION, fractionField: 'ropeScale' } as const;

  it('takes the share the declared field holds of each card', () => {
    const estimate = configuredShareEstimate(
      { ...input([card]), configuration: { ropeScale: 0.25 } },
      buildDeclaration(),
      share
    );

    expect(estimate).toMatchObject({ basis: EstimateBasis.CONFIGURATION, totalBytes: 6 * GIB });
  });

  it('names the field where it holds no share', () => {
    expect(configuredShareEstimate(input([card]), buildDeclaration(), share)).toEqual({
      computed: false,
      missing: [{ source: EstimateInputSource.CONFIGURATION, field: 'ropeScale' }],
    });
  });
});

describe('configuredSizeEstimate', () => {
  const size = { source: VramSource.SIZE, gibField: 'ropeScale' } as const;

  it('takes the GiB the declared field holds, whatever the card', () => {
    const estimate = configuredSizeEstimate(
      { ...input([{ deviceKey: 'GPU-0', totalBytes: null }]), configuration: { ropeScale: 1.5 } },
      buildDeclaration(),
      size
    );

    expect(estimate).toMatchObject({ basis: EstimateBasis.CONFIGURATION, totalBytes: 1.5 * GIB });
  });

  it('names the field where it holds no size', () => {
    expect(configuredSizeEstimate(input([]), buildDeclaration(), size)).toEqual({
      computed: false,
      missing: [{ source: EstimateInputSource.CONFIGURATION, field: 'ropeScale' }],
    });
  });
});

describe('weightsOnDiskEstimate', () => {
  it('scales the model and every companion it loads, and adds the overhead once per card', () => {
    const estimate = weightsOnDiskEstimate(
      {
        ...input([{ deviceKey: 'GPU-0', totalBytes: null }]),
        model: buildEstimatedModel({ sizeBytes: 2 * GIB }),
        companions: [{ field: 'mmproj', sizeBytes: GIB }],
      },
      { source: VramSource.WEIGHTS, factor: 2, overheadBytesPerDevice: GIB }
    );

    expect(estimate).toMatchObject({ basis: EstimateBasis.WEIGHTS, weightsBytes: 6 * GIB, totalBytes: 7 * GIB });
  });
});
