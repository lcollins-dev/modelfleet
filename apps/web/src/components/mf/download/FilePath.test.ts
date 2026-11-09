import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FilePath from './FilePath.vue';

const LONG_PATH = 'Q4_K_M/Meridian-72B-Instruct-Q4_K_M-00005-of-00012.gguf';

describe('MfDownloadFilePath', () => {
  it('splits a path at its last folder, keeping the whole path as the title', () => {
    const path = mount(FilePath, { props: { path: LONG_PATH } });

    expect(path.get('[data-testid="download-file-folder"]').text()).toBe('Q4_K_M/');
    expect(path.get('[data-testid="download-file-name"]').text()).toBe(
      'Meridian-72B-Instruct-Q4_K_M-00005-of-00012.gguf'
    );
    expect(path.attributes('title')).toBe(LONG_PATH);
  });

  it('gives up the width of the folder before the name, so a shard number stays readable', () => {
    const path = mount(FilePath, { props: { path: LONG_PATH } });

    expect(path.get('[data-testid="download-file-folder"]').classes()).toEqual(
      expect.arrayContaining(['truncate', 'shrink-[9999]'])
    );
    expect(path.get('[data-testid="download-file-name"]').classes()).not.toContain('shrink-[9999]');
  });

  it('has no folder for a file at the top of the repository', () => {
    const path = mount(FilePath, { props: { path: 'config.json' } });

    expect(path.find('[data-testid="download-file-folder"]').exists()).toBe(false);
    expect(path.get('[data-testid="download-file-name"]').text()).toBe('config.json');
  });
});
