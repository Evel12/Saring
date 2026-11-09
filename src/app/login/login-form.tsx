"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  TriangleAlert,
} from "lucide-react";
import { ApiError, post } from "@/lib/api";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!email.trim() || !password) {
      setError("Isi email dan kata sandi.");
      emailInput.current?.focus();
      return;
    }
    setSending(true);
    setError("");
    try {
      await post("/auth/login", { email: email.trim(), password });
      // Full navigation so the server layout sees the new session cookie.
      window.location.assign(next);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401
          ? "Email atau kata sandi salah."
          : status === 429
            ? "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
            : status === 0 || status >= 500
              ? "Server Saring tidak terhubung. Pastikan start-api.cmd berjalan."
              : "Tidak bisa masuk sekarang. Coba lagi sebentar lagi.",
      );
      setSending(false);
    }
  }

  return (
    <section className="panel public-message login-card">
      <span className="job-icon sage">
        <LockKeyhole size={20} />
      </span>
      <h1>Masuk ke Saring</h1>
      <p className="login-intro">
        Kelola lowongan, tinjau kandidat, dan setujui undangan interview.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div className="public-field">
          <label htmlFor="login-email">Email kerja</label>
          <input
            ref={emailInput}
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="public-field">
          <label htmlFor="login-password">Kata sandi</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="public-alert" role="alert" id="login-error">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </div>
        )}
        <button
          className="button primary public-submit"
          type="submit"
          disabled={sending}
        >
          {sending ? (
            <>
              <LoaderCircle className="spin" size={16} />
              Masuk...
            </>
          ) : (
            <>
              Masuk
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </section>
  );
}
