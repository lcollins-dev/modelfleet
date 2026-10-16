import Docker from 'dockerode';

import { ConfigService } from '../config/config.service';

export const DOCKER_CLIENT = Symbol('DOCKER_CLIENT');

export const dockerClientProvider = {
  provide: DOCKER_CLIENT,
  useFactory: (configService: ConfigService): Docker => new Docker({ socketPath: configService.dockerSocketPath }),
  inject: [ConfigService],
};
