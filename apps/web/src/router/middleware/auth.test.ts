import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { RouteLocationNormalized } from 'vue-router';

import { ProfileResponseDto, UserRoleId } from '@libs/dto';

import { useUserStore } from '@/stores/user';

import { authMiddleware } from './auth';

const routerMock = vi.hoisted(() => ({ replace: vi.fn(() => Promise.resolve()) }));
const getProfileMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('vue-router', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => routerMock,
}));

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ getProfile: getProfileMock }),
}));

const PROFILE: ProfileResponseDto = {
  name: 'Tester',
  email: 'tester@example.com',
  userRoleIds: [UserRoleId.SYSTEM_ADMIN],
  mustChangePassword: false,
};

const signedInRoute = (fullPath: string): RouteLocationNormalized =>
  ({ path: fullPath.split('?')[0], fullPath, query: {}, hash: '', meta: { requiresAuthState: 'loggedin' } }) as never;

const roleRoute = (path: string, requiresRoleId: UserRoleId): RouteLocationNormalized =>
  ({
    path,
    fullPath: `${path}?page=2#top`,
    query: { page: '2' },
    hash: '#top',
    meta: { requiresAuthState: 'loggedin', requiresRoleId },
  }) as never;

const signInRoute = (redirect?: string): RouteLocationNormalized =>
  ({
    path: '/sign-in',
    fullPath: '/sign-in',
    query: redirect === undefined ? {} : { redirect },
    hash: '',
    meta: { requiresAuthState: 'loggedout' },
  }) as never;

const runAuthMiddleware = (to: RouteLocationNormalized) => authMiddleware.call(undefined, to, to, () => undefined);

const signIn = (profile: Partial<ProfileResponseDto> = {}) => {
  const userStore = useUserStore();
  userStore.setToken('token');
  userStore.setProfile({ ...PROFILE, ...profile });
};

describe('authMiddleware', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    routerMock.replace.mockClear();
    getProfileMock.mockReset();
    getProfileMock.mockResolvedValue(undefined);
  });

  it('sends a signed-out visitor to sign in, carrying the page they asked for', async () => {
    expect(await runAuthMiddleware(signedInRoute('/nodes?page=2'))).toEqual({
      path: '/sign-in',
      query: { redirect: '/nodes?page=2' },
    });
  });

  it('sends a signed-out visitor to a plain sign in from the dashboard', async () => {
    expect(await runAuthMiddleware(signedInRoute('/dashboard'))).toEqual({ path: '/sign-in', query: {} });
  });

  it('sends a signed-in visitor on sign in to the page it carries', async () => {
    signIn();

    expect(await runAuthMiddleware(signInRoute('/edit-profile'))).toBe('/edit-profile');
  });

  it('sends a signed-in visitor on sign in to the dashboard when the page it carries leaves this origin', async () => {
    signIn();

    expect(await runAuthMiddleware(signInRoute('//evil.example/nodes'))).toBe('/dashboard');
  });

  it('sends a signed-in visitor on sign in to the dashboard when it carries no page', async () => {
    signIn();

    expect(await runAuthMiddleware(signInRoute())).toBe('/dashboard');
  });

  it('sends the user to the page sign in carries once they sign in there', async () => {
    expect(await runAuthMiddleware(signInRoute('/nodes'))).toBeUndefined();

    useUserStore().setToken('token');
    await nextTick();

    expect(routerMock.replace).toHaveBeenCalledWith('/nodes');
  });

  it('sends a user who signs out on a page to a plain sign in', async () => {
    signIn();

    expect(await runAuthMiddleware(signedInRoute('/nodes'))).toBeUndefined();

    useUserStore().clearAuth();
    await nextTick();

    expect(routerMock.replace).toHaveBeenCalledWith({ path: '/sign-in', query: {} });
  });

  it('sends a user whose session ends on a page to sign in, carrying that page', async () => {
    signIn();

    expect(await runAuthMiddleware(signedInRoute('/nodes?page=2'))).toBeUndefined();

    useUserStore().endSession();
    await nextTick();

    expect(routerMock.replace).toHaveBeenCalledWith({ path: '/sign-in', query: { redirect: '/nodes?page=2' } });
  });

  it('shows not found at the requested URL to a signed-in user without the role', async () => {
    signIn({ userRoleIds: [] });

    expect(await runAuthMiddleware(roleRoute('/batch-jobs/100', UserRoleId.SYSTEM_ADMIN))).toEqual({
      name: 'not-found',
      params: { pathMatch: ['batch-jobs', '100'] },
      query: { page: '2' },
      hash: '#top',
    });
  });

  it('lets a user with their own password reach any page they hold the role for', async () => {
    signIn();

    expect(await runAuthMiddleware(signedInRoute('/dashboard'))).toBeUndefined();
    expect(await runAuthMiddleware(roleRoute('/nodes', UserRoleId.SYSTEM_ADMIN))).toBeUndefined();
  });

  it('holds a user who must change their password on the setup page', async () => {
    signIn({ mustChangePassword: true });

    expect(await runAuthMiddleware(signedInRoute('/dashboard'))).toBe('/setup');
    expect(await runAuthMiddleware(signedInRoute('/edit-profile'))).toBe('/setup');
    expect(await runAuthMiddleware(roleRoute('/nodes', UserRoleId.SYSTEM_ADMIN))).toBe('/setup');
    expect(await runAuthMiddleware(signedInRoute('/setup'))).toBeUndefined();
  });

  it('sends a user who has finished setup from the setup page to the dashboard', async () => {
    signIn();

    expect(await runAuthMiddleware(signedInRoute('/setup'))).toBe('/dashboard');
  });

  it('decides on the profile it reloads, so a hold set since sign in still applies', async () => {
    signIn();
    getProfileMock.mockImplementation(() => {
      useUserStore().setProfile({ ...PROFILE, mustChangePassword: true });

      return Promise.resolve();
    });

    expect(await runAuthMiddleware(signedInRoute('/dashboard'))).toBe('/setup');
  });

  it('releases the user once the reloaded profile no longer carries the hold', async () => {
    signIn({ mustChangePassword: true });

    expect(await runAuthMiddleware(signedInRoute('/setup'))).toBeUndefined();

    useUserStore().setProfile(PROFILE);

    expect(await runAuthMiddleware(signedInRoute('/dashboard'))).toBeUndefined();
  });

  it('keeps a held user on the setup page when the password change swaps their token', async () => {
    signIn({ mustChangePassword: true });

    expect(await runAuthMiddleware(signedInRoute('/setup'))).toBeUndefined();

    useUserStore().setToken('replacement-token');
    await nextTick();

    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
