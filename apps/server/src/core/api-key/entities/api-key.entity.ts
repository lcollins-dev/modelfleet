import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { User } from '@/core/user/entities/user.entity';

/** `userId` is set at issue, so the access epic can bound a key by its owner's grants without backfilling one. */
@Entity()
export class ApiKey {
  constructor(fields: { keyId: string; name: string; secretHash: string; userId: number }) {
    this.keyId = fields.keyId;
    this.name = fields.name;
    this.secretHash = fields.secretHash;
    this.userId = fields.userId;

    this.lastUsedDate = null;
    this.revokedDate = null;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  /** The public half of the credential. It selects the row a presented token is checked against. */
  @Column({ type: 'varchar', length: 32, unique: true })
  keyId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** SHA-256 of the secret half, hex encoded. */
  @Column({ type: 'varchar', length: 64 })
  secretHash: string;

  @Column({ type: 'int4' })
  userId: number;

  /** Stamped no more often than `LAST_USED_STAMP_INTERVAL_MS`, so verification stays a read. */
  @Column({ type: 'timestamp', nullable: true })
  lastUsedDate: Date | null;

  /** Set once and never cleared. A revoked key stays listed for audit. */
  @Column({ type: 'timestamp', nullable: true })
  revokedDate: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdDate!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: Relation<User>;
}
