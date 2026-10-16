import { Module } from '@nestjs/common';

import { ApiKeyGuard } from './api-key.guard';

import { ApiKeyModule } from '@/core/api-key/api-key.module';

/** Re-exports `ApiKeyModule`, since `@UseGuards(ApiKeyGuard)` builds the guard in the mounting module. */
@Module({
  imports: [ApiKeyModule],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard, ApiKeyModule],
})
export class GatewayAuthModule {}
