import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        /**
         * `pkce` is what supabase-js uses for `signInWithOAuth` in the browser,
         * and it is the flow this app is built around. Stated explicitly rather
         * than left to the default so a future supabase-js upgrade cannot
         * silently move the app onto a different flow.
         *
         * Under PKCE, supabase-js stores a `code_verifier` in localStorage and
         * redeems it for a session at /auth/callback. Clearing site data
         * between the Google redirect and the callback (or opening the callback
         * in a different browser/profile) invalidates that verifier, and the
         * exchange fails with an "invalid flow state / code verifier" error.
         */
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

/**
 * How long to wait for `supabase.auth.getSession()` before falling back to the
 * session already cached in storage.
 *
 * @supabase/auth-js performs a token refresh *inside* getSession() when the
 * stored session has expired, and places no timeout on that request. One
 * stalled refresh (a network blip, a moment offline) therefore leaves every
 * later getSession() call pending forever with no error - which silently blocks
 * anything awaiting a token, including every chat request. Bounding the wait
 * keeps the UI responsive; a stale or rejected token still surfaces as an
 * ordinary 401 that the existing auth flow handles.
 */
export const SESSION_TIMEOUT_MS = 4000;

/** Storage key supabase-js persists the session under: sb-<project-ref>-auth-token. */
function sessionStorageKey(): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * The session supabase-js has persisted, read straight from storage with no
 * network call. Only used as a fallback when getSession() does not settle.
 */
export function readCachedSession(): Session | null {
  if (typeof localStorage === 'undefined') return null;

  const candidates = [sessionStorageKey(), ...Object.keys(localStorage)];
  for (const key of candidates) {
    if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.access_token === 'string') return parsed as Session;
    } catch {
      // Malformed entry - try the next candidate key.
    }
  }
  return null;
}

export function readCachedAccessToken(): string | null {
  return readCachedSession()?.access_token ?? null;
}
