import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

import { EventDetail, EventPartyType, EventSeverity, EventType } from '@libs/dto';

@Entity()
export class Event {
  constructor(fields: {
    type: EventType;
    severity: EventSeverity;
    actorType: EventPartyType | null;
    actorId: string | null;
    subjectType: EventPartyType | null;
    subjectId: string | null;
    message: string | null;
    detail: EventDetail;
  }) {
    this.type = fields.type;
    this.severity = fields.severity;

    this.actorType = fields.actorType;
    this.actorId = fields.actorId;

    this.subjectType = fields.subjectType;
    this.subjectId = fields.subjectId;

    this.message = fields.message;
    this.detail = fields.detail;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'varchar', length: 64 })
  type: EventType;

  @Column({ type: 'varchar', length: 16 })
  severity: EventSeverity;

  @Column({ type: 'varchar', length: 64, nullable: true })
  actorType: EventPartyType | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  subjectType: EventPartyType | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  subjectId: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'jsonb' })
  detail: EventDetail;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
