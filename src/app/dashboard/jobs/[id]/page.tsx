import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  CalendarX2,
  ChartColumn,
  Check,
  ExternalLink,
  Link2,
} from "lucide-react";
import { formatDate, formatTimeRange } from "@/lib/applicant-demo";
import { getJob, type JobSlot } from "@/lib/job-store";
import { CandidateTable } from "../../candidate-table";
import { PageHeading } from "../../dashboard-ui";
import { ApprovalEntry } from "./approval-entry";
import { CopyLink } from "./copy-link";
import { RunAnalysis } from "./run-analysis";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ baru?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  return { title: `${job?.title ?? "Lowongan"} — Saring` };
}

export default async function JobDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { baru } = await searchParams;
  const job = await getJob(id);
  if (!job) notFound();

  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const applyUrl = `${protocol}://${requestHeaders.get("host")}/apply/${job.slug}`;

  const days = new Map<string, JobSlot[]>();
  for (const slot of job.slots) {
    const day = formatDate(slot.start);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }
  const emptySlots = job.slots.filter((slot) => slot.status === "kosong").length;

  return (
    <>
      <PageHeading
        title={job.title}
        description={[job.company, job.department, job.type, job.location]
          .filter(Boolean)
          .join(" · ")}
      >
        <span
          className={`job-open ${job.status === "closed" ? "job-closed" : ""}`}
        >
          <i />
          {job.status === "open" ? "Aktif" : "Ditutup"}
        </span>
        <RunAnalysis jobId={job.id} />
        <Link className="button secondary" href={`/dashboard/jobs/${job.id}/report`}>
          <ChartColumn size={15} />
          Laporan
        </Link>
      </PageHeading>

      {baru && (
        <div className="job-created" role="status">
          <span>
            <Check size={15} />
          </span>
          <div>
            <strong>Lowongan berhasil dibuat.</strong>
            <p>Salin link di bawah dan bagikan untuk mulai menerima lamaran.</p>
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        <div className="main-column">
          {job.status === "open" && job.slug ? (
            <section className="panel job-panel job-share">
              <div className="job-share-heading">
                <span className="job-icon sage">
                  <Link2 size={17} />
                </span>
                <div>
                  <h2>Link lamaran</h2>
                  <p>
                    Bagikan di portal lowongan, media sosial, atau email.
                    Pelamar tidak perlu login.
                  </p>
                </div>
              </div>
              <CopyLink url={applyUrl} />
              <Link
                className="text-button"
                href={`/apply/${job.slug}`}
                target="_blank"
              >
                Lihat form yang dibuka pelamar <ExternalLink size={14} />
              </Link>
            </section>
          ) : (
            <section className="panel job-panel job-share">
              <div className="job-share-heading">
                <span className="job-icon sand">
                  <CalendarX2 size={17} />
                </span>
                <div>
                  <h2>Lowongan ditutup</h2>
                  <p>Link lamaran tidak lagi menerima pelamar baru.</p>
                </div>
              </div>
            </section>
          )}
          <ApprovalEntry jobId={job.id} role={job.title} />
          <CandidateTable full lockedRole={job.title} />
        </div>
        <div className="right-column">
          <section className="panel job-panel">
            <h2>Kriteria penilaian</h2>
            <p className="job-panel-intro">{job.description}</p>
            <h3>Skill wajib</h3>
            <div className="skill-tags">
              {job.requiredSkills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
            {job.niceToHaveSkills.length > 0 && (
              <>
                <h3>Skill tambahan</h3>
                <div className="skill-tags">
                  {job.niceToHaveSkills.map((skill) => (
                    <span key={skill}>{skill}</span>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="panel job-panel">
            <h2>Slot interview</h2>
            {job.slots.length ? (
              <>
                <p className="job-panel-intro">
                  {emptySlots} kosong dari {job.slots.length} slot. Waktu dalam
                  WIB.
                </p>
                <div className="job-slot-list detail">
                  {[...days].map(([day, daySlots]) => (
                    <div key={day}>
                      <h3>{day}</h3>
                      <ul>
                        {daySlots.map((slot) => (
                          <li key={slot.id}>
                            {formatTimeRange(slot)}
                            <span className={`job-slot-status ${slot.status}`}>
                              {slot.status === "kosong" ? "Kosong" : "Terisi"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="job-panel-intro">Tidak ada slot interview.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
