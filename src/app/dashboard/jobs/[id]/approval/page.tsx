import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getJob } from "@/lib/job-store";
import { PageHeading } from "../../../dashboard-ui";
import { ApprovalBoard } from "./approval-board";

export const metadata: Metadata = { title: "Persetujuan shortlist — Saring" };

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  return (
    <>
      <PageHeading
        title={`Persetujuan shortlist ${job.title}`}
        description="Periksa kandidat dan draf email. Agent hanya mengirim undangan yang kamu setujui di sini."
      />
      <ApprovalBoard
        jobId={job.id}
        role={job.title}
        company={job.company}
        emptySlots={job.slots.filter((slot) => slot.status === "kosong").length}
      />
    </>
  );
}
