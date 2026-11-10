import Link from "next/link";
import { LogoMark } from "../brand-logo";
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
              <LogoMark size={19} />
            </span>
            saring<span className="brand-dot">.</span>
          </span>
          <span className="public-topbar-label">Portal pelamar</span>
        </header>
        <main>
          <div className="public-center">{children}</div>
        </main>
        <footer className="page-footer">
          <span>
            saring<span>.</span> <i />
            Lebih dekat dengan talenta yang tepat.
          </span>
          <span className="public-footer-links">
            <Link href="/privacy">Kebijakan privasi</Link>
            <i />
            AI membantu, HR yang memutuskan
          </span>
        </footer>
      </div>
    </div>
  );
}
