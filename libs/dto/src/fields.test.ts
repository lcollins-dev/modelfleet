import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  dateText,
  emailAddress,
  enumList,
  enumValue,
  flag,
  id,
  lengthMessage,
  optionalText,
  password,
  requestBody,
  selection,
  text,
  timestamp,
  wholeNumber,
  wholeNumberParam,
} from './fields';

const messagesFor = (schema: z.ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map(issue => issue.message);
};

enum Colour {
  RED = 'red',
  BLUE = 'blue',
}

enum Role {
  ADMIN = 9100,
  EDITOR = 9200,
}

describe('requestBody', () => {
  const body = requestBody({ name: text(2, 256) });

  it('refuses a field the shape does not name', () => {
    expect(messagesFor(body, { name: 'Tester', extra: 1 })).toEqual([
      "This field isn't accepted. Remove it and try again.",
    ]);
  });

  it('asks for an object when the body is not one', () => {
    expect(messagesFor(body, 'name')).toEqual(['Send the fields as a JSON object.']);
  });

  it('leaves a field to word its own refusal', () => {
    expect(messagesFor(body, {})).toEqual(['Enter between 2 and 256 characters.']);
  });
});

describe('text', () => {
  it('accepts text within the limits', () => {
    expect(messagesFor(text(2, 256), 'Tester')).toEqual([]);
  });

  it('names both limits when the text is too short', () => {
    expect(messagesFor(text(2, 256), 'x')).toEqual(['Enter between 2 and 256 characters.']);
  });

  it('gives the same message for a value that is not text', () => {
    expect(messagesFor(text(2, 256), 42)).toEqual(['Enter between 2 and 256 characters.']);
  });

  it('names only the upper limit when the lower one is zero', () => {
    expect(messagesFor(text(0, 512), 'x'.repeat(513))).toEqual(['Enter no more than 512 characters.']);
  });

  it('counts code points, as a varchar column does', () => {
    expect(messagesFor(text(0, 2), '😀😀')).toEqual([]);
    expect(messagesFor(text(0, 2), '😀😀😀')).toEqual(['Enter no more than 2 characters.']);
  });

  it('counts a variation selector as a character, as Postgres does', () => {
    expect(messagesFor(text(0, 1), '☀️')).toEqual(['Enter no more than 1 characters.']);
  });

  it('measures the trimmed value where the service trims before storing', () => {
    expect(messagesFor(text(1, 3, { trim: true }), '  abc  ')).toEqual([]);
    expect(messagesFor(text(1, 3, { trim: true }), '   ')).toEqual(['Enter between 1 and 3 characters.']);
  });

  it('keeps the value as sent, leaving the service to trim it', () => {
    expect(text(1, 3, { trim: true }).parse(' ab ')).toBe(' ab ');
  });
});

describe('optionalText', () => {
  const body = requestBody({ search: optionalText(4) });

  it('keeps a value', () => {
    expect(body.parse({ search: 'node' })).toEqual({ search: 'node' });
  });

  it('reads an empty value as none', () => {
    expect(body.parse({ search: '' }).search).toBeUndefined();
  });

  it('leaves an absent value absent', () => {
    expect(body.parse({})).toEqual({});
  });

  it('refuses a value over the limit', () => {
    expect(messagesFor(body, { search: 'nodes' })).toEqual(['Enter no more than 4 characters.']);
  });
});

describe('lengthMessage', () => {
  it('names both limits', () => {
    expect(lengthMessage(2, 256)).toBe('Enter between 2 and 256 characters.');
  });

  it('names only the upper limit when the lower one is zero', () => {
    expect(lengthMessage(0, 32)).toBe('Enter no more than 32 characters.');
  });
});

describe('emailAddress', () => {
  it('accepts an email address', () => {
    expect(messagesFor(emailAddress(), 'tester@modelfleet.test')).toEqual([]);
  });

  it('asks for a valid address', () => {
    expect(messagesFor(emailAddress(), 'not-an-email')).toEqual(['Enter a valid email address.']);
  });

  it('names the length limits ahead of the address check', () => {
    expect(messagesFor(emailAddress(), `${'x'.repeat(510)}@modelfleet.test`)).toEqual([
      'Enter between 2 and 512 characters.',
    ]);
  });
});

describe('password', () => {
  it('accepts a password that meets the rule', () => {
    expect(messagesFor(password(), 'Secret1!')).toEqual([]);
  });

  it('states the rule for a weak password', () => {
    expect(messagesFor(password(), 'weak')).toEqual([
      'Use 6 or more characters, with a capital letter, a number and a symbol from @$!%*#?&.',
    ]);
  });

  it('names the upper limit for a long password', () => {
    expect(messagesFor(password(), `Secret1!${'x'.repeat(30)}`)).toEqual(['Enter no more than 32 characters.']);
  });
});

describe('flag', () => {
  it('accepts a boolean', () => {
    expect(messagesFor(flag(), false)).toEqual([]);
  });

  it('asks for yes or no', () => {
    expect(messagesFor(flag(), 'true')).toEqual(['Choose yes or no.']);
  });
});

