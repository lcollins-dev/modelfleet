import { Provider } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';

/** A global ThrottlerGuard running only the named throttlers, so one set of options can be counted at two points. */
export const throttlerGuardFor = (names: readonly string[]): Provider => ({
  provide: APP_GUARD,
  inject: [getOptionsToken(), getStorageToken(), Reflector],
  useFactory: (options: ThrottlerModuleOptions, storage: ThrottlerStorage, reflector: Reflector) =>
    new ThrottlerGuard(
      (Array.isArray(options) ? options : options.throttlers).filter(throttler => names.includes(throttler.name ?? '')),
      storage,
      reflector
    ),
});
