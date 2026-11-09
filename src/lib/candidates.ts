// Bentuk data kandidat yang dipakai UI dashboard (diisi dari backend, lihat load-candidates.ts).

export type SkillStatus = "verified" | "claimed" | "contradicted" | "unknown";

export type SkillCheck = {
  name: string;
  status: SkillStatus;
  evidence: string;
  essential?: boolean;
};

export type ScorePart = {
  label: string;
  score: number;
  max: number;
  quote: string;
};

export type AgentStep = {
  tool: string;
  label: string;
  result: string;
  // recovered: gagal lalu dipulihkan agent. flagged: diteruskan ke HR.
  state: "ok" | "recovered" | "flagged";
  at?: string;
  actor?: "agent" | "hr";
};

/** Hasil tool cek link agent (GitHub lewat API resmi, situs lain hanya judul). */
export type LinkInfo = {
  url: string;
  state: string;
  title: string;
  subject: string;
  publicRepos: number | null;
  topLanguages: string;
  lastActivity: string;
  repos: {
    name: string;
    language: string;
    description: string;
    stars: number;
  }[];
};

export type InterviewQuestion = { question: string; reason: string };

export type CandidateStatus =
  | "Perlu ditinjau"
  | "Shortlist"
  | "Diundang"
  | "Interview"
  | "Tidak dilanjutkan";

export type Candidate = {
  /** application id di backend */
  id: string;
  jobId: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  email: string;
  /** % kriteria yang punya bukti (didukung = 1, sebagian = ½). Bukan keputusan. */
  score: number;
  analyzed: boolean;
  /** Sudah pernah dianalisis agent untuk kriteria saat ini (berhasil atau ditandai). */
  reviewed: boolean;
  status: CandidateStatus;
  experience: string;
  appliedAt: string;
  cvFormat: string;
  link: { url: string; reachable: boolean } | null;
  skills: SkillCheck[];
  summary: string;
  strengths: string[];
  scoreParts: ScorePart[];
  reviewReasons: string[];
  hiddenFields: string[];
  /** Baris CV yang dibaca agent, sudah dirapikan untuk ditampilkan. */
  cvExcerpt: string[];
  pipeline: AgentStep[];
  questions: InterviewQuestion[];
  scheduleToken?: string | null;
  documents: { id: string; name: string }[];
  /** Jawaban form lamaran: pertanyaan -> jawaban */
  answers: Record<string, string>;
  links: LinkInfo[];
  invitedAt?: string;
  reminderSentAt?: string;
};

export type Interview = {
  candidateId: string;
  start: string;
  end: string;
  type: string;
};

export const SHORTLIST_RULE =
  "Agent tidak pernah memilih atau menolak otomatis. Skor adalah persentase kriteria lowongan yang punya bukti di CV; keputusan shortlist selalu di tangan HR.";
