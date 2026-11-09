"use client";

import Link from "next/link";
import { ArrowRight, MailCheck } from "lucide-react";
import { useDashboard } from "../../dashboard-context";

export function ApprovalEntry({
  jobId,
  role,
}: {
  jobId: string;
  role: string;
}) {
  const { candidates } = useDashboard();
  const count = candidates.filter(
    (c) => c.role === role && c.status === "Shortlist",
  ).length;
  if (!count) return null;
  return (
    <section className="review-banner approval-entry">
      <span className="banner-icon">
        <MailCheck size={18} />
      </span>
      <div className="banner-content">
        <h2>{count} kandidat shortlist menunggu persetujuanmu</h2>
        <p>Agent tidak mengirim undangan sebelum kamu menyetujuinya.</p>
      </div>
      <Link
        className="banner-action"
        href={`/dashboard/jobs/${jobId}/approval`}
      >
        Tinjau <ArrowRight size={15} />
      </Link>
    </section>
  );
}
