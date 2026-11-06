"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type Me } from "./api";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: Me };

type AuthContextValue = {
  state: AuthState;
  me: Me | null;
  can: (perm: string) => boolean;
  signIn: (username: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  setMe: (me: Me) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api<Me>("/auth/me")
      .then((me) => !cancelled && setState({ status: "signed-in", me }))
      .catch(() => !cancelled && setState({ status: "signed-out" }));
    const onSignedOut = () => setState({ status: "signed-out" });
    const onPasswordRequired = () =>
      setState((s) => (s.status === "signed-in" ? { status: "signed-in", me: { ...s.me, must_change_password: true } } : s));
    window.addEventListener("admin:signed-out", onSignedOut);
    window.addEventListener("admin:password-required", onPasswordRequired);
    return () => {
      cancelled = true;
      window.removeEventListener("admin:signed-out", onSignedOut);
      window.removeEventListener("admin:password-required", onPasswordRequired);
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const me = await api<Me>("/auth/login", { method: "POST", json: { username, password } });
    setState({ status: "signed-in", me });
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setState({ status: "signed-out" });
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const me = state.status === "signed-in" ? state.me : null;
    return {
      state,
      me,
      can: (perm: string) => !!me && me.permissions.includes(perm),
      signIn,
      signOut,
      setMe: (m: Me) => setState({ status: "signed-in", me: m }),
    };
  }, [state, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
