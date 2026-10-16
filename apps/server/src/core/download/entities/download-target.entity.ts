import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import { DownloadTargetState } from '@libs/dto';

import { Node } from '../../node/entities/node.entity';
import { Download } from './download.entity';

/** One node's share of a download. Only the outcome is kept; progress lives with the node's session. */
@Entity()
export class DownloadTarget {
  constructor(fields: { downloadId: number; nodeId: number }) {
    this.downloadId = fields.downloadId;
    this.nodeId = fields.nodeId;
    this.state = DownloadTargetState.ACTIVE;
    this.attempt = 0;
    this.message = null;
    this.settledDate = null;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  downloadId: number;

  @ManyToOne(() => Download, download => download.targets, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'downloadId' })
  download?: Relation<Download>;

  @Column({ type: 'int4' })
  nodeId: number;

  @ManyToOne(() => Node, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'nodeId' })
  node?: Relation<Node>;

  @Column({ type: 'varchar', length: 16 })
  state: DownloadTargetState;

  /** Raised by each retry. The node echoes it, so a report from an earlier attempt settles nothing. */
  @Column({ type: 'int4' })
  attempt: number;

  @Column({ type: 'varchar', length: 512, nullable: true })
  message: string | null;

  @Column({ type: 'timestamp', nullable: true })
  settledDate: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
