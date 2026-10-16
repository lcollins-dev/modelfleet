import { HttpStatus } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Express, NextFunction, Request, Response, json } from 'express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Server, createServer } from 'node:http';
import { initializeTransactionalContext } from 'typeorm-transactional';

import { BackendErrorType, backendError } from '@libs/backends/openai';

import { ConfigService } from './config/config.service';
import { GatewayListenerService } from './gateway/gateway-listener.service';

import { AppModule } from './app.module';

import { parseAgentMessage } from './core/agent/agent-message-parser';
import { AgentWsAdapter } from './core/agent/agent-ws.adapter';
import { EntryPoint, IEntryPointRequest } from './entry-point/entry-point';
import { RequestExceptionFilter } from './entry-point/request-exception.filter';
import { GATEWAY_PATH_PREFIX } from './gateway/gateway-routes';

export const createApp = async (): Promise<NestExpressApplication> => {
  initializeTransactionalContext();

  // Nest exits the process itself on a provider that throws unless this is off, which would take
  // the bootstrap error handling in main.ts with it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    abortOnError: false,
    // A shutdown waits on the listener closing, which an open event stream would otherwise hold off for good.
    forceCloseConnections: true,
  });
  app.useLogger(app.get(PinoLogger));

  app.useWebSocketAdapter(new AgentWsAdapter(app, { messageParser: parseAgentMessage }));

  return app;
};

export const applyGlobalMiddleware = (app: NestExpressApplication): void => {
  const configService = app.get(ConfigService);

  // The address throttles key on req.ip, which names the proxy rather than the client unless the proxy is trusted.
  app.set('trust proxy', configService.trustProxy);

  // Both listeners share this Express instance, so the management API is kept off the gateway's port here, and the
  // inference routes off the other.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const stamped: IEntryPointRequest = request;

    stamped.entryPoint ??= EntryPoint.MANAGEMENT;

    const onGateway = stamped.entryPoint === EntryPoint.GATEWAY;
    const path = request.path.toLowerCase();
    const inferencePath = path === GATEWAY_PATH_PREFIX || path.startsWith(`${GATEWAY_PATH_PREFIX}/`);

    if (onGateway === inferencePath) {
      next();

      return;
    }

    response
      .status(HttpStatus.NOT_FOUND)
      .json(
        onGateway
          ? backendError(BackendErrorType.NOT_FOUND, `This port serves ${GATEWAY_PATH_PREFIX} inference routes alone.`)
          : { statusCode: HttpStatus.NOT_FOUND, message: 'Not Found' }
      );
  });

  // Registered before Nest's own parser, so an inference body is read to the gateway's limit rather than the API's.
  app.use(GATEWAY_PATH_PREFIX, json({ limit: configService.gatewayRequestMaxSizeJson }));

  app.use(helmet());
  app.useBodyParser('json', { limit: configService.requestMaxSizeJson });

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.useGlobalFilters(new RequestExceptionFilter(httpAdapter));
};

/** A second socket over the same Express instance, stamping each request so the global policies can tell them apart. */
export const listenGateway = (app: NestExpressApplication, port: number): Promise<Server> => {
  const handler = app.get(HttpAdapterHost).httpAdapter.getInstance<Express>();

  const server = createServer((request, response) => {
    const stamped: IEntryPointRequest = request;

    stamped.entryPoint = EntryPoint.GATEWAY;

    handler(request, response);
  });

  app.get(GatewayListenerService).hold(server);

  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
};
