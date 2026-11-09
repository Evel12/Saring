import type { Metadata } from "next";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { CandidateTable } from "../candidate-table";
import { PageHeading } from "../dashboard-ui";

export const metadata: Metadata = { title: "Kandidat — Saring" };

const first = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    cari?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const status = first(params.status);
  const cari = first(params.cari);
  return (
    <>
      <PageHeading
        title="Kandidat"
        description="Tinjau profil dan bukti pendukung untuk setiap kandidat."
      >
        <Link className="button primary" href="/dashboard/jobs">
          <Link2 size={16} />
          Bagikan link lamaran
        </Link>
      </PageHeading>
      <CandidateTable
        key={`${status}-${cari}`}
        full
        initialStatus={status}
        focusSearch={!!cari}
      />
    </>
  );
}
