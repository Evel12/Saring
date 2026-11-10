// Kandidat (= lamaran) dari backend, dibaca di server dengan cookie sesi HR.
import { serverGet } from "./server-api";
import type { Activity, Application, Brief, Document, Page } from "./types";
import type { Job } from "./job-store";
import { expandSkill } from "./skill-keywords";
import type {
  AgentStep,
  Candidate,
  CandidateStatus,
  Interview,
  InterviewQuestion,
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
      if (d.result === "semantic-fallback")
        return `Kriteria ${d.index}/${d.total}: kata di CV tidak sama persis, AI memeriksa maknanya (termasuk lintas bahasa).`;
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

// Usulan pertanyaan interview: mayoritas dari lowongan (judul, kerja harian,
// pencapaian paling kuat), bukan dari status verifikasi skill. Verifikasi CV
// hanya dipakai untuk maksimal dua pertanyaan ke bukti terlemah.
const ORDER: Record<SkillStatus, number> = {
  contradicted: 0,
  unknown: 1,
  claimed: 2,
  verified: 3,
};
function suggestQuestions(
  job: Job | undefined,
  skills: { name: string; status: SkillStatus; essential: boolean }[],
  strengths: string[],
): InterviewQuestion[] {
  const statusWord: Record<SkillStatus, string> = {
    // Pertanyaan penggali dibedakan ringan supaya unsur statusnya tidak menonjol.
    contradicted: `Ada dua keterangan yang berbeda soal {s} di CV. Mana yang benar, dan bagaimana pengalamanmu yang sebenarnya dengan {s}?`,
    unknown: `CV tidak mencantumkan bukti untuk {s}. Jujur saja, pengalaman mana yang paling berkaitan dengan {s}?`,
    claimed: `Pilih satu pengalamanmu seputar {s}: apa yang kamu kerjakan, dan apa hasil yang tertulis?`,
    verified: `Apa pengalaman paling menantangmu seputar {s}, dan bagaimana kamu menghadapinya?`,
  };
  const dig = [...skills]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status])
    .slice(0, 2)
    .map((s) => ({
      question: statusWord[s.status].split("{s}").join(s.name),
      reason: `${s.name} (${s.essential ? "wajib" : "tambahan"})`,
    }));
  const position = job?.title ?? "posisi ini";
  const company = job?.company;
  const jobBased: InterviewQuestion[] = [
    {
      question: `Untuk ${position}, pengalaman apa yang paling menyiapkanmu mengambil peran ini${
        company ? ` di ${company}` : ""
      }?`,
      reason: `${position} (dari lowongan)`,
    },
    {
      question: `Kerja harian seperti apa yang kamu bayangkan untuk ${position}, dan bagaimana kamu menata waktunya?`,
      reason: `${position} (dari lowongan)`,
    },
    {
      question: strengths[0]
        ? `Dari CV: ${strengths[0]} — ceritakan cerita di balik itu (peranmu dan yang dihasilkan).`
        : `Dari CV, pencapaian mana yang paling kamu banggakan, dan apa hasilnya?`,
      reason: "pencapaian terbesar (dari CV)",
    },
  ];
  // Campur: pertanyaan lowongan dulu, sisanya penggali bukti terlemah.
  return [...jobBased.slice(0, 2), dig[0], jobBased[2], dig[1]].filter(
    Boolean,
  );
}

// Singkatan gelar di kebanyakan CV diubah jadi istilah yang jelas bagi HR.
const DEGREE: Record<string, string> = { s1: "Sarjana (S1)", s2: "Magister (S2)", s3: "Doktor (S3)", d1: "Diploma 1", d2: "Diploma 2", d3: "Diploma 3 (D3)", d4: "Diploma 4 (D4)", sma: "SMA/SMK", smk: "SMK" };

