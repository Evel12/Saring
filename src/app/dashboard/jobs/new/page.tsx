import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeading } from "../../dashboard-ui";
import { JobForm } from "./job-form";

export const metadata: Metadata = { title: "Buat lowongan" };

export default async function NewJobPage() {
  await connection();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date());
  return (
    <>
      <PageHeading
        title="Buat lowongan"
        description="Agent menilai pelamar dari isian ini. Setelah dibuat, kamu mendapat link lamaran untuk dibagikan."
      />
      <JobForm today={today} />
    </>
  );
}
