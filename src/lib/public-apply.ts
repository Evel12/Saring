// Halaman lamaran publik: dibaca tanpa login lewat token di link.
const API = process.env.API_URL ?? "http://127.0.0.1:8000";

export type ApplyJob = {
  slug: string;
  /** HR menutup/menghapus lowongan: link masih sah tapi tidak menerima lamaran. */
  closed: boolean;
  title: string;
  company: string;
  description: string;
  questions: string[];
  department: string;
  type: string;
  location: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
};

/** slug = `${vacancyId}.${applyToken}` (lihat job-store.ts). */
export function splitSlug(slug: string) {
  const [id, token] = decodeURIComponent(slug).split(".");
  return id && token ? { id, token } : null;
}

export async function getApplyJob(slug: string): Promise<ApplyJob | null> {
  const parts = splitSlug(slug);
  if (!parts) return null;
  const res = await fetch(`${API}/api/v1/apply/${parts.id}/${parts.token}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (res.status === 410) {
    const { detail } = await res.json();
    return {
      slug,
      closed: true,
      title: detail.title,
      company: detail.company,
      description: "",
      questions: [],
      department: "",
      type: "",
      location: "",
      requiredSkills: [],
      niceToHaveSkills: [],
    };
  }
  if (!res.ok) throw new Error(`Backend ${res.status} on apply view`);
  const v = await res.json();
  return {
    slug,
    closed: false,
    title: v.title,
    company: v.company,
    description: v.description,
    questions: v.questions,
    department: v.department,
    type: v.employment_type,
    location: v.location,
    requiredSkills: v.required_skills,
    niceToHaveSkills: v.preferred_skills,
  };
}
