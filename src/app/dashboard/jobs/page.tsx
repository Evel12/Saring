import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AddJobButton, JobCards, PageHeading } from "../dashboard-ui";

export const metadata: Metadata = { title: "Lowongan" };

export default function JobsPage() {
  return (
    <>
      <PageHeading
        title="Lowongan"
        description="Kelola posisi yang sedang dibuka dan bagikan link lamarannya."
      >
        <AddJobButton />
      </PageHeading>
      <JobCards full />
      <div className="subtle-callout">
        <Plus size={18} />
        <div>
          <strong>Tim yang hebat dimulai dari kesempatan baru.</strong>
          <p>
            Tambahkan lowongan, tentukan kriteria, lalu bagikan link lamarannya.
          </p>
        </div>
        <Link className="button secondary" href="/dashboard/jobs/new">
          Buat lowongan
        </Link>
      </div>
    </>
  );
}
