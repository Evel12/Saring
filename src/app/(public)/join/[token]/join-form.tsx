"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Link2Off,
  LoaderCircle,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { ApiError, post } from "@/lib/api";
import { roleLabel } from "@/lib/session";
import { PublicMessage } from "../../public-ui";

type Preview = {
  organization_name: string;
  email: string;
  display_name: string;
  role: string;
  account_exists: boolean;
};

// Menerima undangan tim: orang yang diundang membuat password-nya sendiri.
export function JoinForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    post<Preview>("/auth/team-invitations/preview", { token })
      .then((p) => {
        setPreview(p);
        setName(p.display_name);
      })
      .catch(() => setInvalid(true));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!preview || sending) return;
    if (!preview.account_exists) {
      if (password.length < 12)
        return setError("Password minimal 12 karakter.");
      if (password !== confirm)
        return setError("Konfirmasi password belum sama.");
    }
    setSending(true);
    setError("");
    try {
      await post("/auth/team-invitations/accept", {
        token,
        password,
        ...(preview.account_exists ? {} : { display_name: name.trim() }),
      });
      window.location.assign("/dashboard");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401
          ? "Password akun salah."
          : status === 404
            ? "Undangan tidak berlaku. Minta admin mengirim ulang undangan."
            : status === 429
              ? "Terlalu banyak percobaan. Coba lagi sebentar lagi."
              : "Belum berhasil bergabung. Coba lagi.",
      );
      setSending(false);
    }
  }

  if (invalid)
    return (
      <PublicMessage
        icon={<Link2Off size={22} />}
        tone="sand"
        title="Undangan tidak berlaku"
      >
        <p>
          Link ini sudah dipakai, dibatalkan, atau kedaluwarsa. Minta admin
          perusahaanmu mengirim ulang undangan.
        </p>
      </PublicMessage>
    );
  if (!preview)
    return (
      <PublicMessage
        icon={<LoaderCircle className="spin" size={22} />}
        title="Memeriksa undangan…"
      >
        <p>Sebentar ya.</p>
      </PublicMessage>
    );

  return (
    <section className="panel public-message login-card">
      <span className="job-icon sage">
        <UserPlus size={20} />
      </span>
      <h1>Gabung ke {preview.organization_name}</h1>
      <p className="login-intro">
        Kamu diundang sebagai <strong>{roleLabel(preview.role)}</strong> di
        ruang kerja Saring.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div className="public-field">
          <label htmlFor="join-email">Email</label>
          <input id="join-email" value={preview.email} readOnly />
        </div>
        {preview.account_exists ? (
          <div className="public-field">
            <label htmlFor="join-password">Password akun Saring-mu</label>
            <input
              id="join-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="public-field-hint">
              Email ini sudah punya akun Saring; masuk dengan password yang
              sama.
            </span>
          </div>
        ) : (
          <>
            <div className="public-field">
              <label htmlFor="join-name">Nama</label>
              <input
                id="join-name"
                value={name}
                maxLength={160}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="public-field">
              <label htmlFor="join-password">Buat password</label>
              <input
                id="join-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="public-field-hint">
                Minimal 12 karakter{" "}
                {password.length > 0 && `(${password.length}/12)`}. Hanya kamu
                yang tahu password ini.
              </span>
            </div>
            <div className="public-field">
              <label htmlFor="join-confirm">Ulangi password</label>
              <input
                id="join-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </>
        )}
        {error && (
          <div className="public-alert" role="alert">
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
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          Gabung ke tim
        </button>
      </form>
    </section>
  );
}
