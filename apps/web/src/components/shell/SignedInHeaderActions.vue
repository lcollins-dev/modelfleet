<template>
  <mf-telemetry-tag v-if="userStore.hasRole(UserRoleId.SYSTEM_ADMIN)" class="max-sm:hidden" />

  <notifications-menu />

  <theme-toggle />

  <user-menu
    v-if="userStore.profile !== null"
    :name="userStore.profile.name"
    :email="userStore.profile.email"
    :items="userMenuItems"
    @select="onUserMenuSelect"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import IconKey from '~icons/material-symbols/key-outline-rounded';
import IconLogout from '~icons/material-symbols/logout-rounded';
import IconManageAccounts from '~icons/material-symbols/manage-accounts-outline-rounded';

import { UserRoleId } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { MfTelemetryTag } from '@/components/mf';
import NotificationsMenu from '@/components/notifications/NotificationsMenu.vue';
import { IMenuItem } from '@/components/ui';

import ThemeToggle from './ThemeToggle.vue';
import UserMenu from './UserMenu.vue';

const MENU_ITEM_PATHS: Record<string, string> = {
  profile: '/edit-profile',
  'api-keys': '/api-keys',
};

const logService = useLogService();
const logger = logService.createLogger('components/shell/SignedInHeaderActions');

const router = useRouter();

const notificationStore = useNotificationStore();
const userStore = useUserStore();
const userService = useUserService();

const userMenuItems = computed<IMenuItem[]>(() => [
  { key: 'profile', label: 'Profile & security', icon: IconManageAccounts },
  ...(userStore.hasRole(UserRoleId.SYSTEM_ADMIN) ? [{ key: 'api-keys', label: 'API keys', icon: IconKey }] : []),
  { key: 'sign-out', label: 'Sign out', icon: IconLogout },
]);

const signOut = () => {
  userService
    .logout()
    .then(() => {
      notificationStore.addToast('Signed out', 'Your API keys keep working.');
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'signOut(): Sign out failed');
    });
};

const onUserMenuSelect = (key: string) => {
  if (key === 'sign-out') {
    signOut();
    return;
  }

  router.push(MENU_ITEM_PATHS[key]).catch((error: unknown) => {
    logger.error({ error }, 'onUserMenuSelect(): Failed to navigate');
  });
};
</script>
