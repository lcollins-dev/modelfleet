import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { BackendId } from '@libs/backends';
import { ConfigurationDocument } from '@libs/dto';

/** A reusable configuration bundle, naming neither a model nor a deployment name, that many deployments apply. */
@Entity()
export class Preset {
  constructor(fields: {
    name: string;
    description: string | null;
    backend: BackendId;
    schemaVersion: number;
    document: string;
    configuration: ConfigurationDocument;
  }) {
    this.name = fields.name;
    this.description = fields.description;
    this.backend = fields.backend;
    this.schemaVersion = fields.schemaVersion;
    this.document = fields.document;
    this.configuration = fields.configuration;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  /** Unique across the fleet, compared without case. */
  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  /** Fixed at creation; it selects the declaration every other key is validated against. */
  @Column({ type: 'varchar', length: 32 })
  backend: BackendId;

  @Column({ type: 'int4' })
  schemaVersion: number;

  /** The YAML as authored, comments and key order intact. */
  @Column({ type: 'text' })
  document: string;

  /** Derived from `document` in the same write. */
  @Column({ type: 'jsonb' })
  configuration: ConfigurationDocument;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedDate!: Date;
}
