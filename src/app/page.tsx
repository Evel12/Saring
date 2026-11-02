"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Filter,
  Funnel,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Video,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  initialCandidates,
  initialJobs,
  interviews,
  type Candidate,
  type Job,
} from "@/lib/demo";

type View =
  | "Ringkasan"
  | "Lowongan"
  | "Kandidat"
  | "Jadwal interview"
  | "Aktivitas agent";
type Modal = "job" | "upload" | "settings" | "help" | null;
const navigation: { label: View; icon: LucideIcon }[] = [
  { label: "Ringkasan", icon: LayoutDashboard },
  { label: "Lowongan", icon: BriefcaseBusiness },
  { label: "Kandidat", icon: Users },
  { label: "Jadwal interview", icon: CalendarDays },
  { label: "Aktivitas agent", icon: Activity },
];

function Avatar({
  initials,
  color = "sage",
  small = false,
}: {
  initials: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${color} ${small ? "small" : ""}`}>
      {initials}
    </span>
  );
}
function Status({ status }: { status: Candidate["status"] }) {
  return (
    <span
      className={`status ${status === "Perlu ditinjau" ? "review" : status === "Shortlist" ? "shortlist" : "interview"}`}
    >
      <i />
      {status}
    </span>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("Ringkasan");
  const [candidates, setCandidates] = useState(initialCandidates);
  const [jobs, setJobs] = useState(initialJobs);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Semua kandidat");
  const [roleFilter, setRoleFilter] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [activities, setActivities] = useState([
    "Analisis 6 CV contoh selesai. Tiga kandidat memerlukan tinjauan HR.",
    "Rubrik Frontend Developer telah diterapkan pada kandidat contoh.",
    "Satu dokumen scan berhasil dibaca menggunakan OCR dalam skenario demo.",
  ]);
  const [provider, setProvider] = useState("Gemini");
  const [model, setModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [uploadJob, setUploadJob] = useState("Frontend Developer");
  const [busy, setBusy] = useState(false);
  const [sortHigh, setSortHigh] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const pending = candidates.filter(
    (c) => c.status === "Perlu ditinjau",
  ).length;

  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (selected) detailDialog.current?.showModal();
    else detailDialog.current?.close();
  }, [selected]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotifications(false);
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        dialog.current?.open ||
        detailDialog.current?.open
      )
        return;
      const target = event.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      event.preventDefault();
      setView("Kandidat");
      setQuery("");
      setFilter("Semua kandidat");
      setRoleFilter("");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(".candidate-filters input")
          ?.focus(),
      );
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function go(next: View) {
    setView(next);
    setMobileNav(false);
    setNotifications(false);
    setQuery("");
    setRoleFilter("");
    setFilter("Semua kandidat");
  }
  function showReview() {
    go("Kandidat");
    setFilter("Perlu ditinjau");
  }
  function approve(c: Candidate) {
    setCandidates((prev) =>
      prev.map((item) =>
        item.id === c.id ? { ...item, status: "Shortlist" } : item,
      ),
    );
    setSelected(null);
    setToast(`${c.name} ditambahkan ke shortlist.`);
    setActivities((prev) => [
      `HR menyetujui ${c.name} untuk shortlist ${c.role}.`,
      ...prev,
    ]);
  }
  function exportCandidates() {
    const data = [
      "Nama,Posisi,Skor,Status",
      ...filtered.map((c) => `${c.name},${c.role},${c.score},${c.status}`),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + data], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "saring-kandidat-demo.csv";
    a.click();
    URL.revokeObjectURL(url);
    setToast("Daftar kandidat berhasil diekspor.");
  }
  const filtered = candidates
    .filter(
      (c) =>
        `${c.name} ${c.role} ${c.skills.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "Semua kandidat" || c.status === filter) &&
        (!roleFilter || c.role === roleFilter),
    )
    .sort((a, b) => (sortHigh ? b.score - a.score : a.id - b.id));

  function CandidateTable({ full = false }: { full?: boolean }) {
    return (
      <section
        className={`panel candidates-panel ${full ? "full-table" : "compact-table"}`}
      >
        <div className="section-heading">
          <div>
            <h2>
              {full ? "Semua kandidat" : "Kandidat terbaru"}{" "}
              <span className="count">{candidates.length}</span>
            </h2>
            <p>Kenali potensi di balik setiap lamaran.</p>
          </div>
          <button
            className="text-button"
            onClick={() => (full ? exportCandidates() : go("Kandidat"))}
          >
            {full ? "Ekspor CSV" : "Lihat semua"}
            {full ? <ArrowDownToLine size={15} /> : <ArrowUpRight size={16} />}
          </button>
        </div>
        <div className="table-toolbar">
          <div className="tabs" aria-label="Filter status">
            {["Semua kandidat", "Perlu ditinjau", "Shortlist"].map((item) => (
              <button
                key={item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item}
                {item === "Perlu ditinjau" && <span>{pending}</span>}
              </button>
            ))}
          </div>
          <button
            className={`icon-button filter-button ${sortHigh ? "selected" : ""}`}
            title={
              sortHigh
                ? "Urutkan berdasarkan kedatangan"
                : "Urutkan skor tertinggi"
            }
            aria-label="Urutkan skor tertinggi"
            aria-pressed={sortHigh}
            onClick={() => setSortHigh(!sortHigh)}
          >
            <Filter size={16} />
          </button>
        </div>
        {full && (
          <div className="candidate-filters">
            <label className="input-search">
              <Search size={16} />
              <input
                placeholder="Cari nama, skill, atau posisi..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter lowongan"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">Semua lowongan</option>
              {jobs.map((j) => (
                <option key={j.id}>{j.title}</option>
              ))}
            </select>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Kandidat</th>
                <th>Posisi dilamar</th>
                <th>
                  Kecocokan{" "}
                  <span title="Skor contoh berdasarkan rubrik posisi">ⓘ</span>
                </th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Tindakan</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, full ? 100 : 5).map((c) => (
                <tr key={c.id} onClick={() => setSelected(c)}>
                  <td>
                    <button
                      className="candidate-name"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(c);
                      }}
                    >
                      <Avatar initials={c.initials} color={c.color} />
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {full ? `${c.experience} pengalaman` : c.role}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>{c.role}</td>
                  <td>
                    <div className="score">
                      <Sparkles size={13} />
                      <strong>{c.score}%</strong>
                      <span className="score-track">
                        <i style={{ width: `${c.score}%` }} />
                      </span>
                    </div>
                  </td>
                  <td>
                    <Status status={c.status} />
                  </td>
                  <td>
                    <button
                      className="icon-button row-arrow"
                      aria-label={`Tinjau ${c.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(c);
                      }}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <div className="empty-state">
            <Search size={25} />
            <h3>Tidak ada kandidat yang cocok</h3>
            <p>Coba kata kunci lain atau ubah filter status.</p>
            <button
              className="button secondary"
              onClick={() => {
                setQuery("");
                setFilter("Semua kandidat");
                setRoleFilter("");
              }}
            >
              Reset filter
            </button>
          </div>
        )}
        <div className="table-footer">
          <span>
            Menampilkan {Math.min(filtered.length, full ? 100 : 5)} dari{" "}
            {filtered.length} kandidat
          </span>
          <span className="sample-note">
            <i />
            Data contoh
          </span>
        </div>
      </section>
    );
  }

  function JobCards({ full = false }: { full?: boolean }) {
    return (
      <section className={`jobs-section ${full ? "full-jobs" : ""}`}>
        <div className="section-heading bare">
          <h2>
            Lowongan aktif <span className="count">{jobs.length}</span>
          </h2>
          {!full && (
            <button className="text-button" onClick={() => go("Lowongan")}>
              Semua lowongan <ArrowUpRight size={16} />
            </button>
          )}
        </div>
        <div className="job-grid">
          {jobs.map((j) => (
            <button
              key={j.id}
              className={`job-card job-${j.color}`}
              onClick={() => {
                go("Kandidat");
                setRoleFilter(j.title);
              }}
            >
              <div className="job-card-top">
                <span className="job-title-dot" />
                <h3>{j.title}</h3>
                <ArrowUpRight size={17} className="job-arrow" />
              </div>
              <p>
                Temukan talenta untuk tim {j.department}.<br />
                {j.type} · {j.department}
              </p>
              <div className="job-details">
                <div>
                  <span>Status</span>
                  <span className="job-open">
                    <i />
                    Aktif
                  </span>
                </div>
                <div>
                  <span>Pelamar</span>
                  <span className="bubble-value">{j.count} kandidat</span>
                </div>
                <div>
                  <span>Departemen</span>
                  <span className="bubble-value">{j.department}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    );
  }

  function Schedule({ full = false }: { full?: boolean }) {
    return (
      <section
        className={`panel schedule-panel ${full ? "full-schedule" : ""}`}
      >
        <div className="section-heading">
          <h2>Interview mendatang</h2>
          <span className="soft-icon">
            <CalendarDays size={17} />
          </span>
        </div>
        <div className="schedule-date">
          <span>Senin, 2 November</span>
          <span className="count">3 interview</span>
        </div>
        <div className="schedule-list">
          {interviews.map((item) => (
            <button
              key={item.name}
              className="interview-item"
              onClick={() => {
                setToast(
                  `${item.name} · 2 Nov 2026, ${item.time}–${item.end} WIB · ${item.type}. Jadwal contoh, belum tersambung ke kalender.`,
                );
              }}
            >
              <div className="interview-time">
                <strong>{item.time}</strong>
                <span>{item.end}</span>
              </div>
              <div className={`interview-line ${item.color}`} />
              <div className="interview-info">
                <strong>{item.name}</strong>
                <span>{item.role}</span>
                <small>
                  <Video size={12} />
                  {item.type}
                </small>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <button
          className="schedule-link"
          onClick={() =>
            full
              ? setToast(
                  "Seluruh jadwal contoh ditampilkan. Integrasi kalender akan ditambahkan berikutnya.",
                )
              : go("Jadwal interview")
          }
        >
          {full ? "Semua jadwal ditampilkan" : "Lihat jadwal lengkap"}
          <ArrowRight size={15} />
        </button>
      </section>
    );
  }

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
        <a href="/" className="brand" aria-label="Saring beranda">
          <span className="brand-mark">
            <Funnel size={23} strokeWidth={2} />
          </span>
          saring<span className="brand-dot">.</span>
          <ChevronDown size={16} className="brand-chevron" />
        </a>
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
        <button
          className="sidebar-search"
          onClick={() => {
            go("Kandidat");
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLInputElement>(".candidate-filters input")
                ?.focus(),
            );
          }}
        >
          <Search size={17} />
          <span>Cari kandidat...</span>
          <kbd>/</kbd>
        </button>
        <span className="nav-label">Menu utama</span>
        <nav aria-label="Navigasi utama">
          {navigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${view === label ? "active" : ""}`}
              onClick={() => go(label)}
              aria-current={view === label ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Lowongan" && (
                <span className="nav-count">{jobs.length}</span>
              )}
              {label === "Kandidat" && (
                <span className="nav-count">{candidates.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-collections">
          <span className="nav-label">Lowongan tim</span>
          {jobs.slice(0, 4).map((j) => (
            <button
              key={j.id}
              className="collection-item"
              onClick={() => {
                go("Kandidat");
                setRoleFilter(j.title);
              }}
            >
              <span className={`collection-dot ${j.color}`} />
              <span>{j.title}</span>
              <ChevronRight size={13} />
            </button>
          ))}
          <button className="collection-add" onClick={() => setModal("job")}>
            <Plus size={16} />
            Tambah lowongan
          </button>
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
            <strong>{view}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="search-shortcut"
              aria-label="Cari kandidat"
              onClick={() => {
                go("Kandidat");
                setTimeout(
                  () =>
                    document
                      .querySelector<HTMLInputElement>(
                        ".candidate-filters input",
                      )
                      ?.focus(),
                  50,
                );
              }}
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
                {pending > 0 && <i />}
              </button>
              {notifications && (
                <div className="notification-popover">
                  <strong>Notifikasi</strong>
                  <p>
                    {pending
                      ? `${pending} kandidat siap untuk ditinjau.`
                      : "Semua kandidat sudah ditinjau."}
                  </p>
                  <button className="text-button" onClick={showReview}>
                    Tinjau kandidat <ArrowRight size={14} />
                  </button>
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
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "Ringkasan"
                  ? "RUANG KERJA REKRUTMEN"
                  : "TIM REKRUTMEN"}
              </div>
              <h1>
                {view === "Ringkasan" ? "Ringkasan rekrutmen" : view}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === "Ringkasan"
                  ? "Pantau lowongan, tinjau kandidat, dan atur langkah berikutnya."
                  : view === "Kandidat"
                    ? "Tinjau profil dan bukti pendukung untuk setiap kandidat."
                    : view === "Lowongan"
                      ? "Kelola posisi yang sedang dibuka di timmu."
                      : view === "Jadwal interview"
                        ? "Siapkan percakapan yang bermakna dengan kandidatmu."
                        : "Lihat setiap langkah dan hasil kerja asisten rekrutmenmu."}
              </p>
            </div>
            <div className="heading-actions">
              {view === "Ringkasan" && (
                <span className="today">
                  <CalendarDays size={15} />1 Nov 2026
                </span>
              )}
              <button
                className="button primary"
                onClick={() => {
                  if (view === "Kandidat") {
                    setFiles([]);
                    setModal("upload");
                  } else setModal("job");
                }}
              >
                <Plus size={16} />
                {view === "Kandidat" ? "Unggah CV" : "Tambah lowongan"}
              </button>
            </div>
          </div>

          {view === "Ringkasan" && (
            <>
              <section className="stats-panel" aria-label="Ringkasan rekrutmen">
                {[
                  {
                    label: "Lowongan aktif",
                    value: jobs.length.toString().padStart(2, "0"),
                    icon: BriefcaseBusiness,
                    note: "Kesempatan untuk talenta baru",
                    action: () => go("Lowongan"),
                  },
                  {
                    label: "Total pelamar",
                    value: "58",
                    icon: Users,
                    note: "+12 pelamar minggu ini",
                    action: () => go("Kandidat"),
                  },
                  {
                    label: "Perlu ditinjau",
                    value: pending.toString().padStart(2, "0"),
                    icon: FileText,
                    note: "Menunggu keputusanmu",
                    action: showReview,
                  },
                  {
                    label: "Interview terjadwal",
                    value: "03",
                    icon: CalendarDays,
                    note: "Untuk Senin, 2 November",
                    action: () => go("Jadwal interview"),
                  },
                ].map(({ label, value, icon: Icon, note, action }, i) => (
                  <button className="stat" key={label} onClick={action}>
                    <div>
                      <span>{label}</span>
                      <Icon size={17} />
                    </div>
                    <strong>
                      {value}
                      <ArrowUpRight size={17} />
                    </strong>
                    <small className={i === 1 ? "positive" : ""}>
                      {i === 1 && <ArrowUpRight size={13} />} {note}
                    </small>
                  </button>
                ))}
              </section>

              <JobCards />
              <div className="dashboard-grid">
                <div className="main-column">
                  <section className="review-banner">
                    <span className="banner-icon">
                      <FileText size={18} />
                    </span>
                    <div className="banner-content">
                      <h2>
                        {pending
                          ? `${pending} kandidat menunggu tinjauan`
                          : "Semua kandidat sudah ditinjau"}
                      </h2>
                      <p>Rekomendasi Saring siap untuk keputusanmu.</p>
                    </div>
                    <button className="banner-action" onClick={showReview}>
                      Tinjau <ArrowRight size={15} />
                    </button>
                  </section>
                  {CandidateTable({})}
                </div>
                <div className="right-column">
                  <Schedule />
                  <section className="panel activity-panel">
                    <div className="section-heading">
                      <h2>Aktivitas terbaru</h2>
                      <span className="live-label">
                        <i />
                        Demo
                      </span>
                    </div>
                    <div className="activity-list">
                      {activities.slice(0, 3).map((item, i) => (
                        <div className="activity-item" key={item}>
                          <span
                            className={`activity-dot ${i === 0 ? "green" : ""}`}
                          >
                            {i === 0 ? (
                              <CheckCheck size={14} />
                            ) : i === 1 ? (
                              <FileText size={13} />
                            ) : (
                              <Zap size={13} />
                            )}
                          </span>
                          <div>
                            <p>{item}</p>
                            <small>
                              {i === 0
                                ? "Baru saja"
                                : i === 1
                                  ? "10 menit lalu"
                                  : "15 menit lalu"}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      className="schedule-link"
                      onClick={() => go("Aktivitas agent")}
                    >
                      Lihat semua aktivitas <ArrowRight size={15} />
                    </button>
                  </section>
                  <div className="trust-note">
                    <ShieldCheck size={17} />
                    <span>
                      AI membantu prosesnya.
                      <br />
                      <strong>Kamu yang menentukan pilihannya.</strong>
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
          {view === "Lowongan" && (
            <>
              <JobCards full />
              {jobs.length === 3 && (
                <div className="subtle-callout">
                  <Plus size={18} />
                  <div>
                    <strong>
                      Tim yang hebat dimulai dari kesempatan baru.
                    </strong>
                    <p>
                      Tambahkan lowongan dan tentukan kriteria kandidat yang
                      kamu cari.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => setModal("job")}
                  >
                    Buat lowongan
                  </button>
                </div>
              )}
            </>
          )}
          {view === "Kandidat" && (
            <>
              {CandidateTable({ full: true })}
              {uploaded.length > 0 && (
                <section className="panel upload-queue">
                  <h2>Antrean dokumen demo</h2>
                  <p>
                    Belum dianalisis. Koneksi backend dan model AI belum
                    diaktifkan.
                  </p>
                  {uploaded.map((f, i) => (
                    <div key={`${f}-${i}`}>
                      <FileText size={17} />
                      {f}
                      <span className="status review">Menunggu integrasi</span>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {view === "Jadwal interview" && (
            <div className="agenda-layout">
              <Schedule full />
              <section className="panel agenda-note">
                <span className="job-icon sage">
                  <CalendarDays size={23} />
                </span>
                <h2>Ruang untuk percakapan yang baik.</h2>
                <p>
                  Jadwal menggunakan zona waktu Asia/Jakarta (WIB). Semua
                  interview di sini adalah data contoh.
                </p>
                <div className="notice">
                  Koneksi Google Calendar dan pengiriman undangan belum
                  diaktifkan.
                </div>
              </section>
            </div>
          )}
          {view === "Aktivitas agent" && (
            <section className="panel activity-full">
              <div className="section-heading">
                <div>
                  <h2>Jejak aktivitas</h2>
                  <p>Hasil tindakan dan keputusan, dalam satu tempat.</p>
                </div>
                <span className="status shortlist">
                  <i />
                  Mode demo
                </span>
              </div>
              {activities.map((item, i) => (
                <div className="activity-full-row" key={`${item}-${i}`}>
                  <span className="activity-dot green">
                    <CheckCheck size={16} />
                  </span>
                  <div>
                    <strong>{item}</strong>
                    <p>
                      {i === 0 ? "Aktivitas terkini" : "Skenario data contoh"}
                    </p>
                  </div>
                  <span className="activity-result">Selesai</span>
                </div>
              ))}
            </section>
          )}
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
        aria-label="Pengaturan dan tindakan rekrutmen"
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
          {modal === "job" && (
            <>
              <span className="job-icon sage">
                <BriefcaseBusiness size={22} />
              </span>
              <h2>Buka kesempatan baru</h2>
              <p className="modal-intro">
                Mulai dari posisi dan tim yang membutuhkan talenta.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const title = String(data.get("title")).trim();
                  if (!title) return;
                  setJobs((prev) => [
                    ...prev,
                    {
                      id: Date.now(),
                      title,
                      department: String(data.get("department")),
                      count: 0,
                      type: String(data.get("type")),
                      color: "sage",
                    },
                  ]);
                  setModal(null);
                  go("Lowongan");
                  setToast(
                    `Lowongan ${title} berhasil ditambahkan untuk sesi ini.`,
                  );
                }}
              >
                <label>
                  Nama posisi
                  <input
                    name="title"
                    required
                    placeholder="Contoh: Product Designer"
                    maxLength={80}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Departemen
                    <select name="department">
                      <option>Engineering</option>
                      <option>Design</option>
                      <option>Product</option>
                      <option>Operations</option>
                      <option>Marketing</option>
                    </select>
                  </label>
                  <label>
                    Tipe pekerjaan
                    <select name="type">
                      <option>Full-time</option>
                      <option>Contract</option>
                      <option>Internship</option>
                    </select>
                  </label>
                </div>
                <label>
                  Deskripsi dan kriteria
                  <textarea
                    name="description"
                    placeholder="Ceritakan tanggung jawab dan skill yang dibutuhkan..."
                    rows={4}
                  />
                </label>
                <div className="notice">
                  Demo desain: lowongan disimpan selama halaman ini terbuka.
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setModal(null)}
                  >
                    Batal
                  </button>
                  <button className="button primary" type="submit">
                    <Plus size={16} />
                    Buat lowongan
                  </button>
                </div>
              </form>
            </>
          )}
          {modal === "upload" && (
            <>
              <span className="job-icon sage">
                <Upload size={22} />
              </span>
              <h2>Kenali kandidat berikutnya</h2>
              <p className="modal-intro">
                Pilih lowongan, lalu tambahkan CV kandidat fiktif.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!files.length) return;
                  setUploaded((prev) => [
                    ...prev,
                    ...files.map((f) => `${f.name} · ${uploadJob}`),
                  ]);
                  setModal(null);
                  setToast(
                    `${files.length} dokumen ditambahkan ke antrean demo. Belum ada analisis AI.`,
                  );
                }}
              >
                <label>
                  Lowongan
                  <select
                    value={uploadJob}
                    onChange={(e) => setUploadJob(e.target.value)}
                  >
                    {jobs.map((j) => (
                      <option key={j.id}>{j.title}</option>
                    ))}
                  </select>
                </label>
                <label
                  className="upload-zone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const valid = Array.from(e.dataTransfer.files).filter(
                      (f) =>
                        /\.(pdf|docx)$/i.test(f.name) &&
                        f.size <= 10 * 1024 * 1024,
                    );
                    setFiles(valid);
                    if (valid.length !== e.dataTransfer.files.length)
                      setToast(
                        "Hanya PDF/DOCX maksimal 10 MB per file yang dapat dipilih.",
                      );
                  }}
                >
                  <Upload size={26} />
                  <strong>Klik atau letakkan CV di sini</strong>
                  <span>PDF atau DOCX · maksimal 10 MB per file</span>
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    multiple
                    onChange={(e) => {
                      const all = Array.from(e.target.files || []);
                      setFiles(
                        all.filter(
                          (f) =>
                            /\.(pdf|docx)$/i.test(f.name) &&
                            f.size <= 10 * 1024 * 1024,
                        ),
                      );
                      if (all.some((f) => f.size > 10 * 1024 * 1024))
                        setToast("File melebihi 10 MB tidak ditambahkan.");
                    }}
                  />
                </label>
                {files.map((f, i) => (
                  <div className="selected-file" key={`${f.name}-${i}`}>
                    <FileText size={16} />
                    <span>{f.name}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Hapus ${f.name}`}
                      onClick={() =>
                        setFiles((prev) =>
                          prev.filter((_, index) => index !== i),
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <div className="notice">
                  File belum dikirim ke server. Tahap ini hanya memperagakan
                  alur upload.
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setModal(null)}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={!files.length}
                  >
                    Tambahkan {files.length ? `${files.length} CV` : "CV"}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            </>
          )}
          {modal === "settings" && (
            <>
              <span className="job-icon sage">
                <Settings2 size={22} />
              </span>
              <h2>Pengaturan model AI</h2>
              <p className="modal-intro">
                Gunakan penyedia yang sesuai dengan kebutuhan timmu.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setModal(null);
                  setToast(
                    "Preferensi model diperbarui untuk sesi ini. Koneksi API belum diaktifkan.",
                  );
                }}
              >
                <label>
                  Penyedia AI
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    <option>Gemini</option>
                    <option>OpenAI-compatible</option>
                    <option>Model perusahaan</option>
                  </select>
                </label>
                <label>
                  Nama model
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Masukkan ID model dari penyedia"
                  />
                </label>
                {provider !== "Gemini" && (
                  <label>
                    Alamat layanan
                    <input
                      type="url"
                      placeholder="https://ai.perusahaan.com/v1"
                    />
                  </label>
                )}
                <label>
                  API key
                  <input
                    type="password"
                    placeholder="Belum dikonfigurasi"
                    autoComplete="off"
                  />
                </label>
                <div className="notice">
                  <ShieldCheck size={16} />
                  <span>
                    Prototipe desain: API key tidak disimpan atau dikirim.
                    Integrasi model tersedia pada tahap backend.
                  </span>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setBusy(true);
                      setTimeout(() => {
                        setBusy(false);
                        setToast(
                          "Belum bisa menguji koneksi: backend AI belum terhubung.",
                        );
                      }, 500);
                    }}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Zap size={15} />
                    )}
                    Tes koneksi
                  </button>
                  <button className="button primary" type="submit">
                    Simpan preferensi
                  </button>
                </div>
              </form>
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
                    "Tentukan posisi dan kriteria yang dibutuhkan tim.",
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

      <dialog
        ref={detailDialog}
        className="detail-dialog"
        aria-label="Profil kandidat"
        onCancel={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {selected && (
          <div className="detail-content">
            <div className="detail-top">
              <span>PROFIL KANDIDAT</span>
              <button
                className="icon-button"
                aria-label="Tutup profil kandidat"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </div>
            <div className="detail-identity">
              <Avatar initials={selected.initials} color={selected.color} />
              <h2>{selected.name}</h2>
              <p>
                {selected.role} · {selected.experience} pengalaman
              </p>
              <Status status={selected.status} />
            </div>
            <div className="detail-score">
              <span>
                <Sparkles size={17} />
                Kecocokan dengan rubrik
              </span>
              <strong>
                {selected.score}
                <small>%</small>
              </strong>
            </div>
            <div className="detail-section">
              <h3>Ringkasan kandidat</h3>
              <p>{selected.summary}</p>
            </div>
            <div className="detail-section">
              <h3>Skill yang tercantum</h3>
              <div className="skill-tags">
                {selected.skills.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <small className="muted">
                Klaim dari CV contoh, belum diverifikasi secara independen.
              </small>
            </div>
            <div className="detail-section">
              <h3>
                <FileText size={16} />
                Bukti pendukung
              </h3>
              <blockquote>{selected.evidence}</blockquote>
            </div>
            <div className="detail-section">
              <h3>Pertanyaan untuk interview</h3>
              <p>
                “Ceritakan satu proyek menggunakan {selected.skills[0]}. Apa
                kontribusi pribadimu, tantangan yang dihadapi, dan bagaimana
                kamu mengukur hasilnya?”
              </p>
            </div>
            <div className="notice">
              <ShieldCheck size={17} />
              <span>
                Analisis dan skor menggunakan data contoh. Tinjau bukti sebelum
                mengambil keputusan.
              </span>
            </div>
            <div className="detail-actions">
              <button
                className="button secondary"
                onClick={() => setSelected(null)}
              >
                Tutup
              </button>
              {selected.status === "Perlu ditinjau" ? (
                <button
                  className="button primary"
                  onClick={() => approve(selected)}
                >
                  <Check size={16} />
                  Setujui shortlist
                </button>
              ) : (
                <span className="approved-label">
                  <CheckCheck size={17} />
                  {selected.status === "Interview"
                    ? "Sudah terjadwal"
                    : "Sudah di-shortlist"}
                </span>
              )}
            </div>
          </div>
        )}
      </dialog>
      {toast && (
        <div role="status" className="toast">
          <span className="toast-check">
            <Check size={15} />
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
