import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { UserRoleId } from '@libs/dto';

import { useUserStore } from './user';

const PROFILE = {
  name: 'Tester',
  email: 'tester@example.com',
  userRoleIds: [UserRoleId.USER_ADMIN],
  mustChangePassword: false,
};

describe('useUserStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts logged out with no profile', () => {
    const userStore = useUserStore();

    expect(userStore.token).toBeNull();
    expect(userStore.profile).toBeNull();
    expect(userStore.loggedIn).toBe(false);
  });

  it('marks the session as ended on endSession, and not on clearAuth', () => {
    const userStore = useUserStore();
    userStore.setToken('signed-jwt');

    userStore.endSession();

    expect(userStore.loggedIn).toBe(false);
    expect(userStore.sessionEnded).toBe(true);

    userStore.clearAuth();

    expect(userStore.sessionEnded).toBe(false);
  });

  it('forgets an ended session once a new token is set', () => {
    const userStore = useUserStore();
    userStore.endSession();

    userStore.setToken('signed-jwt');

    expect(userStore.sessionEnded).toBe(false);
  });

  it('counts the user as logged in once a token is set', () => {
    const userStore = useUserStore();

    userStore.setToken('signed-jwt');

    expect(userStore.loggedIn).toBe(true);
  });

  it('persists the token to local storage', async () => {
    const userStore = useUserStore();

    userStore.setToken('signed-jwt');
    await nextTick();

    expect(window.localStorage.getItem('token')).toBe('signed-jwt');
  });

  it('restores a token left in local storage by a previous session', () => {
    window.localStorage.setItem('token', 'signed-jwt');
    setActivePinia(createPinia());

    const userStore = useUserStore();

    expect(userStore.token).toBe('signed-jwt');
    expect(userStore.loggedIn).toBe(true);
  });

  it('stores the profile', () => {
    const userStore = useUserStore();

    userStore.setProfile(PROFILE);

    expect(userStore.profile).toEqual(PROFILE);
  });

  it('drops both the token and the profile on clearAuth', () => {
    const userStore = useUserStore();
    userStore.setToken('signed-jwt');
    userStore.setProfile(PROFILE);

    userStore.clearAuth();

    expect(userStore.token).toBeNull();
    expect(userStore.profile).toBeNull();
    expect(userStore.loggedIn).toBe(false);
  });

  describe('hasRole', () => {
    it('returns false when there is no profile', () => {
      const userStore = useUserStore();

      expect(userStore.hasRole(UserRoleId.USER_ADMIN)).toBe(false);
    });

    it('returns false when the profile has none of the required roles', () => {
      const userStore = useUserStore();
      userStore.setProfile(PROFILE);

      expect(userStore.hasRole(UserRoleId.SYSTEM_ADMIN)).toBe(false);
    });

    it('returns true when the profile has the single required role', () => {
      const userStore = useUserStore();
      userStore.setProfile(PROFILE);

      expect(userStore.hasRole(UserRoleId.USER_ADMIN)).toBe(true);
    });

    it('returns true when the profile has any of multiple required roles', () => {
      const userStore = useUserStore();
      userStore.setProfile(PROFILE);

      expect(userStore.hasRole(UserRoleId.SYSTEM_ADMIN, UserRoleId.USER_ADMIN)).toBe(true);
    });

    it('returns false when called with no required roles', () => {
      const userStore = useUserStore();
      userStore.setProfile({ ...PROFILE, userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN] });

      expect(userStore.hasRole()).toBe(false);
    });
  });
});
