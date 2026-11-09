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
  links: {
    url: string;
    state: string;
    title?: string;
    subject?: string;
    public_repositories?: number | null;
    top_languages?: string;
    last_public_commit_utc?: string;
    repos?: {
      name: string;
      language: string;
      description: string;
      stars: number;
    }[];
  }[];
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
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

const LABEL: Record<string, string> = {
  "application.applied": "Lamaran masuk",
  "workflow.queued": "Analisis AI dijadwalkan otomatis",
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
  "review.failed": "Analisis gagal",
  "extraction.unsupported_language": "Bahasa CV tidak didukung",
};

const STATUS_ID: Record<string, string> = {
  supported: "terbukti",
  partial: "sebagian terbukti",
  unknown: "belum ada bukti",
  conflicting: "bertentangan",
};

// Backend menulis log dalam bahasa Inggris; HR membacanya dalam bahasa Indonesia.
function describe(e: Event): string {
  const d = e.details ?? {};
  const url = e.message.match(/https?:\/\/\S+/)?.[0] ?? "";
  switch (e.kind) {
    case "application.applied":
      return "Pelamar mengirim lamaran lewat link publik.";
    case "workflow.queued":
      return "Agent langsung menjadwalkan analisis CV tanpa menunggu HR.";
    case "analysis.progress":
      if (d.step === "ingest") return "Mulai membaca dokumen CV pelamar.";
      if (d.step === "evidence")
        return `Mengambil ${d.evidence ?? ""} baris profesional dari CV sebagai bukti.`;
      if (d.step === "review")
        return `Selesai: ${d.index ?? ""} kriteria dinilai, menunggu keputusan HR.`;
      if (d.result === "no-overlap")
        return `Kriteria ${d.index}/${d.total}: tidak ada kata yang cocok di CV, dicatat belum ada bukti.`;
      if (d.result)
        return `Kriteria ${d.index}/${d.total} dinilai AI: ${STATUS_ID[d.result] ?? d.result}.`;
      if (d.index) return `Menilai kriteria ${d.index}/${d.total} dengan AI.`;
      return `Mulai analisis AI untuk ${d.total ?? ""} kriteria.`;
    case "analysis.summary":
      return "Ringkasan profil pelamar dibuat.";
    case "analysis.summary_failed":
      return "Ringkasan AI gagal dibuat; dipakai kutipan CV sebagai gantinya.";
    case "analysis.highlights":
      return "Poin kuat diambil dari CV (kutipan persis).";
    case "analysis.details":
      return "Detail yang relevan dengan lowongan diambil dari CV.";
    case "link.observed":
      return `Link dari CV dicatat: ${url}`;
    case "link.reviewed":
      return `Isi link ditinjau AI: ${url}`;
    case "review.failed":
      return d.result === "retry_scheduled"
        ? `Percobaan ${d.attempt} gagal (${d.error_code}). Agent mencoba ulang otomatis.`
        : `Analisis gagal setelah ${d.attempt} percobaan (${d.error_code}). Perlu dicek HR.`;
    case "decision.recorded":
      return "HR mencatat keputusan untuk pelamar ini.";
    case "interview.link_created":
      return "HR menyetujui undangan; link jadwal pribadi dibuat.";
    case "interview.booked":
      return "Pelamar memilih slot interview.";
    default:
      return e.message;
  }
}

function step(e: Event): AgentStep {
  const failed =
    /failed|uncertain|unsupported|error/.test(e.kind) ||
    !!e.details?.error_code;
  return {
    tool: e.details?.tool ?? e.kind,
    label: LABEL[e.kind] ?? e.kind,
    result: describe(e),
    state: failed
      ? e.details?.result === "retry_scheduled"
        ? "recovered"
        : "flagged"
      : "ok",
    at: iso(e.created_at),
    actor: e.actor_id ? "hr" : "agent",
  };
}

// Usulan pertanyaan interview (bahasa Indonesia), fokus ke skill yang buktinya paling lemah.
const ORDER: Record<SkillStatus, number> = {
  contradicted: 0,
  unknown: 1,
  claimed: 2,
  verified: 3,
};
function suggestQuestions(
  skills: { name: string; status: SkillStatus; essential: boolean }[],
) {
  const ask: Record<SkillStatus, (s: string) => string> = {
    contradicted: (s) =>
      `Ada informasi yang berbeda soal ${s} di CV. Bisa ceritakan pengalamanmu yang sebenarnya dengan ${s}?`,
    unknown: (s) =>
      `CV belum menyebut ${s}. Pernahkah kamu memakai ${s}, atau teknologi serupa? Ceritakan contohnya.`,
    claimed: (s) =>
      `Ceritakan satu proyek di mana kamu memakai ${s}: apa peranmu dan apa hasilnya?`,
    verified: (s) =>
      `Apa tantangan tersulit yang pernah kamu hadapi saat memakai ${s}, dan bagaimana kamu menyelesaikannya?`,
  };
  const why: Record<SkillStatus, string> = {
    contradicted: "bukti bertentangan",
    unknown: "belum ada bukti di CV",
    claimed: "baru sebagian terbukti",
    verified: "menggali kedalaman",
  };
  return [...skills]
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        Number(b.essential) - Number(a.essential),
    )
    .slice(0, 5)
    .map((s) => ({
      question: ask[s.status](s.name),
      reason: `${s.name} (${s.essential ? "wajib" : "tambahan"}, ${why[s.status]})`,
    }));
}

const tidy = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/^[\s•·\-–*.…]+/, "")
    .trim();

