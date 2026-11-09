// Data dan fungsi tiruan untuk halaman pelamar. Saat backend siap, cukup ganti
// isi tiga fungsi async di bawah dengan panggilan API; bentuk datanya tetap.
// Data lowongan ada di job-store.ts.

export type ApplicationInput = {
  name: string;
  email: string;
  cv: File;
  link?: string;
  consent: true;
};

export type InterviewSlot = {
  id: string;
  start: string;
  end: string;
  // Khusus demo: slot tampak kosong, lalu ditolak saat dipilih.
  takenOnSubmit?: boolean;
};

export type ScheduleInvite = {
  token: string;
  status: "active" | "expired" | "used";
  applicantName: string;
  jobTitle: string;
  company: string;
  format: string;
  durationMinutes: number;
  expiresAt: string;
  slots: InterviewSlot[];
};

export type BookingResult =
  | { ok: true }
  | { ok: false; reason: "taken"; alternatives: InterviewSlot[] };

export const COMPANY = "PT Karya Contoh";

const slots: InterviewSlot[] = [
  {
    id: "s1",
    start: "2026-11-12T09:00:00+07:00",
    end: "2026-11-12T09:45:00+07:00",
  },
  {
    id: "s2",
    start: "2026-11-12T10:00:00+07:00",
    end: "2026-11-12T10:45:00+07:00",
    takenOnSubmit: true,
  },
  {
    id: "s3",
    start: "2026-11-12T14:00:00+07:00",
    end: "2026-11-12T14:45:00+07:00",
  },
  {
    id: "s4",
    start: "2026-11-13T09:30:00+07:00",
    end: "2026-11-13T10:15:00+07:00",
  },
  {
    id: "s5",
    start: "2026-11-13T13:00:00+07:00",
    end: "2026-11-13T13:45:00+07:00",
  },
  {
    id: "s6",
    start: "2026-11-16T11:00:00+07:00",
    end: "2026-11-16T11:45:00+07:00",
  },
];

const baseInvite = {
  applicantName: "Nadia Putri",
  jobTitle: "Frontend Developer",
  company: COMPANY,
  format: "Interview teknis · Online",
  durationMinutes: 45,
  expiresAt: "2026-11-11T23:59:00+07:00",
};

const invites: ScheduleInvite[] = [
  { ...baseInvite, token: "demo-aktif-8f3k", status: "active", slots },
  { ...baseInvite, token: "demo-penuh-5h2w", status: "active", slots: [] },
  { ...baseInvite, token: "demo-kedaluwarsa-7q1p", status: "expired", slots },
  { ...baseInvite, token: "demo-terpakai-3t6n", status: "used", slots },
];

const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function submitApplication(
  _slug: string,
  input: ApplicationInput,
) {
  await wait(900);
  // Khusus demo: email ini memicu tampilan gagal kirim.
  if (input.email.toLowerCase() === "gagal@contoh.test")
    throw new Error("Gagal mengirim lamaran.");
}

export async function getScheduleInvite(token: string) {
  return invites.find((invite) => invite.token === token) ?? null;
}

export async function bookSlot(
  token: string,
  slotId: string,
): Promise<BookingResult> {
  await wait(700);
  const available =
    invites.find((invite) => invite.token === token)?.slots ?? [];
  const picked = available.find((slot) => slot.id === slotId);
  if (!picked?.takenOnSubmit) return { ok: true };
  const distance = (slot: InterviewSlot) =>
    Math.abs(Date.parse(slot.start) - Date.parse(picked.start));
  return {
    ok: false,
    reason: "taken",
    alternatives: available
      .filter((slot) => !slot.takenOnSubmit)
      .sort((a, b) => distance(a) - distance(b))
      .slice(0, 2),
  };
}

// Selalu memakai WIB supaya hasil server dan browser sama.
const TIME_ZONE = "Asia/Jakarta";

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDayMonth(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export { formatTime };

export function formatTimeRange(slot: Pick<InterviewSlot, "start" | "end">) {
  return `${formatTime(slot.start)}–${formatTime(slot.end)} WIB`;
}
