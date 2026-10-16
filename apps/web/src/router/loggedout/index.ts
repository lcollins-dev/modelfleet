/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RouteRecordRaw } from 'vue-router';

import SignIn from '@/pages/loggedout/SignIn.vue';

export const loggedOutRoutes: RouteRecordRaw[] = [
  {
    path: '/sign-in',
    component: SignIn,
  },
];
