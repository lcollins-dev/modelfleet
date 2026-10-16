<template>
  <ui-page-container>
    <ui-page-heading v-if="user" :title="user.name" back-to="/users" back-label="Users">
      <template #leading>
        <user-avatar :user="user" size="lg" />
      </template>

      <template #subtitle>
        <span data-testid="user-email">{{ user.email }}</span>
      </template>

      <div class="flex gap-1.5">
        <user-access-tag :user-role-ids="user.userRoleIds" />
        <ui-tag :type="user.enabled ? 'success' : 'error'" data-testid="user-state">
          {{ user.enabled ? 'Enabled' : 'Disabled' }}
        </ui-tag>
      </div>
    </ui-page-heading>

    <ui-back-link v-else to="/users" label="Users" />

    <div v-if="loadingUser && !user" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!user">
      <ui-empty>Could not load this user.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-card title="Details">
        <ui-stat-grid>
          <ui-stat label="Last sign-in">
            <div class="font-mono">{{ formatOptional(user.lastLoginSuccess) }}</div>
            <div class="mt-0.5 text-xs text-muted">
              {{
                user.lastLoginFail ? `Failed attempt ${formatRelativeDate(user.lastLoginFail)}` : 'No failed attempts'
              }}
            </div>
          </ui-stat>

          <ui-stat label="Last active">
            <div class="font-mono">{{ formatDateTime(user.lastAccess) }}</div>
            <div class="mt-0.5 text-xs text-muted">{{ formatRelativeDate(user.lastAccess) }}</div>
          </ui-stat>

          <ui-stat label="Created">
            <div class="font-mono">{{ formatDateTime(user.createdDate) }}</div>
            <div class="mt-0.5 text-xs text-muted">ID {{ user.id }}</div>
          </ui-stat>
        </ui-stat-grid>
      </ui-card>

      <ui-form :name="PROFILE_FORM" layout="row" align="end" @submit="doSaveProfile">
        <ui-card title="Profile" subtitle="Who they are and what they can do." rows>
          <ui-form-field v-slot="{ input }" label="Name" help="Shown in the header and the event log." path="name">
            <div class="w-100 max-w-full">
              <ui-input
                v-model:value="name"
                v-bind="input"
                name="display-name"
                autocomplete="off"
                placeholder="Their name"
                :disabled="pending === 'profile'"
              />
            </div>
          </ui-form-field>

          <ui-form-field v-slot="{ input }" label="Email" help="Used to sign in." path="email">
            <div class="w-100 max-w-full">
              <ui-input
                v-model:value="email"
                v-bind="input"
                type="email"
                name="email"
                autocomplete="off"
                :disabled="pending === 'profile'"
              />
            </div>
          </ui-form-field>

          <ui-form-field
            v-slot="{ input }"
            label="Roles"
            help="Each role opens part of the console to them. With none, they only call deployments."
            path="userRoleIds"
          >
            <div class="w-100 max-w-full">
              <role-select v-model:value="roleIds" v-bind="input" name="roles" :disabled="pending === 'profile'" />
            </div>
          </ui-form-field>

          <template #footer>
            <ui-button
              type="primary"
              native-type="submit"
              :disabled="!profileChanged || blockedBy('profile')"
              :loading="pending === 'profile'"
            >
              Save
            </ui-button>
          </template>
        </ui-card>
      </ui-form>

      <ui-form :name="PASSWORD_FORM" layout="row" align="end" @submit="doSetPassword">
        <ui-card title="Password" subtitle="Setting a new one signs them out everywhere." rows>
          <ui-form-field v-slot="{ input }" label="New password" :help="PASSWORD_HELP" path="password">
            <div class="w-100 max-w-full">
              <ui-input
                v-model:value="newPassword"
                v-bind="input"
                type="password"
                name="new-password"
                autocomplete="new-password"
                placeholder="New password"
                :disabled="pending === 'password'"
              />
            </div>
          </ui-form-field>

          <ui-form-field v-slot="{ input }" label="Confirm password" path="confirmPassword">
            <div class="w-100 max-w-full">
              <ui-input
                v-model:value="confirmPassword"
                v-bind="input"
                type="password"
                name="confirm-password"
                autocomplete="new-password"
                placeholder="Enter it again"
                :disabled="pending === 'password'"
              />
            </div>
          </ui-form-field>

          <template #footer>
            <ui-button
              type="primary"
              native-type="submit"
              :disabled="blockedBy('password')"
              :loading="pending === 'password'"
            >
              Set Password
            </ui-button>
          </template>
        </ui-card>
      </ui-form>

      <ui-card title="Access" subtitle="Whether they can sign in." rows>
        <ui-form-field
          v-slot="{ input }"
          layout="row"
          align="end"
          :label="user.enabled ? 'Disable account' : 'Enable account'"
          :help="stateHelp"
        >
          <ui-button
            v-bind="input"
            :disabled="blockedBy('state')"
            :loading="pending === 'state'"
            @click="doToggleEnabled"
          >
            {{ user.enabled ? 'Disable' : 'Enable' }}
          </ui-button>
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          layout="row"
          align="end"
          label="Sign out everywhere"
          help="Ends every session they have. They can sign in again straight away."
        >
          <ui-button
            v-bind="input"
            :disabled="blockedBy('sessions')"
            :loading="pending === 'sessions'"
            @click="doSignOutEverywhere"
          >
            Sign Out
          </ui-button>
        </ui-form-field>
      </ui-card>

      <ui-card
        v-if="canReadEvents"
        title="Recent activity"
        subtitle="What they did, newest first."
        flush
        data-testid="activity-card"
      >
        <template #header-extra>
          <ui-button to="/events">
            <template #icon>
              <icon-arrow-forward class="size-4" />
            </template>
            Open event log
          </ui-button>
        </template>

        <mf-event-table
          :events="activity"
          :columns="ACTIVITY_COLUMNS"
          :loading="loadingActivity"
          empty-description="Nothing they did has been recorded yet."
        />

        <template v-if="activityPages > 1" #footer>
          <ui-pagination v-model:page="activityPage" :page-count="activityPages" />
        </template>
      </ui-card>
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import IconArrowForward from '~icons/material-symbols/arrow-forward-rounded';

