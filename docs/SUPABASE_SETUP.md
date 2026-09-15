# Supabase setup — رَيّ — RAYY

Project URL: `https://ftaxppokgpmsnuipvvvt.supabase.co`

## 1. Frontend (done)

`frontend/.env` is configured with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

Restart the dev server after any env change:

```bash
cd frontend && npm run dev
```

## 2. Backend — still required

Add to `backend/.env`:

| Variable | Where to find it |
|----------|------------------|
| `AUTH_MODE` | Set to `supabase` (this is the default) |
| `SUPABASE_URL` | Same value as the frontend's `VITE_SUPABASE_URL` |
| `DATABASE_URL` | Settings → Database → **Connection string** → URI (use **Session pooler**, port 6543), or `sqlite:///./data/app.db` for local dev |

`SUPABASE_JWT_SECRET` is **not** needed — the backend verifies Supabase access
tokens against Supabase's public JWKS endpoint
(`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), which uses asymmetric
signing, not a shared secret. If your backend logs `Auth mode: legacy` at
startup, `AUTH_MODE` was left unset or set to `legacy` — set
`AUTH_MODE=supabase` and restart.

Then restart the backend:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

## 3. Google sign-in

The app calls `supabase.auth.signInWithOAuth({ provider: 'google' })`. Google is
never contacted by the frontend directly: **Supabase runs the whole exchange**,
so Supabase — not this app — is the OAuth client Google knows about.

That means there are **two different redirect URLs** in play, and both must be
registered in different places:

| Hop | URL | Registered in |
|-----|-----|---------------|
| Google → Supabase | `https://ftaxppokgpmsnuipvvvt.supabase.co/auth/v1/callback` | Google Cloud Console → OAuth client → **Authorized redirect URIs** |
| Supabase → this app | `http://localhost:5173/auth/callback` | Supabase → Authentication → **URL Configuration → Redirect URLs** |

The flow is `Google → Supabase → localhost`. Registering the localhost URL in
Google, or the Supabase URL in Supabase, does not work — each hop has its own
list.

### Step A — Google Cloud Console

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Edit your **OAuth 2.0 Client ID**. Its **Application type must be
   `Web application`** — other types (Desktop, iOS, Android, Chrome extension)
   either cannot hold a redirect URI or cannot hold a client secret, and cannot
   be used with Supabase. If the only client you have is not a web application,
   create a **new** one rather than adding credentials to the wrong type.
3. Under **Authorized redirect URIs**, add **exactly** (no trailing slash):

   ```
   https://ftaxppokgpmsnuipvvvt.supabase.co/auth/v1/callback
   ```

4. Under **Authorized JavaScript origins**, add:

   ```
   http://localhost:5173
   https://ftaxppokgpmsnuipvvvt.supabase.co
   ```

5. Save. Changes can take a few minutes to apply.

### Step B — Supabase Dashboard

1. [Authentication → Providers → Google](https://supabase.com/dashboard/project/ftaxppokgpmsnuipvvvt/auth/providers)
   — enable it, then paste the **Client ID** and **Client Secret** from **that
   same web-application client**. Paste the secret with no leading/trailing
   space or newline: a copy-paste whitespace bug here is a documented cause of
   the failure below.
2. [Authentication → URL configuration](https://supabase.com/dashboard/project/ftaxppokgpmsnuipvvvt/auth/url-configuration):
   - **Site URL:** `http://localhost:5173`
   - **Redirect URLs:** add `http://localhost:5173/auth/callback`
     (`?redirect=…` is appended to this URL at runtime; Supabase matches on the
     origin+path, so no wildcard is needed for that query string.)

You can verify Supabase actually reached Google under
**Authentication → Logs**, which records the provider exchange and the exact
upstream error.

### Troubleshooting: which of the two redirects is wrong

The two failure modes look completely different, and confusing them wastes time:

| What you see | Where it failed | What to fix |
|--------------|-----------------|-------------|
| Google's own page: `Error 400: redirect_uri_mismatch` | Google → Supabase, **before** any code is issued | Step A: add the Supabase callback as an Authorized redirect URI. The app's `/auth/callback` is irrelevant here. |
| You sign in at Google successfully, then `/auth/callback` shows `error=server_error&error_code=unexpected_failure&error_description=Unable to exchange external code` | Supabase → Google **token** endpoint (`/auth/v1/callback`, server-side) | Step B: the **Client Secret**. See below. |
| `/auth/callback` shows `redirect_to` not allowed | Supabase → this app | Step B: add `http://localhost:5173/auth/callback` to Redirect URLs. |
| `/auth/callback` shows a PKCE / code-verifier error | this browser | The `code_verifier` in `localStorage` was cleared or the callback was opened in another browser/profile between the redirect and the return. |

**Why `Unable to exchange external code` means the Client Secret, not the
redirect URL:** Google validates the `redirect_uri` when it *issues* the
authorization code, and validates the `client_secret` only later, when Supabase
POSTs the code to `https://oauth2.googleapis.com/token`. Reaching the exchange
at all therefore proves the redirect URL is correct — the account picker would
never have appeared otherwise — and leaves the credential pair as the only thing
left to fail. In practice this is one of:

- the **Client Secret was regenerated** in Google and Supabase still holds the old one;
- the Client ID and Secret are **from different clients** (commonly one from a
  previous Google Cloud project or a previous Supabase project);
- the secret was pasted with a **trailing space/newline**;
- the OAuth client is **not a Web application** and has no usable secret.

To rule the pair out completely: in Google Cloud Console, open the client, copy
its **Client ID**, and confirm the very same clients list shows that ID, then
use **Add secret** / reset to mint a fresh secret, paste it into Supabase, save,
and retry in a fresh incognito window.

### Google OAuth consent screen

If the consent screen is still in **Testing** mode, only accounts listed under
**OAuth consent screen → Test users** can complete sign-in. Add the Google
account you are testing with, or publish the app. Note that a missing test user
fails at Google's own screen with `access_denied` — it does *not* produce the
token-exchange error above, so do not chase it for that symptom.

### Verifying the fix

A successful sign-in must do all of these:

1. `http://localhost:5173/auth/callback` is reached **without** `error=…` in the URL.
2. The console (development builds log `[auth/callback]` and `[auth]` lines)
   shows a session with a real email.
3. The app lands on the requested page, by default `http://localhost:5173/dashboard`.
4. The account appears in Supabase → **Authentication → Users**, with
   `provider = google`.

Until step 4 is true, nothing downstream can work — do not work around it with a
manual `public.users` row or a hand-written session.

## 4. Email sign-in

Enabled by default. For local dev, you may disable email confirmation under
**Authentication → Providers → Email**.

## Security note

The **anon key** is safe to use in the browser. Never put the **service role
key** or **JWT secret** in the frontend, and never commit a Google **Client
Secret** — it belongs only in the Supabase dashboard.
