"use client";

import { Select } from "../ui-select";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { Candidate } from "@/lib/candidates";
import { useDashboard } from "./dashboard-context";
import { IndicatorGroup } from "./indicator-group";

const STATUS_TABS = [
  "Semua kandidat",
  "Perlu ditinjau",
  "Shortlist",
  "Diundang",
  "Interview",
  "Tidak dilanjutkan",
];

const STATUS_CLASS: Record<Candidate["status"], string> = {
  "Perlu ditinjau": "review",
  Shortlist: "shortlist",
  Diundang: "invited",
  Interview: "interview",
  "Tidak dilanjutkan": "declined",
};

export function Avatar({
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

export function Status({ status }: { status: Candidate["status"] }) {
  return (
    <span className={`status ${STATUS_CLASS[status]}`}>
      <i />
      {status}
    </span>
  );
}

// Muat ulang data pelamar dari server, misalnya setelah lamaran baru masuk.
function RefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);
  return (
    <button
      type="button"
      className="icon-button refresh-button"
      title="Muat ulang data pelamar"
      aria-label="Muat ulang data pelamar"
      disabled={spinning}
      onClick={() => {
        setSpinning(true);
        router.refresh();
        setTimeout(() => {
          setSpinning(false);
        }, 1200);
      }}
    >
      <RefreshCw className={spinning ? "spin" : ""} size={16} />
    </button>
  );
}

export function CandidateTable({
  full = false,
  lockedRole,
  initialRole = "",
  initialStatus,
  focusSearch = false,
}: {
  full?: boolean;
  lockedRole?: string;
  initialRole?: string;
  initialStatus?: string;
  focusSearch?: boolean;
}) {
  const router = useRouter();
  const { jobs, candidates, setToast } = useDashboard();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(
    initialStatus && STATUS_TABS.includes(initialStatus)
      ? initialStatus
      : "Semua kandidat",
  );
  const [roleFilter, setRoleFilter] = useState(initialRole);
  const [sortHigh, setSortHigh] = useState(false);

  const scoped = lockedRole
    ? candidates.filter((c) => c.role === lockedRole)
    : candidates;
  const pending = scoped.filter((c) => c.status === "Perlu ditinjau").length;
  const filtered = scoped
    .filter(
      (c) =>
        `${c.name} ${c.role} ${c.skills.map((skill) => skill.name).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "Semua kandidat" || c.status === filter) &&
        (!roleFilter || c.role === roleFilter),
    )
    .sort((a, b) =>
      sortHigh ? b.score - a.score : a.appliedAt.localeCompare(b.appliedAt),
    );

  function exportCandidates() {
    const data = [
      "Nama,Posisi,Skor,Status",
      ...filtered.map((c) =>
        [c.name, c.role, c.score, c.status]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob(["﻿" + data], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "saring-kandidat.csv";
    a.click();
    URL.revokeObjectURL(url);
    setToast("Daftar kandidat berhasil diekspor.");
  }

  if (lockedRole && !scoped.length)
    return (
      <section className="panel candidates-panel full-table">
        <div className="section-heading">
          <div>
            <h2>
              Pelamar <span className="count">0</span>
            </h2>
          </div>
          <RefreshButton />
        </div>
        <div className="empty-state">
          <Search size={25} />
          <h3>Belum ada pelamar</h3>
          <p>
            Bagikan link lamaran. Pelamar yang masuk akan muncul di sini beserta
            analisis agent.
          </p>
        </div>
      </section>
    );

  return (
    <section
      className={`panel candidates-panel ${full ? "full-table" : "compact-table"}`}
    >
      <div className="section-heading">
        <div>
          <h2>
            {lockedRole
              ? "Pelamar"
              : full
                ? "Semua kandidat"
                : "Kandidat terbaru"}{" "}
            <span className="count">{scoped.length}</span>
          </h2>
          <p>Kenali potensi di balik setiap lamaran.</p>
        </div>
        {full ? (
          <button className="text-button" onClick={exportCandidates}>
            Ekspor CSV
            <ArrowDownToLine size={15} />
          </button>
        ) : (
          <Link className="text-button" href="/dashboard/candidates">
            Lihat semua
            <ArrowUpRight size={16} />
          </Link>
        )}
        <RefreshButton />
      </div>
      <div className="table-toolbar">
        <IndicatorGroup
          className="tabs"
          aria-label="Filter status"
          activeKey={`${filter}-${pending}`}
        >
          {STATUS_TABS.map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              aria-pressed={filter === item}
              data-active={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
              {item === "Perlu ditinjau" && <span>{pending}</span>}
            </button>
          ))}
        </IndicatorGroup>
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
      {full && !lockedRole && (
        <div className="candidate-filters">
          <label className="input-search">
            <Search size={16} />
            <input
              placeholder="Cari nama, skill, atau posisi..."
              value={query}
              autoFocus={focusSearch}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Select
            className="filter-select"
            aria-label="Filter lowongan"
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: "", label: "Semua lowongan" },
              ...jobs.map((j) => ({ value: j.title, label: j.title })),
            ]}
          />
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
                <span title="Persentase kriteria lowongan yang punya bukti di CV">
                  ⓘ
                </span>
              </th>
              <th>Status</th>
              <th>
                <span className="sr-only">Tindakan</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, full ? 100 : 5).map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/dashboard/candidates/${c.id}`)}
              >
                <td>
                  <Link
                    className="candidate-name"
                    href={`/dashboard/candidates/${c.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Avatar initials={c.initials} color={c.color} />
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        {full && c.experience
                          ? `${c.experience} pengalaman`
                          : c.role}
                      </small>
                    </span>
                  </Link>
                </td>
                <td>{c.role}</td>
                <td>
                  {c.analyzed ? (
                    <div className="score">
                      <Sparkles size={13} />
                      <strong>{c.score}%</strong>
                      <span className="score-track">
                        <i style={{ width: `${c.score}%` }} />
                      </span>
                    </div>
                  ) : (
                    <span className="score-pending">Belum dianalisis</span>
                  )}
                </td>
                <td>
                  <Status status={c.status} />
                </td>
                <td>
                  <Link
                    className="icon-button row-arrow"
                    aria-label={`Tinjau ${c.name}`}
                    href={`/dashboard/candidates/${c.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ChevronRight size={17} />
                  </Link>
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
      </div>
    </section>
  );
}
