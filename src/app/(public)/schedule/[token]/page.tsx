import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { getScheduleInvite } from "@/lib/schedule";
import { PublicMessage } from "../../public-ui";
import { SlotPicker } from "./slot-picker";

export const metadata: Metadata = {
  title: "Pilih jadwal interview",
  robots: { index: false },
};

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ubah?: string | string[] }>;
}) {
  const { token } = await params;
  const { ubah } = await searchParams;
  const invite = await getScheduleInvite(token);
  if (!invite) notFound();

  if (!invite.slots.length)
    return (
      <PublicMessage
        icon={<CalendarClock size={22} />}
        tone="sand"
        title="Belum ada slot yang kosong"
      >
        <p>
          Semua slot interview untuk posisi {invite.jobTitle} sudah terisi.
          Hubungi tim HR {invite.company} untuk menanyakan jadwal lain.
        </p>
      </PublicMessage>
    );

  const currentSlot = invite.slots.find((slot) => slot.id === ubah);

  return (
    <>
      <div className="page-heading public-heading">
        <div>
          <h1>
            {currentSlot
              ? "Ubah jadwal interview"
              : `Halo ${invite.applicantName}, pilih jadwal interview`}
          </h1>
          <p>
            Selamat, kamu lolos ke tahap interview untuk posisi{" "}
            {invite.jobTitle} di {invite.company}.
          </p>
        </div>
      </div>
      <SlotPicker invite={invite} currentSlotId={currentSlot?.id} />
    </>
  );
}
