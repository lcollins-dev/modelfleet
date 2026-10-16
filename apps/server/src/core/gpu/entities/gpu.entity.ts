import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import { GpuVendor } from '@libs/agent-protocol';

import { Node } from '../../node/entities/node.entity';

import { ColumnNumericTransformer } from '@/common/transformers/ColumnNumericTransformer';

/** One physical device on one node; a row is a whole card. */
@Entity()
export class Gpu {
  constructor(fields: {
    nodeId: number;
    deviceKey: string;
    vendor: GpuVendor;
    name: string | null;
    pciBusId: string | null;
    memoryTotalBytes: number | null;
    index: number | null;
    lastReportedDate: Date;
  }) {
    this.nodeId = fields.nodeId;
    this.deviceKey = fields.deviceKey;
    this.vendor = fields.vendor;
    this.name = fields.name;
    this.pciBusId = fields.pciBusId;
    this.memoryTotalBytes = fields.memoryTotalBytes;
    this.index = fields.index;
    this.lastReportedDate = fields.lastReportedDate;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  nodeId: number;

  @ManyToOne(() => Node, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'nodeId' })
  node?: Relation<Node>;

  /** The vendor UUID. Unique within a node. */
  @Column({ type: 'varchar', length: 128 })
  deviceKey: string;

  @Column({ type: 'varchar', length: 32 })
  vendor: GpuVendor;

  @Column({ type: 'varchar', length: 128, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  pciBusId: string | null;

  @Column({ type: 'int8', nullable: true, transformer: new ColumnNumericTransformer() })
  memoryTotalBytes: number | null;

  /** For ordering only; identity is `deviceKey`. Null from an agent that predates reporting it. */
  @Column({ type: 'int4', nullable: true })
  index: number | null;

  @Column({ type: 'timestamp' })
  lastReportedDate: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
