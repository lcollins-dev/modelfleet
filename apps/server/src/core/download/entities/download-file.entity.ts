import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import { DownloadDigestAlgorithm } from '@libs/agent-protocol';

import { Download } from './download.entity';

import { ColumnNumericTransformer } from '@/common/transformers/ColumnNumericTransformer';

/** A file as the source recorded it at the download's commit, which is what a node checks what it wrote against. */
@Entity()
export class DownloadFile {
  constructor(fields: {
    downloadId: number;
    position: number;
    path: string;
    sizeBytes: number;
    digestAlgorithm: DownloadDigestAlgorithm;
    digest: string;
  }) {
    this.downloadId = fields.downloadId;
    this.position = fields.position;
    this.path = fields.path;
    this.sizeBytes = fields.sizeBytes;
    this.digestAlgorithm = fields.digestAlgorithm;
    this.digest = fields.digest;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  downloadId: number;

  @ManyToOne(() => Download, download => download.files, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'downloadId' })
  download?: Relation<Download>;

  @Column({ type: 'int4' })
  position: number;

  /** Relative to the repository, and so to the directory the node writes the repository into. */
  @Column({ type: 'varchar', length: 512 })
  path: string;

  @Column({ type: 'int8', transformer: new ColumnNumericTransformer() })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 16 })
  digestAlgorithm: DownloadDigestAlgorithm;

  @Column({ type: 'varchar', length: 64 })
  digest: string;
}
