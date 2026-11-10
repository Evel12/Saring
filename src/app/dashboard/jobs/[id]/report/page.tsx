import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getJob } from "@/lib/job-store";
import { JobReport } from "./job-report";

export const metadata: Metadata = { title: "Laporan lowongan" };

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  return (
    <JobReport
      jobId={job.id}
      title={job.title}
      company={job.company}
      slots={job.slots.length}
      filledSlots={job.slots.filter((slot) => slot.status === "terisi").length}
    />
  );
}
