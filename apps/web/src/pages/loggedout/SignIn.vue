<template>
  <ui-card class="mx-auto mt-10 max-w-sm">
    <ui-form v-if="step === 'email'" :name="FORM_NAME" @submit="doContinue">
      <ui-form-heading title="Sign in to Modelfleet" subtitle="Deploy and manage the models running on your GPUs." />

      <ui-form-field v-slot="{ input }" label="Email" path="email" :error="emailError">
        <ui-input
          v-model:value="loginRequest.email"
          v-bind="input"
          type="email"
          name="email"
          autocomplete="username"
          placeholder="you@example.com"
        />
      </ui-form-field>

      <ui-button type="primary" native-type="submit" block>Continue</ui-button>
    </ui-form>

    <ui-form v-else :name="FORM_NAME" @submit="doLogin">
      <ui-form-heading title="Enter your password" />

      <ui-identity-pill class="mb-6 mt-3.5" :disabled="loading" @change="doChangeEmail">
        {{ loginRequest.email }}
      </ui-identity-pill>

      <!-- Lets a password manager pair the password with the email from the first step. -->
      <input
        class="hidden"
        type="email"
        autocomplete="username"
        :value="loginRequest.email"
        tabindex="-1"
        aria-hidden="true"
        readonly
      />

      <ui-form-field v-slot="{ input }" label="Password" path="password" :error="passwordError">
        <ui-input
          v-model:value="loginRequest.password"
          v-bind="input"
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder="Your password"
          :disabled="loading"
        />
      </ui-form-field>

      <ui-button type="primary" native-type="submit" block :loading="loading">
        {{ loading ? 'Signing in...' : 'Sign In' }}
      </ui-button>
    </ui-form>
  </ui-card>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import type { LoginRequestDto } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { useUserService } from '@/services/api/UserService';
import { useErrorStore } from '@/stores/error';

import { UiButton, UiCard, UiForm, UiFormField, UiFormHeading, UiIdentityPill, UiInput } from '@/components/ui';

const FORM_NAME = 'sign-in';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedout/SignIn');

const errorStore = useErrorStore();
const userService = useUserService();

const step = ref<'email' | 'password'>('email');

const loginRequest = reactive<LoginRequestDto>({
  email: '',
  password: '',
});

const loading = ref(false);
const emailError = ref('');
const passwordError = ref('');

watch(
  () => loginRequest.email,
  () => {
    emailError.value = '';
  }
);

watch(
  () => loginRequest.password,
  () => {
    passwordError.value = '';
  }
);

const doContinue = () => {
  loginRequest.email = loginRequest.email.trim();

  if (loginRequest.email === '') {
    emailError.value = 'Enter your email.';
    return;
  }

  errorStore.clearValidationError();
  step.value = 'password';
};

const doChangeEmail = () => {
  errorStore.clearValidationError();
  loginRequest.password = '';
  passwordError.value = '';
  step.value = 'email';
};

const doLogin = () => {
  if (loading.value) {
    return;
  }

  if (loginRequest.password === '') {
    passwordError.value = 'Enter your password.';
    return;
  }

  loading.value = true;

  userService
    .login({ email: loginRequest.email, password: loginRequest.password }, FORM_NAME)
    .finally(() => {
      loading.value = false;
    })
    .catch((error: unknown) => {
      // The email field, and so the api's refusal of the email, shows only on the first step.
      if (errorStore.getFieldError(FORM_NAME, 'email') !== undefined) {
        step.value = 'email';
      }

      logger.info({ error }, 'doLogin(): Sign-in failed');
    });
};
</script>