async function toCandidate(
  a: Application & { schedule_token?: string | null },
  person: Person | undefined,
  job: Job | undefined,
  index: number,
): Promise<Candidate> {
  const [brief, insights, docs, events] = await Promise.all([
    serverGet<Brief>(`/applications/${a.id}/interview-brief`),
    serverGet<Insights>(`/applications/${a.id}/insights`),
    serverGet<Page<Document>>(
      `/applications/${a.id}/documents?limit=10&offset=0`,
    ),
    serverGet<{ items: Event[] }>(
      `/events/changes?tail=true&limit=50&application_id=${a.id}`,
    ),
  ]);
  const requirements = brief?.requirements ?? [];
  const findings = brief?.findings ?? [];
  const evidence = brief?.evidence ?? [];
  const revisionOf = (requirementId: string) =>
    findings.find((f) => f.requirement_id === requirementId)?.latest_revision ??
    null;

  const skills = requirements.map((r) => {
    const rev = revisionOf(r.id);
    const quote = evidence.find((e) =>
      rev?.evidence_ids.includes(e.id),
    )?.passage;
    return {
      name: r.description,
      status: SKILL[rev?.state ?? "unknown"],
      evidence:
        rev?.explanation ||
        (quote ? `CV: ‘${quote}’` : "Belum ada bukti di CV."),
      essential: r.importance === "essential",
    };
  });
  const points = skills.reduce(
    (sum, s) =>
      sum + (s.status === "verified" ? 1 : s.status === "claimed" ? 0.5 : 0),
    0,
  );
  const analyzed = findings.some((f) => f.latest_revision);
  const reviewReasons = [
    ...((events?.items ?? []).some(
      (e) => e.kind === "extraction.unsupported_language",
    )
      ? [
          "CV tidak berbahasa Indonesia atau Inggris, jadi agent tidak menilainya. Baca CV secara manual.",
        ]
      : []),
    ...(a.reassessment_required
      ? [
          "Kriteria lowongan berubah. Jalankan analisis ulang sebelum memutuskan.",
        ]
      : []),
    ...skills
      .filter((s) => s.essential && s.status === "contradicted")
      .map(
        (s) =>
          `Bukti untuk ${s.name} saling bertentangan. Agent tidak menolak otomatis, jadi kamu yang memutuskan.`,
      ),
    ...skills
      .filter((s) => analyzed && s.essential && s.status === "unknown")
      .map(
        (s) =>
          `Belum ada bukti untuk skill wajib ${s.name}. Tidak ada bukti bukan berarti tidak mampu.`,
      ),
  ];

  const booked = job?.slots.find((s) => s.applicationId === a.id);
  const status: CandidateStatus =
    a.decision === "reject"
      ? "Tidak dilanjutkan"
      : booked
        ? "Interview"
        : a.decision === "shortlist"
          ? a.schedule_token
            ? "Diundang"
            : "Shortlist"
          : "Perlu ditinjau";

  const answers = a.intro_answers ?? {};
  const linkUrl =
    answers["Link GitHub atau portofolio"] ?? insights?.links[0]?.url;
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
    score: requirements.length
      ? Math.round((100 * points) / requirements.length)
      : 0,
    analyzed,
    reviewed: a.review_state !== "pending",
    status,
    experience: "",
    appliedAt: iso(a.created_at),
    cvFormat: doc ? (/pdf/i.test(doc.media_type) ? "PDF" : "DOCX") : "-",
    link: linkUrl
      ? {
          url: linkUrl,
          reachable: !["not_found", "unreachable"].includes(linkState ?? ""),
        }
      : null,
    skills: skills.map(({ name, status, evidence, essential }) => ({
      name,
      status,
      evidence,
      essential,
    })),
    summary:
      insights?.summary ??
      brief?.summary ??
      "Belum dianalisis. Jalankan analisis AI dari halaman lowongan.",
    strengths: (insights?.strengths ?? []).map((s) => s.text),
    scoreParts: [],
    reviewReasons,
    hiddenFields: [],
    cvExcerpt: evidence
      .map((e) => tidy(e.passage))
      .filter((line) => line.length > 3)
      .slice(0, 8),
    pipeline: (events?.items ?? []).map(step),
    questions: analyzed ? suggestQuestions(skills) : [],
    scheduleToken: a.schedule_token,
    documents: (docs?.items ?? []).map((d) => ({
      id: d.id,
      name: d.original_name,
    })),
    answers,
    links: (insights?.links ?? []).map((l) => ({
      url: l.url,
      state: l.state,
      title: l.title ?? "",
      subject: l.subject ?? "",
      publicRepos: l.public_repositories ?? null,
      topLanguages: l.top_languages ?? "",
      lastActivity: l.last_public_commit_utc ?? "",
      repos: l.repos ?? [],
    })),
  };
}

export async function loadCandidates(jobs: Job[]): Promise<{
  candidates: Candidate[];
  interviews: Interview[];
}> {
  // shortcut: first 100 applications/candidates only, add paging for bigger teams.
  const [apps, people] = await Promise.all([
    serverGet<Page<Application & { schedule_token?: string | null }>>(
      "/applications?limit=100&offset=0",
    ),
    serverGet<Page<Person>>("/candidates?limit=100&offset=0"),
  ]);
  const list = (apps?.items ?? []).filter(
    (a) => !a.withdrawn_at && jobs.some((j) => j.id === a.vacancy_id), // deleted jobs hide their applicants
  );
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
        ? [
            {
              candidateId: slot.applicationId,
              start: slot.start,
              end: slot.end,
              type: `Interview · ${job.title}`,
            },
          ]
        : [],
    ),
  );
  return { candidates, interviews };
}
