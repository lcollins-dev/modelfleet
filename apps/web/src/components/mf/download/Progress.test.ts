import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { DownloadState } from '@libs/dto';

import MfMeter from '../Meter.vue';
import Progress from './Progress.vue';

const GIB = 1024 ** 3;

describe('MfDownloadProgress', () => {
  it('labels the bar with how much is done, filled to that share in the tone of its state', () => {
    const progress = mount(Progress, {
      props: { bytesDone: 5 * GIB, totalBytes: 10 * GIB, state: DownloadState.ACTIVE },
    });

    expect(progress.text()).toBe('5 GiB / 10 GiB (50%)');
    expect(progress.findComponent(MfMeter).props('bands')).toEqual([
      { label: 'Downloading', tone: 'primary', percent: 50 },
    ]);
  });

  it('fills a failed download in the error tone', () => {
    const progress = mount(Progress, { props: { bytesDone: GIB, totalBytes: 4 * GIB, state: DownloadState.FAILED } });

    expect(progress.findComponent(MfMeter).props('bands')).toEqual([{ label: 'Failed', tone: 'error', percent: 25 }]);
  });
});
