// Bentuk data kandidat yang dipakai UI dashboard (diisi dari backend, lihat load-candidates.ts).

export type SkillStatus = "verified" | "claimed" | "contradicted" | "unknown";

export type SkillCheck = { name: string; status: SkillStatus; evidence: string };

export type ScorePart = { label: string; score: number; max: number; quote: string };

export type AgentStep = {
  tool: string;
  label: string;
  result: string;
  // recovered: gagal lalu dipulihkan agent. flagged: diteruskan ke HR.
  state: "ok" | "recovered" | "flagged";
  at?: string;
  actor?: "agent" | "hr";
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
  cvExcerpt: string;
  pipeline: AgentStep[];
  questions: InterviewQuestion[];
  scheduleToken?: string | null;
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
