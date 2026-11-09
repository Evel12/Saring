"use client";

import { Select } from "../../ui-select";
import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatDate, formatTime } from "@/lib/schedule";
import { buildLog, type LogEntry } from "@/lib/agent-log";
import { useDashboard } from "../dashboard-context";
import { PageHeading } from "../dashboard-ui";
import { IndicatorGroup } from "../indicator-group";
import { LogIcon, STATE_LABEL } from "./log-ui";

const PAGE_SIZE = 10;

const FILTERS: { label: string; match: (entry: LogEntry) => boolean }[] = [
  { label: "Semua", match: () => true },
  { label: "Agent", match: (e) => e.actor === "agent" },
  { label: "Keputusan HR", match: (e) => e.actor === "hr" },
  { label: "Dipulihkan otomatis", match: (e) => e.state === "recovered" },
  {
    label: "Diteruskan ke HR",
    match: (e) => e.actor === "agent" && e.state === "flagged",
  },
];

export default function ActivityPage() {
  const { candidates, hrEvents } = useDashboard();
  const [filter, setFilter] = useState(FILTERS[0].label);
  const [candidateId, setCandidateId] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const log = buildLog(candidates, hrEvents);
  const agentSteps = log.filter((e) => e.actor === "agent");
  const counts = [
    {
      label: "Langkah agent",
      value: agentSteps.length,
      note: "Tool yang dijalankan",
    },
    {
      label: "Dipulihkan otomatis",
      value: agentSteps.filter((e) => e.state === "recovered").length,
      note: "Tanpa campur tangan manusia",
    },
    {
      label: "Diteruskan ke HR",
      value: agentSteps.filter((e) => e.state === "flagged").length,
      note: "Kasus ambigu, tidak ditolak otomatis",
    },
    {
      label: "Keputusan HR",
      value: log.filter((e) => e.actor === "hr").length,
      note: "Persetujuan dan penolakan",
    },
  ];

  const match = FILTERS.find((item) => item.label === filter)!.match;
  const shown = log.filter(
    (entry) =>
      match(entry) &&
      (!candidateId || String(entry.candidateId) === candidateId),
  );
  const days = new Map<string, LogEntry[]>();
  for (const entry of shown.slice(0, limit)) {
    const day = formatDate(entry.at);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }

  return (
    <>
      <PageHeading
        title="Aktivitas agent"
        description="Setiap tool yang dijalankan agent, hasilnya, dan keputusan HR, dalam satu jejak."
      />
      <section
        className="stats-panel log-stats"
        aria-label="Ringkasan aktivitas"
      >
        {counts.map((item) => (
          <div className="stat" key={item.label}>
            <div>
              <span>{item.label}</span>
            </div>
            <strong>{item.value.toString().padStart(2, "0")}</strong>
            <small>{item.note}</small>
          </div>
        ))}
      </section>

      <section className="panel log-panel">
        <div className="table-toolbar log-toolbar">
          <IndicatorGroup
            className="tabs"
            aria-label="Filter aktivitas"
            activeKey={filter}
          >
            {FILTERS.map((item) => (
              <button
                key={item.label}
                className={filter === item.label ? "active" : ""}
                aria-pressed={filter === item.label}
                data-active={filter === item.label}
                onClick={() => {
                  setFilter(item.label);
                  setLimit(PAGE_SIZE);
                }}
              >
                {item.label}
              </button>
            ))}
          </IndicatorGroup>
          <Select
            className="filter-select"
            aria-label="Filter kandidat"
            value={candidateId}
            onChange={(value) => {
              setCandidateId(value);
              setLimit(PAGE_SIZE);
            }}
            options={[
              { value: "", label: "Semua kandidat" },
              ...candidates.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>

        {[...days].map(([day, entries]) => (
          <div className="log-day" key={day}>
            <h3>{day}</h3>
            <ol>
              {entries.map((entry) => {
                const candidate = candidates.find(
                  (c) => c.id === entry.candidateId,
                );
                return (
                  <li key={entry.id} className="log-row">
                    <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                    <LogIcon entry={entry} />
                    <div className="log-body">
                      <p className="log-title">
                        <strong>{entry.label}</strong>
                        {candidate && (
                          <Link href={`/dashboard/candidates/${candidate.id}`}>
                            {candidate.name}
                          </Link>
                        )}
                      </p>
                      <p>{entry.result}</p>
                      <small>
                        {entry.tool ? <code>{entry.tool}</code> : "Oleh HR"}
                      </small>
                    </div>
                    {entry.actor === "agent" && entry.state !== "ok" && (
                      <span className={`log-badge ${entry.state}`}>
                        {STATE_LABEL[entry.state]}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {shown.length > limit && (
          <div className="log-more">
            <span>
              Menampilkan {limit} dari {shown.length} aktivitas
            </span>
            <button
              className="button secondary"
              onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
            >
              Tampilkan {Math.min(PAGE_SIZE, shown.length - limit)} lagi
            </button>
          </div>
        )}
        {!shown.length && (
          <div className="empty-state">
            <Search size={25} />
            <h3>Tidak ada aktivitas yang cocok</h3>
            <p>Ubah filter untuk melihat aktivitas lain.</p>
          </div>
        )}
      </section>
    </>
  );
}
