import { Module } from '@nestjs/common';

import { ApiKeyAdminService } from './api-key-admin.service';

import { ApiKeyAdminController } from './api-key-admin.controller';

import { ApiKeyModule } from '@/core/api-key/api-key.module';

@Module({
  imports: [ApiKeyModule],
  providers: [ApiKeyAdminService],
  controllers: [ApiKeyAdminController],
})
export class ApiKeyApiModule {}
