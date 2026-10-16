import { defineStore } from 'pinia';
import { VNode, h, reactive, ref } from 'vue';

import { ValidationError } from '@/types/error';
import { Notification, NotificationType } from '@/types/notification';

import { useNotificationStore } from './notification';

export const useErrorStore = defineStore('error', () => {
  const notificationStore = useNotificationStore();

  const vueError = ref<unknown>(null);

  const validationError = ref<ValidationError | null>(null);
  const validationErrorNotificationId = ref<number | null>(null);

  const formLabelsMap = reactive(new Map<string | null, Map<string, string>>());

  function setVueError(newVueError: unknown) {
    vueError.value = newVueError;
  }

  function setValidationError(newValidationError: ValidationError) {
    const listItemNodes: VNode[] = [];

    const fieldPaths = Object.keys(newValidationError.fields);
    for (const fieldPath of fieldPaths) {
      const fieldError = newValidationError.fields[fieldPath];
      const formLabel = getFormLabel(newValidationError.form, fieldPath);

      if (!fieldError) {
        continue;
      }

      listItemNodes.push(
        h('li', [
          h('span', { class: 'font-medium' }, `${formLabel ?? fieldError.name ?? 'Field'}: `),
          fieldError.message,
        ])
      );
    }

    clearValidationError();

    validationError.value = newValidationError;
    validationErrorNotificationId.value = notificationStore.addNotification(
      new Notification(
        () => h('div', [`${newValidationError.message}:`, h('ul', { class: 'm-0 pl-3 list-disc' }, listItemNodes)]),
        NotificationType.ERROR
      )
    );
  }

  function getFieldError(form: string | null, path: string) {
    if (!validationError.value) {
      return;
    }

    if (form !== validationError.value.form) {
      return;
    }

    const fields = validationError.value.fields;

    const fieldPath = path in fields ? path : Object.keys(fields).find(candidate => candidate.startsWith(`${path}.`));

    return fieldPath === undefined ? undefined : fields[fieldPath]?.message;
  }

  function clearValidationError() {
    validationError.value = null;

    if (validationErrorNotificationId.value !== null) {
      notificationStore.clearNotification(validationErrorNotificationId.value);
      validationErrorNotificationId.value = null;
    }
  }

  function setFormLabel(form: string | null, path: string, label: string) {
    let formMap = formLabelsMap.get(form);

    if (formMap === undefined) {
      formMap = new Map();
      formLabelsMap.set(form, formMap);
    }

    formMap.set(path, label);
  }

  function getFormLabel(form: string | null, path: string) {
    return formLabelsMap.get(form)?.get(path);
  }

  function removeFormLabel(form: string | null, path: string) {
    const formMap = formLabelsMap.get(form);

    if (formMap === undefined) {
      return;
    }

    const label = formMap.get(path);

    if (label === undefined) {
      return;
    }

    formMap.delete(path);

    if (formMap.size === 0) {
      formLabelsMap.delete(form);
    }
  }

  return {
    vueError,
    formLabelsMap,
    setVueError,
    setValidationError,
    getFieldError,
    clearValidationError,
    setFormLabel,
    getFormLabel,
    removeFormLabel,
  };
});
