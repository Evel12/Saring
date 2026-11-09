"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import type { SkillStatus } from "@/lib/demo";
import { Status } from "../../../candidate-table";
import { SKILL_LABEL } from "../../../candidates/[id]/candidate-detail";
import { useDashboard } from "../../../dashboard-context";
import { PageHeading } from "../../../dashboard-ui";

const SKILL_ORDER: SkillStatus[] = ["verified", "claimed", "contradicted"];

export function JobReport({
  jobId,
  title,
  company,
  slots,
  filledSlots,
}: {
  jobId: string;
  title: string;
  company: string;
  slots: number;
  filledSlots: number;
}) {
  const { candidates } = useDashboard();
  const applicants = candidates.filter((c) => c.role === title);
  const passed = applicants.filter((c) =>
    ["Shortlist", "Diundang", "Interview"].includes(c.status),
  );
  const invited = applicants.filter((c) =>
    ["Diundang", "Interview"].includes(c.status),
  );
  const interviewed = applicants.filter((c) => c.status === "Interview");
  const average = applicants.length
    ? Math.round(
        applicants.reduce((sum, c) => sum + c.score, 0) / applicants.length,
      )
    : 0;

  const funnel = [
    { label: "Melamar", value: applicants.length },
    { label: "Dinilai agent", value: applicants.length },
    { label: "Lolos tinjauan", value: passed.length },
    { label: "Diundang", value: invited.length },
    { label: "Memilih jadwal", value: interviewed.length },
  ];
  const max = Math.max(1, applicants.length);

  const skills = applicants.flatMap((c) => c.skills);
  const skillCounts = SKILL_ORDER.map((status) => ({
    status,
    count: skills.filter((s) => s.status === status).length,
  }));
  const steps = applicants.flatMap((c) => c.pipeline);
  const agentFacts = [
    {
      label: "Data sensitif disembunyikan",
      value: applicants.reduce((sum, c) => sum + c.hiddenFields.length, 0),
      unit: "field",
    },
    {
      label: "Kegagalan dipulihkan otomatis",
      value: steps.filter((s) => s.state === "recovered").length,
      unit: "kali",
    },
    {
      label: "Kasus diteruskan ke HR",
      value: applicants.filter((c) => c.reviewReasons.length).length,
      unit: "pelamar",
    },
    {
      label: "Tidak dilanjutkan",
      value: applicants.filter((c) => c.status === "Tidak dilanjutkan").length,
      unit: "pelamar",
    },
  ];

  return (
    <>
      <PageHeading
        title={`Laporan ${title}`}
        description={`${company} · Ringkasan hasil rekrutmen lowongan ini.`}
      >
        <button
          className="button secondary report-print"
          onClick={() => window.print()}
        >
          <Printer size={15} />
          Cetak atau simpan PDF
        </button>
      </PageHeading>

      <section className="stats-panel" aria-label="Angka utama">
        {[
          { label: "Pelamar", value: applicants.length, note: "Masuk lewat link lamaran" },
          { label: "Lolos tinjauan", value: passed.length, note: "Shortlist sampai interview" },
          {
            label: "Slot interview terisi",
            value: filledSlots,
            note: `Dari ${slots} slot`,
          },
          { label: "Rata-rata skor", value: average, note: "Skala 0 sampai 100" },
        ].map((item) => (
          <div className="stat" key={item.label}>
            <div>
              <span>{item.label}</span>
            </div>
            <strong>{item.value.toString().padStart(2, "0")}</strong>
            <small>{item.note}</small>
          </div>
        ))}
      </section>

      {applicants.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <h3>Belum ada pelamar</h3>
            <p>Laporan terisi setelah lamaran pertama masuk.</p>
          </div>
        </section>
      ) : (
        <div className="report-grid">
          <section className="panel job-panel">
            <h2>Alur pelamar</h2>
            <p className="job-panel-intro">
              Jumlah pelamar di setiap tahap rekrutmen.
            </p>
            <ul className="report-funnel">
              {funnel.map((item) => (
                <li key={item.label} title={`${item.label}: ${item.value} pelamar`}>
                  <span className="report-funnel-label">{item.label}</span>
                  <span className="report-funnel-track">
                    <i style={{ width: `${(item.value / max) * 100}%` }} />
                  </span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel job-panel">
            <h2>Verifikasi skill</h2>
            <p className="job-panel-intro">
              {skills.length} klaim skill dari semua pelamar, dicek dari link yang
              mereka berikan.
            </p>
            <div className="report-stack" role="img" aria-label={skillCounts
              .map((s) => `${SKILL_LABEL[s.status]} ${s.count}`)
              .join(", ")}>
              {skillCounts
                .filter((s) => s.count)
                .map((s) => (
                  <i
                    key={s.status}
                    className={s.status}
                    style={{ flexGrow: s.count }}
                    title={`${SKILL_LABEL[s.status]}: ${s.count}`}
                  />
                ))}
            </div>
            <ul className="report-legend">
              {skillCounts.map((s) => (
                <li key={s.status}>
                  <span className={`report-swatch ${s.status}`} />
                  {SKILL_LABEL[s.status]}
                  <strong>{s.count}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel job-panel">
            <h2>Kerja agent</h2>
            <dl className="report-facts">
              {agentFacts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>
                    {fact.value} <small>{fact.unit}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="panel job-panel report-table">
            <h2>Daftar pelamar</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pelamar</th>
                    <th>Skor</th>
                    <th>Skill terbukti</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...applicants]
                    .sort((a, b) => b.score - a.score)
                    .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/dashboard/candidates/${c.id}`}>
                            {c.name}
                          </Link>
                        </td>
                        <td>{c.score}</td>
                        <td>
                          {c.skills.filter((s) => s.status === "verified").length}{" "}
                          dari {c.skills.length}
                        </td>
                        <td>
                          <Status status={c.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      <p className="report-note">
        Angka dihitung dari data contoh prototipe, belum dari penggunaan nyata.{" "}
        <Link href={`/dashboard/jobs/${jobId}`}>Kembali ke lowongan</Link>
      </p>
    </>
  );
}
