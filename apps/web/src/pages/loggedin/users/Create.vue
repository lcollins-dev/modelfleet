<template>
  <ui-page-container>
    <ui-page-heading
      title="New user"
      subtitle="Set their password here and share it with them. They can change it once signed in."
      back-to="/users"
      back-label="Users"
    />

    <ui-form :name="CREATE_FORM" @submit="doCreateUser">
      <ui-card>
        <ui-form-section title="Who" subtitle="The person you are adding.">
          <ui-form-field v-slot="{ input }" label="Name" help="Shown in the header and the event log." path="name">
            <ui-input
              v-model:value="name"
              v-bind="input"
              name="display-name"
              autocomplete="off"
              placeholder="Their name"
              :disabled="loading"
            />
          </ui-form-field>

          <ui-form-field v-slot="{ input }" label="Email" help="Used to sign in." path="email">
            <ui-input
              v-model:value="email"
              v-bind="input"
              type="email"
              name="email"
              autocomplete="off"
              placeholder="name@example.com"
              :disabled="loading"
            />
          </ui-form-field>
        </ui-form-section>

        <ui-form-section title="Password" subtitle="They sign in with this until they change it.">
          <ui-form-field v-slot="{ input }" label="Password" :help="PASSWORD_HELP" path="password">
            <ui-input
              v-model:value="password"
              v-bind="input"
              type="password"
              name="new-password"
              autocomplete="new-password"
              placeholder="Their password"
              :disabled="loading"
            />
          </ui-form-field>

          <ui-form-field v-slot="{ input }" label="Confirm password" path="confirmPassword">
            <ui-input
              v-model:value="confirmPassword"
              v-bind="input"
              type="password"
              name="confirm-password"
              autocomplete="new-password"
              placeholder="Enter it again"
              :disabled="loading"
            />
          </ui-form-field>
        </ui-form-section>

        <ui-form-section title="Access" subtitle="You can change this at any time.">
          <ui-form-field
            v-slot="{ input }"
            label="Roles"
            help="Each role opens part of the console to them. With none, they only call deployments."
            path="userRoleIds"
          >
            <role-select v-model:value="roleIds" v-bind="input" name="roles" :disabled="loading" />
          </ui-form-field>
        </ui-form-section>

        <template #footer>
          <div class="flex gap-2">
            <ui-button :disabled="loading" to="/users">Cancel</ui-button>

            <ui-button type="primary" native-type="submit" :loading="loading">Create User</ui-button>
          </div>
        </template>
      </ui-card>
    </ui-form>
  </ui-page-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import type { CreateUserRequestDto, UserRoleId } from '@libs/dto';

import { PASSWORD_HELP, passwordMismatchError } from '@/utils/password';

import { useLogService } from '@/services/LogService';
import { useUserAdminService } from '@/services/api/admin/UserAdminService';
import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';

import {
  UiButton,
  UiCard,
  UiForm,
  UiFormField,
  UiFormSection,
  UiInput,
  UiPageContainer,
  UiPageHeading,
} from '@/components/ui';
import RoleSelect from '@/components/user/RoleSelect.vue';

const CREATE_FORM = 'create-user';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/users/Create');

const router = useRouter();

const errorStore = useErrorStore();
const notificationStore = useNotificationStore();
const adminUserService = useUserAdminService();

const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const roleIds = ref<UserRoleId[]>([]);
const loading = ref(false);

const doCreateUser = () => {
  if (loading.value) {
    return;
  }

  if (password.value !== confirmPassword.value) {
    errorStore.setValidationError(passwordMismatchError(CREATE_FORM));
    return;
  }

  const createUserRequest: CreateUserRequestDto = {
    name: name.value,
    email: email.value,
    userRoleIds: roleIds.value,
    password: password.value,
  };

  loading.value = true;

  adminUserService
    .createUser(createUserRequest, CREATE_FORM)
    .then(async userId => {
      notificationStore.addToast('User created', `${createUserRequest.name} can sign in now.`);

      await router.push(`/users/${userId}`);
    })
    .finally(() => {
      loading.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCreateUser(): Failed to create user');
    });
};
</script>
