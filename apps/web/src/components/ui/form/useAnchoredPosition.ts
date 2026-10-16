import {
  MaybeComputedElementRef,
  unrefElement,
  useEventListener,
  useIntersectionObserver,
  useResizeObserver,
} from '@vueuse/core';
import { CSSProperties, MaybeRefOrGetter, onMounted, reactive, toValue } from 'vue';

const GAP = 4;

const WINDOW_MARGIN = 8;

export const PANEL_MAX_HEIGHT = 264;

type Side = 'below' | 'above';

interface IAnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/** Keeps `keepSide` while the panel still fits there. */
export const placePanel = (anchor: IAnchorRect, viewportHeight: number, panelHeight: number, keepSide?: Side) => {
  const roomBelow = viewportHeight - anchor.bottom - GAP - WINDOW_MARGIN;
  const roomAbove = anchor.top - GAP - WINDOW_MARGIN;
  const wanted = Math.min(panelHeight, PANEL_MAX_HEIGHT);

  const roomOn = (candidate: Side) => (candidate === 'above' ? roomAbove : roomBelow);
  const best: Side = wanted > roomBelow && roomAbove > roomBelow ? 'above' : 'below';
  const side = keepSide !== undefined && wanted <= roomOn(keepSide) ? keepSide : best;

  const style: CSSProperties = {
    left: `${anchor.left}px`,
    width: `${anchor.width}px`,
    top: side === 'below' ? `${anchor.bottom + GAP}px` : 'auto',
    bottom: side === 'above' ? `${viewportHeight - anchor.top + GAP}px` : 'auto',
    maxHeight: `${Math.min(Math.max(roomOn(side), 0), PANEL_MAX_HEIGHT)}px`,
  };

  return { side, style };
};

/** For a panel that exists only while open. Calls `onHidden` once the anchor is scrolled out of view. */
export const useAnchoredPosition = (
  anchor: MaybeRefOrGetter<HTMLElement | null>,
  panel: MaybeComputedElementRef,
  onHidden: () => void
) => {
  const style = reactive<CSSProperties>({ position: 'fixed' });

  let side: Side | undefined;

  const place = () => {
    const anchorElement = toValue(anchor);

    if (anchorElement === null) {
      return;
    }

    const panelElement = unrefElement(panel);
    const panelHeight =
      panelElement instanceof HTMLElement
        ? panelElement.scrollHeight + panelElement.offsetHeight - panelElement.clientHeight
        : PANEL_MAX_HEIGHT;

    const placement = placePanel(
      anchorElement.getBoundingClientRect(),
      document.documentElement.clientHeight,
      panelHeight,
      side
    );

    side = placement.side;
    Object.assign(style, placement.style);
  };

  place();

  onMounted(() => {
    side = undefined;
    place();
  });

  // Scroll does not bubble, so a capturing listener on the window hears every container's scroll.
  useEventListener(window, 'scroll', place, { capture: true, passive: true });
  useEventListener(window, 'resize', place, { passive: true });
  useResizeObserver(() => toValue(anchor), place);
  useResizeObserver(panel, place);

  // With no root, the observer counts the anchor as clipped by every scrolling container around it.
  useIntersectionObserver(
    () => toValue(anchor),
    entries => {
      if (entries.at(-1)?.isIntersecting === false) {
        onHidden();
      }
    }
  );

  return { style };
};
