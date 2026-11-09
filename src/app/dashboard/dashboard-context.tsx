"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import type { LogEntry } from "@/lib/agent-log";
import { request } from "@/lib/api";
import type { Candidate, Interview } from "@/lib/candidates";
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
  interviews: Interview[];
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
  saveDraft: (id: string, draft: InvitationDraft) => void;
  invitations: Record<string, InvitationStatus>;
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
  candidates: loaded,
  interviews,
  children,
}: {
  jobs: Job[];
  candidates: Candidate[];
  interviews: Interview[];
  children: ReactNode;
}) {
  const router = useRouter();
  // Optimistic copy of server data; replaced whenever the server re-renders.
  const [candidates, setCandidates] = useState(loaded);
  useEffect(() => setCandidates(loaded), [loaded]);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToastMessage] = useState("");
  const [toastFailed, setToastFailed] = useState(false);
  const setToast = useCallback((message: string) => {
    setToastFailed(false);
    setToastMessage(message);
  }, []);
  const [drafts, setDrafts] = useState<Record<string, InvitationDraft>>({});
  const [invitations, setInvitations] = useState<Record<string, InvitationStatus>>({});

  async function decide(
    candidate: Candidate,
    decision: "shortlist" | "reject" | "undecided",
    status: Candidate["status"],
    message: string,
  ) {
    const previous = candidates;
    setCandidates((prev) =>
      prev.map((item) => (item.id === candidate.id ? { ...item, status } : item)),
    );
    try {
      await request(`/applications/${candidate.id}/decisions`, {
        method: "POST",
        body: { decision, rationale: message },
      });
      setToast(message);
      router.refresh();
    } catch (err) {
      setCandidates(previous);
      setToastFailed(true);
      setToastMessage(`Gagal menyimpan keputusan: ${(err as Error).message}`);
    }
  }

  async function sendInvitations(list: Candidate[], company: string) {
    setInvitations((prev) => ({
      ...prev,
      ...Object.fromEntries(list.map((c) => [c.id, "mengirim" as const])),
    }));
    const results = await Promise.all(
      list.map(async (candidate) => ({ candidate, sent: await sendInvitation(candidate) })),
    );
    setInvitations((prev) => ({
      ...prev,
      ...Object.fromEntries(
        results.map(({ candidate, sent }) => [candidate.id, sent ? ("terkirim" as const) : ("gagal" as const)]),
      ),
    }));
    const failed = results.filter((item) => !item.sent).length;
    setToastFailed(failed > 0);
    setToastMessage(
      failed
        ? `${failed} dari ${results.length} link jadwal gagal dibuat.`
        : `${results.length} link jadwal dibuat untuk ${company}. Kirim lewat emailmu.`,
    );
    router.refresh();
  }

  return (
    <DashboardContext.Provider
      value={{
        jobs,
        openJobs: jobs.filter((job) => job.status === "open"),
        candidates,
        interviews,
        pending: candidates.filter((c) => c.status === "Perlu ditinjau").length,
        failedInvitations: candidates.filter(
          (c) => c.status === "Shortlist" && invitations[c.id] === "gagal",
        ).length,
        hrEvents: [], // HR actions come back from the backend inside each candidate's pipeline
        modal,
        setModal,
        toast,
        toastFailed,
        setToast,
        approve: (c) =>
          decide(c, "shortlist", "Shortlist", `HR menyetujui ${c.name} ke shortlist ${c.role}.`),
        decline: (c) =>
          decide(c, "reject", "Tidak dilanjutkan", `${c.name} tidak dilanjutkan. Tidak ada email terkirim.`),
        returnToReview: (c) =>
          decide(c, "undecided", "Perlu ditinjau", `${c.name} dikembalikan ke tinjauan.`),
        getDraft: (candidate, company) => drafts[candidate.id] ?? createDraft(candidate, company),
        saveDraft: (id, draft) => setDrafts((prev) => ({ ...prev, [id]: draft })),
        invitations,
        sendInvitations,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
