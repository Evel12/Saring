"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";
import { ApiError, post } from "@/lib/api";

// HR memicu agent menilai semua lamaran lowongan ini (worker backend yang bekerja).
export function RunAnalysis({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function run() {
    setState("busy");
    setError("");
    try {
      await post("/workflow-runs", { vacancy_id: jobId });
      setState("done");
      router.refresh();
    } catch (err) {
      setState("idle");
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 409
          ? (err as Error).message.includes("No applications")
            ? "Belum ada lamaran untuk dianalisis."
            : "Analisis sedang berjalan. Tunggu sampai selesai."
          : "Analisis gagal dimulai. Pastikan start-worker.cmd berjalan.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={run}
        disabled={state === "busy"}
      >
        {state === "busy" ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
        {state === "done" ? "Analisis berjalan…" : "Jalankan analisis AI"}
      </button>
      {error && (
        <span className="job-field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
