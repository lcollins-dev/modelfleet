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

import { BackendId } from '@libs/backends';
import { ActivationPolicy, ConfigurationDocument } from '@libs/dto';

import { Model } from '../../model/entities/model.entity';
import { Preset } from '../../preset/entities/preset.entity';

/** The servable unit, and the only object a caller can address. */
@Entity()
export class Deployment {
  constructor(fields: {
    name: string;
    modelId: number;
    presetId: number | null;
    backend: BackendId | null;
    activationPolicy: ActivationPolicy;
    description: string | null;
    schemaVersion: number;
    document: string;
    configuration: ConfigurationDocument;
    configurationRevision: string;
    appliedRevision: string;
  }) {
    this.name = fields.name;
    this.modelId = fields.modelId;
    this.presetId = fields.presetId;
    this.backend = fields.backend;
    this.activationPolicy = fields.activationPolicy;
    this.description = fields.description;
    this.schemaVersion = fields.schemaVersion;
    this.document = fields.document;
    this.configuration = fields.configuration;
    this.configurationRevision = fields.configurationRevision;
    this.appliedRevision = fields.appliedRevision;

    this.enabled = true;
    this.lastUsedDate = null;
    this.launchFailures = 0;
    this.lastLaunchFailureDate = null;
    this.lastLaunchFailure = null;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  /** Unique across the fleet, compared without case. */
  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'int4' })
  modelId: number;

  @ManyToOne(() => Model, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'modelId' })
  model?: Relation<Model>;

  @Column({ type: 'int4', nullable: true })
  presetId: number | null;

  @ManyToOne(() => Preset, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'presetId' })
  preset?: Relation<Preset>;

  /** Set where the deployment names no preset, and null where the preset carries the backend instead. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  backend: BackendId | null;

  @Column({ type: 'varchar', length: 32 })
  activationPolicy: ActivationPolicy;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  @Column({ type: 'int4' })
  schemaVersion: number;

  /** The YAML as authored, holding the deployment's own keys alone. */
  @Column({ type: 'text' })
  document: string;

  /** Derived from `document` in the same write. The whole configuration where the deployment names no preset. */
  @Column({ type: 'jsonb' })
  configuration: ConfigurationDocument;

  /** A digest of the effective configuration's relaunch-required values. */
  @Column({ type: 'varchar', length: 64 })
  configurationRevision: string;

  /** The revision running instances are being brought to. It trails `configurationRevision` until an apply. */
  @Column({ type: 'varchar', length: 64 })
  appliedRevision: string;

  /** A disabled deployment is stopped by the deployment supervisor and cannot be started by hand. */
  @Column({ type: 'bool' })
  enabled: boolean;

  /** Stamped no more often than `LAST_USED_STAMP_INTERVAL_MS`, so routing a request stays a read. */
  @Column({ type: 'timestamp', nullable: true })
  lastUsedDate: Date | null;

  /** Launches that failed since an instance of the deployment was last ready, which its backoff is counted from. */
  @Column({ type: 'int4' })
  launchFailures: number;

  @Column({ type: 'timestamp', nullable: true })
  lastLaunchFailureDate: Date | null;

  /** The backend's own last output from that failure, kept after the failed instance has gone. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  lastLaunchFailure: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedDate!: Date;
}
