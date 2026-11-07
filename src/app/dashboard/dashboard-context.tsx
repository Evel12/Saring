"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { LogEntry } from "@/lib/agent-log";
import {
  initialCandidates,
  initialHrEvents,
  type AgentStep,
  type Candidate,
} from "@/lib/demo";
import {
  createDraft,
  sendInvitation,
  type InvitationDraft,
} from "@/lib/invitation-demo";
import type { Job } from "@/lib/job-store";

export type Modal = "settings" | "help" | null;
export type InvitationStatus = "mengirim" | "terkirim" | "gagal";

type DashboardState = {
  jobs: Job[];
  openJobs: Job[];
  candidates: Candidate[];
  pending: number;
  failedInvitations: number;
  hrEvents: LogEntry[];
  modal: Modal;
  setModal: Dispatch<SetStateAction<Modal>>;
  toast: string;
  toastFailed: boolean;
  setToast: (message: string) => void;
  approve: (candidate: Candidate) => void;
  decline: (candidate: Candidate) => void;
  returnToReview: (candidate: Candidate) => void;
  getDraft: (candidate: Candidate, company: string) => InvitationDraft;
  saveDraft: (id: number, draft: InvitationDraft) => void;
  invitations: Record<number, InvitationStatus>;
  sendInvitations: (list: Candidate[], company: string) => Promise<void>;
};

const DashboardContext = createContext<DashboardState | null>(null);

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard dipakai di luar DashboardProvider");
  return value;
}

export function DashboardProvider({
  jobs,
  children,
}: {
  jobs: Job[];
  children: ReactNode;
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToastMessage] = useState("");
  const [toastFailed, setToastFailed] = useState(false);
  const setToast = useCallback((message: string) => {
    setToastFailed(false);
    setToastMessage(message);
  }, []);
  const [drafts, setDrafts] = useState<Record<number, InvitationDraft>>({});
  const [invitations, setInvitations] = useState<
    Record<number, InvitationStatus>
  >({});
  const [hrEvents, setHrEvents] = useState<LogEntry[]>(initialHrEvents);

  function update(id: number, change: (candidate: Candidate) => Candidate) {
    setCandidates((prev) =>
      prev.map((item) => (item.id === id ? change(item) : item)),
    );
  }
  function setStatus(id: number, status: Candidate["status"]) {
    update(id, (item) => ({ ...item, status }));
  }
  function logHr(candidate: Candidate, label: string, result: string) {
    setHrEvents((prev) => [
      {
        id: `hr-${Date.now()}-${candidate.id}`,
        at: new Date().toISOString(),
        actor: "hr",
        candidateId: candidate.id,
        label,
        result,
        state: "ok",
      },
      ...prev,
    ]);
  }
  function addStep(id: number, step: AgentStep) {
    update(id, (item) => ({ ...item, pipeline: [...item.pipeline, step] }));
  }

  function approve(candidate: Candidate) {
    setStatus(candidate.id, "Shortlist");
    setToast(`${candidate.name} ditambahkan ke shortlist.`);
    logHr(
      candidate,
      "Menyetujui shortlist",
      `HR menyetujui ${candidate.name} untuk shortlist ${candidate.role}.`,
    );
  }
  function decline(candidate: Candidate) {
    setStatus(candidate.id, "Tidak dilanjutkan");
    setToast(`${candidate.name} tidak dilanjutkan. Tidak ada email terkirim.`);
    logHr(
      candidate,
      "Tidak melanjutkan",
      `HR tidak melanjutkan ${candidate.name}. Tidak ada email terkirim.`,
    );
  }
  function returnToReview(candidate: Candidate) {
    setStatus(candidate.id, "Perlu ditinjau");
    setToast(`${candidate.name} dikembalikan ke tinjauan.`);
    logHr(
      candidate,
      "Mengembalikan ke tinjauan",
      `HR mengembalikan ${candidate.name} ke tinjauan.`,
    );
  }
  function getDraft(candidate: Candidate, company: string) {
    return drafts[candidate.id] ?? createDraft(candidate, company);
  }
  async function sendInvitations(list: Candidate[], company: string) {
    const previous = invitations;
    setInvitations((prev) => ({
      ...prev,
      ...Object.fromEntries(list.map((c) => [c.id, "mengirim" as const])),
    }));
    for (const candidate of list)
      logHr(
        candidate,
        "Menyetujui undangan",
        `HR menyetujui undangan interview untuk ${candidate.name}.`,
      );
    const results = await Promise.all(
      list.map(async (candidate) => {
        const isRetry = previous[candidate.id] === "gagal";
        const sent = await sendInvitation(
          candidate,
          getDraft(candidate, company),
          isRetry,
        );
        return { candidate, sent, isRetry };
      }),
    );
    setInvitations((prev) => ({
      ...prev,
      ...Object.fromEntries(
        results.map(({ candidate, sent }) => [
          candidate.id,
          sent ? ("terkirim" as const) : ("gagal" as const),
        ]),
      ),
    }));
    const at = new Date().toISOString();
    for (const { candidate, sent, isRetry } of results) {
      if (sent) {
        update(candidate.id, (item) => ({
          ...item,
          status: "Diundang",
          invitedAt: at,
        }));
        addStep(candidate.id, {
          tool: "send_email",
          label: "Mengirim undangan",
          result: isRetry
            ? "Undangan terkirim pada percobaan ulang."
            : "Undangan terkirim setelah disetujui HR.",
          state: isRetry ? "recovered" : "ok",
          at,
        });
      } else {
        addStep(candidate.id, {
          tool: "send_email",
          label: "Mengirim undangan",
          result: "Email gagal terkirim setelah dicoba ulang. HR diberi tahu.",
          state: "flagged",
          at,
        });
      }
    }
    const failed = results.filter((item) => !item.sent).length;
    setToast(
      failed
        ? `${failed} dari ${results.length} undangan gagal terkirim.`
        : `${results.length} undangan terkirim.`,
    );
    setToastFailed(failed > 0);
  }

  return (
    <DashboardContext.Provider
      value={{
        jobs,
        openJobs: jobs.filter((job) => job.status === "open"),
        candidates,
        pending: candidates.filter((c) => c.status === "Perlu ditinjau").length,
        failedInvitations: candidates.filter(
          (c) => c.status === "Shortlist" && invitations[c.id] === "gagal",
        ).length,
        hrEvents,
        modal,
        setModal,
        toast,
        toastFailed,
        setToast,
        approve,
        decline,
        returnToReview,
        getDraft,
        saveDraft: (id, draft) =>
          setDrafts((prev) => ({ ...prev, [id]: draft })),
        invitations,
        sendInvitations,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
