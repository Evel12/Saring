// Data halaman pelamar (jadwal interview) dari backend + format tanggal WIB.
// Lamaran publik dikirim langsung dari apply-form.tsx.

export type InterviewSlot = { id: string; start: string; end: string };

export type ScheduleInvite = {
  token: string;
  status: "active" | "expired" | "used";
  applicantName: string;
  jobTitle: string;
  company: string;
  format: string;
  durationMinutes: number;
  expiresAt: string | null;
  slots: InterviewSlot[];
  bookedSlotId: string | null;
};

export type BookingResult =
  | { ok: true }
  | { ok: false; reason: "taken"; alternatives: InterviewSlot[] };

type ApiSlot = { id: string; starts_at: number; ends_at: number };
const toSlot = (s: ApiSlot): InterviewSlot => ({
  id: s.id,
  start: new Date(s.starts_at * 1000).toISOString(),
  end: new Date(s.ends_at * 1000).toISOString(),
});
/** token di URL = `${applicationId}.${scheduleToken}` */
const path = (token: string) => decodeURIComponent(token).split(".").join("/");

// Dipanggil di server (halaman /schedule/[token]).
export async function getScheduleInvite(token: string): Promise<ScheduleInvite | null> {
  if (!decodeURIComponent(token).includes(".")) return null;
  const api = process.env.API_URL ?? "http://127.0.0.1:8000";
  const res = await fetch(`${api}/api/v1/schedule/${path(token)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend ${res.status} on schedule view`);
  const v: {
    title: string;
    company: string;
    candidate_name: string;
    slots: ApiSlot[];
    booked: ApiSlot | null;
  } = await res.json();
  const slots = [...(v.booked ? [v.booked] : []), ...v.slots]
    .map(toSlot)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const first = slots[0];
  return {
    token,
    status: "active",
    applicantName: v.candidate_name,
    jobTitle: v.title,
    company: v.company,
    format: "Interview · detail dikirim HR",
    durationMinutes: first ? Math.round((Date.parse(first.end) - Date.parse(first.start)) / 60000) : 0,
    expiresAt: null,
    slots,
    bookedSlotId: v.booked?.id ?? null,
  };
}

// Dipanggil di browser saat pelamar memilih slot.
export async function bookSlot(token: string, slotId: string): Promise<BookingResult> {
  const res = await fetch(`/api/v1/schedule/${path(token)}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot_id: slotId }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      reason: "taken",
      alternatives: (data.detail?.alternatives ?? []).map(toSlot),
    };
  }
  throw new Error("Jadwal belum tersimpan.");
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
