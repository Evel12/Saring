// Draf dan pengiriman undangan tiruan. Saat backend siap, ganti isi
// sendInvitation dengan panggilan API yang mengirim email sungguhan.
import type { Candidate } from "./demo";

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

export async function sendInvitation(
  candidate: Candidate,
  _draft: InvitationDraft,
  isRetry: boolean,
) {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return !(candidate.emailFailsOnce && !isRetry);
}
