import { Controller, Get } from '@nestjs/common';

import { NoAuth } from '@/api/v1/user/decorators/no-auth.decorator';

@NoAuth()
@Controller('api/v1/availability')
export class AvailabilityController {
  @Get()
  getAvailability(): { available: boolean } {
    return {
      available: true,
    };
  }
}
