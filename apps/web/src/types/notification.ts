import { VNode } from 'vue';

export enum NotificationType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

export class Notification {
  id = -1;
  timedOut = false;
  timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * After `timeoutMs` a notification is timed out and goes at the next navigation, notification or successful request;
   * with `autoClose` it goes at once.
   */
  constructor(
    public content: string | (() => VNode),
    public type: NotificationType,
    public timeoutMs: number = 4000,
    public title: string | null = null,
    public autoClose = false
  ) {}
}
