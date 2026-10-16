<template>
  <ui-page-container>
    <ui-page-heading title="Profile &amp; security" :subtitle="userStore.profile?.email">
      <template #leading>
        <ui-avatar size="lg" round>{{ initial }}</ui-avatar>
      </template>
    </ui-page-heading>

    <ui-form :name="PROFILE_FORM" layout="row" align="end" @submit="doSaveProfile">
      <ui-card title="Profile" rows>
        <ui-form-field v-slot="{ input }" label="Name" help="Shown in the header and the event log." path="name">
          <div class="w-100 max-w-full">
            <ui-input
              v-model:value="name"
              v-bind="input"
              name="display-name"
              autocomplete="name"
              placeholder="Your name"
              :disabled="profileLoading"
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
              autocomplete="email"
              :disabled="profileLoading"
            />
          </div>
        </ui-form-field>

        <template #footer>
          <ui-button type="primary" native-type="submit" :disabled="profileUnchanged" :loading="profileLoading">
            Save
          </ui-button>
        </template>
      </ui-card>
    </ui-form>

    <ui-form :name="PASSWORD_FORM" layout="row" align="end" @submit="doChangePassword">
      <ui-card title="Password" subtitle="Changing it signs you out anywhere else you're signed in." rows>
        <ui-form-field v-slot="{ input }" label="New password" :help="PASSWORD_HELP" path="password">
          <div class="w-100 max-w-full">
            <ui-input
              v-model:value="newPassword"
              v-bind="input"
              type="password"
              name="new-password"
              autocomplete="new-password"
              placeholder="New password"
              :disabled="passwordLoading"
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
              :disabled="passwordLoading"
            />
          </div>
        </ui-form-field>

        <template #footer>
          <ui-button type="primary" native-type="submit" :loading="passwordLoading">Change Password</ui-button>
        </template>
      </ui-card>
    </ui-form>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { accountInitial } from '@/utils/accountLabel';
import { PASSWORD_HELP, passwordMismatchError } from '@/utils/password';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import {
  UiAvatar,
  UiButton,
  UiCard,
  UiForm,
  UiFormField,
  UiInput,
  UiPageContainer,
  UiPageHeading,
} from '@/components/ui';

const PROFILE_FORM = 'profile';
const PASSWORD_FORM = 'password';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/EditProfile');

const errorStore = useErrorStore();
const notificationStore = useNotificationStore();
const userStore = useUserStore();
const userService = useUserService();

const name = ref('');
const email = ref('');
const profileLoading = ref(false);

const newPassword = ref('');
const confirmPassword = ref('');
const passwordLoading = ref(false);

const initial = computed(() => accountInitial(userStore.profile?.name ?? '', userStore.profile?.email ?? ''));

const profileUnchanged = computed(
  () => name.value === (userStore.profile?.name ?? '') && email.value === (userStore.profile?.email ?? '')
);

// Every navigation reloads the profile; refill only when the saved values change, so typed edits survive it.
watch(
  () => [userStore.profile?.name ?? '', userStore.profile?.email ?? ''],
  ([profileName, profileEmail]) => {
    name.value = profileName;
    email.value = profileEmail;
  },
  { immediate: true }
);

const doSaveProfile = () => {
  if (profileLoading.value) {
    return;
  }

  profileLoading.value = true;

  userService
    .updateProfile({ name: name.value, email: email.value }, PROFILE_FORM)
    .then(() => {
      notificationStore.addToast('Profile updated', 'Your changes have been saved.');
    })
    .finally(() => {
      profileLoading.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSaveProfile(): Failed to update profile');
    });
};

const doChangePassword = () => {
  if (passwordLoading.value) {
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    errorStore.setValidationError(passwordMismatchError(PASSWORD_FORM));
    return;
  }

  passwordLoading.value = true;

  userService
    .updateProfile(
      {
        name: userStore.profile?.name ?? '',
        email: userStore.profile?.email ?? '',
        password: newPassword.value,
      },
      PASSWORD_FORM
    )
    .then(() => {
      newPassword.value = '';
      confirmPassword.value = '';
      notificationStore.addToast('Password changed', 'Use it the next time you sign in.');
    })
    .finally(() => {
      passwordLoading.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doChangePassword(): Failed to change password');
    });
};
</script>
