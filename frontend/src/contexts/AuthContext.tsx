import { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { SESSION_TIMEOUT_MS, readCachedSession, supabase, supabaseConfigured } from '../lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const finish = (next: Session | null) => {
      if (cancelled) return;
      setSession(next);
      setLoading(false);
    };

    // Subscribe BEFORE the initial getSession() read. supabase-js emits
    // INITIAL_SESSION / SIGNED_IN as soon as it has restored a session - often
    // within the first tick - and a listener registered afterwards misses that
    // event on an OAuth callback, leaving `session` null (and the app looking
    // logged out) even though a session exists. Subscribing first means no
    // state change can be missed; the read below only seeds the initial value.
    const { data: sub } = supabase.auth.onAuthStateChange((event: string, s: Session | null) => {
      if (cancelled) return;
      if (import.meta.env.DEV) {
        console.info('[auth] onAuthStateChange:', event, s ? `user=${s.user?.email}` : '(signed out)');
      }
      // Any definitive auth event settles initialisation: we now know the real
      // state, so stop withholding the protected routes.
      setSession(s);
      setLoading(false);
    });

    // getSession() can stay pending forever if its token refresh stalls (see
    // SESSION_TIMEOUT_MS), which used to leave the whole app sitting on
    // "Loading…". Fall back to the cached session instead of gating on it.
    // Loading is only cleared here as a last resort: `loading` must stay true
    // until Supabase has actually answered, or a protected route would treat an
    // un-restored session as "signed out" and bounce to /login.
    const timer = setTimeout(() => finish(readCachedSession()), SESSION_TIMEOUT_MS);

    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        clearTimeout(timer);
        if (import.meta.env.DEV) {
          console.info('[auth] initial getSession():', data.session ? `user=${data.session.user?.email}` : 'no session');
        }
        finish(data.session);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        console.error('[auth] initial getSession() failed:', err);
        finish(readCachedSession());
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    if (supabase) {
      const { error: err } = await supabase.auth.signOut();
      if (err) console.error('[auth] signOut failed:', err);
    }
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
