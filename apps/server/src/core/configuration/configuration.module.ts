import { Module } from '@nestjs/common';

import { ConfigurationRevisionService } from './configuration-revision.service';
import { ConfigurationValueService } from './configuration-value.service';
import { ConfigurationService } from './configuration.service';
import { EffectiveConfigurationService } from './effective-configuration.service';

@Module({
  providers: [
    ConfigurationRevisionService,
    ConfigurationService,
    ConfigurationValueService,
    EffectiveConfigurationService,
  ],
  exports: [
    ConfigurationRevisionService,
    ConfigurationService,
    ConfigurationValueService,
    EffectiveConfigurationService,
  ],
})
export class ConfigurationModule {}
