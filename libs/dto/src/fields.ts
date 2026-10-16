import { z } from 'zod';

export const lengthMessage = (min: number, max: number): string => {
  if (min === 0) {
    return `Enter no more than ${max} characters.`;
  }

  return `Enter between ${min} and ${max} characters.`;
};

export const rangeMessage = (min: number, max: number): string => `Enter a number from ${min} to ${max}.`;

const selectionCountMessage = (min: number, max: number): string => {
  if (min === 0) {
    return `Choose no more than ${max}.`;
  }

  return `Choose between ${min} and ${max}.`;
};

export const WHOLE_NUMBER_MESSAGE = 'Enter a whole number.';
export const UNACCEPTED_FIELD_MESSAGE = "This field isn't accepted. Remove it and try again.";
export const NOT_AN_OBJECT_MESSAGE = 'Send the fields as a JSON object.';

const SELECTION_MESSAGE = 'Choose an option from the list.';

export const INT4_MAX = 2147483647;

const EMAIL_MIN_LENGTH = 2;
const EMAIL_MAX_LENGTH = 512;

const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{6,}$/;
export const PASSWORD_MAX_LENGTH = 32;

// Number() reads '', '4e1' and '0x2a' as numbers, so the whole string is matched first.
const INTEGER_PATTERN = /^-?\d+$/;

export interface ITextOptions {
  /** Must match whether the service trims the value before storing it. */
  trim?: boolean;
}

/** Counts code points, as Postgres `varchar(n)` does, where `length` counts a surrogate pair as two. */
const codePoints = (value: string, trim: boolean): number => Array.from(trim ? value.trim() : value).length;

export const requestBody = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.strictObject(shape, {
    error: issue => (issue.code === 'unrecognized_keys' ? UNACCEPTED_FIELD_MESSAGE : NOT_AN_OBJECT_MESSAGE),
  });

export const text = (min: number, max: number, options: ITextOptions = {}) => {
  const error = lengthMessage(min, max);
  const trim = options.trim ?? false;

  return z.string({ error }).refine(
    value => {
      const length = codePoints(value, trim);

      return length >= min && length <= max;
    },
    { error }
  );
};

export const optionalText = (max: number) =>
  text(0, max)
    .transform(value => (value === '' ? undefined : value))
    .optional();

export const emailAddress = () => {
  const error = 'Enter a valid email address.';

  return text(EMAIL_MIN_LENGTH, EMAIL_MAX_LENGTH, { trim: true }).pipe(z.email({ error }));
};

export const password = () => {
  const error = 'Use 6 or more characters, with a capital letter, a number and a symbol from @$!%*#?&.';

  return z
    .string({ error })
    .regex(PASSWORD_PATTERN, { error })
    .max(PASSWORD_MAX_LENGTH, { error: lengthMessage(0, PASSWORD_MAX_LENGTH) });
};

export const flag = () => z.boolean({ error: 'Choose yes or no.' });

export const wholeNumber = (min: number, max: number) => {
  const error = rangeMessage(min, max);

  return z.int({ error: WHOLE_NUMBER_MESSAGE }).min(min, { error }).max(max, { error });
};

export const id = () => wholeNumber(1, INT4_MAX);

export const wholeNumberParam = (min: number, max: number) =>
  z
    .string({ error: WHOLE_NUMBER_MESSAGE })
    .regex(INTEGER_PATTERN, { error: WHOLE_NUMBER_MESSAGE })
    .transform(Number)
    .pipe(wholeNumber(min, max));

export const enumValue = <Entity extends z.core.util.EnumLike>(entity: Entity) =>
  z.enum(entity, { error: SELECTION_MESSAGE });

export const enumList = <Entity extends z.core.util.EnumLike>(entity: Entity) =>
  z.array(enumValue(entity), { error: SELECTION_MESSAGE });

export const selection = <Option extends z.ZodType>(option: Option, min: number, max: number) => {
  const error = selectionCountMessage(min, max);

  return z.array(option, { error: SELECTION_MESSAGE }).min(min, { error }).max(max, { error });
};

export const dateText = () =>
  z.string({ error: 'Enter a valid date and time.' }).refine(value => value !== '' && !isNaN(Date.parse(value)), {
    error: 'Enter a valid date and time.',
  });

export const timestamp = () =>
  z.codec(z.iso.datetime({ offset: true, error: 'Enter a valid date and time.' }), z.date(), {
    decode: value => new Date(value),
    encode: date => date.toISOString(),
  });
