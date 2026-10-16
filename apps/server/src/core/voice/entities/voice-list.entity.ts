import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, Relation } from 'typeorm';

import { IVoice } from '@libs/backends';

import { Deployment } from '../../deployment/entities/deployment.entity';

/** Written only from an instance launched on `configurationRevision`. */
@Entity()
export class VoiceList {
  constructor(fields: { deploymentId: number; configurationRevision: string; voices: IVoice[] }) {
    this.deploymentId = fields.deploymentId;
    this.configurationRevision = fields.configurationRevision;
    this.voices = fields.voices;
  }

  @PrimaryColumn({ type: 'int4' })
  deploymentId: number;

  @OneToOne(() => Deployment, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'deploymentId' })
  deployment?: Relation<Deployment>;

  @Column({ type: 'varchar', length: 64 })
  configurationRevision: string;

  @Column({ type: 'jsonb' })
  voices: IVoice[];
}
