import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PickerFrame from './PickerFrame.vue';

const SLOTS = {
  head: '<span>Select all</span>',
  default: '<div>row</div>',
  footer: '<span>A note</span>',
};

describe('PickerFrame', () => {
  it('names its group, and shows the head, the rows and the footer', () => {
    const frame = mount(PickerFrame, { props: { label: 'Files' }, slots: SLOTS });

    expect(frame.attributes('role')).toBe('group');
    expect(frame.attributes('aria-label')).toBe('Files');
    expect(frame.text()).toContain('Select all');
    expect(frame.get('[data-testid="picker-rows"]').text()).toBe('row');
    expect(frame.text()).toContain('A note');
  });

  it('shows a spinner in place of the head and rows while loading, and keeps the footer', () => {
    const frame = mount(PickerFrame, { props: { label: 'Files', loading: true }, slots: SLOTS });

    expect(frame.find('[role="status"]').exists()).toBe(true);
    expect(frame.find('[data-testid="picker-rows"]').exists()).toBe(false);
    expect(frame.text()).not.toContain('Select all');
    expect(frame.text()).toContain('A note');
  });

  it('shows the empty text in place of the head and rows', () => {
    const frame = mount(PickerFrame, { props: { label: 'Files', empty: 'No files.' }, slots: SLOTS });

    expect(frame.text()).toContain('No files.');
    expect(frame.find('[data-testid="picker-rows"]').exists()).toBe(false);
  });

  it('shows a status in place of the head and rows, ahead of the empty text', () => {
    const frame = mount(PickerFrame, {
      props: { label: 'Files', empty: 'No files.' },
      slots: { ...SLOTS, status: '<p>Could not list</p>' },
    });

    expect(frame.text()).toContain('Could not list');
    expect(frame.text()).not.toContain('No files.');
    expect(frame.find('[data-testid="picker-rows"]').exists()).toBe(false);
  });
});
