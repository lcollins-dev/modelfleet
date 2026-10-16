import pino from 'pino';

import { serializeError } from '@/utils/serializeError';

const logger = pino({
  browser: {
    serialize: true,
    formatters: {
      level(label, number) {
        return { level: number, levelLabel: label };
      },
    },
  },
  errorKey: 'error',
  serializers: {
    error: serializeError,
  },
});

export const useLogService = () => {
  function createLogger(context: string) {
    return logger.child({ context });
  }

  return { createLogger };
};
