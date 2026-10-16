import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';
import type { DeploymentConfigurationDto } from '@libs/dto';
import { ConfigurationSource } from '@libs/dto';

import Effective from './Effective.vue';

const configuration = (entries: DeploymentConfigurationDto['entries']): DeploymentConfigurationDto => ({
  backend: BackendId.LLAMA_CPP,
  entries,
  configuration: {},
  presetId: 3,
  presetName: 'Standard',
});

describe('MfEffectiveConfiguration', () => {
  it('lists each applied key with its label, value and the layer that set it', () => {
    const wrapper = mount(Effective, {
      props: {
        configuration: configuration([
          { key: 'replicas', value: 2, source: ConfigurationSource.DEPLOYMENT, modelled: true },
          { key: 'customKey', value: 'a long value', source: ConfigurationSource.PRESET, modelled: true },
        ]),
      },
    });

    const rows = wrapper.findAll('[data-testid="effective-entry"]');

    expect(rows.map(row => row.text())).toEqual([
      'Replicasreplicas2Deployment',
      'customKeycustomKeya long valuePreset',
    ]);
    expect(rows[0].get('.rounded-full').classes()).toContain('bg-primary-soft');
  });

  it('reads a placement by the names of the nodes it pins, or as automatic', () => {
    const wrapper = mount(Effective, {
      props: {
        configuration: configuration([
          { key: 'placement', value: { nodeIds: [1] }, source: ConfigurationSource.DEPLOYMENT, modelled: true },
        ]),
        placementNodes: [
          {
            nodeId: 1,
            nodeName: 'rig-a',
            devices: [],
            replicas: 1,
            running: 0,
            problem: null,
            expectedUsage: null,
            capacity: null,
          },
        ],
      },
    });

    expect(wrapper.get('[data-testid="effective-entry"]').text()).toBe('Placementplacementrig-a: CPUDeployment');
  });

  it('says so where nothing is applied', () => {
    const wrapper = mount(Effective, { props: { configuration: configuration([]) } });

    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('This deployment has no configuration.');
  });
});
