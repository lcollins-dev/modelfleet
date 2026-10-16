import { describe, expect, it } from 'vitest';

import { BackendFieldType, EXTRA_FLAGS_FIELD, extraFlagsField } from './field';

describe('extraFlagsField', () => {
  it('takes the group the backend files it under', () => {
    const field = extraFlagsField('hatch');

    expect(field.name).toBe(EXTRA_FLAGS_FIELD);
    expect(field.group).toBe('hatch');
    expect(field.type).toBe(BackendFieldType.TEXT_LIST);
  });
});
