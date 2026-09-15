"""
Auth tests for the Supabase-backed authentication flow (AUTH_MODE=supabase,
the default). These cover the original bug: the backend rejecting valid
Supabase access tokens because it was stuck on the legacy JWT path.

We never make real network calls to Supabase's JWKS endpoint in tests —
`verify_supabase_token` is monkeypatched to simulate the outcome of that
verification (valid / invalid / expired), the same way it would behave for
real tokens signed by the project's Supabase instance.
"""
import app.services.supabase_auth as supabase_auth_module

PROTECTED_ENDPOINTS = [
    ("GET", "/api/v1/plants"),
    ("GET", "/api/v1/diagnose/history"),
    ("GET", "/api/v1/sensors/blynk/readings?hours=1"),
]

FAKE_SUB = "11111111-1111-1111-1111-111111111111"
FAKE_EMAIL = "grower@example.com"


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _patch_verify(monkeypatch, result):
    """Patch the JWKS-based verifier to return `result` (a dict payload or None)."""
    monkeypatch.setattr(
        supabase_auth_module, "verify_supabase_token", lambda token: result
    )


# ---------------------------------------------------------------------------
# 1. Missing Authorization -> 401
# ---------------------------------------------------------------------------
def test_missing_authorization_returns_401(client):
    for method, path in PROTECTED_ENDPOINTS:
        resp = client.request(method, path)
        assert resp.status_code == 401, f"{method} {path} should 401 with no Authorization header"


# ---------------------------------------------------------------------------
# 2. Invalid Bearer token -> 401
# ---------------------------------------------------------------------------
def test_invalid_bearer_token_returns_401(client, monkeypatch):
    # Simulates a garbage/tampered token: JWKS verification fails -> None.
    _patch_verify(monkeypatch, None)
    resp = client.get("/api/v1/plants", headers=_auth_header("not-a-real-token"))
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Supabase JWT verification failed"


# ---------------------------------------------------------------------------
# 3. Expired token -> 401
# ---------------------------------------------------------------------------
def test_expired_token_returns_401(client, monkeypatch):
    # jose.jwt.decode raises JWTError for an expired `exp` claim; the real
    # verify_supabase_token catches that and returns None, same as invalid.
    _patch_verify(monkeypatch, None)
    resp = client.get("/api/v1/plants", headers=_auth_header("expired-token"))
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 4. Valid Supabase token -> authenticated
# ---------------------------------------------------------------------------
def test_valid_token_authenticates_user(client, monkeypatch):
    _patch_verify(monkeypatch, {"sub": FAKE_SUB, "email": FAKE_EMAIL})
    resp = client.get("/api/v1/auth/me", headers=_auth_header("valid-token"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == FAKE_EMAIL


def test_valid_token_creates_local_user_once(client, monkeypatch):
    # Calling twice with the same `sub` should resolve to the SAME local
    # user (sync-on-login), not create duplicates.
    _patch_verify(monkeypatch, {"sub": FAKE_SUB, "email": FAKE_EMAIL})
    first = client.get("/api/v1/auth/me", headers=_auth_header("valid-token"))
    second = client.get("/api/v1/auth/me", headers=_auth_header("valid-token"))
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


# ---------------------------------------------------------------------------
# 5-7. Protected endpoints succeed once authenticated
# ---------------------------------------------------------------------------
def test_plants_authenticated_request_succeeds(client, monkeypatch):
    _patch_verify(monkeypatch, {"sub": FAKE_SUB, "email": FAKE_EMAIL})
    resp = client.get("/api/v1/plants", headers=_auth_header("valid-token"))
    assert resp.status_code == 200
    assert resp.json() == []


def test_diagnose_history_authenticated_request_succeeds(client, monkeypatch):
    _patch_verify(monkeypatch, {"sub": FAKE_SUB, "email": FAKE_EMAIL})
    resp = client.get("/api/v1/diagnose/history", headers=_auth_header("valid-token"))
    assert resp.status_code == 200
    assert resp.json() == []


def test_diagnose_requires_auth_before_touching_ml_model(client, monkeypatch):
    # Without auth, /diagnose must reject before ever reaching the ML model.
    _patch_verify(monkeypatch, None)
    resp = client.post(
        "/api/v1/diagnose",
        headers=_auth_header("not-a-real-token"),
        files={"file": ("leaf.jpg", b"not-a-real-image", "image/jpeg")},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 8. Logout -> protected requests fail again
# ---------------------------------------------------------------------------
def test_logout_then_protected_requests_fail(client, monkeypatch):
    _patch_verify(monkeypatch, {"sub": FAKE_SUB, "email": FAKE_EMAIL})
    ok = client.get("/api/v1/plants", headers=_auth_header("valid-token"))
    assert ok.status_code == 200

    # "Logout" client-side just means no more token is sent (Supabase session
    # cleared). The backend is stateless, so the next request without a
    # token must be rejected exactly like before login.
    after_logout = client.get("/api/v1/plants")
    assert after_logout.status_code == 401


# ---------------------------------------------------------------------------
# 9. No infinite 401 retry loop (server side: repeated unauthenticated
# requests are each rejected independently and cheaply, never hang or
# recurse). The client-side fix (React Query retry policy) lives in
# frontend/src/App.tsx and frontend/src/lib/api.ts and is covered by
# frontend/src/lib/api.test.ts.
# ---------------------------------------------------------------------------
def test_repeated_unauthenticated_requests_all_401_independently(client):
    for _ in range(5):
        resp = client.get("/api/v1/plants")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Sanity: startup no longer reports the legacy default
# ---------------------------------------------------------------------------
def test_default_auth_mode_is_supabase():
    from app.config import get_settings

    assert get_settings().auth_mode == "supabase"
    assert get_settings().use_supabase_auth is True
