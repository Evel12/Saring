"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  ViewTransition,
} from "react";
import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Funnel,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDashboard } from "./dashboard-context";
import { DEMO_EMAIL } from "@/lib/demo-auth";
import { playIntro, resetIntro } from "@/lib/intro";
import { IndicatorGroup } from "./indicator-group";
import { logout } from "../login/actions";
import { Avatar } from "./candidate-table";

const CANDIDATES = "/dashboard/candidates";

const navigation: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Ringkasan", href: "/dashboard", icon: LayoutDashboard },
  { label: "Lowongan", href: "/dashboard/jobs", icon: BriefcaseBusiness },
  { label: "Kandidat", href: CANDIDATES, icon: Users },
  { label: "Jadwal interview", href: "/dashboard/schedule", icon: CalendarDays },
  { label: "Aktivitas agent", href: "/dashboard/activity", icon: Activity },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    jobs,
    openJobs,
    candidates,
    pending,
    failedInvitations,
    modal,
    setModal,
    toast,
    toastFailed,
    setToast,
  } = useDashboard();
  const [mobileNav, setMobileNav] = useState(false);
  // Pil menu langsung pindah saat diklik, tanpa menunggu halaman selesai dimuat.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activePath = pendingHref ?? pathname;

  useLayoutEffect(() => playIntro(), []);
  useEffect(() => setPendingHref(null), [pathname]);

  function selectNav(event: MouseEvent, href: string) {
    closeMenus();
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    setPendingHref(href);
  }
  const [notifications, setNotifications] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  function goSearch() {
    setMobileNav(false);
    setNotifications(false);
    if (window.location.pathname === CANDIDATES)
      document
        .querySelector<HTMLInputElement>(".candidate-filters input")
        ?.focus();
    else router.push(`${CANDIDATES}?cari=1`);
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotifications(false);
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        dialog.current?.open
      )
        return;
      const target = event.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      event.preventDefault();
      goSearch();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  function closeMenus() {
    setMobileNav(false);
    setNotifications(false);
  }

  const section = navigation.find((item) => isActive(pathname, item.href));
  const jobMatch = pathname.match(/^\/dashboard\/jobs\/([^/]+)(\/approval|\/report)?$/);
  const candidateId = pathname.match(/^\/dashboard\/candidates\/(\d+)$/)?.[1];
  const subPage =
    jobMatch?.[1] === "new"
      ? "Buat lowongan"
      : jobMatch?.[2]
        ? jobMatch[2] === "/report"
          ? "Laporan"
          : "Persetujuan shortlist"
        : jobMatch
          ? jobs.find((job) => job.id === jobMatch[1])?.title
          : candidates.find((c) => String(c.id) === candidateId)?.name;

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="mobile-scrim"
          aria-label="Tutup navigasi"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <Link
          href="/dashboard"
          className="brand"
          aria-label="Saring beranda"
          onClick={closeMenus}
        >
          <span className="brand-mark">
            <Funnel size={23} strokeWidth={2} />
          </span>
          saring<span className="brand-dot">.</span>
          <ChevronDown size={16} className="brand-chevron" />
        </Link>
        <button
          className="workspace-switch"
          onClick={() =>
            setToast("Kamu berada di workspace demo Tim Rekrutmen.")
          }
        >
          <span className="workspace-avatar">S</span>
          <span>
            <strong>Tim Rekrutmen</strong>
            <small>Workspace demo</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button className="sidebar-search" onClick={goSearch}>
          <Search size={17} />
          <span>Cari kandidat...</span>
          <kbd>/</kbd>
        </button>
        <span className="nav-label">Menu utama</span>
        <IndicatorGroup
          as="nav"
          aria-label="Navigasi utama"
          activeKey={activePath}
        >
          {navigation.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${isActive(activePath, href) ? "active" : ""}`}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              data-active={isActive(activePath, href)}
              onClick={(event) => selectNav(event, href)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Lowongan" && (
                <span className="nav-count">{jobs.length}</span>
              )}
              {label === "Kandidat" && (
                <span className="nav-count">{candidates.length}</span>
              )}
            </Link>
          ))}
        </IndicatorGroup>
        <div className="sidebar-collections">
          <span className="nav-label">Lowongan tim</span>
          {openJobs.slice(0, 4).map((job) => (
            <Link
              key={job.id}
              href={`/dashboard/jobs/${job.id}`}
              className="collection-item"
              onClick={closeMenus}
            >
              <span className={`collection-dot ${job.color}`} />
              <span>{job.title}</span>
              <ChevronRight size={13} />
            </Link>
          ))}
          <Link
            href="/dashboard/jobs/new"
            className="collection-add"
            onClick={closeMenus}
          >
            <Plus size={16} />
            Tambah lowongan
          </Link>
        </div>
        <div className="sidebar-bottom">
          <div className="agent-status-card">
            <span className="agent-orb">
              <Sparkles size={17} />
            </span>
            <div>
              <strong>Asistenmu, Saring</strong>
              <span>
                <i />
                Mode demo aktif
              </span>
            </div>
            <span className="tiny-star">✧</span>
          </div>
          <button className="nav-item" onClick={() => setModal("settings")}>
            <Settings2 size={18} />
            <span>Pengaturan</span>
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={18} />
            <span>Pusat bantuan</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-user">
            <Avatar initials="AP" color="sand" />
            <div>
              <strong>Andini Putri</strong>
              <small>HR Manager</small>
            </div>
            <button
              className="icon-button"
              aria-label="Pengaturan profil"
              onClick={() => setModal("settings")}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Buka navigasi"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            {subPage ? (
              <>
                <Link href={section?.href ?? "/dashboard"}>
                  {section?.label}
                </Link>
                <ChevronRight size={13} />
                <strong>{subPage}</strong>
              </>
            ) : (
              <strong>{section?.label}</strong>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="search-shortcut"
              aria-label="Cari kandidat"
              onClick={goSearch}
            >
              <Search size={16} />
              <span>Cari kandidat...</span>
              <kbd>/</kbd>
            </button>
            <span className="topbar-divider" />
            <div className="notification-wrap">
              <button
                className={`icon-button notification-button ${notifications ? "selected" : ""}`}
                aria-label="Notifikasi"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                {pending + failedInvitations > 0 && <i />}
              </button>
              {notifications && (
                <div className="notification-popover">
                  <strong>Notifikasi</strong>
                  <p>
                    {pending
                      ? `${pending} kandidat siap untuk ditinjau.`
                      : "Semua kandidat sudah ditinjau."}
                  </p>
                  {failedInvitations > 0 && (
                    <p>
                      {failedInvitations} email undangan gagal terkirim. Buka
                      halaman persetujuan lowongan untuk mencoba lagi.
                    </p>
                  )}
                  <Link
                    className="text-button"
                    href={`${CANDIDATES}?status=Perlu+ditinjau`}
                    onClick={closeMenus}
                  >
                    Tinjau kandidat <ArrowRight size={14} />
                  </Link>
                </div>
              )}
            </div>
            <button
              className="profile-button"
              aria-label="Profil Andini Putri"
              onClick={() => setModal("settings")}
            >
              <Avatar initials="AP" color="sand" small />
            </button>
          </div>
        </header>

        <main>
          <ViewTransition
            key={pathname}
            enter="page-enter"
            exit="page-exit"
            default="none"
          >
            <div className="page-transition">{children}</div>
          </ViewTransition>
          <footer className="page-footer">
            <span>
              saring<span>.</span> <i />
              Lebih dekat dengan talenta yang tepat.
            </span>
            <span>Prototipe desain · Data fiktif</span>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialog}
        className="modal"
        aria-label="Pengaturan dan bantuan"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <div className="modal-content">
          <button
            className="icon-button close-modal"
            aria-label="Tutup dialog"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
          {modal === "settings" && (
            <>
              <span className="job-icon sage">
                <Settings2 size={22} />
              </span>
              <h2>Pengaturan</h2>
              <p className="modal-intro">Akun dan cara Saring dijalankan.</p>
              <dl className="settings-list">
                <div>
                  <dt>Akun</dt>
                  <dd>
                    Andini Putri · HR Manager
                    <small>{DEMO_EMAIL}</small>
                  </dd>
                </div>
                <div>
                  <dt>Model AI</dt>
                  <dd>
                    Dikelola tim teknis di server.
                    <small>
                      API key disimpan di environment variable server, tidak
                      pernah di browser.
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Privasi pelamar</dt>
                  <dd>
                    Data sensitif disembunyikan sebelum penilaian.
                    <small>
                      Agent hanya memeriksa link yang diberikan pelamar.
                    </small>
                  </dd>
                </div>
              </dl>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setModal(null)}
                >
                  Tutup
                </button>
                <form action={logout} onSubmit={resetIntro}>
                  <button className="button primary" type="submit">
                    <LogOut size={15} />
                    Keluar
                  </button>
                </form>
              </div>
            </>
          )}
          {modal === "help" && (
            <>
              <span className="job-icon sage">
                <CircleHelp size={22} />
              </span>
              <h2>Mulai dengan Saring</h2>
              <p className="modal-intro">
                Ruang kerja yang membantu HR berfokus pada manusia.
              </p>
              <div className="help-steps">
                {[
                  [
                    "01",
                    "Buka lowongan",
                    "Tentukan posisi dan kriteria, lalu bagikan link lamarannya.",
                  ],
                  [
                    "02",
                    "Kenali kandidat",
                    "Tinjau kecocokan, bukti pendukung, dan hal yang perlu diklarifikasi.",
                  ],
                  [
                    "03",
                    "Tentukan langkah berikutnya",
                    "Setujui kandidat untuk shortlist. Keputusan tetap di tangan HR.",
                  ],
                ].map(([num, title, desc]) => (
                  <div key={num}>
                    <span>{num}</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="notice">
                Ini prototipe interaktif dengan data fiktif. Analisis AI, email,
                dan kalender belum terhubung.
              </div>
              <button
                className="button primary help-done"
                onClick={() => setModal(null)}
              >
                Mengerti <Check size={16} />
              </button>
            </>
          )}
        </div>
      </dialog>

      {toast && (
        <div role="status" className="toast">
          <span className={`toast-check ${toastFailed ? "failed" : ""}`}>
            {toastFailed ? <AlertTriangle size={15} /> : <Check size={15} />}
          </span>
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Tutup pemberitahuan"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
