import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Node {
  constructor(fields: { nodeKey: string; name: string; secretHash: string; description?: string | null }) {
    this.nodeKey = fields.nodeKey;
    this.name = fields.name;
    this.secretHash = fields.secretHash;

    this.description = fields.description ?? null;

    this.enabled = true;

    this.lastSeenDate = null;
    this.agentVersion = null;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'uuid', unique: true })
  nodeKey: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 256 })
  secretHash: string;

  @Column({ type: 'bool' })
  enabled: boolean;

  /** Stamped by every heartbeat. A node's state is read from how long ago this was. */
  @Column({ type: 'timestamp', nullable: true })
  lastSeenDate: Date | null;

  /** Stamped by the handshake alone. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  agentVersion: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;
}
