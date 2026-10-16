/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RouteRecordRaw, createRouter, createWebHistory } from 'vue-router';

import { UserRoleId } from '@libs/dto';

import { Layout } from '@/components/layouts';

import Error from '@/pages/Error.vue';
import PageNotFound from '@/pages/PageNotFound.vue';

import { loggedInRoutes } from './loggedin';
import { loggedOutRoutes } from './loggedout';
import { HOME_PATH, NOT_FOUND_ROUTE, authMiddleware } from './middleware/auth';
import { clearNotificationsErrorMiddleware } from './middleware/clear-notifications-errors';
import { logMiddleware } from './middleware/log';

declare module 'vue-router' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface RouteMeta {
    layout?: Layout;
    /** Widens the minimal layout's column from 24rem to 40rem. */
    wideLayout?: boolean;
    requiresAuthState?: 'loggedin' | 'loggedout';
    requiresRoleId?: UserRoleId[] | UserRoleId;
  }
}

const routes: Readonly<RouteRecordRaw[]> = [
  // Logged out
  ...loggedOutRoutes.map(route => {
    route.meta = route.meta ?? {};
    route.meta.requiresAuthState = 'loggedout';
    route.meta.layout = route.meta.layout ?? Layout.LOGGED_OUT;

    return route;
  }),
  ...loggedInRoutes.map(route => {
    route.meta = route.meta ?? {};
    route.meta.requiresAuthState = 'loggedin';
    route.meta.layout = route.meta.layout ?? Layout.DEFAULT;

    return route;
  }),
  // Base
  {
    path: '/',
    redirect: HOME_PATH,
  },
  {
    path: '/error',
    component: Error,
    meta: {
      layout: Layout.MINIMAL,
      wideLayout: true,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    name: NOT_FOUND_ROUTE,
    component: PageNotFound,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(logMiddleware);
router.beforeEach(clearNotificationsErrorMiddleware);
router.beforeEach(authMiddleware);

export { router };
