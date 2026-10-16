import { Controller, Get } from '@nestjs/common';

import { NoAuth } from '@/api/v1/user/decorators/no-auth.decorator';

import { ConfigService } from '@/config/config.service';

@NoAuth()
@Controller('api/v1/version')
export class VersionController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getVersion(): { version: string } {
    return {
      version: this.configService.version,
    };
  }
}
