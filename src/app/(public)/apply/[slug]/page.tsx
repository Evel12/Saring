import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefcaseBusiness, CalendarX2, ShieldCheck } from "lucide-react";
import { getJobBySlug } from "@/lib/job-store";
import { NextSteps, PublicMessage } from "../../public-ui";
import { ApplyForm } from "./apply-form";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  return {
    title: job
      ? `Lamar ${job.title} — ${job.company}`
      : "Lowongan tidak ditemukan — Saring",
  };
}

export default async function ApplyPage({ params }: Props) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  if (job.status === "closed")
    return (
      <PublicMessage
        icon={<CalendarX2 size={22} />}
        tone="sand"
        title="Lowongan ini sudah ditutup"
      >
        <p>
          {job.company} tidak lagi menerima lamaran untuk posisi {job.title}.
          Lamaran yang sudah masuk tetap diproses.
        </p>
      </PublicMessage>
    );

  return (
    <>
      <div className="page-heading public-heading">
        <div>
          <h1>Lamar posisi {job.title}</h1>
          <p>
            {job.company} · {job.department} · {job.type} · {job.location}
          </p>
        </div>
      </div>
      <div className="public-grid">
        <ApplyForm slug={job.slug} />
        <aside className="public-aside">
          <section className="panel public-card">
            <span className="job-icon sage">
              <BriefcaseBusiness size={18} />
            </span>
            <h2>Tentang posisi</h2>
            <p>{job.description}</p>
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
          <section className="panel public-card">
            <h2>Setelah kamu kirim</h2>
            <NextSteps />
          </section>
          <div className="public-fair-note">
            <ShieldCheck size={17} />
            <span>
              Form ini tidak meminta foto, agama, usia, atau status pernikahan.
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}
