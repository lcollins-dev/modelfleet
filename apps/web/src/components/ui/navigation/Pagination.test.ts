import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Pagination from './Pagination.vue';

describe('Pagination', () => {
  it('marks the current page', () => {
    const wrapper = mount(Pagination, { props: { page: 2, pageCount: 3 } });

    expect(wrapper.get('[aria-current="page"]').text()).toBe('2');
  });

  it('moves to a page when it is pressed', async () => {
    const wrapper = mount(Pagination, { props: { page: 1, pageCount: 3 } });

    await wrapper.get('button[aria-label="Page 3"]').trigger('click');

    expect(wrapper.emitted('update:page')).toEqual([[3]]);
  });

  it('steps back and forward a page', async () => {
    const back = mount(Pagination, { props: { page: 2, pageCount: 3 } });
    const forward = mount(Pagination, { props: { page: 2, pageCount: 3 } });

    await back.get('button[aria-label="Previous page"]').trigger('click');
    await forward.get('button[aria-label="Next page"]').trigger('click');

    expect(back.emitted('update:page')).toEqual([[1]]);
    expect(forward.emitted('update:page')).toEqual([[3]]);
  });

  it('disables stepping past the first and last pages', () => {
    const first = mount(Pagination, { props: { page: 1, pageCount: 3 } });
    const last = mount(Pagination, { props: { page: 3, pageCount: 3 } });

    expect(first.get('button[aria-label="Previous page"]').attributes('disabled')).toBeDefined();
    expect(last.get('button[aria-label="Next page"]').attributes('disabled')).toBeDefined();
  });
});
