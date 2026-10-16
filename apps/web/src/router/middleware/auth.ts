import { WatchHandle, watch } from 'vue';
import { NavigationGuardWithThis, RouteLocationRaw, useRouter } from 'vue-router';

import { RETURN_PATH_PARAM, SIGN_IN_PATH, signInReturnPath } from '@/utils/signInReturnPath';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useUserStore } from '@/stores/user';

const logService = useLogService();
const logger = logService.createLogger('router/middleware/auth');

export const HOME_PATH = '/dashboard';

export const NOT_FOUND_ROUTE = 'not-found';

const SETUP_PATH = '/setup';

let userWatcher: WatchHandle | null = null;

export const authMiddleware: NavigationGuardWithThis<undefined> = async to => {
  // Shown at the requested URL, so a signed-in user without the role cannot tell the page exists.
  const notFound: RouteLocationRaw = {
    name: NOT_FOUND_ROUTE,
    params: { pathMatch: to.path.substring(1).split('/') },
    query: to.query,
    hash: to.hash,
  };

  const router = useRouter();

  const userStore = useUserStore();
  const userService = useUserService();

  // Off after a deliberate sign-out, here or in another tab, so the next person to sign in starts at home.
  const doRedirect = (carryReturnPath: boolean) => {
    if (to.meta.requiresAuthState === 'loggedin' || to.meta.requiresRoleId !== undefined) {
      if (!userStore.loggedIn) {
        logger.info('doRedirect(): User must be logged in, redirecting to sign in page');
        const keepPath = carryReturnPath && to.path !== HOME_PATH;

        return { path: SIGN_IN_PATH, query: keepPath ? { [RETURN_PATH_PARAM]: to.fullPath } : {} };
      }

      // The api refuses everything else until the account has its own password.
      const mustChangePassword = userStore.profile?.mustChangePassword === true;

      if (mustChangePassword && to.path !== SETUP_PATH) {
        logger.info('doRedirect(): User must finish first-time setup');
        return SETUP_PATH;
      }

      if (!mustChangePassword && to.path === SETUP_PATH) {
        return HOME_PATH;
      }

      if (to.meta.requiresRoleId !== undefined) {
        const requiresRoleIds = Array.isArray(to.meta.requiresRoleId)
          ? to.meta.requiresRoleId
          : [to.meta.requiresRoleId];

        if (!userStore.hasRole(...requiresRoleIds)) {
          logger.info("doRedirect(): User doesn't have required role");
          return notFound;
        }
      }
    } else if (to.meta.requiresAuthState === 'loggedout' && userStore.loggedIn) {
      logger.info("doRedirect(): User isn't logged out, redirecting home");
      return signInReturnPath(to.query) ?? HOME_PATH;
    }
  };

  if (userStore.loggedIn) {
    await userService.getProfile().catch((error: unknown) => {
      logger.error({ error }, 'authMiddleware(): Failed to get profile');
    });
  }

  if (userWatcher !== null) {
    userWatcher.stop();
    userWatcher = null;
  }

  const newRoute = doRedirect(true);

  if (newRoute === undefined) {
    userWatcher = watch(
      () => userStore.token,
      () => {
        const newRoute = doRedirect(userStore.sessionEnded);

        if (newRoute !== undefined) {
          router.replace(newRoute).catch((error: unknown) => {
            logger.error({ error }, 'authMiddleware(): Failed to navigate to page');
          });
        }
      }
    );
  }

  return newRoute;
};
