import { describe, expect, it } from 'vitest';

import { UserListRequestDto, UserListStatus } from './admin';

describe('UserListRequestDto', () => {
  it('keeps a search term', () => {
    expect(UserListRequestDto.parse({ search: 'tester', status: UserListStatus.ALL }).search).toBe('tester');
  });

  it('reads an empty search as no search', () => {
    expect(UserListRequestDto.parse({ search: '', status: UserListStatus.ALL }).search).toBeUndefined();
  });

  it('refuses a status the list does not offer', () => {
    expect(UserListRequestDto.safeParse({ status: 'archived' }).success).toBe(false);
  });
});
