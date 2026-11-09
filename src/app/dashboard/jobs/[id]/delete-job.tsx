"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { request } from "@/lib/api";

// Menghapus = backend mengarsipkan lowongan (riwayat tetap ada) dan link lamaran ditutup.
export function DeleteJob({ jobId, title }: { jobId: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(`/vacancies/${jobId}`, { method: "DELETE" });
      window.location.assign("/dashboard/jobs");
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={15} />
        Hapus
      </button>
      <dialog
        ref={dialog}
        className="modal"
        aria-label="Konfirmasi hapus lowongan"
        onCancel={() => setConfirming(false)}
      >
        <div className="modal-content">
          <h2>Hapus lowongan {title}?</h2>
          <p className="modal-intro">
            Link lamaran langsung ditutup, dan pelamar baru akan melihat
            &ldquo;Pendaftaran sudah ditutup&rdquo;. Riwayat penilaian tetap
            tersimpan di server.
          </p>
          {error && (
            <p className="job-field-error" role="alert">
              {error}
            </p>
          )}
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
              onClick={remove}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              Hapus lowongan
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
