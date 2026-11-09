// Kandidat (= lamaran) dari backend, dibaca di server dengan cookie sesi HR.
import { serverGet } from "./server-api";
import type { Activity, Application, Brief, Document, Page } from "./types";
import type { Job } from "./job-store";
import type {
  AgentStep,
  Candidate,
  CandidateStatus,
  Interview,
  SkillStatus,
} from "./candidates";

type Person = { id: string; display_name: string; email: string | null };
type Insights = {
  summary: string | null;
  strengths: { text: string }[];
  relevant_details: { text: string }[];
  links: { url: string; state: string }[];
};
type Event = Activity & { actor_id?: string | null };

const COLORS = ["peach", "lavender", "sage", "sand", "rose", "blue"];
const SKILL: Record<string, SkillStatus> = {
  supported: "verified",
  partial: "claimed",
  conflicting: "contradicted",
  unknown: "unknown",
};
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const LABEL: Record<string, string> = {
  "application.applied": "Lamaran masuk",
  "application.created": "Lamaran dibuat",
  "extraction.completed": "Membaca CV",
  "extraction.uncertain": "Bagian CV sulit dibaca",
  "analysis.progress": "Menilai kriteria",
  "analysis.summary": "Merangkum CV",
  "analysis.summary_failed": "Ringkasan gagal dibuat",
  "analysis.highlights": "Mencari poin kuat",
  "analysis.details": "Mencari detail relevan",
  "execution.completed": "Analisis selesai",
  "link.observed": "Memeriksa link",
  "link.reviewed": "Meninjau isi link",
  "interview.link_created": "Membuat link jadwal",
  "interview.booked": "Pelamar memilih jadwal",
  "review.cancelled": "Analisis dibatalkan",
  "decision.recorded": "Keputusan HR dicatat",
};

function step(e: Event): AgentStep {
  const failed = /failed|uncertain|error/.test(e.kind) || !!e.details?.error_code;
  return {
    tool: e.details?.tool ?? e.kind,
    label: LABEL[e.kind] ?? e.kind,
    result: e.message,
    state: failed ? "flagged" : "ok",
    at: iso(e.created_at),
    actor: e.actor_id ? "hr" : "agent",
  };
}

async function toCandidate(
  a: Application & { schedule_token?: string | null },
  person: Person | undefined,
  job: Job | undefined,
  index: number,
): Promise<Candidate> {
  const [brief, insights, docs, events] = await Promise.all([
    serverGet<Brief>(`/applications/${a.id}/interview-brief`),
    serverGet<Insights>(`/applications/${a.id}/insights`),
    serverGet<Page<Document>>(`/applications/${a.id}/documents?limit=10&offset=0`),
    serverGet<{ items: Event[] }>(`/events/changes?tail=true&limit=50&application_id=${a.id}`),
  ]);
  const requirements = brief?.requirements ?? [];
  const findings = brief?.findings ?? [];
  const evidence = brief?.evidence ?? [];
  const revisionOf = (requirementId: string) =>
    findings.find((f) => f.requirement_id === requirementId)?.latest_revision ?? null;

  const skills = requirements.map((r) => {
    const rev = revisionOf(r.id);
    const quote = evidence.find((e) => rev?.evidence_ids.includes(e.id))?.passage;
    return {
      name: r.description,
      status: SKILL[rev?.state ?? "unknown"],
      evidence: rev?.explanation || (quote ? `CV: ‘${quote}’` : "Belum ada bukti di CV."),
      essential: r.importance === "essential",
    };
  });
  const points = skills.reduce(
    (sum, s) => sum + (s.status === "verified" ? 1 : s.status === "claimed" ? 0.5 : 0),
    0,
  );
  const analyzed = findings.some((f) => f.latest_revision);
  const reviewReasons = [
    ...(a.reassessment_required ? ["Kriteria lowongan berubah. Jalankan analisis ulang sebelum memutuskan."] : []),
    ...skills
      .filter((s) => s.essential && s.status === "contradicted")
      .map((s) => `Bukti untuk ${s.name} saling bertentangan. Agent tidak menolak otomatis, jadi kamu yang memutuskan.`),
    ...skills
      .filter((s) => analyzed && s.essential && s.status === "unknown")
      .map((s) => `Belum ada bukti untuk skill wajib ${s.name}. Tidak ada bukti bukan berarti tidak mampu.`),
  ];

  const booked = job?.slots.find((s) => s.applicationId === a.id);
  const status: CandidateStatus =
    a.decision === "reject"
      ? "Tidak dilanjutkan"
      : booked
        ? "Interview"
        : a.decision === "shortlist"
          ? a.schedule_token ? "Diundang" : "Shortlist"
          : "Perlu ditinjau";

  const answers = a.intro_answers ?? {};
  const linkUrl = answers["Link GitHub atau portofolio"] ?? insights?.links[0]?.url;
  const linkState = insights?.links.find((l) => l.url === linkUrl)?.state;
  const name = person?.display_name ?? "Pelamar";
  const doc = docs?.items[0];

  return {
    id: a.id,
    jobId: a.vacancy_id,
    name,
    initials: initials(name),
    color: COLORS[index % COLORS.length],
    role: job?.title ?? brief?.vacancy_title ?? "",
    email: person?.email ?? "",
    score: requirements.length ? Math.round((100 * points) / requirements.length) : 0,
    analyzed,
    status,
    experience: "",
    appliedAt: iso(a.created_at),
    cvFormat: doc ? (/pdf/i.test(doc.media_type) ? "PDF" : "DOCX") : "-",
    link: linkUrl ? { url: linkUrl, reachable: !["not_found", "unreachable"].includes(linkState ?? "") } : null,
    skills: skills.map(({ name, status, evidence }) => ({ name, status, evidence })),
    summary:
      insights?.summary ??
      brief?.summary ??
      "Belum dianalisis. Jalankan analisis AI dari halaman lowongan.",
    strengths: (insights?.strengths ?? []).map((s) => s.text),
    scoreParts: [],
    reviewReasons,
    hiddenFields: [],
    cvExcerpt: evidence.slice(0, 3).map((e) => e.passage).join(" … "),
    pipeline: (events?.items ?? []).map(step),
    questions: requirements.flatMap((r) => {
      const q = revisionOf(r.id)?.unresolved_question;
      return q ? [{ question: q, reason: r.description }] : [];
    }),
    scheduleToken: a.schedule_token,
  };
}

export async function loadCandidates(jobs: Job[]): Promise<{
  candidates: Candidate[];
  interviews: Interview[];
}> {
  // shortcut: first 100 applications/candidates only, add paging for bigger teams.
  const [apps, people] = await Promise.all([
    serverGet<Page<Application & { schedule_token?: string | null }>>("/applications?limit=100&offset=0"),
    serverGet<Page<Person>>("/candidates?limit=100&offset=0"),
  ]);
  const list = (apps?.items ?? []).filter((a) => !a.withdrawn_at);
  const candidates = await Promise.all(
    list.map((a, i) =>
      toCandidate(
        a,
        people?.items.find((p) => p.id === a.candidate_id),
        jobs.find((j) => j.id === a.vacancy_id),
        i,
      ),
    ),
  );
  const interviews = jobs.flatMap((job) =>
    job.slots.flatMap((slot) =>
      slot.applicationId
        ? [{ candidateId: slot.applicationId, start: slot.start, end: slot.end, type: `Interview · ${job.title}` }]
        : [],
    ),
  );
  return { candidates, interviews };
}
