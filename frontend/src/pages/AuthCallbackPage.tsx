import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AUTH_REDIRECT_STATE_KEY, DEFAULT_AUTH_REDIRECT, safeInternalPath } from '../lib/authRedirect';
import { supabase, supabaseConfigured } from '../lib/supabase';

/**
 * Development-only tracing for the OAuth round trip.
 *
 * The callback URL carries a single-use authorization code, and a successful
 * callback carries the account's email and provider. Neither belongs in a
 * production console, so every line logged through here is gated behind
 * `import.meta.env.DEV`. Genuine failures stay on `console.error` in every
 * build - the error is the whole point of this route, and it never contains a
 * token, a refresh token or a client secret.
 */
const trace = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.info('[auth/callback]', ...args);
};

/**
 * Where to send the user once the Supabase session is established.
 *
 * Read synchronously from this URL's `redirect` query parameter, where
 * LoginPage's `redirectTo` put it (Supabase echoes redirectTo back verbatim),
 * so it is captured before anything can clear it. Anything unsafe - an external
 * origin, a scheme-relative URL such as `//evil.example`, or the sign-in transit
 * pages themselves - is rejected by `safeInternalPath` in favour of the recorded
 * intent and finally /dashboard; only same-origin paths survive.
 */
function readDestination(): string {
  const raw = new URLSearchParams(window.location.search).get('redirect');
  if (raw) {
    const safe = safeInternalPath(raw);
    if (safe) return safe;
  }

  // No usable parameter (e.g. a state-only flow): fall back to the destination
  // recorded when /login was entered. Already sanitised, and never /login.
  const state = window.history.state as { usr?: Record<string, unknown> } | null;
  const fromState = safeInternalPath(
    typeof state?.usr?.[AUTH_REDIRECT_STATE_KEY] === 'string'
      ? (state.usr[AUTH_REDIRECT_STATE_KEY] as string)
      : null,
  );
  if (fromState) return fromState;

  return DEFAULT_AUTH_REDIRECT;
}

/**
 * Turn whatever Supabase/Google handed back into something readable.
 *
 * Supabase reports OAuth failures as `error` / `error_code` /
 * `error_description` query parameters on this URL, so a bare "sign-in failed"
 * hides the one line that says what actually went wrong (e.g. "Unable to
 * exchange external code", "PKCE code verifier not found in storage").
 */
/**
 * This project's Supabase OAuth callback, derived from the configured project
 * URL rather than hardcoded, so a diagnostic can never point at a stale ref
 * left over from a previous Supabase project.
 */
function supabaseCallbackUrl(): string {
  const raw = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (!raw) return 'https://<project-ref>.supabase.co/auth/v1/callback';
  try {
    return `${new URL(raw).origin}/auth/v1/callback`;
  } catch {
    return `${raw.replace(/\/+$/, '')}/auth/v1/callback`;
  }
}

/**
 * Explain where an OAuth failure happened, in the order the flow runs.
 *
 * Supabase's own error strings are easy to misread: "Unable to exchange
 * external code" is raised by the Supabase auth server while swapping Google's
 * authorization code for tokens - *before* this React page is ever reached.
 * Nothing in this component can cause or fix it, so say that plainly instead of
 * leaving a message that sends the reader looking in the wrong place.
 */
function classifyOAuthFailure(description: string): string | null {
  const text = description.toLowerCase();
  if (text.includes('exchange external code')) {
    return (
      'Fail point: Supabase ⇄ Google - the server-side token exchange Supabase performs BEFORE ' +
      'this page loads. The message quotes a Google authorization code (4/...), and Google only ' +
      `issues one when ${supabaseCallbackUrl()} is already an Authorized redirect URI on that ` +
      'exact OAuth client, so hop 1 of the redirect is registered correctly and the failure is ' +
      'the exchange itself. Google checks the Client Secret only at this token endpoint, never ' +
      "while it shows the account picker, so 'the picker worked but the exchange failed' means " +
      'the Secret in Supabase → Authentication → Providers → Google does not match the Client ID ' +
      'next to it: a rotated/regenerated secret, a secret copied from a different OAuth client ' +
      'or Google Cloud project, an empty field, or one pasted with a trailing space or newline. ' +
      "The provider's own reason is in Supabase → Logs → Auth Logs, which names the exact " +
      "rejection (invalid_client, redirect_uri_mismatch, invalid_grant); compare the Client ID " +
      'and Secret there before changing anything.'
    );
  }
  if (text.includes('redirect') && text.includes('not allowed')) {
    return 'Fail point: Supabase → this app. Add this callback URL under Authentication → URL Configuration → Redirect URLs.';
  }
  if (text.includes('code verifier') || text.includes('pkce')) {
    return 'Fail point: PKCE verifier missing/mismatched in this browser (see the PKCE note in lib/supabase.ts).';
  }
  return null;
}

