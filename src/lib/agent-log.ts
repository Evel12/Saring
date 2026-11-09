import type { AgentStep, Candidate } from "./candidates";

export type LogEntry = {
  id: string;
  at: string;
  actor: "agent" | "hr";
  candidateId: string;
  tool?: string;
  label: string;
  result: string;
  state: AgentStep["state"];
};

// Langkah agent tanpa waktu tercatat diberi jarak 15 detik dari waktu melamar.
export function buildLog(candidates: Candidate[], hrEvents: LogEntry[]) {
  const agent = candidates.flatMap((candidate) =>
    candidate.pipeline.map(
      (step, index): LogEntry => ({
        id: `${candidate.id}-${index}`,
        at:
          step.at ??
          new Date(
            Date.parse(candidate.appliedAt) + (index + 1) * 15_000,
          ).toISOString(),
        actor: step.actor ?? "agent",
        candidateId: candidate.id,
        tool: step.tool,
        label: step.label,
        result: step.result,
        state: step.state,
      }),
    ),
  );
  return [...agent, ...hrEvents].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
}
