import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, clearTokens, shouldRetry } from './api';

// These tests exercise the local-token fallback path in getAccessToken()
// (used when Supabase isn't configured, e.g. this test environment). The
// Supabase-session path is a thin wrapper around the same `api()` function
// and is covered by manual/E2E testing against a real Supabase project.

describe('api() — sends the current access token', () => {
  beforeEach(() => {
    localStorage.setItem('access_token', 'test-token-123');
  });
  afterEach(() => {
    clearTokens();
    vi.restoreAllMocks();
  });

  it('attaches Authorization: Bearer <token> to every request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/api/v1/plants');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-token-123',
    );
  });
});

describe('api() — 401 handling', () => {
  beforeEach(() => {
    localStorage.setItem('access_token', 'expired-token');
  });
  afterEach(() => {
    clearTokens();
    vi.restoreAllMocks();
    // jsdom doesn't support real navigation; guard against leaking state.
  });

  it('throws an ApiError with status 401 and clears local tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Supabase JWT verification failed' }), {
        status: 401,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    // jsdom throws on window.location.href assignment to a relative path in
    // some configs; stub it out since we only care about the thrown error.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '', pathname: '/dashboard' },
      writable: true,
    });

    await expect(api('/api/v1/plants')).rejects.toMatchObject({
      status: 401,
      name: 'ApiError',
    });
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});

describe('shouldRetry — React Query retry policy', () => {
  it('never retries a 401 (expired/invalid session)', () => {
    expect(shouldRetry(0, new ApiError('Unauthorized', 401))).toBe(false);
    expect(shouldRetry(1, new ApiError('Unauthorized', 401))).toBe(false);
  });

  it('retries other failures up to 2 times', () => {
    expect(shouldRetry(0, new ApiError('Server error', 500))).toBe(true);
    expect(shouldRetry(1, new ApiError('Server error', 500))).toBe(true);
    expect(shouldRetry(2, new ApiError('Server error', 500))).toBe(false);
  });

  it('retries non-ApiError failures (e.g. network errors) up to 2 times', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(2, new TypeError('Failed to fetch'))).toBe(false);
  });
});
