import { computed, inject, onMounted, onUnmounted } from 'vue';

import { useErrorStore } from '@/stores/error';

import { FORM_CONTEXT_KEY } from './formContext';

interface IFieldErrorProps {
  label: string;
  path?: string;
  error: string;
}

/** The page's own `error` wins over the server's. Registers the label, which the validation toast names the field by. */
export const useFieldError = (props: IFieldErrorProps) => {
  const errorStore = useErrorStore();
  const formContext = inject(FORM_CONTEXT_KEY, null);
  const formName = () => formContext?.name ?? null;

  onMounted(() => {
    if (props.path !== undefined) {
      errorStore.setFormLabel(formName(), props.path, props.label);
    }
  });

  onUnmounted(() => {
    if (props.path !== undefined) {
      errorStore.removeFormLabel(formName(), props.path);
    }
  });

  return computed(() => {
    if (props.error !== '') {
      return props.error;
    }

    return props.path === undefined ? '' : (errorStore.getFieldError(formName(), props.path) ?? '');
  });
};
