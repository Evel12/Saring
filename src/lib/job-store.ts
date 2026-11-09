// Lowongan dari backend FastAPI (dibaca di server, cookie sesi HR diteruskan).
import { serverGet } from "./server-api";
import type { Page, Vacancy, Version } from "./types";

export type JobSlot = {
  id: string;
  start: string;
  end: string;
  status: "kosong" | "terisi";
  applicationId: string | null;
};

export type Job = {
  id: string;
  /** `${vacancyId}.${applyToken}`, dipakai di /apply/[slug]; kosong kalau link mati. */
  slug: string;
  title: string;
  company: string;
  department: string;
  type: string;
  location: string;
  description: string;
  status: "open" | "closed";
  color: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  slots: JobSlot[];
  /** Agent sedang menganalisis lamaran lowongan ini. */
  analysisRunning: boolean;
};

type ApiVacancy = Vacancy & {
  department: string | null;
  employment_type: string | null;
  location: string | null;
};
type ApiSlot = {
  id: string;
  starts_at: number;
  ends_at: number;
  application_id: string | null;
};
type ApplyLink = { token: string | null; enabled: boolean };

const COLORS = ["sage", "lavender", "peach"];
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

async function toJob(
  v: ApiVacancy,
  index: number,
  company: string,
  running: Set<string>,
): Promise<Job> {
  const [version, link, slots] = await Promise.all([
    v.active_requirement_version_id
      ? serverGet<Version>(
          `/requirement-versions/${v.active_requirement_version_id}`,
        )
      : null,
    serverGet<ApplyLink>(`/vacancies/${v.id}/apply-link`),
    serverGet<{ items: ApiSlot[] }>(`/vacancies/${v.id}/slots`),
  ]);
  const criteria = version?.requirements ?? [];
  return {
    id: v.id,
    slug: link?.enabled && link.token ? `${v.id}.${link.token}` : "",
    title: v.title,
    company,
    department: v.department ?? "",
    type: v.employment_type ?? "",
    location: v.location ?? "",
    description: v.description,
    status: v.state === "published" ? "open" : "closed",
    color: COLORS[index % COLORS.length],
    requiredSkills: criteria
      .filter((c) => c.importance === "essential")
      .map((c) => c.description),
    niceToHaveSkills: criteria
      .filter((c) => c.importance === "preferred")
      .map((c) => c.description),
    slots: (slots?.items ?? []).map((s) => ({
      id: s.id,
      start: iso(s.starts_at),
      end: iso(s.ends_at),
      status: s.application_id ? "terisi" : "kosong",
      applicationId: s.application_id,
    })),
    analysisRunning: running.has(v.id),
  };
}

async function companyName() {
  return (await serverGet<{ name: string }>("/organization"))?.name ?? "";
}

type Run = { vacancy_id: string; state: string };

// Runs are listed oldest first; read the newest 100 to see which are still active.
async function runningVacancies() {
  const total =
    (await serverGet<Page<Run>>("/workflow-runs?limit=1&offset=0"))?.total ?? 0;
  const page = await serverGet<Page<Run>>(
    `/workflow-runs?limit=100&offset=${Math.max(0, total - 100)}`,
  );
  return new Set(
    (page?.items ?? [])
      .filter((r) => r.state === "queued" || r.state === "running")
      .map((r) => r.vacancy_id),
  );
}

export async function listJobs(): Promise<Job[]> {
  // shortcut: first 100 vacancies only, add paging if a team ever has more.
  const [page, company, running] = await Promise.all([
    serverGet<Page<ApiVacancy>>("/vacancies?limit=100&offset=0"),
    companyName(),
    runningVacancies(),
  ]);
  return Promise.all(
    (page?.items ?? []).map((v, i) => toJob(v, i, company, running)),
  );
}

export async function getJob(id: string): Promise<Job | null> {
  const jobs = await listJobs(); // keeps colors consistent with the list
  return jobs.find((job) => job.id === id) ?? null;
}
