import { InjectionKey } from 'vue';

export type FieldLayout = 'stacked' | 'row';

export type FieldAlign = 'start' | 'end';

export interface IFormContext {
  name: string | null;
  layout: FieldLayout | undefined;
  align: FieldAlign | undefined;
}

export const FORM_CONTEXT_KEY: InjectionKey<IFormContext> = Symbol('formContext');
