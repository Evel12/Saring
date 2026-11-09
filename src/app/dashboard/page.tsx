"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  FileText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { formatDayMonth } from "@/lib/applicant-demo";
import { buildLog } from "@/lib/agent-log";
import { CandidateTable } from "./candidate-table";
import { useDashboard } from "./dashboard-context";
import { LogIcon, logTime } from "./activity/log-ui";
import {
  AddJobButton,
  JobCards,
  PageHeading,
  SchedulePanel,
  upcomingInterviews,
} from "./dashboard-ui";

const REVIEW_HREF = "/dashboard/candidates?status=Perlu+ditinjau";
const pad = (value: number) => value.toString().padStart(2, "0");

export default function OverviewPage() {
  const { openJobs, candidates, interviews, pending, hrEvents } = useDashboard();
  const upcoming = upcomingInterviews(interviews);
  const recent = buildLog(candidates, hrEvents).slice(0, 4);
  const stats = [
    {
      label: "Lowongan aktif",
      value: pad(openJobs.length),
      icon: BriefcaseBusiness,
      note: "Kesempatan untuk talenta baru",
      href: "/dashboard/jobs",
    },
    {
      label: "Total pelamar",
      value: pad(candidates.length),
      icon: Users,
      note: "Dari semua lowongan",
      href: "/dashboard/candidates",
    },
    {
      label: "Perlu ditinjau",
      value: pad(pending),
      icon: FileText,
      note: "Menunggu keputusanmu",
      href: REVIEW_HREF,
    },
    {
      label: "Interview terjadwal",
      value: pad(upcoming.length),
      icon: CalendarDays,
      note: upcoming.length
        ? `Mulai ${formatDayMonth(upcoming[0].start)}`
        : "Belum ada jadwal",
      href: "/dashboard/schedule",
    },
  ];

  return (
    <>
      <PageHeading
        title="Ringkasan rekrutmen"
        description="Pantau lowongan, tinjau kandidat, dan atur langkah berikutnya."
      >
        <AddJobButton />
      </PageHeading>
      <section className="stats-panel" aria-label="Ringkasan rekrutmen">
        {stats.map(({ label, value, icon: Icon, note, href }) => (
          <Link className="stat" key={label} href={href}>
            <div>
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>
              {value}
              <ArrowUpRight size={17} />
            </strong>
            <small>{note}</small>
          </Link>
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
            <Link className="banner-action" href={REVIEW_HREF}>
              Tinjau <ArrowRight size={15} />
            </Link>
          </section>
          <CandidateTable />
        </div>
        <div className="right-column">
          <SchedulePanel />
          <section className="panel activity-panel">
            <div className="section-heading">
              <h2>Aktivitas terbaru</h2>
            </div>
            <div className="activity-list">
              {recent.map((entry) => {
                const candidate = candidates.find(
                  (c) => c.id === entry.candidateId,
                );
                return (
                  <div className="activity-item" key={entry.id}>
                    <LogIcon entry={entry} />
                    <div>
                      <p>
                        {entry.label} · {candidate?.name}
                      </p>
                      <small>{logTime(entry)}</small>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link className="schedule-link" href="/dashboard/activity">
              Lihat semua aktivitas <ArrowRight size={15} />
            </Link>
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
  );
}