function describeOAuthFailure(url: URL): string | null {
  const description = url.searchParams.get('error_description');
  const code = url.searchParams.get('error_code');
  const error = url.searchParams.get('error');
  if (!description && !error && !code) return null;

  const decoded = [description, error]
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part as string);
      } catch {
        return part as string;
      }
    })
    .join(' - ');

  return code ? `${decoded} (${code})` : decoded;
}

/** The long-form diagnostic shown under the error, including the fail point. */
function oauthFailureDetail(url: URL): string {
  const raw = describeOAuthFailure(url) ?? 'oauth_error';
  const hint = classifyOAuthFailure(raw);
  return hint ? `${raw}\n\n${hint}` : raw;
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');

  // Resolved once, on first render, so the effect and the "back to login" link
  // agree on the destination. Read synchronously here - the OAuth parameters are
  // still in the URL at this point, and reading them later (after the effect's
  // async work has navigated) is what loses them.
  const [destination] = useState(readDestination);

  useEffect(() => {
    if (!supabase) {
      console.error('[auth/callback] Supabase is not configured; cannot complete sign-in.');
      navigate('/login', { replace: true });
      return;
    }

    const client = supabase;
    let cancelled = false;


    const finish = (session: Session | null, message?: string, why?: string) => {
      if (cancelled) return;
      if (session) {
        trace('session established for', session.user?.email ?? session.user?.id);
        // Success: the page the user originally asked for, whatever it was.
        navigate(destination, { replace: true });
      } else {
        // A genuine failure. Report it here and STAY on this page - the error
        // text is the whole point of the callback route. Navigating away to
        // /login immediately destroyed the evidence (and re-ran the OAuth
        // params through a second page), which is why an "Unable to exchange
        // external code" failure looked like a routing problem.
        console.error('[auth/callback] sign-in failed:', message ?? 'unknown error');
        setError(message ?? 'تعذّر إكمال تسجيل الدخول. حاول مرة أخرى.');
        setDetail(why ?? '');
      }
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      trace('auth state event:', event, session ? '(with session)' : '(no session)');
      if (event === 'SIGNED_IN' && session) {
        // Confirm against the auth server that this is a real, Google-backed
        // user before treating sign-in as complete. `getUser()` round-trips to
        // Supabase, so it is the check that matches what you see in
        // Authentication → Users; a session that exists only in localStorage
        // fails here, which is precisely the case that used to look confirmed.
        void client.auth.getUser().then(({ data, error: userError }) => {
          if (userError || !data.user) {
            console.error(
              '[auth/callback] session present but getUser() failed:',
              userError ?? 'no user returned',
            );
            return;
          }
          trace(
            'verified user:',
            data.user.email,
            '| provider =',
            data.user.app_metadata?.provider,
          );
          finish(session);
        });
      }
    });

    const handleCallback = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      // Set when the explicit exchange below fails. Deliberately NOT treated as
      // proof of failure on its own - see that branch for why.
      let exchangeFailure: string | null = null;

      // Log exactly what arrived, so a stuck flow is diagnosable from the
      // console instead of guessed at. The `code` is truncated: it is a
      // single-use credential and a full dump in the console is not needed to
      // tell whether it was present.
      trace('received', {
        hasCode: Boolean(code),
        codePreview: code ? `${code.slice(0, 8)}…` : null,
        error: url.searchParams.get('error'),
        errorCode: url.searchParams.get('error_code'),
        redirect: url.searchParams.get('redirect'),
      });

      // Supabase reports OAuth failures on this URL itself. This is a real
      // error - do not fall through and claim success.
      const oauthFailure = describeOAuthFailure(url);
      if (oauthFailure) {
        console.error('[auth/callback] Supabase/Google reported an OAuth error:', {
          error: url.searchParams.get('error'),
          errorCode: url.searchParams.get('error_code'),
          errorDescription: url.searchParams.get('error_description'),
          rawUrl: url.toString(),
        });
        console.error('[auth/callback]', classifyOAuthFailure(oauthFailure) ?? 'unclassified');
        finish(null, oauthFailure, oauthFailureDetail(url));
        return;
      }

      if (code) {
        const { data: exchangeData, error: exchangeError } =
          await client.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          // NOT immediately fatal, and no longer reported as one.
          //
          // `detectSessionInUrl: true` (lib/supabase.ts) makes supabase-js
          // redeem a `?code=` itself while initializing - GoTrueClient's
          // _getSessionFromURL() calls _exchangeCodeForSession() - and
          // exchangeCodeForSession() awaits that same initialization before it
          // runs. This explicit call can therefore redeem a code the library
          // already consumed, and Supabase rejects a single-use code the second
          // time with an error that says nothing about whether sign-in actually
          // worked. Treating it as failure here raced the successful SIGNED_IN
          // path above, intermittently showing "Sign-in failed" for a session
          // that had just been created. The session checks below decide instead;
          // this is kept only as the explanation if no session materialises.
          console.error(
            '[auth/callback] exchangeCodeForSession did not redeem the code (the session check below decides):',
            exchangeError,
          );
          exchangeFailure = `${exchangeError.name}: ${exchangeError.message}`;
        }

        const exchangedUser = exchangeData?.session?.user ?? exchangeData?.user ?? null;
        trace(
          'exchangeCodeForSession ok; user =',
          exchangedUser?.email ?? exchangedUser?.id ?? '(none returned)',
        );

        // A session from the exchange is authoritative: the code was just
        // redeemed for it. Report success immediately rather than re-reading
        // storage, which is where a race would otherwise lose the session.
        if (exchangeData?.session) {
          finish(exchangeData.session);
          return;
        }
      } else {
        trace(
          'no `code` in the URL. If the Google round trip completed, ' +
            'the Supabase redirect URL allowlist probably does not include this exact URL.',
        );
      }

      // getSession() must not be allowed to hang this page: it performs an
      // untimed token refresh internally, and a stalled one would leave the user
      // on "Signing you in…" forever. If it does not settle but a session *is*
      // present in storage, the exchange above already succeeded - continue to
      // the destination rather than declaring the user signed out.
      let settled = false;
      const onTimeout = async () => {
        if (cancelled || settled) return;
        let stillThere: Session | null = null;
        try {
          const { data } = await client.auth.getSession();
          stillThere = data.session;
        } catch {
          stillThere = null;
        }
        if (cancelled) return;
        // No session anywhere: report it rather than pretending the sign-in
        // worked and sending the user somewhere they cannot use.
        finish(
          stillThere,
          stillThere ? undefined : (exchangeFailure ?? 'تعذّر إكمال تسجيل الدخول. حاول مرة أخرى.'),
          stillThere ? undefined : (exchangeFailure ?? undefined),
        );
      };
      const timeout = setTimeout(() => {
        void onTimeout();
      }, 8000);

      const { data: { session }, error: sessionError } = await client.auth.getSession();
      settled = true;
      clearTimeout(timeout);

      // Only a genuine Supabase error, or a code exchange that never produced a
      // session, counts as failure. A missing session here is NOT proof of
      // failure: `onAuthStateChange` above may already have completed the
      // sign-in, so leave the user on this page to let that path finish instead
      // of bouncing them back to /login.
      if (sessionError && sessionError.name !== 'AuthSessionMissingError') {
        console.error('[auth/callback] getSession failed:', sessionError);
        finish(null, sessionError.message, `${sessionError.name}: ${sessionError.message}`);
        return;
      }
      if (session) {
        finish(session);
        return;
      }

      const deadline = Date.now() + 6000;
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        const { data } = await client.auth.getSession();
        if (data.session) {
          finish(data.session);
          return;
        }
      }

      console.error(
        '[auth/callback] no session after the OAuth round trip. Check, in order: ' +
          '(1) Supabase → Authentication → URL Configuration → Redirect URLs contains ' +
          'this exact origin+path; (2) Authentication → Providers → Google is enabled ' +
          'and its Client ID/Secret are correct; (3) the browser is not blocking ' +
          'localStorage for this origin.',
      );
      finish(
        null,
        exchangeFailure ?? 'لم يتم إنشاء جلسة. راجع وحدة التحكم (Console) لمعرفة السبب.',
        exchangeFailure ?? 'no_session_after_oauth',
      );
    };

    void handleCallback();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div dir="rtl" lang="ar" className="font-arabic min-h-screen flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-leaf-700">{error ? 'Sign-in failed' : 'Signing you in…'}</p>
      {error && (
        <>
          <p className="text-red-600 text-sm text-center max-w-md">{error}</p>
          {detail && (
            <pre
              dir="ltr"
              className="text-xs text-gray-600 text-left whitespace-pre-wrap break-words max-w-2xl bg-gray-50 border-gray-200 rounded-lg p-3"
            >
              {detail}
            </pre>
          )}
          <Link
            to={`/login?redirect=${encodeURIComponent(destination)}`}
            className="text-leaf-700 underline text-sm"
          >
            العودة إلى تسجيل الدخول
          </Link>
        </>
      )}
    </div>
  );
}
