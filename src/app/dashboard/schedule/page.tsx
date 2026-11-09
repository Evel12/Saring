"use client";

import Link from "next/link";
import { BellRing, CalendarDays, Clock, Video } from "lucide-react";
import {
  formatDate,
  formatDateTime,
  formatTimeRange,
} from "@/lib/applicant-demo";
import type { Interview } from "@/lib/candidates";
import { Avatar } from "../candidate-table";
import { useDashboard } from "../dashboard-context";
import { PageHeading, upcomingInterviews } from "../dashboard-ui";

const REMINDER_AFTER = 48 * 60 * 60 * 1000;

export default function SchedulePage() {
  const { candidates, interviews } = useDashboard();
  const days = new Map<string, Interview[]>();
  for (const item of upcomingInterviews(interviews)) {
    const day = formatDate(item.start);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  const waiting = candidates.filter((c) => c.status === "Diundang");

  return (
    <>
      <PageHeading
        title="Jadwal interview"
        description="Jadwal yang sudah dipilih pelamar dan undangan yang masih menunggu. Semua waktu dalam WIB."
      />
      <div className="dashboard-grid schedule-grid">
        <section className="panel job-panel">
          <h2>
            <CalendarDays size={15} />
            Interview terjadwal
          </h2>
          {days.size ? (
            [...days].map(([day, items]) => (
              <div className="schedule-day" key={day}>
                <h3>{day}</h3>
                <ul>
                  {items.map((item) => {
                    const candidate = candidates.find(
                      (c) => c.id === item.candidateId,
                    );
                    if (!candidate) return null;
                    return (
                      <li key={item.candidateId}>
                        <span className="schedule-time">
                          {formatTimeRange(item)}
                        </span>
                        <Avatar
                          initials={candidate.initials}
                          color={candidate.color}
                          small
                        />
                        <span className="schedule-who">
                          <Link href={`/dashboard/candidates/${candidate.id}`}>
                            {candidate.name}
                          </Link>
                          <small>{candidate.role}</small>
                        </span>
                        <span className="schedule-type">
                          <Video size={12} />
                          {item.type}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          ) : (
            <p className="job-panel-intro">Belum ada interview terjadwal.</p>
          )}
        </section>

        <section className="panel job-panel">
          <h2>
            <Clock size={15} />
            Menunggu pilih jadwal
          </h2>
          <p className="job-panel-intro">
            Pelamar sudah menerima link jadwal pribadi. Kirim ulang linknya
            dari halaman persetujuan kalau mereka belum memilih.
          </p>
          {waiting.length ? (
            <ul className="schedule-waiting">
              {waiting.map((candidate) => {
                const reminderAt =
                  candidate.reminderSentAt ??
                  (candidate.invitedAt
                    ? new Date(
                        Date.parse(candidate.invitedAt) + REMINDER_AFTER,
                      ).toISOString()
                    : undefined);
                return (
                  <li key={candidate.id}>
                    <Link href={`/dashboard/candidates/${candidate.id}`}>
                      {candidate.name}
                    </Link>
                    <small>{candidate.role}</small>
                    {candidate.invitedAt && (
                      <p>Diundang {formatDateTime(candidate.invitedAt)}</p>
                    )}
                    {reminderAt && (
                      <p className="schedule-reminder">
                        <BellRing size={12} />
                        {candidate.reminderSentAt
                          ? `Pengingat terkirim ${formatDateTime(reminderAt)}`
                          : `Pengingat otomatis ${formatDateTime(reminderAt)}`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="job-panel-intro">Tidak ada undangan yang menunggu.</p>
          )}
        </section>
      </div>
    </>
  );
}