const tidy = (text: string) =>
  text
    .replace(/\u00a0|\u200b/g, " ")
    .replace(/\s+/g, " ")
    // Coret leading bullet/penanda dari segala varian CV agar indentasi seragam.
    .replace(/^(?:[\s•·‣▪◆●○◦»>*.\-–—…]|&#8226;)+/, "")
    .trim()
    .replace(/\b(S[1-3]|D[1-4]|SMA|SMK)\b/g, (word) => DEGREE[word.toLowerCase()] ?? word);

// Heading bagian CV ("PENGALAMAN KERJA", "Education") bukan kalimat bukti.
const HEADING =
  /^(skills?|experiences?|work|education|projects?|certifications?|awards?|organizations?|experiences?|competitions?|references?|languages?|about me|summary|profil|skills?:?|pengalaman|organisasi|keahlian|keterampilan|kemampuan|pendidikan|proyek|sertifikasi?|prestasi|pencapaian|pekerjaan|beasiswa|kegiatan|pelatihan|seminar|tanggung jawab)\b[^a-z]*$/i;

// Baris tanggal ("2019 - 2022", "Jan 2020 – Present") dipakai sebagai penanda periode.
const DATE_ONLY =
  /^(?:[\s•·\-–—,.|]*)(?:\b(?:jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?\s*)?(?:19|20)\d{2}(?:\s*[-–—/]\s*(?:\b(?:jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?\s*)?(?:19|20)?\d{2}|\s*[-–—]\s*(?:present|sekarang|now|current(?:ly)?|saat ini|s\.?d\.?\s*(?:sekarang|present)|kini))?(?:[\s•·\-–—,.|()]*(?:present|sekarang|now|current(?:ly)?|saat ini|kini))?[\s•·\-–—,.|()]*$/i;

const isDateOnly = (text: string) =>
  text.length <= 48 && DATE_ONLY.test(text) && /\d/.test(text);

// A useful evidence line is a short sentence or fact, not a heading or a bare date range.
const meaningful = (text: string) =>
  text.length >= 8 &&
  text.length <= 300 &&
  text !== text.toUpperCase() &&
  /[a-z]{3}/i.test(text) &&
  !HEADING.test(text) &&
  !isDateOnly(text);

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
    const quotes = evidence
      .filter((e) => rev?.evidence_ids.includes(e.id))
      .map((e) => tidy(e.passage))
      .filter(meaningful)
      .slice(0, 2);
    return {
      name: r.description,
      matchTerms: expandSkill(r.description),
      status: SKILL[rev?.state ?? "unknown"],
      evidence:
        rev?.explanation ||
        (quotes.length ? "Ditemukan di CV." : "Belum ada bukti di CV."),
      quotes,
      essential: r.importance === "essential",
      requirementId: r.id,
      evidenceIds: rev?.evidence_ids ?? [],
    };
  });

// Blind-screening excerpt: poin-poin penting dari CV apa adanya, dibagi dua
// kelompok — pengalaman kerja/organisasi (peran + yang dikerjakan) dan fakta
// lain (skill, pencapaian, sertifikasi). Tanggal tidak ditampilkan.
const ROLE_DETAIL =
  /\b(engineer|developer|programmer|analyst|manager|manajer|male? customer|customer service|customer support|representative|specialis|specialist|supervisor|admin(istrator)?|intern(ship)?|magang|praktikan|staf|staff|konsultan|consultant|koordinator|kasir|cashier|sales|officer|guru|teacher|dosen|asisten|ketua|wakil|bendahara|sekretaris|freelance|part[- ]?time|full[- ]?time|karyawan|crew|team lead)\b/i;
const DUTY_DETAIL =
  /^(assisted|assist|supported|handled|responsib(le)?|coordinated|managed|developed|created|maintained|provided|worked|served|membantu|melayani|menangani|bertanggung|mengelola|melakukan|memberikan|membuat|mempromosikan|menjaga|mengembangkan|berfokus|fokus)/i;

  const reqTerms = new Map(
    requirements.map((r) => [r.id, expandSkill(r.description)]),
  );
  const afterDate = { value: false };
  const pointers = evidence
    .map((e) => {
      const text = tidy(e.passage);
      if (isDateOnly(text)) {
        // Baris tanggal tidak ditampilkan, tapi menandai baris berikutnya
        // sebagai bagian dari pengalaman kerja/organisasi.
        afterDate.value = true;
        return null;
      }
      if (!meaningful(text)) return null;
      const isExperience =
        afterDate.value || /\s[|·]\s/.test(text) || ROLE_DETAIL.test(text) || DUTY_DETAIL.test(text);
      afterDate.value = false;
      const lower = text.toLowerCase();
      const linked = requirements
        .filter((r) => revisionOf(r.id)?.evidence_ids.includes(e.id))
        .map((r) => r.description);
      const named = requirements
        .filter(
          (r) =>
            !linked.includes(r.description) &&
            (reqTerms.get(r.id) ?? []).some(
              (t) => t.length > 2 && lower.includes(t),
            ),
        )
        .map((r) => r.description);
      const skills = [...linked, ...named];
      const terms = [...new Set(skills.flatMap((d) => reqTerms.get(d) ?? []))];
      return {
        text,
        skills,
        terms,
        kind: (isExperience ? "experience" : "facts") as
          | "experience"
          | "facts",
      };
    })
    .filter(
      (line): line is NonNullable<typeof line> =>
        !!line && meaningful(line.text),
    );
  const cvExcerpt = pointers.slice(0, 12);
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
    skills,
    summary:
      insights?.summary ??
      brief?.summary ??
      "Belum dianalisis. Jalankan analisis AI dari halaman lowongan.",
    strengths: (insights?.strengths ?? []).map((s) => s.text),
    scoreParts: [],
    reviewReasons,
    hiddenFields: [],
    cvExcerpt,
    pipeline: (events?.items ?? []).map(step),
    questions: analyzed
      ? suggestQuestions(
          job,
          skills,
          (insights?.strengths ?? []).map((s) => s.text),
        )
      : [],
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
