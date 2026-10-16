import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { BatchJobRunResult, type BatchJobRunDto } from '@libs/dto';

import BatchJobRunRow from './BatchJobRunRow.vue';

const START = '2026-10-02T13:47:00Z';

const buildRun = (overrides: Partial<BatchJobRunDto> = {}): BatchJobRunDto => ({
  id: 4,
  startDate: new Date(START),
  endDate: new Date('2026-10-02T13:49:05Z'),
  result: BatchJobRunResult.SUCCEEDED,
  error: null,
  ...overrides,
});

const mountRow = (batchJobRun: BatchJobRunDto) => mount(BatchJobRunRow, { props: { batchJobRun } });

describe('BatchJobRunRow', () => {
  it('shows the duration and result of a finished run, with nothing to expand', () => {
    const wrapper = mountRow(buildRun());

    expect(wrapper.text()).toContain('2m 5s');
    expect(wrapper.text()).toContain('Succeeded');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows no duration while the run is going', () => {
    const wrapper = mountRow(buildRun({ endDate: null, result: BatchJobRunResult.RUNNING }));

    expect(wrapper.text()).toContain('Running');
    expect(wrapper.text()).toContain('-');
  });

  it("shows a failed run's error once expanded, and hides it again", async () => {
    const wrapper = mountRow(buildRun({ result: BatchJobRunResult.FAILED, error: 'deadlock detected' }));

    expect(wrapper.find('[data-testid="job-run-error"]').exists()).toBe(false);

    await wrapper.get('button[aria-label="Show details"]').trigger('click');

    expect(wrapper.get('[data-testid="job-run-error"]').text()).toBe('deadlock detected');
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true');

    await wrapper.get('button[aria-label="Hide details"]').trigger('click');

    expect(wrapper.find('[data-testid="job-run-error"]').exists()).toBe(false);
  });
});
