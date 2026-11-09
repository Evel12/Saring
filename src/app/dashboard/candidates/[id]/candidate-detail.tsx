"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCheck,
  CircleSlash,
  FileText,
  Link2,
  MessageCircleQuestion,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Undo2,
  Wrench,
} from "lucide-react";
import { formatDate, formatTimeRange } from "@/lib/schedule";
import {
  SHORTLIST_RULE,
  type AgentStep,
  type Candidate,
  type SkillStatus,
} from "@/lib/candidates";
import { Avatar, Status } from "../../candidate-table";
import { useDashboard } from "../../dashboard-context";

export const SKILL_LABEL: Record<SkillStatus, string> = {
  verified: "Terbukti",
  claimed: "Hanya klaim",
  contradicted: "Bertentangan",
  unknown: "Belum ada bukti",
};

const STEP_ICON: Record<AgentStep["state"], typeof Check> = {
  ok: Check,
  recovered: RotateCcw,
  flagged: AlertTriangle,
};

const STEP_NOTE: Record<AgentStep["state"], string> = {
  ok: "",
  recovered: "Dipulihkan otomatis",
  flagged: "Diteruskan ke HR",
};

function CvExcerpt({ lines }: { lines: string[] }) {
  return (
    <ul className="review-excerpt">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

function DecisionPanel({ candidate }: { candidate: Candidate }) {
  const { jobs, interviews, approve, decline, returnToReview } = useDashboard();
  const job = jobs.find((item) => item.id === candidate.jobId);
  const interview = interviews.find(
    (item) => item.candidateId === candidate.id,
  );
  return (
    <section className="panel job-panel review-decision">
      <h2>Keputusanmu</h2>
      <div className="review-decision-body" key={candidate.status}>
        {candidate.status === "Perlu ditinjau" && (
          <>
            <p className="job-panel-intro">
              Setujui untuk masuk shortlist, atau jangan lanjutkan. Belum ada
              email yang terkirim.
            </p>
            <button
              className="button primary review-action"
              onClick={() => approve(candidate)}
            >
              <Check size={16} />
              Setujui ke shortlist
            </button>
            <button
              className="button secondary review-action"
              onClick={() => decline(candidate)}
            >
              <CircleSlash size={15} />
              Tidak dilanjutkan
            </button>
          </>
        )}
        {candidate.status === "Shortlist" && (
          <>
            <p className="job-panel-intro">
              Kandidat ini ada di shortlist. Undangan baru terkirim setelah kamu
              menyetujuinya di halaman persetujuan.
            </p>
            {job && (
              <Link
                className="button primary review-action"
                href={`/dashboard/jobs/${job.id}/approval`}
              >
                Tinjau undangan
                <ArrowRight size={15} />
              </Link>
            )}
            <button
              className="button secondary review-action"
              onClick={() => returnToReview(candidate)}
            >
              <Undo2 size={15} />
              Kembalikan ke tinjauan
            </button>
          </>
        )}
        {candidate.status === "Diundang" && (
          <>
            <p className="review-done">
              <CheckCheck size={17} />
              Link jadwal sudah dibuat. Menunggu pelamar memilih slot.
            </p>
            {job && (
              <Link
                className="button secondary review-action"
                href={`/dashboard/jobs/${job.id}/approval`}
              >
                Salin atau kirim ulang link
                <ArrowRight size={15} />
              </Link>
            )}
          </>
        )}
        {candidate.status === "Interview" && (
          <>
            <p className="review-done">
              <CheckCheck size={17} />
              Pelamar sudah memilih jadwal interview.
            </p>
            {interview && (
              <p className="review-interview">
                <strong>{formatDate(interview.start)}</strong>
                {formatTimeRange(interview)} · {interview.type}
              </p>
            )}
          </>
        )}
        {candidate.status === "Tidak dilanjutkan" && (
          <>
            <p className="job-panel-intro">
              Kandidat ini tidak dilanjutkan. Tidak ada email yang dikirim ke
              pelamar.
            </p>
            <button
              className="button secondary review-action"
              onClick={() => returnToReview(candidate)}
            >
              <Undo2 size={15} />
              Kembalikan ke tinjauan
            </button>
          </>
        )}
      </div>
    </section>
  );
}

const STEPS_SHOWN = 6;

const LINK_STATE: Record<string, string> = {
  observed: "Terbuka",
  manual: "Cek manual",
  not_found: "Tidak ditemukan",
  unreachable: "Tidak bisa dibuka",
};

// Buka CV di tab baru (endpoint download butuh cookie HR, jadi lewat blob).
async function openDocument(id: string) {
  const tab = window.open("", "_blank");
  const res = await fetch(`/api/v1/documents/${id}/download`, {
    credentials: "same-origin",
  });
  if (!res.ok || !tab) {
    tab?.close();
    alert("CV tidak bisa dibuka. Coba muat ulang halaman.");
    return;
  }
  tab.location.href = URL.createObjectURL(await res.blob());
}

function AgentSteps({ steps }: { steps: AgentStep[] }) {
  const [all, setAll] = useState(false);
  // Langkah terbaru di atas; sisanya disembunyikan supaya panel tidak memanjang.
  const ordered = [...steps].reverse();
  const shown = all ? ordered : ordered.slice(0, STEPS_SHOWN);
  return (
    <>
      <ol className="review-steps">
        {shown.map((item, index) => {
          const Icon = STEP_ICON[item.state];
          return (
            <li key={index} className={item.state}>
              <span>
                <Icon size={12} />
              </span>
              <div>
                <strong>{item.label}</strong>
                <code>{item.tool}</code>
                <p>{item.result}</p>
                {STEP_NOTE[item.state] && (
                  <small>{STEP_NOTE[item.state]}</small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {ordered.length > STEPS_SHOWN && (
        <button
          type="button"
          className="text-button"
          onClick={() => setAll(!all)}
        >
          {all
            ? "Tampilkan lebih sedikit"
            : `Lihat semua ${ordered.length} langkah`}
        </button>
      )}
    </>
  );
}

export function CandidateDetail({ id }: { id: string }) {
  const { candidates } = useDashboard();
  const candidate = candidates.find((item) => item.id === id);
  if (!candidate) return null;

  const counts = (
    ["verified", "claimed", "contradicted", "unknown"] as const
  ).map((status) => ({
    status,
    count: candidate.skills.filter((skill) => skill.status === status).length,
  }));

  return (
    <>
      <div className="page-heading review-heading">
        <div className="review-identity">
          <Avatar initials={candidate.initials} color={candidate.color} />
          <div>
            <h1>{candidate.name}</h1>
            <p>
              {candidate.role}
              {candidate.experience && ` · ${candidate.experience} pengalaman`}
            </p>
          </div>
        </div>
        <div className="heading-actions">
          <span className="review-status" key={candidate.status}>
            <Status status={candidate.status} />
          </span>
        </div>
      </div>

      {candidate.status === "Perlu ditinjau" &&
        candidate.reviewReasons.length > 0 && (
          <section className="review-reasons">
            <AlertTriangle size={17} />
            <div>
              <h2>Kenapa agent meminta kamu meninjau</h2>
              <ul>
                {candidate.reviewReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

      <div className="dashboard-grid review-grid">
        <div className="main-column review-column">
          <section className="panel job-panel">
            <div className="review-score-top">
              <div>
                <h2>
                  <Sparkles size={15} />
                  Kecocokan dengan lowongan
                </h2>
                <p className="job-panel-intro">{candidate.summary}</p>
              </div>
              <strong className="review-score">
                {candidate.score}
                <small>/100</small>
              </strong>
            </div>
            {candidate.strengths.length > 0 && (
              <ul className="review-parts">
                {candidate.strengths.map((text) => (
                  <li key={text}>
                    <p>
                      <FileText size={12} />
                      {text}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <ul className="review-parts">
              {candidate.scoreParts.map((part) => (
                <li key={part.label}>
                  <div className="review-part-top">
                    <span>{part.label}</span>
                    <strong>
                      {part.score}
                      <small>/{part.max}</small>
                    </strong>
                  </div>
                  <span className="score-track review-track">
                    <i style={{ width: `${(part.score / part.max) * 100}%` }} />
                  </span>
                  <p>
                    <FileText size={12} />
                    {part.quote}
                  </p>
                </li>
              ))}
            </ul>
            <p className="review-rule">
              <strong>Aturan shortlist:</strong> {SHORTLIST_RULE}
            </p>
          </section>

          <section className="panel job-panel">
            <h2>Verifikasi skill</h2>
            <div className="review-counts">
              {counts.map(({ status, count }) => (
                <span className={`skill-status ${status}`} key={status}>
                  {count} {SKILL_LABEL[status].toLowerCase()}
                </span>
              ))}
            </div>
            <ul className="review-skills">
              {candidate.skills.map((skill) => (
                <li key={skill.name}>
                  <div>
                    <strong>{skill.name}</strong>
                    <p>{skill.evidence}</p>
                  </div>
                  <span className={`skill-status ${skill.status}`}>
                    {SKILL_LABEL[skill.status]}
                  </span>
                </li>
              ))}
            </ul>
            <p className="review-rule">
              “Belum ada bukti” bukan berarti tidak mampu. Agent tidak pernah
              menolak otomatis.
            </p>
          </section>

          <section className="panel job-panel">
            <h2>
              <MessageCircleQuestion size={15} />
              Usulan pertanyaan interview
            </h2>
            <p className="job-panel-intro">
              Saran dari agent berdasarkan bukti yang paling lemah. Pakai, ubah,
              atau abaikan sesuai kebutuhanmu.
            </p>
            {candidate.questions.length ? (
              <ol className="review-questions">
                {candidate.questions.map((item) => (
                  <li key={item.question}>
                    <p>{item.question}</p>
                    <small>Menyasar: {item.reason}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="job-panel-intro">
                Muncul setelah analisis selesai.
              </p>
            )}
          </section>

          <section className="panel job-panel">
            <h2>
              <ShieldCheck size={15} />
              Blind screening
            </h2>
            <p className="job-panel-intro">
              Agent hanya mengirim baris profesional ke model AI. Nama, kontak,
              URL, dan data pribadi disaring dulu, jadi penilaian tidak melihat
              siapa pelamarnya.
            </p>
            <h3>Cuplikan CV yang dinilai agent</h3>
            {candidate.cvExcerpt.length ? (
              <CvExcerpt lines={candidate.cvExcerpt} />
            ) : (
              <p className="job-panel-intro">Belum ada bukti yang dibaca.</p>
            )}
          </section>
        </div>

        <div className="right-column review-column">
          <DecisionPanel candidate={candidate} />

          <section className="panel job-panel">
            <h2>Data lamaran</h2>
            <dl className="review-data">
              <div>
                <dt>Email</dt>
                <dd>{candidate.email}</dd>
              </div>
              <div>
                <dt>Melamar</dt>
                <dd>{formatDate(candidate.appliedAt)}</dd>
              </div>
              <div>
                <dt>Format CV</dt>
                <dd>{candidate.cvFormat}</dd>
              </div>
              <div>
                <dt>Link</dt>
                <dd>
                  {candidate.link ? (
                    <>
                      {candidate.link.url}
                      {!candidate.link.reachable && (
                        <span className="review-link-dead">
                          Tidak bisa dibuka (404)
                        </span>
                      )}
                    </>
                  ) : (
                    "Tidak diberikan"
                  )}
                </dd>
              </div>
              <div>
                <dt>Persetujuan privasi</dt>
                <dd>Diberikan saat melamar</dd>
              </div>
            </dl>
          </section>

          {candidate.links.length > 0 && (
            <section className="panel job-panel">
              <h2>
                <Link2 size={15} />
                Cek link oleh agent
              </h2>
              <p className="job-panel-intro">
                Agent membuka link dari CV lewat API resmi. Hanya bahan untuk
                HR, tidak memengaruhi skor.
              </p>
              <ul className="link-checks">
                {candidate.links.map((link) => (
                  <li key={link.url}>
                    <div className="link-check-top">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {link.url.replace(/^https:\/\/(www\.)?/, "")}
                      </a>
                      <span className={`link-state ${link.state}`}>
                        {LINK_STATE[link.state] ?? link.state}
                      </span>
                    </div>
                    {link.publicRepos !== null && (
                      <p>
                        {link.title && <strong>{link.title} · </strong>}
                        {link.publicRepos} repo publik
                        {link.topLanguages && ` · Bahasa: ${link.topLanguages}`}
                        {link.lastActivity &&
                          ` · Aktif terakhir ${formatDate(link.lastActivity)}`}
                      </p>
                    )}
                    {link.publicRepos === null && link.title && (
                      <p>{link.title}</p>
                    )}
                    {link.repos.length > 0 && (
                      <ul className="link-repos">
                        {link.repos.slice(0, 4).map((repo) => (
                          <li key={repo.name}>
                            <code>{repo.name}</code>
                            {repo.language && <span>{repo.language}</span>}
                            {repo.description && (
                              <small>{repo.description}</small>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel job-panel">
            <h2>
              <FileText size={15} />
              CV &amp; jawaban pelamar
            </h2>
            {candidate.documents.length ? (
              <div className="skill-tags">
                {candidate.documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className="button secondary"
                    onClick={() => openDocument(doc.id)}
                  >
                    <FileText size={14} />
                    Lihat {doc.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="job-panel-intro">Tidak ada dokumen.</p>
            )}
            {Object.keys(candidate.answers).length > 0 && (
              <dl className="review-data">
                {Object.entries(candidate.answers).map(([question, answer]) => (
                  <div key={question}>
                    <dt>{question}</dt>
                    <dd>{answer}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="panel job-panel">
            <h2>
              <Wrench size={15} />
              Langkah agent
            </h2>
            <AgentSteps steps={candidate.pipeline} />
          </section>
        </div>
      </div>
    </>
  );
}
