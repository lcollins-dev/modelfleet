import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApiKey } from './entities/api-key.entity';

import { ApiKeyTokenService } from './api-key-token.service';
import { ApiKeyService } from './api-key.service';

import { EventModule } from '../event/event.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), EventModule, UserModule],
  providers: [ApiKeyService, ApiKeyTokenService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
