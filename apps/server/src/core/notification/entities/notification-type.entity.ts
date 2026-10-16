import { Entity, Column, PrimaryColumn } from 'typeorm';

import { NotificationSeverity, NotificationTypeId } from '@libs/dto';

@Entity()
export class NotificationType {
  constructor(fields: {
    id: NotificationTypeId;
    name: string;
    severity: NotificationSeverity;
    pageUrl: string | null;
  }) {
    this.id = fields.id;
    this.name = fields.name;
    this.severity = fields.severity;

    this.pageUrl = fields.pageUrl;
  }

  @PrimaryColumn({ type: 'int4' })
  id: NotificationTypeId;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 256, nullable: true })
  pageUrl: string | null;
}
