"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import logo from "@/assets/logo.png";
import Rays from "@/components/Rays";
import { ApiError } from "@/admin/api";
import { useAuth } from "@/admin/auth";

export default function LoginPage() {
  const { state, signIn } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state.status === "signed-in") {
      router.replace(state.me.must_change_password ? "/admin/account" : "/admin");
    }
  }, [state, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    if (!username || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signIn(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="adm-login">
      <Rays variant="band" />
      <div className="adm-login-card">
        <Link href="/" className="adm-brand">
          <span className="adm-brand-badge"><Image src={logo} alt="" width={40} priority /></span>
          <span>
            <strong>Heal The World</strong>
            <small>Church admin</small>
          </span>
        </Link>
        <div>
          <h1>Staff sign in</h1>
          <p className="adm-login-foot">For church staff only. Every sign-in is recorded.</p>
        </div>
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {error && <p className="adm-error" role="alert">{error}</p>}
          <button className="adm-btn adm-btn-primary" type="submit" disabled={busy || state.status === "loading"}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="adm-login-foot">
          Forgot your password? Ask an Admin or System Admin to reset it for you.
        </p>
      </div>
    </div>
  );
}
