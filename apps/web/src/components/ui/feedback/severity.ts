import { type Component } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';
import IconClose from '~icons/material-symbols/close-rounded';
import IconInfo from '~icons/material-symbols/info-i-rounded';
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded';

export type Severity = 'info' | 'success' | 'warning' | 'error';

export const SEVERITY_ICONS: Record<Severity, Component> = {
  info: IconInfo,
  success: IconCheck,
  warning: IconPriorityHigh,
  error: IconClose,
};

/** The disc's colour; the caller sets the glyph's to the background the disc sits on. */
export const SEVERITY_DISC_CLASSES: Record<Severity, string> = {
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
};
