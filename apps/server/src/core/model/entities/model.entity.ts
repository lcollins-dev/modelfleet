import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, Relation } from 'typeorm';

import {
  GgufMetadata,
  ModelFormat,
  ModelLicence,
  ModelTask,
  ModelType,
  ProjectorModality,
  SafetensorsMetadata,
} from '@libs/agent-protocol';

import { Availability } from './availability.entity';

import { ColumnNumericTransformer } from '@/common/transformers/ColumnNumericTransformer';

/** Weights and nothing else, identified fleet-wide by their fingerprint. Where they sit is an `Availability`. */
@Entity()
export class Model {
  constructor(fields: {
    fingerprint: string;
    format: ModelFormat;
    type: ModelType;
    detectedTasks: ModelTask[];
    licence: ModelLicence | null;
    modalities: ProjectorModality[] | null;
    sizeBytes: number;
    shardCount: number;
    name: string;
    ggufMetadata: GgufMetadata | null;
    safetensorsMetadata: SafetensorsMetadata | null;
  }) {
    this.fingerprint = fields.fingerprint;
    this.format = fields.format;
    this.type = fields.type;
    this.detectedTasks = fields.detectedTasks;
    this.assignedTasks = null;
    this.licence = fields.licence;
    this.modalities = fields.modalities;
    this.sizeBytes = fields.sizeBytes;
    this.shardCount = fields.shardCount;
    this.name = fields.name;
    this.displayName = null;
    this.ggufMetadata = fields.ggufMetadata;
    this.safetensorsMetadata = fields.safetensorsMetadata;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  fingerprint: string;

  @Column({ type: 'varchar', length: 32 })
  format: ModelFormat;

  /** Only a `model` can be deployed; every other type runs beside one. */
  @Column({ type: 'varchar', length: 32 })
  type: ModelType;

  @Column({ type: 'varchar', length: 32, array: true, default: () => "'{}'" })
  detectedTasks: ModelTask[];

  /** Overrides `detectedTasks` while set. Never empty. */
  @Column({ type: 'varchar', length: 32, array: true, nullable: true })
  assignedTasks: ModelTask[] | null;

  @Column({ type: 'jsonb', nullable: true })
  licence: ModelLicence | null;

  @Column({ type: 'varchar', length: 16, array: true, nullable: true })
  modalities: ProjectorModality[] | null;

  @Column({ type: 'int8', transformer: new ColumnNumericTransformer() })
  sizeBytes: number;

  @Column({ type: 'int4' })
  shardCount: number;

  /** Set once, by the first scan to find it: a GGUF's own name where it has one, else the file's stem. */
  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  displayName: string | null;

  @Column({ type: 'jsonb', nullable: true })
  ggufMetadata: GgufMetadata | null;

  @Column({ type: 'jsonb', nullable: true })
  safetensorsMetadata: SafetensorsMetadata | null;

  @OneToMany(() => Availability, availability => availability.model)
  availability?: Relation<Availability[]>;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;

  /** A message identifying a file on a node takes `name` instead. */
  get label(): string {
    return this.displayName ?? this.name;
  }

  /** Empty means unknown, which admits every operation the model's backend serves. */
  get tasks(): ModelTask[] {
    return this.assignedTasks ?? this.detectedTasks;
  }

  get architecture(): string | null {
    return this.ggufMetadata?.architecture ?? this.safetensorsMetadata?.architecture ?? null;
  }
}
