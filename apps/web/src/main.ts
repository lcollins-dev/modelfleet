import { createPinia } from 'pinia';
import { createApp } from 'vue';
import VueDOMPurifyHTML from 'vue-dompurify-html';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/ubuntu-mono/400.css';
import './assets/css/main.css';

import { useErrorStore } from './stores/error';
import { useLogService } from '@/services/LogService';

import App from './App.vue';
import { router } from './router';

const logService = useLogService();
const logger = logService.createLogger('main');

const pinia = createPinia();
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const app = createApp(App);

app.use(pinia);
app.use(router);

app.use(VueDOMPurifyHTML, {
  default: {
    USE_PROFILES: { html: true },
  },
});

app.config.errorHandler = error => {
  const errorStore = useErrorStore();

  errorStore.setVueError(error);

  router.push('/error').catch((error: unknown) => {
    logger.error({ error }, 'errorHandler(): Failed to navigate to error page');
  });
};

// Mount once the first route resolves, so the layout never renders for a route the auth middleware is about to leave.
router
  .isReady()
  .finally(() => {
    app.mount('#app');
  })
  .catch((error: unknown) => {
    logger.error({ error }, 'main(): Failed to resolve the first route');
  });
