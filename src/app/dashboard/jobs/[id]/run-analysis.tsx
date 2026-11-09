"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, LoaderCircle, Sparkles } from "lucide-react";
import { ApiError, post } from "@/lib/api";
import { useDashboard } from "../../dashboard-context";

// HR memicu agent untuk pelamar yang BELUM dianalisis saja; pelamar lama tidak dinilai ulang.
export function RunAnalysis({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { jobs, candidates } = useDashboard();
  const running = jobs.find((j) => j.id === jobId)?.analysisRunning ?? false;
  const pending = candidates.filter(
    (c) => c.jobId === jobId && !c.reviewed,
  ).length;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Once the server reports the run, the server state drives the button.
  useEffect(() => {
    if (running) setStarting(false);
  }, [running]);

  async function run() {
    setStarting(true);
    setError("");
    try {
      await post("/workflow-runs", { vacancy_id: jobId, pending_only: true });
      router.refresh();
    } catch (err) {
      setStarting(false);
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 409
          ? (err as Error).message.includes("No applications")
            ? "Semua pelamar sudah dianalisis."
            : "Analisis sedang berjalan."
          : "Analisis gagal dimulai. Pastikan start-worker.cmd berjalan.",
      );
    }
  }

  const busy = starting || running;
  return (
    <>
      <button
        type="button"
        className={`button ${busy ? "primary agent-running" : "secondary"}`}
        onClick={run}
        disabled={busy || pending === 0}
        aria-live="polite"
      >
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : pending === 0 ? (
          <CheckCheck size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        {busy
          ? "Agent sedang menganalisis…"
          : pending === 0
            ? "Semua pelamar sudah dianalisis"
            : `Analisis ${pending} pelamar baru`}
      </button>
      {error && (
        <span className="job-field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
