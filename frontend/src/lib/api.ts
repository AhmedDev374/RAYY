import { SESSION_TIMEOUT_MS, readCachedAccessToken, supabase } from './supabase';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

// Thrown for non-2xx API responses. Carries the HTTP status so callers (and the
// QueryClient's retry logic) can distinguish "session expired" (401) — which
// should never be retried — from transient/server errors, which may be.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * The Supabase access token, obtained without ever blocking indefinitely.
 *
 * `supabase.auth.getSession()` refreshes an expired session internally and that
 * request has no timeout, so a single stalled refresh leaves the returned
 * promise pending forever. Awaited before every chat request, that hung the
 * send path before `fetch()` was ever reached. We cap the wait and reuse the
 * token already cached in storage - Supabase accepts it until it actually
 * expires, and a bad token surfaces as a normal 401.
 */
async function readSupabaseAccessToken(): Promise<string | null> {
  const client = supabase;
  if (!client) return null;

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, SESSION_TIMEOUT_MS);
  });

  const session = await Promise.race([
    client.auth
      .getSession()
      .then(({ data }) => data.session)
      .catch(() => null),
    deadline,
  ]);
  if (timer !== undefined) clearTimeout(timer);

  if (!timedOut) return session?.access_token ?? null;

  console.warn(
    `[api] supabase.auth.getSession() did not settle within ${SESSION_TIMEOUT_MS}ms; using the cached session token`,
  );
  return readCachedAccessToken();
}

export async function getAccessToken(): Promise<string | null> {
  if (supabase) {
    const token = await readSupabaseAccessToken();
    if (!token) {
      console.warn('[api] No Supabase session token available');
    }
    return token;
  }
  return localStorage.getItem('access_token');
}

export function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

// Tracks whether we've already redirected to /login for an expired/invalid
// session in this page load, so a burst of in-flight requests that all fail
// with 401 only triggers a single sign-out + redirect instead of repeating it
// (and instead of retrying the doomed request).
let sessionExpiredHandled = false;

export async function handleUnauthorizedResponse(_detail?: string) {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  if (supabase) {
    await supabase.auth.signOut();
  }
  clearTokens();
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

// Shared React Query retry predicate: never retry an expired/invalid session
// (401) — api()/the diagnose upload already sign the user out and redirect
// to /login on the first 401, so retrying just re-sends a doomed request and
// produces the repeated-401 log spam this was built to fix. Other failures
// (network blips, 5xx) get a couple of quick retries.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return false;
  return failureCount < 2;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    const err = await res.json().catch(() => ({ detail: 'Unauthorized' }));
    console.warn('[api] 401 on', path, err.detail);
    await handleUnauthorizedResponse(err.detail);
    throw new ApiError(err.detail || 'Session expired — please log in again.', 401);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(err.detail || 'Request failed', res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function useApiReady() {
  const { session, loading } = useAuth();
  return { ready: !loading && !!session, session };
}
