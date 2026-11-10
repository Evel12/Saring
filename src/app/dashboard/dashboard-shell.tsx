"use client";

import {
  Fragment,
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
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sparkles,
  UserCog,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDashboard } from "./dashboard-context";
import { LogoMark } from "../brand-logo";
import { AiSettings } from "./ai-settings";
import { post } from "@/lib/api";
import { roleLabel, type Me } from "@/lib/session";
import { playIntro, resetIntro } from "@/lib/intro";
import { IndicatorGroup } from "./indicator-group";
import { Avatar } from "./candidate-table";

const CANDIDATES = "/dashboard/candidates";

const navigation: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Ringkasan", href: "/dashboard", icon: LayoutDashboard },
  { label: "Lowongan", href: "/dashboard/jobs", icon: BriefcaseBusiness },
  { label: "Kandidat", href: CANDIDATES, icon: Users },
  {
    label: "Jadwal interview",
    href: "/dashboard/schedule",
    icon: CalendarDays,
  },
  { label: "Aktivitas agent", href: "/dashboard/activity", icon: Activity },
];
const TEAM = { label: "Tim", href: "/dashboard/team", icon: UserCog };

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({
  children,
  me,
}: {
  children: ReactNode;
  me: Me;
}) {
  const org =
    me.memberships.find((m) => m.org_id === me.organization_id)
      ?.organization_name ?? "Organisasi";
  const role = roleLabel(me.role);
  // Inisial avatar mengikuti nama orang yang login, bukan nama organisasi.
  const nameForAvatar = me.display_name || org;
  const initials = nameForAvatar
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
  async function logout() {
    await post("/auth/logout").catch(() => undefined);
    resetIntro();
    window.location.assign("/login");
  }
  const router = useRouter();
  const pathname = usePathname();
  const {
    jobs,
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

  const [userMenu, setUserMenu] = useState(false);
  useEffect(() => {
    if (!userMenu) return;
    const close = (event: globalThis.MouseEvent) => {
      if (!(event.target as Element).closest?.(".user-menu-wrap"))
        setUserMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenu]);
  function closeMenus() {
    setMobileNav(false);
    setNotifications(false);
    setUserMenu(false);
  }

  const section = [...navigation, TEAM].find((item) =>
    isActive(pathname, item.href),
  );
  const jobMatch = pathname.match(
    /^\/dashboard\/jobs\/([^/]+)(\/approval|\/report)?$/,
  );
  const candidateId = pathname.match(/^\/dashboard\/candidates\/([^/]+)$/)?.[1];
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
            <LogoMark size={22} />
          </span>
          saring<span className="brand-dot">.</span>
        </Link>
        <button
          className="workspace-switch"
          onClick={() => setToast(`Kamu berada di workspace ${org}.`)}
        >
          <span className="workspace-avatar">{initials[0]}</span>
          <span>
            <strong>{org}</strong>
            <small>{role}</small>
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
          {(me.role === "admin" ? [...navigation, TEAM] : navigation).map(
            ({ label, href, icon: Icon }) => (
              <Fragment key={href}>
                <Link
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
                {label === "Lowongan" && isActive(activePath, href) && (
                  <div
                    className="nav-sub"
                    role="group"
                    aria-label="Daftar lowongan"
                  >
                    {jobs.map((job) => {
                      const jobHref = `/dashboard/jobs/${job.id}`;
                      const current = isActive(activePath, jobHref);
                      return (
                        <Link
                          key={job.id}
                          href={jobHref}
                          className={`collection-item ${current ? "active" : ""} ${job.status === "closed" ? "closed" : ""}`}
                          aria-current={current ? "page" : undefined}
                          onClick={(event) => selectNav(event, jobHref)}
                        >
                          <span className={`collection-dot ${job.color}`} />
                          <span>{job.title}</span>
                          <ChevronRight size={13} />
                        </Link>
                      );
                    })}
                    <Link
                      href="/dashboard/jobs/new"
                      className={`collection-add ${activePath === "/dashboard/jobs/new" ? "active" : ""}`}
                      onClick={(event) =>
                        selectNav(event, "/dashboard/jobs/new")
                      }
                    >
                      <Plus size={16} />
                      Tambah lowongan
                    </Link>
                  </div>
                )}
              </Fragment>
            ),
          )}
        </IndicatorGroup>
        <div className="sidebar-bottom">
          <div className="agent-status-card">
            <span className="agent-orb">
              <Sparkles size={17} />
            </span>
            <div>
              <strong>Asistenmu, Saring</strong>
              <span>
                <i />
                Terhubung ke backend
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
            <Avatar initials={initials} color="sand" />
            <div>
              <strong>{me.display_name || org}</strong>
              <small title={org}>{role}</small>
            </div>
            <div className="user-menu-wrap">
              <button
                className={`icon-button ${userMenu ? "selected" : ""}`}
                aria-label="Menu akun"
                aria-expanded={userMenu}
                onClick={() => setUserMenu(!userMenu)}
              >
                <MoreHorizontal size={18} />
              </button>
              {userMenu && (
                <div className="user-menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setUserMenu(false);
                      setModal("settings");
                    }}
                  >
                    <Settings2 size={15} />
                    Pengaturan
                  </button>
                  <button role="menuitem" className="danger" onClick={logout}>
                    <LogOut size={15} />
                    Keluar
                  </button>
                </div>
              )}
            </div>
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
                      {failedInvitations} link jadwal gagal dibuat. Buka halaman
                      persetujuan lowongan untuk mencoba lagi.
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
              aria-label={`Profil ${org}`}
              onClick={() => setModal("settings")}
            >
              <Avatar initials={initials} color="sand" small />
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
            <span>AI membantu, HR yang memutuskan</span>
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
                    {me.display_name} · {role}
                    <small>
                      {me.email} · {org}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Model AI</dt>
                  <dd>
                    <AiSettings canEdit={me.is_platform_admin} />
                  </dd>
                </div>
                <div>
                  <dt>Privasi pelamar</dt>
                  <dd>
                    Nama, kontak, dan data pribadi disaring sebelum CV dibaca
                    AI.
                    <small>
                      Agent hanya membuka link yang tertulis di CV pelamar.
                    </small>
                  </dd>
                </div>
              </dl>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setModal(null)}
                >
                  Selesai
                </button>
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
                    "Agent membaca CV pelamar baru, menilai tiap kriteria, dan menandai bukti yang masih kurang.",
                  ],
                  [
                    "03",
                    "Tentukan langkah berikutnya",
                    "Setujui shortlist dan kirim link jadwal interview. Keputusan tetap di tangan HR.",
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
                Email belum dikirim otomatis: link jadwal disalin atau dibuka di
                aplikasi emailmu dari halaman persetujuan.
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
