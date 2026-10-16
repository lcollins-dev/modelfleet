import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inspect } from 'node:util';

import { PROTOCOL_VERSION } from '@libs/agent-protocol';
import { ConfigError, ExitCode } from '@libs/runtime';

import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { DockerSocketError } from './docker/docker-socket.service';
import { ServerTransport } from './server/server.transport';

const logger = new Logger('main');

function untilShutdown(): Promise<NodeJS.Signals> {
  return new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
}

async function bootstrap() {
  // Nest exits the process itself on a provider that throws unless this is off, which would take
  // the bootstrap error handling below with it.
  const app = await NestFactory.create(AppModule, { abortOnError: false });

  const configService = app.get(ConfigService);
  logger.debug({ config: configService.loggable }, 'bootstrap(): Agent config');

  // The adapter is never listened on; the agent serves no HTTP.
  app.connectMicroservice({ strategy: app.get(ServerTransport) });

  app.enableShutdownHooks();

  await app.init();
  await app.startAllMicroservices();

  logger.log(`bootstrap(): Agent started, speaking protocol version ${PROTOCOL_VERSION}`);

  const signal = await untilShutdown();
  logger.log(`bootstrap(): Received ${signal}, stopping`);

  await app.close();
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    logger.error(`bootstrap(): Configuration rejected. ${error.message}`);
    process.exit(ExitCode.CONFIG);
  }

  if (error instanceof DockerSocketError) {
    logger.error(`bootstrap(): ${error.message}`);
    process.exit(ExitCode.OS_FILE);
  }

  logger.error(`bootstrap(): Agent bootstrap failed. ${inspect(error)}`);
  process.exit(ExitCode.FAILURE);
});
