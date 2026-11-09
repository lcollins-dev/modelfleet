import { NavigationFailureType, NavigationGuardWithThis, NavigationHookAfter, isNavigationFailure } from 'vue-router';

import { useLogService } from '@/services/LogService';

import { isTransientStepBack } from './transient';

const logService = useLogService();
const logger = logService.createLogger('router/middleware/log');

export const logMiddleware: NavigationGuardWithThis<undefined> = to => {
  logger.info({ fullPath: to.fullPath, meta: to.meta }, 'logMiddleware(): Navigating to page');
};

export const logNavigationFailure: NavigationHookAfter = (to, from, failure) => {
  if (!isNavigationFailure(failure)) {
    return;
  }

  if (isNavigationFailure(failure, NavigationFailureType.aborted) && isTransientStepBack(to)) {
    return;
  }

  logger.warn(
    { to: to.fullPath, from: from.fullPath, type: NavigationFailureType[failure.type] },
    'logNavigationFailure(): Navigation did not complete'
  );
};
