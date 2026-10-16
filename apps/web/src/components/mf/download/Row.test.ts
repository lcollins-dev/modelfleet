import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { DownloadSource, DownloadState, DownloadTargetState, NodeState } from '@libs/dto';

import { UiTag } from '@/components/ui';

import Row from './Row.vue';

describe('MfDownloadRow', () => {
  it('reads the repository, what it is doing where, its state, how many nodes, and how far it has got', () => {
    const row = mount(Row, {
      props: {
        download: {
          id: 1,
          key: '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f',
          source: DownloadSource.HUGGINGFACE,
          repository: 'owner/repo',
          directory: 'huggingface/owner/repo',
          revision: 'a'.repeat(40),
          state: DownloadState.ACTIVE,
          files: [{ path: 'model.gguf', sizeBytes: 1024 }],
          targets: [
            {
              nodeId: 1,
              nodeName: 'gpu-01',
              nodeState: NodeState.ONLINE,
              state: DownloadTargetState.ACTIVE,
              progress: null,
              message: null,
              bytesDone: 512,
              totalBytes: 1024,
              bytesPerSecond: null,
              files: [],
              settledDate: null,
            },
          ],
          bytesDone: 512,
          totalBytes: 1024,
          createdDate: new Date('2026-09-26T09:14:00.000Z'),
        },
      },
    });

    expect(row.text()).toContain('owner/repo');
    expect(row.text()).toContain('Downloading to gpu-01 · 1 file');
    expect(row.findComponent(UiTag).text()).toBe('Downloading');
    expect(row.findComponent(UiTag).props('type')).toBe('primary');
    expect(row.find('[title="gpu-01"]').text()).toBe('1');
    expect(row.text()).toContain('512 B / 1 KiB (50%)');
  });
});
