import { ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';

import { RequestAuthGuard } from './request-auth.guard';
import { AuthGuard } from '@/api/v1/user/guards/auth.guard';
import { IApiKeyRequest } from '@/gateway/auth/api-key.guard';

import { ConfigService } from '@/config/config.service';

import { UserModule } from '@/core/user/user.module';
import { GatewayAuthModule } from '@/gateway/auth/gateway-auth.module';

import { EntryPoint, IEntryPointRequest } from './entry-point';
import { throttlerGuardFor } from './throttler-guard.provider';

const MANAGEMENT_THROTTLER = 'default';
const GATEWAY_ADDRESS_THROTTLER = 'gateway-address';
const GATEWAY_KEY_THROTTLER = 'gateway';

/** Counted before authentication, so a caller that never presents a valid credential is still bounded. */
const ADDRESS_THROTTLERS = [MANAGEMENT_THROTTLER, GATEWAY_ADDRESS_THROTTLER];

/** Counted after authentication, so it keys on a verified key rather than one a caller merely claims. */
const KEY_THROTTLERS = [GATEWAY_KEY_THROTTLER];

/**
 * The policies that differ by entry point, each chosen by the listener that stamped the request. Nest
 * has no module-scoped guard, so every one here is global and dispatches rather than being mounted per
 * controller.
 */
@Module({
  imports: [
    GatewayAuthModule,
    UserModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const onGateway = (context: ExecutionContext): boolean =>
          context.switchToHttp().getRequest<IEntryPointRequest>().entryPoint === EntryPoint.GATEWAY;

        return {
          throttlers: [
            {
              name: MANAGEMENT_THROTTLER,
              ttl: seconds(configService.rateLimitWindowSecs),
              limit: configService.rateLimitMaxRequests,
              skipIf: onGateway,
            },
            {
              name: GATEWAY_ADDRESS_THROTTLER,
              ttl: seconds(configService.gatewayRateLimitWindowSecs),
              limit: configService.gatewayRateLimitMaxRequestsPerAddress,
              skipIf: context => !onGateway(context),
            },
            {
              name: GATEWAY_KEY_THROTTLER,
              ttl: seconds(configService.gatewayRateLimitWindowSecs),
              limit: configService.gatewayRateLimitMaxRequests,
              skipIf: context => !onGateway(context),
              getTracker: (_request, context) =>
                `key:${context.switchToHttp().getRequest<IApiKeyRequest>().apiKey?.id ?? ''}`,
            },
          ],
        };
      },
    }),
  ],
  providers: [
    AuthGuard,
    RequestAuthGuard,

    // Global guards run in the order they are provided, which is what puts authentication between the two throttles.
    throttlerGuardFor(ADDRESS_THROTTLERS),
    { provide: APP_GUARD, useClass: RequestAuthGuard },
    throttlerGuardFor(KEY_THROTTLERS),
  ],
})
export class EntryPointModule {}
