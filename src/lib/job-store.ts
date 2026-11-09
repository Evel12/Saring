// Penyimpanan lowongan sementara di memori server, supaya lowongan baru bisa
// langsung dibuka lewat link lamarannya. Data kembali ke awal saat server
// restart. Saat backend siap, ganti isi empat fungsi async di bawah.
import { randomBytes } from "node:crypto";
import { connection } from "next/server";
import { COMPANY } from "./applicant-demo";
import type { JobInput, JobSlotInput } from "./job-input";

export type JobSlot = JobSlotInput & {
  id: string;
  status: "kosong" | "terisi";
};

export type Job = Omit<JobInput, "slots"> & {
  id: string;
  slug: string;
  company: string;
  status: "open" | "closed";
  color: string;
  slots: JobSlot[];
};

function slot(
  id: string,
  date: string,
  start: string,
  end: string,
  status: JobSlot["status"] = "kosong",
): JobSlot {
  return {
    id,
    start: `${date}T${start}:00+07:00`,
    end: `${date}T${end}:00+07:00`,
    status,
  };
}

const seedJobs: Job[] = [
  {
    id: "1",
    slug: "frontend-developer-x7k2",
    title: "Frontend Developer",
    company: COMPANY,
    department: "Engineering",
    type: "Full-time",
    location: "Jakarta · Hybrid",
    status: "open",
    color: "sage",
    description:
      "Membangun dan merawat antarmuka aplikasi internal bersama tim produk, dari komponen dasar sampai halaman dashboard.",
    requiredSkills: ["React", "TypeScript", "CSS"],
    niceToHaveSkills: ["Next.js", "Pengujian otomatis"],
    slots: [
      slot("s1", "2026-11-12", "09:00", "09:45"),
      slot("s2", "2026-11-12", "10:00", "10:45", "terisi"),
      slot("s3", "2026-11-12", "14:00", "14:45"),
      slot("s4", "2026-11-13", "09:30", "10:15"),
      slot("s5", "2026-11-13", "13:00", "13:45"),
      slot("s6", "2026-11-16", "11:00", "11:45"),
    ],
  },
  {
    id: "2",
    slug: "ui-ux-designer-m4p9",
    title: "UI/UX Designer",
    company: COMPANY,
    department: "Design",
    type: "Full-time",
    location: "Jakarta · Hybrid",
    status: "open",
    color: "lavender",
    description:
      "Merancang alur dan tampilan produk, menjalankan riset pengguna, dan menjaga konsistensi design system.",
    requiredSkills: ["Figma", "User Research", "Prototyping"],
    niceToHaveSkills: ["Usability Testing", "Design System"],
    slots: [
      slot("s1", "2026-11-17", "09:00", "09:45", "terisi"),
      slot("s2", "2026-11-17", "13:30", "14:15"),
    ],
  },
  {
    id: "3",
    slug: "backend-developer-q8r3",
    title: "Backend Developer",
    company: COMPANY,
    department: "Engineering",
    type: "Full-time",
    location: "Remote · Indonesia",
    status: "open",
    color: "peach",
    description:
      "Membangun API dan layanan data yang andal, termasuk pemantauan dan penanganan kegagalan di lingkungan produksi.",
    requiredSkills: ["Python", "FastAPI", "PostgreSQL"],
    niceToHaveSkills: ["Docker", "Observabilitas"],
    slots: [
      slot("s1", "2026-11-18", "10:00", "10:30", "terisi"),
      slot("s2", "2026-11-18", "15:00", "15:30"),
    ],
  },
  {
    id: "4",
    slug: "data-analyst-z2c6",
    title: "Data Analyst",
    company: COMPANY,
    department: "Operations",
    type: "Contract",
    location: "Jakarta",
    status: "closed",
    color: "sage",
    description:
      "Menyusun laporan operasional dan analisis data untuk tim bisnis.",
    requiredSkills: ["SQL"],
    niceToHaveSkills: [],
    slots: [],
  },
];

// globalThis menjaga isi tetap sama saat modul dimuat ulang oleh next dev.
const store = globalThis as typeof globalThis & { __saringJobs?: Job[] };
const jobs = (store.__saringJobs ??= seedJobs);

export async function listJobs() {
  await connection();
  return [...jobs];
}

export async function getJob(id: string) {
  await connection();
  return jobs.find((job) => job.id === id) ?? null;
}

export async function getJobBySlug(slug: string) {
  await connection();
  return jobs.find((job) => job.slug === slug) ?? null;
}

function createSlug(title: string) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "lowongan";
  return `${base}-${randomBytes(2).toString("hex")}`;
}

export async function addJob(input: JobInput) {
  const colors = ["sage", "lavender", "peach"];
  const job: Job = {
    ...input,
    title: input.title.trim(),
    location: input.location.trim(),
    description: input.description.trim(),
    id: String(Date.now()),
    slug: createSlug(input.title),
    company: COMPANY,
    status: "open",
    color: colors[jobs.length % colors.length],
    slots: input.slots.map((item, index) => ({
      ...item,
      id: `s${index + 1}`,
      status: "kosong",
    })),
  };
  jobs.push(job);
  return job;
}
