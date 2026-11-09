import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarCheck, CalendarDays } from "lucide-react";
import { formatDate, formatTimeRange, getScheduleInvite } from "@/lib/schedule";
import { PublicMessage } from "../../../public-ui";

export const metadata: Metadata = {
  title: "Interview terjadwal — Saring",
  robots: { index: false },
};

export default async function ScheduleSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ slot?: string | string[] }>;
}) {
  const { token } = await params;
  const { slot: slotId } = await searchParams;
  const invite = await getScheduleInvite(token);
  if (!invite) notFound();
  const slot = invite.slots.find((item) => item.id === slotId);
  if (invite.status !== "active" || !slot) redirect(`/schedule/${token}`);

  return (
    <PublicMessage
      icon={<CalendarCheck size={22} />}
      title="Interview terjadwal"
      success
    >
      <p>
        Terima kasih, {invite.applicantName}. Jadwalmu sudah tercatat untuk tim
        HR {invite.company}.
      </p>
      <dl className="public-booking">
        <div>
          <dt>Tanggal</dt>
          <dd>{formatDate(slot.start)}</dd>
        </div>
        <div>
          <dt>Waktu</dt>
          <dd>{formatTimeRange(slot)}</dd>
        </div>
        <div>
          <dt>Posisi</dt>
          <dd>{invite.jobTitle}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{invite.format}</dd>
        </div>
      </dl>
      <div className="public-message-actions">
        <Link
          className="button secondary"
          href={`/schedule/${token}?ubah=${slot.id}`}
        >
          <CalendarDays size={15} />
          Ubah jadwal
        </Link>
      </div>
    </PublicMessage>
  );
}
