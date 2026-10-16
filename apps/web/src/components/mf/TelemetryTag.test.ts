import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { useTelemetryStore } from '@/stores/telemetry';

import TelemetryTag from './TelemetryTag.vue';

describe('MfTelemetryTag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads as idle where the page holds no stream open', () => {
    const wrapper = mount(TelemetryTag);

    expect(wrapper.text()).toBe('Telemetry idle');
  });

  it('reports a current stream as live with its age', async () => {
    useTelemetryStore().register({ connected: ref(true), lastActivityDate: ref(new Date()) });
    vi.advanceTimersByTime(3000);

    const wrapper = mount(TelemetryTag);
    await nextTick();

    expect(wrapper.text()).toBe('Telemetry live · 3s');
    expect(wrapper.get('span span').classes()).toContain('text-success');
  });

  it('reports a disconnected stream as stale', async () => {
    useTelemetryStore().register({ connected: ref(false), lastActivityDate: ref(new Date()) });
    vi.advanceTimersByTime(41000);

    const wrapper = mount(TelemetryTag);
    await nextTick();

    expect(wrapper.text()).toBe('Telemetry stale · 41s old');
    expect(wrapper.get('span span').classes()).toContain('text-warning');
  });
});
