import { Entity, PrimaryGeneratedColumn, Column, JoinColumn, ManyToOne, type Relation } from 'typeorm';

import { UserRoleId } from '@libs/dto';

import { UserRole } from './user-role.entity';
import { User } from './user.entity';

@Entity()
export class UserUserRole {
  constructor(userId: number, userRoleId: UserRoleId) {
    this.userId = userId;
    this.userRoleId = userRoleId;
  }

  @PrimaryGeneratedColumn({ type: 'int4' })
  id!: number;

  @Column({ type: 'int4' })
  userId: number;

  @JoinColumn()
  @ManyToOne(() => User, user => user.id)
  user?: Relation<User>;

  @Column({ type: 'int4' })
  userRoleId: UserRoleId;

  @JoinColumn()
  @ManyToOne(() => UserRole, userRole => userRole.id)
  userRole?: Relation<UserRole>;
}
