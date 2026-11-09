// Draf undangan interview + link jadwal pribadi dari backend.
// Email belum dikirim otomatis (butuh provider email); HR mengirimnya lewat aplikasi email.
import { post } from "./api";
import type { Candidate } from "./candidates";

export const SCHEDULE_LINK_PLACEHOLDER = "{link jadwal}";

export type InvitationDraft = { subject: string; body: string };

export function createDraft(
  candidate: Candidate,
  company: string,
): InvitationDraft {
  const linkRequest =
    candidate.link && !candidate.link.reachable
      ? "\n\nLink GitHub atau portofolio yang kamu kirim tidak bisa kami buka. Kalau berkenan, balas email ini dengan link yang baru. Hal ini tidak memengaruhi penilaianmu."
      : "";
  return {
    subject: `Undangan interview ${candidate.role} di ${company}`,
    body: `Halo ${candidate.name},

Terima kasih sudah melamar posisi ${candidate.role} di ${company}. Kami ingin mengundangmu ke tahap interview.

Silakan pilih jadwal yang paling cocok lewat link berikut:
${SCHEDULE_LINK_PLACEHOLDER}${linkRequest}

Salam,
Tim Rekrutmen ${company}`,
  };
}

export function draftError(draft: InvitationDraft) {
  if (!draft.subject.trim()) return "Isi subjek email.";
  if (!draft.body.includes(SCHEDULE_LINK_PLACEHOLDER))
    return `Isi email harus memuat ${SCHEDULE_LINK_PLACEHOLDER} supaya pelamar bisa memilih jadwal.`;
}

export const scheduleUrl = (c: Pick<Candidate, "id" | "scheduleToken">) =>
  c.scheduleToken
    ? `${window.location.origin}/schedule/${c.id}.${c.scheduleToken}`
    : "";

/** Membuat link jadwal pribadi (butuh status shortlist di backend). */
export async function sendInvitation(candidate: Candidate) {
  try {
    await post(`/applications/${candidate.id}/schedule-link`);
    return true;
  } catch {
    return false;
  }
}

export function mailtoFor(candidate: Candidate, draft: InvitationDraft) {
  const body = draft.body.replace(
    SCHEDULE_LINK_PLACEHOLDER,
    scheduleUrl(candidate),
  );
  return `mailto:${encodeURIComponent(candidate.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body)}`;
}
