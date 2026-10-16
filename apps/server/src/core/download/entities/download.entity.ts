import { randomUUID } from 'node:crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

import { DownloadSource } from '@libs/dto';

import { User } from '../../user/entities/user.entity';
import { DownloadFile } from './download-file.entity';
import { DownloadTarget } from './download-target.entity';

/** Named files from one repository at one commit, asked of one or more nodes. It knows nothing of models. */
@Entity()
export class Download {
  constructor(fields: {
    source: DownloadSource;
    repository: string;
    directory: string;
    revision: string;
    createdById: number | null;
  }) {
    this.downloadKey = randomUUID();
    this.source = fields.source;
    this.repository = fields.repository;
    this.directory = fields.directory;
    this.revision = fields.revision;
    this.createdById = fields.createdById;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'uuid', unique: true })
  downloadKey: string;

  @Column({ type: 'varchar', length: 32 })
  source: DownloadSource;

  @Column({ type: 'varchar', length: 193 })
  repository: string;

  /** Relative to each node's first model directory. */
  @Column({ type: 'varchar', length: 256 })
  directory: string;

  /** A full commit id, whatever revision the operator named. */
  @Column({ type: 'varchar', length: 40 })
  revision: string;

  @Column({ type: 'int4', nullable: true })
  createdById: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy?: Relation<User>;

  @OneToMany(() => DownloadFile, file => file.download)
  files?: Relation<DownloadFile[]>;

  @OneToMany(() => DownloadTarget, target => target.download)
  targets?: Relation<DownloadTarget[]>;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
