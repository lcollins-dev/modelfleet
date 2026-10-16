import { LocationQuery } from 'vue-router';

export const RETURN_PATH_PARAM = 'redirect';

export const SIGN_IN_PATH = '/sign-in';

/** Undefined unless the value is a path on this origin, other than sign in. */
export function signInReturnPath(query: LocationQuery): string | undefined {
  const value = query[RETURN_PATH_PARAM];

  if (typeof value !== 'string' || !value.startsWith('/')) {
    return undefined;
  }

  // The URL parser reads `//host` and `/\host` as another origin, and drops tabs and newlines as a browser does.
  const url = new URL(value, window.location.origin);

  // `/.//host` resolves to the path `//host`.
  if (url.origin !== window.location.origin || url.pathname.startsWith('//')) {
    return undefined;
  }

  // The router matches paths regardless of case and a trailing slash.
  const routePath = url.pathname.replace(/\/+$/, '').toLowerCase();

  if (routePath === SIGN_IN_PATH) {
    return undefined;
  }

  return url.pathname + url.search + url.hash;
}
