"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { ApiError, post } from "@/lib/api";
import { useDashboard } from "../../dashboard-context";

// Satu tombol per lowongan, dipicu manual: memuat ulang daftar pelamar
// (CV baru langsung terlihat) lalu menjadwalkan analisis untuk pelamar yang
// belum pernah dinilai. Agent tidak pernah berjalan otomatis.
export function RunAnalysis({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { jobs } = useDashboard();
  const running = jobs.find((j) => j.id === jobId)?.analysisRunning ?? false;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Once the server reports the run, the server state drives the button.
  useEffect(() => {
    if (running) setStarting(false);
  }, [running]);

  async function run() {
    setStarting(true);
    setError("");
    // Queuing analysis ignores app that are already analyzed; refreshing
    // data happens regardless so freshly uploaded CVs appear.
    let queued = true;
    try {
      await post("/workflow-runs", { vacancy_id: jobId, pending_only: true });
    } catch (err) {
      queued = false;
      const status = err instanceof ApiError ? err.status : 0;
      const noApp = (err as Error).message.includes("No applications");
      if (!(status === 409 && noApp)) {
        setStarting(false);
        setError(
          status === 409
            ? "Analisis sedang berjalan. Daftar pelamar tetap dimuat ulang."
            : "Pemicuan analisis gagal. Pastikan start-worker.cmd berjalan.",
        );
      }
    }
    router.refresh();
    if (queued) setStarting(false);
  }

  const busy = starting || running;
  return (
    <>
      <button
        type="button"
        className={`button ${busy ? "primary agent-running" : "secondary"}`}
        onClick={run}
        disabled={busy}
        aria-live="polite"
      >
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <RefreshCw size={15} />
        )}
        {busy ? "Agent sedang menganalisis…" : "Analisis Pelamar"}
      </button>
      {error && (
        <span className="job-field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
