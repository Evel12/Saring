// Aturan form lowongan, dipakai browser dan server supaya hasilnya sama.

export const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Product",
  "Operations",
  "Marketing",
];
export const JOB_TYPES = ["Full-time", "Contract", "Internship"];

export type JobSlotInput = { start: string; end: string };

export type JobInput = {
  title: string;
  department: string;
  type: string;
  location: string;
  description: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  slots: JobSlotInput[];
};

export type JobInputField =
  | "title"
  | "department"
  | "type"
  | "location"
  | "description"
  | "requiredSkills"
  | "slots";
export type JobInputErrors = Partial<Record<JobInputField, string>>;

export function validateJobInput(input: JobInput) {
  const errors: JobInputErrors = {};
  if (!input.title.trim()) errors.title = "Isi nama posisi.";
  else if (input.title.length > 80)
    errors.title = "Nama posisi maksimal 80 karakter.";
  if (!DEPARTMENTS.includes(input.department))
    errors.department = "Pilih departemen.";
  if (!JOB_TYPES.includes(input.type)) errors.type = "Pilih tipe pekerjaan.";
  if (!input.location.trim()) errors.location = "Isi lokasi kerja.";
  if (!input.description.trim())
    errors.description = "Isi deskripsi pekerjaan. Agent menilai pelamar dari sini.";
  if (!input.requiredSkills.length)
    errors.requiredSkills = "Tambahkan minimal satu skill wajib.";
  if (!input.slots.length)
    errors.slots = "Tambahkan minimal satu slot interview.";
  else if (
    input.slots.some(
      (slot) => !(Date.parse(slot.start) < Date.parse(slot.end)),
    )
  )
    errors.slots = "Ada slot dengan waktu yang tidak valid.";
  return errors;
}
