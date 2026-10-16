import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import { Node } from '../../node/entities/node.entity';
import { Model } from './model.entity';

/** One node holding one model. The same weights on two nodes are one model with two of these. */
@Entity()
export class Availability {
  constructor(fields: { modelId: number; nodeId: number; path: string; lastConfirmedDate: Date }) {
    this.modelId = fields.modelId;
    this.nodeId = fields.nodeId;
    this.path = fields.path;
    this.lastConfirmedDate = fields.lastConfirmedDate;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  modelId: number;

  @ManyToOne(() => Model, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'modelId' })
  model?: Relation<Model>;

  @Column({ type: 'int4' })
  nodeId: number;

  @ManyToOne(() => Node, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'nodeId' })
  node?: Relation<Node>;

  /** This node's path to the model, and the first shard where it is sharded. */
  @Column({ type: 'varchar', length: 1024 })
  path: string;

  /** Stamped by every scan that still finds the model, so a long-offline node's entry reads as stale. */
  @Column({ type: 'timestamp' })
  lastConfirmedDate: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
