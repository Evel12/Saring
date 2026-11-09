import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { getApplyJob } from "@/lib/public-apply";
import { NextSteps, PublicMessage } from "../../../public-ui";

export const metadata: Metadata = {
  title: "Lamaran diterima — Saring",
  robots: { index: false },
};

export default async function ApplySuccessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const job = await getApplyJob(slug);
  if (!job) notFound();

  return (
    <PublicMessage
      icon={<Check size={22} />}
      title="Lamaran diterima"
      success
    >
      <p>
        Lamaranmu untuk posisi <strong>{job.title}</strong> di {job.company}{" "}
        sudah masuk. Kamu boleh menutup halaman ini.
      </p>
      <div className="public-message-steps">
        <h2>Yang terjadi berikutnya</h2>
        <NextSteps />
      </div>
      <p className="public-message-note">
        Email dari kami bisa saja masuk ke folder spam, jadi periksa juga folder
        itu.
      </p>
    </PublicMessage>
  );
}
