import { Entity, Column, PrimaryColumn } from 'typeorm';

import { UserRoleId } from '@libs/dto';

@Entity()
export class UserRole {
  constructor(id: UserRoleId, name: string) {
    this.id = id;
    this.name = name;
  }

  @PrimaryColumn({ type: 'int4' })
  id: UserRoleId;

  @Column({ type: 'varchar', length: 64 })
  name: string;
}
