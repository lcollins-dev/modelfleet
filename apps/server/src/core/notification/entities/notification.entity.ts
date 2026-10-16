import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  JoinColumn,
  ManyToOne,
  CreateDateColumn,
  type Relation,
} from 'typeorm';

import { NotificationTypeId } from '@libs/dto';

import { User } from '../../user/entities/user.entity';
import { NotificationType } from './notification-type.entity';

@Entity()
export class Notification {
  constructor(fields: { notificationTypeId: number; userId: number; desc: string }) {
    this.notificationTypeId = fields.notificationTypeId;
    this.userId = fields.userId;

    this.desc = fields.desc;

    this.cleared = false;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  notificationTypeId: NotificationTypeId;

  @JoinColumn()
  @ManyToOne(() => NotificationType, notificationType => notificationType.id)
  notificationType?: Relation<NotificationType>;

  @Column({ type: 'int4' })
  userId: number;

  @JoinColumn()
  @ManyToOne(() => User, user => user.id)
  user?: Relation<User>;

  @Column({ type: 'text' })
  desc: string;

  @Column({ type: 'bool' })
  cleared: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