describe('wholeNumber', () => {
  it('accepts a whole number within the range', () => {
    expect(messagesFor(wholeNumber(1, 100), 42)).toEqual([]);
  });

  it('asks for a whole number', () => {
    expect(messagesFor(wholeNumber(1, 100), 4.2)).toEqual(['Enter a whole number.']);
  });

  it('names the range for a number outside it', () => {
    expect(messagesFor(wholeNumber(1, 100), 101)).toEqual(['Enter a number from 1 to 100.']);
  });
});

describe('id', () => {
  it('refuses zero and a value past an int4 column', () => {
    expect(messagesFor(id(), 0)).toEqual(['Enter a number from 1 to 2147483647.']);
    expect(messagesFor(id(), 2147483648)).toEqual(['Enter a number from 1 to 2147483647.']);
  });
});

describe('wholeNumberParam', () => {
  const param = wholeNumberParam(1, 100);

  it('reads a numeric string as a number', () => {
    expect(param.parse('42')).toBe(42);
  });

  it('accepts both bounds', () => {
    expect(param.parse('1')).toBe(1);
    expect(param.parse('100')).toBe(100);
  });

  it('names the range for a value outside it', () => {
    expect(messagesFor(param, '0')).toEqual(['Enter a number from 1 to 100.']);
    expect(messagesFor(param, '101')).toEqual(['Enter a number from 1 to 100.']);
  });

  it('asks for a whole number when the value is missing', () => {
    expect(messagesFor(param, undefined)).toEqual(['Enter a whole number.']);
  });

  it.each(['', 'abc', '42.9', '42abc', ' 42', '42 ', '4e1', '0x2a'])('refuses %j as a whole number', value => {
    expect(messagesFor(param, value)).toEqual(['Enter a whole number.']);
  });

  it('refuses a negative value against a zero lower bound', () => {
    expect(messagesFor(wholeNumberParam(0, 10), '-1')).toEqual(['Enter a number from 0 to 10.']);
  });
});

describe('enumValue', () => {
  it('accepts a member of the enum', () => {
    expect(messagesFor(enumValue(Colour), 'red')).toEqual([]);
  });

  it('asks for an option from the list', () => {
    expect(messagesFor(enumValue(Colour), 'green')).toEqual(['Choose an option from the list.']);
  });
});

describe('enumList', () => {
  it('accepts a list of members', () => {
    expect(messagesFor(enumList(Role), [9100, 9200])).toEqual([]);
  });

  it('asks for an option from the list for a value outside the enum', () => {
    expect(messagesFor(enumList(Role), [9100, 1])).toEqual(['Choose an option from the list.']);
  });

  it('refuses the name of a numeric member', () => {
    expect(messagesFor(enumList(Role), ['ADMIN'])).toEqual(['Choose an option from the list.']);
  });

  it('asks for an option from the list when the value is not a list', () => {
    expect(messagesFor(enumList(Role), 9100)).toEqual(['Choose an option from the list.']);
  });
});

describe('selection', () => {
  const colours = selection(enumValue(Colour), 1, 2);

  it('accepts a count within the limits', () => {
    expect(messagesFor(colours, ['red'])).toEqual([]);
  });

  it('names the limits for an empty or overlong list', () => {
    expect(messagesFor(colours, [])).toEqual(['Choose between 1 and 2.']);
    expect(messagesFor(colours, ['red', 'blue', 'red'])).toEqual(['Choose between 1 and 2.']);
  });

  it('names only the upper limit when the lower one is zero', () => {
    expect(messagesFor(selection(enumValue(Colour), 0, 1), ['red', 'blue'])).toEqual(['Choose no more than 1.']);
  });

  it('asks for an option from the list for an entry outside it', () => {
    expect(messagesFor(colours, ['green'])).toEqual(['Choose an option from the list.']);
  });
});

describe('dateText', () => {
  it('keeps what Date.toJSON writes as the text it was sent as', () => {
    expect(dateText().parse('2026-05-15T12:00:00.000Z')).toBe('2026-05-15T12:00:00.000Z');
  });

  it.each(['', 'soon', 20260515])('refuses %j', value => {
    expect(messagesFor(dateText(), value)).toEqual(['Enter a valid date and time.']);
  });
});

describe('timestamp', () => {
  it('reads what Date.toJSON writes back as the same moment', () => {
    const date = new Date('2026-05-15T12:00:00.000Z');

    expect(timestamp().parse(date.toJSON())).toEqual(date);
  });

  it('accepts an offset other than UTC', () => {
    expect(timestamp().parse('2026-05-15T12:00:00+01:00')).toEqual(new Date('2026-05-15T11:00:00.000Z'));
  });

  it.each(['2026-05-15', '2026-05-15T12:00:00', 'May 15, 2026', '2026-02-31T12:00:00Z', 1747310400000])(
    'refuses %j',
    value => {
      expect(messagesFor(timestamp(), value)).toEqual(['Enter a valid date and time.']);
    }
  );
});
