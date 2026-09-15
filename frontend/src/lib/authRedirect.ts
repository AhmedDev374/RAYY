/**
 * Remembering where the user was headed before they were asked to sign in.
 *
 * Without this, every sign-in path finished on a hardcoded `/dashboard`, so an
 * unauthenticated visit to /diagnose (or /plants, /chat, ...) showed the
 * diagnose page's login gate and then dumped the user on the dashboard after a
 * successful Google sign-in.
 *
 * There are three carriers, because each flow drops one of them:
 *
 *  1. the `?redirect=` query parameter `PrivateRoute` attaches to `/login` -
 *     this is the one a user sees in the address bar, and the one that must win;
 *  2. `sessionStorage`, which survives the OAuth round trip off-site;
 *  3. React Router's location state, which survives in-SPA navigation.
 *
 * `/auth/callback` receives the destination in a fourth place too - on its own
 * `redirectTo` URL - but that is only reachable once {@link OAuthRedirectUrl} has
 * been handed to Supabase.
 */

/** Where a signed-in user lands when no earlier destination was recorded. */
export const DEFAULT_AUTH_REDIRECT = '/dashboard';

/** Routes that must never be used as a post-login destination. */
const NON_DESTINATIONS = new Set(['/login', '/auth/callback']);

/** Key PrivateRoute uses to hand the blocked route to /login via location state. */
export const AUTH_REDIRECT_STATE_KEY = 'rayy:redirect-intent';

/**
 * An internal path safe to hand to the router after sign-in.
 *
 * Returns null for anything that is not a plain same-origin path, so a crafted
 * `?redirect=https://evil.example` (or `//evil.example`, or `/\evil.example`,
 * both of which browsers treat as protocol-relative) can never become an open
 * redirect. Only path, query and hash are ever kept - never an origin.
 */
export function safeInternalPath(candidate?: string | null): string | null {
  if (!candidate) return null;

  let decoded = candidate.trim();
  // The value may have been encoded once per hop (OAuth query parameter then
  // storage), so decode until it stops changing before validating.
  for (let i = 0; i < 3; i += 1) {
    if (!decoded.includes('%')) break;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break; // Malformed escape sequence - validate what we already have.
    }
  }

  // A single leading "/" only: this rejects "//host", "/\\host" and full URLs.
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.startsWith('/\\')) return null;
  // Reject whitespace, control characters and HTML escaping outright.
  if (/\s/.test(decoded) || /[<>]/.test(decoded)) return null;

  let parsed: URL;
  try {
    // Resolve against the current origin to get a normalised absolute URL.
    parsed = new URL(decoded, window.location.origin);
  } catch {
    return null;
  }
  if (parsed.origin !== window.location.origin) return null;

  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (NON_DESTINATIONS.has(parsed.pathname)) return null;
  return path;
}

/**
 * Record that the user was trying to reach `path` when authentication was
 * required. Used by LoginPage to seed the OAuth round trip.
 */
export function setAuthRedirectIntent(path: string) {
  const safe = safeInternalPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem('authRedirect', safe);
  } catch {
    // Private mode / storage disabled - the query parameter still carries it.
  }
}

/**
 * The destination recorded when the user was bounced to `/login`.
 *
 * PrivateRoute writes it into React Router's location state (which survives the
 * redirect within the SPA) and the login button records the same value on
 * click. This is consulted *before* minting a fresh OAuth intent, so a second
 * sign-in attempt cannot overwrite the user's real destination with `/login`.
 */
export function readAuthRedirectIntent(): string | null {
  try {
    const fromStorage = safeInternalPath(sessionStorage.getItem('authRedirect'));
    if (fromStorage) return fromStorage;

    const state = window.history.state as { usr?: Record<string, unknown> } | null;
    return safeInternalPath(
      typeof state?.usr?.[AUTH_REDIRECT_STATE_KEY] === 'string'
        ? (state.usr[AUTH_REDIRECT_STATE_KEY] as string)
        : null,
    );
  } catch {
    return null;
  }
}

/**
 * The OAuth destination to start a sign-in for.
 *
 * Priority is `explicit` > the `?redirect=` query parameter > `recorded` > the
 * current page > `/dashboard`.
 *
 * The query parameter is deliberately read *before* the recorded intent. The
 * recorded intent can be stale - it outlives a sign-out, or a user may have
 * followed `/login?redirect=/chat` from a page other than the one that was
 * originally blocked - and the URL the user is actually on is the more honest
 * statement of where they meant to go. Reading storage first is what once made
 * `?redirect=` behave as if it were ignored.
 *
 * Never returns `/login` or `/auth/callback`: repeated attempts on the login
 * page keep pointing at the page that actually wanted authentication, not at
 * the login page itself.
 */
export function resolveAuthRedirectTarget(explicit?: string): string {
  const candidates = [
    explicit,
    new URLSearchParams(window.location.search).get('redirect'),
    readAuthRedirectIntent(),
    `${window.location.pathname}${window.location.search}`,
  ];

  for (const candidate of candidates) {
    const safe = safeInternalPath(candidate);
    if (safe) return safe;
  }

  return DEFAULT_AUTH_REDIRECT;
}

/**
 * The URL Supabase should send the user back to after Google sign-in.
 *
 * The destination rides along as a query parameter on the callback URL. Google
 * echoes the `redirectTo` URL back verbatim and Supabase preserves extra query
 * parameters on it, so `/auth/callback` reads the destination straight out of
 * its own address bar - no storage lookup required, and it survives a different
 * tab or a cleared session.
 *
 * `/auth/callback` itself is never a destination, so a resolved value of
 * `/auth/callback` cannot recurse; `safeInternalPath` rejects it.
 */
export function buildOAuthRedirectUrl(target: string): string {
  const callback = new URL('/auth/callback', window.location.origin);
  callback.searchParams.set('redirect', safeInternalPath(target) ?? DEFAULT_AUTH_REDIRECT);
  return callback.toString();
}
