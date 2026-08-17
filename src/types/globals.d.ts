/** Build-time constants injected by Vite's `define`. See vite.config.ts. */
declare const __SNAPDOCK_VERSION__: string;
/**
 * OAuth client id used by Firefox's PKCE flow. Empty when unconfigured, which the auth
 * layer turns into a precise setup message. Firefox has no `oauth2` manifest key, so
 * unlike Chromium's id this one has to be compiled in.
 */
declare const __SNAPDOCK_FIREFOX_CLIENT_ID__: string;
