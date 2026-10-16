import { Column, Entity, PrimaryColumn } from 'typeorm';

import { BatchJobId } from '@libs/dto';

@Entity()
export class BatchJob {
  constructor(fields: { id: BatchJobId; name: string; desc: string; enabled: boolean }) {
    this.id = fields.id;

    this.name = fields.name;
    this.desc = fields.desc;

    this.cronExpression = null;

    this.enabled = fields.enabled;

    this.lastStartDate = null;
    this.lastSuccessDate = null;
    this.lastFailDate = null;
  }

  @PrimaryColumn({ type: 'int4' })
  id: BatchJobId;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 256 })
  desc: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  cronExpression: string | null;

  @Column({ type: 'bool' })
  enabled: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastStartDate: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSuccessDate: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastFailDate: Date | null;
}
