import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { placePanel, useAnchoredPosition } from './useAnchoredPosition';

const VIEWPORT = 800;

const anchorAt = (top: number, height = 36) => ({ top, bottom: top + height, left: 40, width: 300 });

describe('placePanel', () => {
  it('opens below the control at its width, 4px down', () => {
    expect(placePanel(anchorAt(100), VIEWPORT, 200)).toEqual({
      side: 'below',
      style: { left: '40px', width: '300px', top: '140px', bottom: 'auto', maxHeight: '264px' },
    });
  });

  it('flips above when the panel would not fit below and there is more room above', () => {
    expect(placePanel(anchorAt(700), VIEWPORT, 200)).toMatchObject({
      side: 'above',
      style: { top: 'auto', bottom: '104px', maxHeight: '264px' },
    });
  });

  it('stays below a short panel that fits there, however near the bottom', () => {
    expect(placePanel(anchorAt(700), VIEWPORT, 40)).toMatchObject({
      side: 'below',
      style: { top: '740px', maxHeight: '52px' },
    });
  });

  it('stays below when neither side fits and below has more room, shrinking to it', () => {
    expect(placePanel(anchorAt(200), 500, 264)).toMatchObject({
      side: 'below',
      style: { top: '240px', maxHeight: '252px' },
    });
  });

  it('shrinks to the room above when that is all there is', () => {
    expect(placePanel(anchorAt(150), 200, 264)).toMatchObject({
      side: 'above',
      style: { bottom: '54px', maxHeight: '138px' },
    });
  });

  it('keeps the side it was on while the panel still fits there', () => {
    expect(placePanel(anchorAt(700), VIEWPORT, 40, 'above')).toMatchObject({ side: 'above' });
  });

  it('leaves the side it was on once the panel outgrows it', () => {
    expect(placePanel(anchorAt(700), VIEWPORT, 200, 'below')).toMatchObject({ side: 'above' });
  });
});

describe('useAnchoredPosition', () => {
  const observed: { target: Element; callback: IntersectionObserverCallback }[] = [];

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}

      observe(target: Element) {
        observed.push({ target, callback: this.callback });
      }

      disconnect() {}
    }
  );

  Object.defineProperty(document.documentElement, 'clientHeight', { value: VIEWPORT, configurable: true });

  enableAutoUnmount(afterEach);

  afterEach(() => {
    observed.splice(0);
    document.body.innerHTML = '';
  });

  const mountAnchored = () => {
    const anchor = document.createElement('div');
    const container = document.createElement('div');
    container.append(anchor);
    document.body.append(container);

    let top = 100;
    anchor.getBoundingClientRect = () => DOMRect.fromRect({ x: 40, y: top, width: 300, height: 36 });

    const onHidden = vi.fn();

    const wrapper = mount(
      defineComponent({
        setup() {
          const panel = ref<HTMLElement | null>(null);
          const { style } = useAnchoredPosition(anchor, panel, onHidden);

          return () => h('div', { ref: panel, style });
        },
      }),
      { attachTo: document.body }
    );

    const reportVisible = (isIntersecting: boolean) => {
      observed.forEach(({ callback }) => {
        callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
    };

    return {
      wrapper,
      anchor,
      container,
      onHidden,
      reportVisible,
      moveTo: (next: number) => {
        top = next;
      },
    };
  };

  it('fixes the panel to the control from its first render and follows it as a container scrolls', async () => {
    const { wrapper, container, moveTo } = mountAnchored();

    expect(wrapper.attributes('style')).toContain('position: fixed');
    expect(wrapper.attributes('style')).toContain('top: 140px');

    moveTo(60);
    container.dispatchEvent(new Event('scroll'));
    await nextTick();

    expect(wrapper.attributes('style')).toContain('top: 100px');
  });

  it('watches the control, not the panel, for leaving the view', () => {
    const { anchor } = mountAnchored();

    expect(observed.map(({ target }) => target)).toEqual([anchor]);
  });

  it('calls onHidden once the control is scrolled out of view, and not while it is in view', () => {
    const { onHidden, reportVisible } = mountAnchored();

    reportVisible(true);

    expect(onHidden).not.toHaveBeenCalled();

    reportVisible(false);

    expect(onHidden).toHaveBeenCalledOnce();
  });
});
