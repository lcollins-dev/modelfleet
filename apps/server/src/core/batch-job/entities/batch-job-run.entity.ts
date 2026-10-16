import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';

import { BatchJobId, BatchJobRunResult } from '@libs/dto';

import { BatchJob } from './batch-job.entity';

@Entity()
@Index(['batchJobId', 'startDate'])
export class BatchJobRun {
  constructor(fields: { batchJobId: BatchJobId; startDate: Date }) {
    this.batchJobId = fields.batchJobId;

    this.startDate = fields.startDate;
    this.endDate = null;

    this.result = BatchJobRunResult.RUNNING;
    this.error = null;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  batchJobId: BatchJobId;

  @JoinColumn()
  @ManyToOne(() => BatchJob, { onDelete: 'CASCADE' })
  batchJob?: Relation<BatchJob>;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate: Date | null;

  @Column({ type: 'varchar', length: 16 })
  result: BatchJobRunResult;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
