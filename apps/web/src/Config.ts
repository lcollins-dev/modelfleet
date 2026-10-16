export class Config {
  public static readonly VERSION =
    typeof import.meta.env.VITE_APP_VERSION === 'string' ? import.meta.env.VITE_APP_VERSION : '0.0.0';

  // The AGPL asks a network service to offer its users the source it runs.
  public static readonly SOURCE_URL = 'https://github.com/lcollins-dev/modelfleet';

  public static readonly API_BASE_URL = '/api/v1/';
  public static readonly API_TIMEOUT_MS = 15000;

  public static readonly LIST_DEBOUNCE_MS = 400;
  public static readonly PREVIEW_DEBOUNCE_MS = 400;

  /** Three missed server heartbeats prove the stream has gone stale. */
  public static readonly SSE_STALE_MS = 15000;

  public static readonly EVENT_LIVE_MAX = 100;
}
