<template>
  <ui-card class="mx-auto mt-10 max-w-sm">
    <ui-form :name="FORM_NAME" @submit="doFinishSetup">
      <ui-form-heading title="Set up your account" subtitle="Choose the email and password you'll sign in with." />

      <ui-notice class="mb-6" type="warning" title="Set your own password to continue">
        This account's password was given to you rather than chosen, so others may know it.
      </ui-notice>

      <ui-form-field
        v-slot="{ input }"
        label="Email"
        help="You'll sign in with this. Change it if it isn't your own address."
        path="email"
      >
        <ui-input
          v-model:value="setupForm.email"
          v-bind="input"
          type="email"
          name="email"
          autocomplete="username"
          :disabled="loading"
        />
      </ui-form-field>

      <ui-form-field v-slot="{ input }" label="New password" :help="PASSWORD_HELP" path="password">
        <ui-input
          v-model:value="setupForm.password"
          v-bind="input"
          type="password"
          name="new-password"
          autocomplete="new-password"
          placeholder="New password"
          :disabled="loading"
        />
      </ui-form-field>

      <ui-form-field v-slot="{ input }" label="Confirm password" :error="confirmPasswordError">
        <ui-input
          v-model:value="setupForm.confirmPassword"
          v-bind="input"
          type="password"
          name="confirm-password"
          autocomplete="new-password"
          placeholder="Enter it again"
          :disabled="loading"
        />
      </ui-form-field>

      <div class="flex justify-between gap-2">
        <ui-button type="text" :disabled="loading" @click="doSignOut">Sign out</ui-button>

        <ui-button type="primary" native-type="submit" :loading="loading">Save and Continue</ui-button>
      </div>
    </ui-form>
  </ui-card>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { PASSWORD_HELP, PASSWORD_MISMATCH } from '@/utils/password';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { UiButton, UiCard, UiForm, UiFormField, UiFormHeading, UiInput, UiNotice } from '@/components/ui';

import { HOME_PATH } from '@/router/middleware/auth';

const FORM_NAME = 'setup';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/FirstTimeSetup');

const router = useRouter();

const notificationStore = useNotificationStore();
const userStore = useUserStore();
const userService = useUserService();

const setupForm = reactive({
  email: '',
  password: '',
  confirmPassword: '',
});

const loading = ref(false);
const confirmPasswordError = ref('');

watch(
  () => userStore.profile?.email ?? '',
  profileEmail => {
    if (setupForm.email === '') {
      setupForm.email = profileEmail;
    }
  },
  { immediate: true }
);

watch(
  () => [setupForm.password, setupForm.confirmPassword],
  () => {
    confirmPasswordError.value = '';
  }
);

const finishSetup = async () => {
  await userService.updateProfile(
    { name: userStore.profile?.name ?? '', email: setupForm.email.trim(), password: setupForm.password },
    FORM_NAME
  );

  setupForm.password = '';
  setupForm.confirmPassword = '';

  await router.push(HOME_PATH);
  notificationStore.addToast('Account set up', 'Sign in with your new email and password from now on.');
};

const doFinishSetup = () => {
  if (loading.value) {
    return;
  }

  if (setupForm.password !== setupForm.confirmPassword) {
    confirmPasswordError.value = PASSWORD_MISMATCH;
    return;
  }

  loading.value = true;

  finishSetup()
    .finally(() => {
      loading.value = false;
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'doFinishSetup(): Setup failed');
    });
};

const doSignOut = () => {
  userService.logout().catch((error: unknown) => {
    logger.error({ error }, 'doSignOut(): Sign out failed');
  });
};
</script>
