"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Plus,
  Video,
} from "lucide-react";
import { formatDayMonth, formatTime } from "@/lib/schedule";
import type { Interview } from "@/lib/candidates";
import { useDashboard } from "./dashboard-context";

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}

export function AddJobButton() {
  return (
    <Link className="button primary" href="/dashboard/jobs/new">
      <Plus size={16} />
      Tambah lowongan
    </Link>
  );
}

export function JobCards({ full = false }: { full?: boolean }) {
  const { jobs, openJobs, candidates } = useDashboard();
  const shown = full ? jobs : openJobs;
  return (
    <section className={`jobs-section ${full ? "full-jobs" : ""}`}>
      <div className="section-heading bare">
        <h2>
          {full ? "Semua lowongan" : "Lowongan aktif"}{" "}
          <span className="count">{shown.length}</span>
        </h2>
        {!full && (
          <Link className="text-button" href="/dashboard/jobs">
            Semua lowongan <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
      <div className="job-grid">
        {shown.map((job) => (
          <Link
            key={job.id}
            href={`/dashboard/jobs/${job.id}`}
            className={`job-card job-${job.color}`}
          >
            <div className="job-card-top">
              <span className="job-title-dot" />
              <h3>{job.title}</h3>
              <ArrowUpRight size={17} className="job-arrow" />
            </div>
            <p>
              Temukan talenta untuk tim {job.department}.<br />
              {job.type} · {job.department}
            </p>
            <div className="job-details">
              <div>
                <span>Status</span>
                <span
                  className={`job-open ${job.status === "closed" ? "job-closed" : ""}`}
                >
                  <i />
                  {job.status === "open" ? "Aktif" : "Ditutup"}
                </span>
              </div>
              <div>
                <span>Pelamar</span>
                <span className="bubble-value">
                  {candidates.filter((c) => c.role === job.title).length}{" "}
                  kandidat
                </span>
              </div>
              <div>
                <span>Departemen</span>
                <span className="bubble-value">{job.department}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function upcomingInterviews(interviews: Interview[]) {
  return [...interviews].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
}

export function SchedulePanel() {
  const { candidates, interviews } = useDashboard();
  const list = upcomingInterviews(interviews);
  return (
    <section className="panel schedule-panel">
      <div className="section-heading">
        <h2>Interview mendatang</h2>
        <span className="soft-icon">
          <CalendarDays size={17} />
        </span>
      </div>
      <div className="schedule-date">
        <span>
          {list.length
            ? `Mulai ${formatDayMonth(list[0].start)}`
            : "Belum ada jadwal"}
        </span>
        <span className="count">{list.length} interview</span>
      </div>
      <div className="schedule-list">
        {list.map((item) => {
          const candidate = candidates.find((c) => c.id === item.candidateId);
          if (!candidate) return null;
          return (
            <Link
              key={item.candidateId}
              href={`/dashboard/candidates/${candidate.id}`}
              className="interview-item"
            >
              <div className="interview-time">
                <strong>{formatTime(item.start)}</strong>
                <span>{formatTime(item.end)}</span>
              </div>
              <div className={`interview-line ${candidate.color}`} />
              <div className="interview-info">
                <strong>{candidate.name}</strong>
                <span>
                  {formatDayMonth(item.start)} · {candidate.role}
                </span>
                <small>
                  <Video size={12} />
                  {item.type}
                </small>
              </div>
              <ChevronRight size={15} />
            </Link>
          );
        })}
      </div>
      <Link className="schedule-link" href="/dashboard/schedule">
        Lihat jadwal lengkap
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}