import type { EventFilterRequestDto, UpdateUserRequestDto } from '@libs/dto';
import { EventPartyType, UserRoleId } from '@libs/dto';

import { DialogType, IDialogOptions } from '@/types/dialog';

import { formatDateTime, formatRelativeDate } from '@/utils/format/date';
import { PASSWORD_HELP, passwordMismatchError } from '@/utils/password';

import { useLogService } from '@/services/LogService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useUserAdminService } from '@/services/api/admin/UserAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { EventTableColumn, MfEventTable } from '@/components/mf';
import {
  UiBackLink,
  UiButton,
  UiCard,
  UiEmpty,
  UiForm,
  UiFormField,
  UiInput,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiSpinner,
  UiStat,
  UiStatGrid,
  UiTag,
} from '@/components/ui';
import RoleSelect from '@/components/user/RoleSelect.vue';
import UserAccessTag from '@/components/user/UserAccessTag.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';

import { usePagedList } from '@/composables/usePagedList';
import { useResource } from '@/composables/useResource';

type Action = 'profile' | 'password' | 'state' | 'sessions';

const PROFILE_FORM = 'user-profile';
const PASSWORD_FORM = 'user-password';

const ACTIVITY_COLUMNS: EventTableColumn[] = ['when', 'event', 'summary', 'subject'];

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/users/User');

const route = useRoute();

const dialogStore = useDialogStore();
const errorStore = useErrorStore();
const notificationStore = useNotificationStore();
const userStore = useUserStore();
const adminUserService = useUserAdminService();
const eventAdminService = useEventAdminService();

const userId = computed(() => (typeof route.params.userId === 'string' ? parseInt(route.params.userId, 10) : null));

const {
  data: user,
  loading: loadingUser,
  reload: reloadUser,
} = useResource({
  request: userId,
  fetch: (targetId: number) => adminUserService.getUser(targetId),
});

// The event log answers system admins only, and this page needs only the user admin role.
const canReadEvents = computed(() => userStore.hasRole(UserRoleId.SYSTEM_ADMIN));

const activityRequest = computed<EventFilterRequestDto | null>(() =>
  userId.value === null || !canReadEvents.value ? null : { actorType: EventPartyType.USER, actorId: `${userId.value}` }
);

const {
  list: activity,
  page: activityPage,
  pages: activityPages,
  loading: loadingActivity,
} = usePagedList({
  request: activityRequest,
  debounceRequest: false,
  fetch: (request, page) =>
    eventAdminService
      .getEventList(request, page)
      .then(response => ({ list: response.eventList, pages: response.pages })),
});

const name = ref('');
const email = ref('');
const roleIds = ref<UserRoleId[]>([]);

const newPassword = ref('');
const confirmPassword = ref('');

// One action at a time, so each request is built from the user the previous one reloaded.
const pending = ref<Action | null>(null);

const profileChanged = computed(() => {
  if (user.value === null) {
    return false;
  }

  const sortedJoin = (ids: number[]) => [...ids].sort((first, second) => first - second).join();

  return (
    name.value !== user.value.name ||
    email.value !== user.value.email ||
    sortedJoin(roleIds.value) !== sortedJoin(user.value.userRoleIds)
  );
});

