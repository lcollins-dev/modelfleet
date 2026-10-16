export type MeterTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted'
  | 'strong'
  | 'pending'
  | 'series-1'
  | 'series-2'
  | 'series-3'
  | 'series-4'
  | 'series-5'
  | 'series-6'
  | 'series-7'
  | 'series-8';

export const METER_TONE_CLASSES: Record<MeterTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  muted: 'bg-muted',
  strong: 'bg-line-strong',
  pending: 'bg-[repeating-linear-gradient(135deg,var(--primary)_0_2px,transparent_2px_5px)]',
  'series-1': 'bg-series-1',
  'series-2': 'bg-series-2',
  'series-3': 'bg-series-3',
  'series-4': 'bg-series-4',
  'series-5': 'bg-series-5',
  'series-6': 'bg-series-6',
  'series-7': 'bg-series-7',
  'series-8': 'bg-series-8',
};

export const METER_OVERFLOW_CLASS =
  'border-error bg-[repeating-linear-gradient(135deg,var(--error)_0_2px,transparent_2px_4px)]';

export const STATUS_METER_TONES: Record<'success' | 'warning' | 'error' | 'default', MeterTone> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  default: 'strong',
};

/** Cycled in order across processes, so each tone must read apart from the next and the last from the first. */
export const PROCESS_METER_TONES: MeterTone[] = [
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'series-7',
  'series-8',
];
