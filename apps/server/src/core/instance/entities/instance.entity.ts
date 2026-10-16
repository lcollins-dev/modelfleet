import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { InstanceState } from '@libs/agent-protocol';
import { IInstancePins } from '@libs/backends';

import { Deployment } from '../../deployment/entities/deployment.entity';
import { Node } from '../../node/entities/node.entity';

/** One container of one deployment on one node. The server issues the key; the agent makes the container match it. */
@Entity()
export class Instance {
  constructor(fields: {
    instanceKey: string;
    deploymentId: number;
    nodeId: number;
    revision: number;
    configurationRevision: string;
    pins: IInstancePins;
  }) {
    this.instanceKey = fields.instanceKey;
    this.deploymentId = fields.deploymentId;
    this.nodeId = fields.nodeId;
    this.revision = fields.revision;
    this.configurationRevision = fields.configurationRevision;
    this.pins = fields.pins;

    this.instanceState = InstanceState.STARTING;
    this.message = null;
    this.exitCode = null;
    this.reportedDate = null;
    this.readyDate = null;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  /** A UUIDv7, so the keys of one node's instances sort by the order they were issued in. */
  @Column({ type: 'uuid', unique: true })
  instanceKey: string;

  @Column({ type: 'int4' })
  deploymentId: number;

  @ManyToOne(() => Deployment, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'deploymentId' })
  deployment?: Relation<Deployment>;

  @Column({ type: 'int4' })
  nodeId: number;

  @ManyToOne(() => Node, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'nodeId' })
  node?: Relation<Node>;

  /** What the agent compares to tell a restart from a replacement, without reading the configuration. */
  @Column({ type: 'int4' })
  revision: number;

  /** The revision of the configuration this instance was launched with, which desired state carries to its node. */
  @Column({ type: 'varchar', length: 64 })
  configurationRevision: string;

  /** The hardware this instance took, recorded so it survives a change to the deployment's placement. */
  @Column({ type: 'jsonb' })
  pins: IInstancePins;

  /** The node's last report about this instance, or `starting` until one arrives. */
  @Column({ type: 'varchar', length: 32 })
  instanceState: InstanceState;

  /** The backend's own last output where the launch failed, which is where the cause is explained. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  message: string | null;

  @Column({ type: 'int4', nullable: true })
  exitCode: number | null;

  @Column({ type: 'timestamp', nullable: true })
  reportedDate: Date | null;

  /** When the node first reported the instance ready, which its deployment's idleness is counted from. */
  @Column({ type: 'timestamp', nullable: true })
  readyDate: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedDate!: Date;
}
