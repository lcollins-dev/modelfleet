import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { ColumnNumericTransformer } from '@/common/transformers/ColumnNumericTransformer';

/**
 * The most VRAM a deployment configuration has measurably taken. One revision can run on a different number of cards
 * on each node its placement names, so the card count is part of the key.
 */
@Entity()
export class MeasuredVram {
  constructor(fields: { configurationRevision: string; gpuCount: number; bytes: number }) {
    this.configurationRevision = fields.configurationRevision;
    this.gpuCount = fields.gpuCount;
    this.bytes = fields.bytes;
  }

  @PrimaryColumn({ type: 'varchar', length: 64 })
  configurationRevision: string;

  @PrimaryColumn({ type: 'int4' })
  gpuCount: number;

  @Column({ type: 'int8', transformer: new ColumnNumericTransformer() })
  bytes: number;

  @UpdateDateColumn({ type: 'timestamp' })
  measuredDate!: Date;
}
