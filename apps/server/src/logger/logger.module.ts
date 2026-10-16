import { Module, Global } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { join } from 'path';
import pino from 'pino';
import { Options as PinoHttpOptions } from 'pino-http';
import { v4 as uuidv4 } from 'uuid';

import { ConfigService } from '../config/config.service';

import { serializeError, serializeReceivedRequest } from '@/logger/log-serializers';
import { IPinoRfsOptions } from '@/logger/transports/pino-rfs';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Split out our base logger to avoid duplicate transports
        const logger = pino({
          // Logs outside a request skip pino-http's serializers. Nest's Logger files an error under `err`, ours `error`.
          serializers: { err: serializeError, error: serializeError },
          transport: {
            targets: [
              {
                target: configService.logStdoutPretty ? 'pino-pretty' : 'pino/file',
                level: configService.logStdoutLevel,
              },
              configService.logFilePath !== ''
                ? {
                    target: join(__dirname, 'transports/pino-rfs.js'),
                    level: configService.logFileLevel,
                    options: {
                      filename: configService.logFileName,
                      pretty: configService.logFilePretty,
                      path: configService.logFilePath,
                      interval: configService.logFileRotateInterval,
                      size: configService.logFileRotateMaxSize,
                      maxFiles: configService.logFileRotateMaxFiles,
                    } satisfies IPinoRfsOptions,
                  }
                : undefined,
            ].filter(entry => entry !== undefined),
          },
        });

        const pinoHttp: PinoHttpOptions = {
          logger,
          genReqId: () => uuidv4(),
          customReceivedMessage: () => 'Request received',
          customReceivedObject: req => ({ request: serializeReceivedRequest(req), accessLog: true }),
          customSuccessMessage: () => 'Request success',
          customSuccessObject: (_req, res) => ({ response: res, accessLog: true }),
          customErrorMessage: () => 'Request error',
          customErrorObject: (_req, res) => ({ response: res, accessLog: true }),
          customProps: req => ({ correlationId: req.id }),
          mixin(_context, level) {
            return { levelLabel: logger.levels.labels[level] };
          },
          serializers: {
            req: () => undefined,
            error: serializeError,
          },
          customAttributeKeys: {
            res: 'response',
            err: 'error',
          },
          redact: {
            // Must match the key `customReceivedObject` logs the request under, since a missed path redacts nothing.
            paths: ['request.headers.authorization', 'request.headers["x-api-key"]', 'request.headers["api-key"]'],
          },
        };

        return {
          pinoHttp,
        };
      },
    }),
  ],
})
export class LoggerModule {}
