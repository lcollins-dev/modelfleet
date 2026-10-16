import { Component } from 'vue';

export interface ISelectOption<T extends string> {
  value: T;
  label: string;
  /** A second line under the label in the list, which MultiSelect's search also matches. */
  description?: string;
  icon?: Component;
  disabled?: boolean;
}

export interface ISelectGroup<T extends string> {
  label: string;
  options: (ISelectOption<T> | T)[];
}

/** A plain string is both the value and the label. */
export type SelectOptions<T extends string> = (ISelectOption<T> | ISelectGroup<T> | T)[];

export interface IFlatOption<T extends string> extends ISelectOption<T> {
  group: string | null;
}

export interface ISelectSection<T extends string> {
  group: string | null;
  options: { option: IFlatOption<T>; index: number }[];
}

export const optionAt = <T extends string>(options: IFlatOption<T>[], index: number): IFlatOption<T> | undefined =>
  index >= 0 && index < options.length ? options[index] : undefined;

export const optionId = (listboxId: string, index: number): string => `${listboxId}-option-${index}`;

const normalise = <T extends string>(option: ISelectOption<T> | T, group: string | null): IFlatOption<T> =>
  typeof option === 'string' ? { value: option, label: option, group } : { ...option, group };

export const flattenOptions = <T extends string>(options: SelectOptions<T>): IFlatOption<T>[] =>
  options.flatMap(entry =>
    typeof entry !== 'string' && 'options' in entry
      ? entry.options.map(option => normalise(option, entry.label))
      : [normalise(entry, null)]
  );

export const sectionsOf = <T extends string>(options: IFlatOption<T>[]): ISelectSection<T>[] => {
  const sections: ISelectSection<T>[] = [];

  options.forEach((option, index) => {
    const last = sections.at(-1);

    if (last?.group === option.group) {
      last.options.push({ option, index });
    } else {
      sections.push({ group: option.group, options: [{ option, index }] });
    }
  });

  return sections;
};

/** Wraps round; -1 when no option is enabled. */
export const stepIndex = <T extends string>(options: IFlatOption<T>[], from: number, step: 1 | -1): number => {
  let index = from;

  for (let i = 0; i < options.length; i++) {
    index = (index + step + options.length) % options.length;

    if (options[index].disabled !== true) {
      return index;
    }
  }

  return -1;
};

export const firstEnabledIndex = <T extends string>(options: IFlatOption<T>[]): number =>
  options.findIndex(option => option.disabled !== true);

export const lastEnabledIndex = <T extends string>(options: IFlatOption<T>[]): number => stepIndex(options, 0, -1);