const stateHelp = computed(() =>
  user.value?.enabled === true
    ? 'Signs them out everywhere and stops them signing in. Nothing is deleted, so you can enable them again.'
    : "They can't sign in. Enable the account to let them back in."
);

const formatOptional = (date: Date | null): string => (date === null ? 'Never' : formatDateTime(date));

const blockedBy = (action: Action) => pending.value !== null && pending.value !== action;

const fillProfile = () => {
  name.value = user.value?.name ?? '';
  email.value = user.value?.email ?? '';
  roleIds.value = [...(user.value?.userRoleIds ?? [])];
};

// Filled once per user, so a reload after a state change keeps unsaved edits.
watch(() => user.value?.id, fillProfile, { immediate: true });

const runAction = (action: Action, request: () => Promise<void>, failure: string) => {
  pending.value = action;

  request()
    .finally(() => {
      pending.value = null;
    })
    .catch((error: unknown) => {
      logger.error({ error }, failure);
    });
};

// The dialog's action holds the one pending action, so the page's other buttons wait for it.
const confirmAction = (action: Action, options: Omit<IDialogOptions, 'action'>, request: () => Promise<void>) => {
  void dialogStore.confirm({
    ...options,
    action: async () => {
      pending.value = action;

      try {
        await request();
      } finally {
        pending.value = null;
      }
    },
  });
};

const doSaveProfile = () => {
  if (user.value === null || pending.value !== null || !profileChanged.value) {
    return;
  }

  const target = user.value;
  const updateUserRequest: UpdateUserRequestDto = {
    name: name.value,
    email: email.value,
    userRoleIds: roleIds.value,
  };

  runAction(
    'profile',
    async () => {
      await adminUserService.updateUser(updateUserRequest, target.id, PROFILE_FORM);
      notificationStore.addToast('Profile updated', `${updateUserRequest.name}'s details have been saved.`);
      await reloadUser();
      fillProfile();
    },
    'doSaveProfile(): Failed to update the profile'
  );
};

const doSetPassword = () => {
  if (user.value === null || pending.value !== null) {
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    errorStore.setValidationError(passwordMismatchError(PASSWORD_FORM));
    return;
  }

  // A request clears the last refusal, but the confirm dialog shows before it.
  errorStore.clearValidationError();

  const target = user.value;
  const updateUserRequest: UpdateUserRequestDto = {
    name: target.name,
    email: target.email,
    userRoleIds: target.userRoleIds,
    password: newPassword.value,
  };

  // Confirmed before the request, so a refused password shows under its field rather than behind the dialog.
  dialogStore
    .confirm({
      type: DialogType.WARNING,
      title: `Set a new password for ${target.name}?`,
      message: "Their current password stops working, and they're signed out everywhere.",
      confirmLabel: 'Set Password',
    })
    .then(confirmed => {
      if (!confirmed) {
        return;
      }

      runAction(
        'password',
        async () => {
          await adminUserService.updateUser(updateUserRequest, target.id, PASSWORD_FORM);
          newPassword.value = '';
          confirmPassword.value = '';
          notificationStore.addToast('Password set', `${target.name} signs in with the new password from now on.`);
        },
        'doSetPassword(): Failed to set the password'
      );
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSetPassword(): Failed to confirm the password');
    });
};

const doToggleEnabled = () => {
  if (user.value === null || pending.value !== null) {
    return;
  }

  const target = user.value;

  if (!target.enabled) {
    runAction(
      'state',
      async () => {
        await adminUserService.updateState({ enabled: true }, target.id);
        notificationStore.addToast('Account enabled', `${target.name} can sign in again.`);
        await reloadUser();
      },
      'doToggleEnabled(): Failed to enable the account'
    );
    return;
  }

  confirmAction(
    'state',
    {
      type: DialogType.WARNING,
      title: `Disable ${target.name}?`,
      message: "They're signed out everywhere and can't sign in until you enable the account again.",
      confirmLabel: 'Disable Account',
    },
    async () => {
      await adminUserService.updateState({ enabled: false }, target.id);
      notificationStore.addToast('Account disabled', `${target.name} has been signed out everywhere.`);
      await reloadUser();
    }
  );
};

const doSignOutEverywhere = () => {
  if (user.value === null || pending.value !== null) {
    return;
  }

  const target = user.value;

  confirmAction(
    'sessions',
    {
      type: DialogType.WARNING,
      title: `Sign ${target.name} out everywhere?`,
      message: 'Every session they have ends. They can sign in again straight away.',
      confirmLabel: 'Sign Out Everywhere',
    },
    async () => {
      await adminUserService.logoutAllSessions(target.id);
      notificationStore.addToast('Signed out everywhere', `${target.name} has to sign in again.`);
    }
  );
};
</script>
