import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Detail from './Detail.vue';

describe('MfEventDetail', () => {
  it('lays out each detail as a muted key beside its mono value, in order', () => {
    const detail = mount(Detail, { props: { detail: { nodeKey: 'node-a-01', gpus: 4, enabled: false } } });

    const cells = detail.findAll('span').map(cell => cell.text());

    expect(cells).toEqual(['nodeKey', 'node-a-01', 'gpus', '4', 'enabled', 'false']);
    expect(detail.findAll('span')[1].classes()).toContain('font-mono');
  });
});
