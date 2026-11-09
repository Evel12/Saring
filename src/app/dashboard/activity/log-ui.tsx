import { AlertTriangle, Check, RotateCcw, UserRound } from "lucide-react";
import { formatDateTime } from "@/lib/schedule";
import type { LogEntry } from "@/lib/agent-log";

export const STATE_LABEL: Record<LogEntry["state"], string> = {
  ok: "Selesai",
  recovered: "Dipulihkan otomatis",
  flagged: "Diteruskan ke HR",
};

export function LogIcon({ entry }: { entry: LogEntry }) {
  const Icon =
    entry.actor === "hr"
      ? UserRound
      : entry.state === "recovered"
        ? RotateCcw
        : entry.state === "flagged"
          ? AlertTriangle
          : Check;
  return (
    <span className={`log-icon ${entry.actor === "hr" ? "hr" : entry.state}`}>
      <Icon size={13} />
    </span>
  );
}

export function logTime(entry: LogEntry) {
  return formatDateTime(entry.at);
}
