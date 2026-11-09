"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  LoaderCircle,
  Mail,
  RotateCcw,
  Send,
  Users,
} from "lucide-react";
import type { Candidate } from "@/lib/candidates";
import {
  draftError,
  mailtoFor,
  scheduleUrl,
  SCHEDULE_LINK_PLACEHOLDER,
} from "@/lib/invitation";
import { Avatar } from "../../../candidate-table";
import { useDashboard } from "../../../dashboard-context";

function warningsFor(candidate: Candidate) {
  const contradicted = candidate.skills.filter(
    (skill) => skill.status === "contradicted",
  );
  return [
    ...contradicted.map((skill) => `${skill.name} bertentangan dengan bukti`),
    ...(candidate.link && !candidate.link.reachable
      ? ["Link mati, email meminta link baru"]
      : []),
  ];
}

export function ApprovalBoard({
  jobId,
  role,
  company,
  emptySlots,
}: {
  jobId: string;
  role: string;
  company: string;
  emptySlots: number;
}) {
  const { candidates, getDraft, saveDraft, invitations, sendInvitations } =
    useDashboard();
  const shortlist = candidates.filter(
    (c) => c.role === role && c.status === "Shortlist",
  );
  const invited = candidates.filter(
    (c) => c.role === role && c.status === "Diundang",
  );
  const waiting = candidates.filter(
    (c) => c.role === role && c.status === "Perlu ditinjau",
  ).length;
  const [excluded, setExcluded] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [draftProblem, setDraftProblem] = useState("");
  const confirmDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (confirming) confirmDialog.current?.showModal();
    else confirmDialog.current?.close();
  }, [confirming]);

  const active =
    shortlist.find((c) => c.id === activeId) ?? shortlist[0] ?? null;
  const selected = shortlist.filter((c) => !excluded.includes(c.id));
  const sending = shortlist.some((c) => invitations[c.id] === "mengirim");
  const draft = active ? getDraft(active, company) : null;
  const activeError = draft ? draftError(draft) : undefined;

  function toggle(id: string) {
    setExcluded((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }
  function requestSend() {
    const invalid = selected.find((c) => draftError(getDraft(c, company)));
    if (invalid) {
      setActiveId(invalid.id);
      setDraftProblem(
        `Draf untuk ${invalid.name} perlu diperbaiki sebelum dikirim.`,
      );
      return;
    }
    setDraftProblem("");
    setConfirming(true);
  }
  function confirmSend() {
    setConfirming(false);
    sendInvitations(selected, company);
  }

  if (!shortlist.length && !invited.length)
    return (
      <section className="panel">
        <div className="empty-state">
          <Users size={25} />
          <h3>Belum ada kandidat di shortlist</h3>
          <p>
            {waiting
              ? `${waiting} kandidat masih menunggu tinjauanmu.`
              : "Kandidat yang lolos aturan shortlist akan muncul di sini."}
          </p>
          <Link className="button secondary" href={`/dashboard/jobs/${jobId}`}>
            Kembali ke lowongan
          </Link>
        </div>
      </section>
    );

  return (
    <>
      {waiting > 0 && (
        <div className="approval-note">
          <AlertTriangle size={15} />
          <span>
            {waiting} kandidat lowongan ini masih perlu ditinjau dan belum masuk
            daftar di bawah.
          </span>
          <Link
            className="text-button"
            href="/dashboard/candidates?status=Perlu+ditinjau"
          >
            Tinjau <ArrowUpRight size={14} />
          </Link>
        </div>
      )}

      {shortlist.length > 0 && (
        <div className="dashboard-grid approval-grid">
          <div className="main-column">
            {active && draft && (
              <section className="panel job-panel approval-draft">
                <h2>
                  <Mail size={15} />
                  Draf email untuk {active.name}
                </h2>
                <p className="job-panel-intro">Kepada: {active.email}</p>
                <div className="job-field">
                  <label htmlFor="draft-subject">Subjek</label>
                  <input
                    id="draft-subject"
                    value={draft.subject}
                    onChange={(e) =>
                      saveDraft(active.id, {
                        ...draft,
                        subject: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="job-field">
                  <label htmlFor="draft-body">Isi email</label>
                  <textarea
                    id="draft-body"
                    rows={13}
                    value={draft.body}
                    aria-invalid={!!activeError}
                    aria-describedby="draft-hint"
                    onChange={(e) =>
                      saveDraft(active.id, { ...draft, body: e.target.value })
                    }
                  />
                  {activeError ? (
                    <span className="job-field-error" id="draft-hint">
                      <AlertTriangle size={13} />
                      {activeError}
                    </span>
                  ) : (
                    <span className="job-field-hint" id="draft-hint">
                      {SCHEDULE_LINK_PLACEHOLDER} diganti otomatis dengan link
                      pribadi saat kamu membuka email.
                    </span>
                  )}
                </div>
              </section>
            )}
          </div>

          <div className="right-column">
            <section className="panel job-panel">
              <h2>Kandidat shortlist</h2>
              <p className="job-panel-intro">
                Hilangkan centang untuk menahan undangan. Pilih nama untuk
                melihat drafnya.
              </p>
              <ul className="approval-list">
                {shortlist.map((candidate) => {
                  const warnings = warningsFor(candidate);
                  const status = invitations[candidate.id];
                  return (
                    <li
                      key={candidate.id}
                      className={candidate.id === active?.id ? "active" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={!excluded.includes(candidate.id)}
                        disabled={sending}
                        aria-label={`Kirim undangan ke ${candidate.name}`}
                        onChange={() => toggle(candidate.id)}
                      />
                      <button
                        type="button"
                        className="approval-candidate"
                        aria-pressed={candidate.id === active?.id}
                        onClick={() => setActiveId(candidate.id)}
                      >
                        <Avatar
                          initials={candidate.initials}
                          color={candidate.color}
                          small
                        />
                        <span>
                          <strong>{candidate.name}</strong>
                          <small>Skor {candidate.score}</small>
                        </span>
                      </button>
                      <Link
                        className="icon-button"
                        href={`/dashboard/candidates/${candidate.id}`}
                        aria-label={`Lihat detail ${candidate.name}`}
                      >
                        <ArrowUpRight size={15} />
                      </Link>
                      {warnings.map((warning) => (
                        <p className="approval-warning" key={warning}>
                          <AlertTriangle size={12} />
                          {warning}
                        </p>
                      ))}
                      {status === "gagal" && (
                        <p className="approval-failed" role="alert">
                          <AlertTriangle size={12} />
                          Link gagal dibuat. Centang lalu coba lagi.
                        </p>
                      )}
                      {status === "mengirim" && (
                        <p className="approval-sending">
                          <LoaderCircle className="spin" size={12} />
                          Membuat link...
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {selected.length > emptySlots && (
                <p className="approval-warning approval-slots">
                  <AlertTriangle size={12} />
                  Slot kosong hanya {emptySlots}, kurang untuk {selected.length}{" "}
                  undangan. Sebagian pelamar bisa kehabisan slot.
                </p>
              )}
              {draftProblem && (
                <p className="job-field-error approval-problem" role="alert">
                  <AlertTriangle size={13} />
                  {draftProblem}
                </p>
              )}
              <button
                type="button"
                className="button primary review-action"
                disabled={!selected.length || sending}
                onClick={requestSend}
              >
                {sending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : shortlist.some((c) => invitations[c.id] === "gagal") ? (
                  <RotateCcw size={15} />
                ) : (
                  <Send size={15} />
                )}
                {sending
                  ? "Membuat link..."
                  : `Setujui & buat ${selected.length} link jadwal`}
              </button>
            </section>
          </div>
        </div>
      )}

      {invited.length > 0 && (
        <section className="panel job-panel approval-sent">
          <h2>Link jadwal siap</h2>
          <p className="job-panel-intro">
            Kirim link pribadi ini ke pelamar lewat emailmu. Pelamar memilih
            sendiri slot interview yang masih kosong.
          </p>
          <ul>
            {invited.map((candidate, index) => (
              <li
                key={candidate.id}
                style={{ "--stagger": index } as CSSProperties}
              >
                <Check size={14} />
                <Link href={`/dashboard/candidates/${candidate.id}`}>
                  {candidate.name}
                </Link>
                <span>
                  <a href={mailtoFor(candidate, getDraft(candidate, company))}>
                    Buka di email
                  </a>
                  {" · "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      navigator.clipboard.writeText(scheduleUrl(candidate))
                    }
                  >
                    Salin link
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dialog
        ref={confirmDialog}
        className="modal approval-confirm"
        aria-label="Konfirmasi kirim undangan"
        onCancel={() => setConfirming(false)}
      >
        <div className="modal-content">
          <h2>Setujui {selected.length} undangan?</h2>
          <p className="modal-intro">
            Saring membuat link jadwal pribadi untuk tiap pelamar. Setelah itu
            kamu mengirim emailnya dari aplikasi emailmu.
          </p>
          <ul>
            {selected.map((candidate) => (
              <li key={candidate.id}>
                <strong>{candidate.name}</strong> · {candidate.email}
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirming(false)}
            >
              Batal
            </button>
            <button
              type="button"
              className="button primary"
              onClick={confirmSend}
            >
              <Send size={15} />
              Setujui &amp; buat link
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
