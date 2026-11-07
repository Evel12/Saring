import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Funnel } from "lucide-react";
import { SESSION_COOKIE, safeNext } from "@/lib/demo-auth";
import { LoginForm } from "./login-form";
import "../(public)/public.css";

export const metadata: Metadata = {
  title: "Masuk — Saring",
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next);
  if ((await cookies()).has(SESSION_COOKIE)) redirect(target);

  return (
    <div className="app-shell public-shell">
      <div className="main-shell">
        <header className="public-topbar">
          <span className="public-brand">
            <span className="brand-mark">
              <Funnel size={20} strokeWidth={2} />
            </span>
            saring<span className="brand-dot">.</span>
          </span>
          <span className="public-topbar-label">Ruang kerja HRD</span>
        </header>
        <main>
          <LoginForm next={target} />
          <footer className="page-footer">
            <span>
              saring<span>.</span> <i />
              Lebih dekat dengan talenta yang tepat.
            </span>
            <span>Pelamar tidak perlu login. Cukup buka link lamaran.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
