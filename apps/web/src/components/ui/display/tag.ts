export type TagType = 'default' | 'primary' | 'success' | 'warning' | 'error';

export const TAG_TYPE_CLASSES: Record<TagType, string> = {
  default: 'border-transparent bg-emphasis text-highlight',
  primary: 'border-transparent bg-primary-soft text-accent',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  error: 'border-transparent bg-error-soft text-error',
};
