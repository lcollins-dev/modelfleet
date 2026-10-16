import { VNode } from 'vue';

export enum DialogType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  DANGER = 'danger',
}

export interface IDialogOptions {
  type: DialogType;
  title: string;
  message: string | (() => VNode);
  confirmLabel: string;
  cancelLabel?: string;
  /** Matched ignoring case and surrounding space. */
  confirmText?: string;
  confirmTextLabel?: string;
  /** Runs on confirm with the dialog held open and loading; a rejection keeps it open, and cancelling leaves it running. */
  action?: () => Promise<unknown>;
}

export interface IOpenDialog {
  id: number;
  options: IDialogOptions;
  resolve: (confirmed: boolean) => void;
}
