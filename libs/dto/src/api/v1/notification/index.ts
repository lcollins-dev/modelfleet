import { z } from 'zod';

import { timestamp } from '../../../fields';

export enum NotificationTypeId {}

export enum NotificationSeverity {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

export const NotificationTypeDto = z.object({
  // z.enum types an enum with no members as string; switch to z.enum once NotificationTypeId has one.
  id: z.custom<NotificationTypeId>(id => typeof id === 'number'),
  name: z.string(),
  severity: z.enum(NotificationSeverity),
  pageUrl: z.string().optional(),
});
export type NotificationTypeDto = z.infer<typeof NotificationTypeDto>;

export const NotificationDto = z.object({
  id: z.number(),
  notificationType: NotificationTypeDto,
  desc: z.string(),
  createdDate: timestamp(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationListDto = z.object({
  notificationList: z.array(NotificationDto),
});
export type NotificationListDto = z.infer<typeof NotificationListDto>;
