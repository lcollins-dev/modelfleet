export interface IFieldIds {
  input: string;
  help: string;
  error: string;
}

export interface IFieldInputProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

export const fieldIds = (baseId: string): IFieldIds => ({
  input: `${baseId}-input`,
  help: `${baseId}-help`,
  error: `${baseId}-error`,
});

export const fieldInputProps = (ids: IFieldIds, hasHelp: boolean, hasError: boolean): IFieldInputProps => {
  const describedBy = [hasHelp ? ids.help : null, hasError ? ids.error : null].filter(id => id !== null);

  return {
    id: ids.input,
    'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    'aria-invalid': hasError ? true : undefined,
  };
};

/** A control's attributes minus `class`, which styles the control's wrapper rather than its native input. */
export const inputAttrsOf = (attrs: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(attrs).filter(([name]) => name !== 'class'));
