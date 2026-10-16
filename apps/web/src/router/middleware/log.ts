import { NavigationGuardWithThis } from 'vue-router';

import { useLogService } from '@/services/LogService';

const logService = useLogService();
const logger = logService.createLogger('router/middleware/log');

export const logMiddleware: NavigationGuardWithThis<undefined> = to => {
  logger.info({ fullPath: to.fullPath, meta: to.meta }, 'logMiddleware(): Navigating to page');
};
