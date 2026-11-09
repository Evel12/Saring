import Link from "next/link";
import { Funnel } from "lucide-react";
import "./public.css";

export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
          <span className="public-topbar-label">Portal pelamar</span>
        </header>
        <main>
          {children}
          <footer className="page-footer">
            <span>
              saring<span>.</span> <i />
              Lebih dekat dengan talenta yang tepat.
            </span>
            <span className="public-footer-links">
              <Link href="/privacy">Kebijakan privasi</Link>
              <i />
              Prototipe · Data belum dikirim ke server
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
