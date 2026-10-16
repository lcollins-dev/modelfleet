import { describe, expect, it } from 'vitest';

import { accountInitial, accountLabel } from './accountLabel';

describe('accountLabel', () => {
  it('uses the display name when there is one', () => {
    expect(accountLabel('Sam Lee', 'sam@example.com')).toBe('Sam Lee');
  });

  it('falls back to the address for an empty or blank name', () => {
    expect(accountLabel('', 'sam@example.com')).toBe('sam@example.com');
    expect(accountLabel('   ', 'sam@example.com')).toBe('sam@example.com');
  });
});

describe('accountInitial', () => {
  it('takes the first letter of the label, upper-cased', () => {
    expect(accountInitial('riley', 'riley@example.com')).toBe('R');
    expect(accountInitial('', 'jo@example.com')).toBe('J');
  });
});
