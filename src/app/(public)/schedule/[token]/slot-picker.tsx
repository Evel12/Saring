"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Clock,
  LoaderCircle,
  TriangleAlert,
  Video,
} from "lucide-react";
import {
  bookSlot,
  formatDate,
  formatTimeRange,
  type InterviewSlot,
  type ScheduleInvite,
} from "@/lib/applicant-demo";

type Conflict = { taken: InterviewSlot; alternatives: InterviewSlot[] };

export function SlotPicker({
  invite,
  currentSlotId,
}: {
  invite: ScheduleInvite;
  currentSlotId?: string;
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(invite.slots);
  const [selectedId, setSelectedId] = useState(currentSlotId ?? "");
  const [sending, setSending] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conflict) alert.current?.focus();
  }, [conflict]);

  const days = new Map<string, InterviewSlot[]>();
  for (const slot of slots) {
    const day = formatDate(slot.start);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }
  const selected = slots.find((slot) => slot.id === selectedId);
  const unchanged = !!currentSlotId && selectedId === currentSlotId;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected || unchanged || sending) return;
    setSending(true);
    setConflict(null);
    setSendFailed(false);
    try {
      const result = await bookSlot(invite.token, selected.id);
      if (result.ok) {
        router.push(`/schedule/${invite.token}/success?slot=${selected.id}`);
        return;
      }
      setSlots((prev) => prev.filter((slot) => slot.id !== selected.id));
      setSelectedId("");
      setConflict({ taken: selected, alternatives: result.alternatives });
    } catch {
      setSendFailed(true);
    }
    setSending(false);
  }

  return (
    <form className="public-grid" onSubmit={onSubmit}>
      <fieldset className="panel public-card public-slots">
        <legend className="sr-only">Slot interview yang tersedia</legend>
        <div className="public-form-heading">
          <h2>Slot yang tersedia</h2>
          <p>Semua waktu dalam WIB. Pilih satu yang paling cocok untukmu.</p>
        </div>

        {conflict && (
          <div className="public-alert" role="alert" tabIndex={-1} ref={alert}>
            <TriangleAlert size={16} />
            <div>
              <strong>
                Slot {formatDate(conflict.taken.start)},{" "}
                {formatTimeRange(conflict.taken)} baru saja terisi.
              </strong>
              {conflict.alternatives.length > 0 && (
                <>
                  <span> Slot terdekat yang masih kosong:</span>
                  <div className="public-alternatives">
                    {conflict.alternatives.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        className="button secondary"
                        aria-pressed={selectedId === slot.id}
                        onClick={() => setSelectedId(slot.id)}
                      >
                        {selectedId === slot.id && <Check size={14} />}
                        {formatDate(slot.start)}, {formatTimeRange(slot)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {[...days].map(([day, daySlots]) => (
          <div className="public-slot-day" key={day}>
            <h3>{day}</h3>
            <div className="public-slot-options">
              {daySlots.map((slot) => (
                <label className="public-slot" key={slot.id}>
                  <input
                    type="radio"
                    name="slot"
                    value={slot.id}
                    checked={selectedId === slot.id}
                    onChange={() => setSelectedId(slot.id)}
                  />
                  <span>{formatTimeRange(slot)}</span>
                  {slot.id === currentSlotId && <small>Jadwal saat ini</small>}
                  <Check size={15} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <aside className="public-aside">
        <section className="panel public-card public-summary">
          <h2>Detail interview</h2>
          <dl>
            <div>
              <dt>Posisi</dt>
              <dd>{invite.jobTitle}</dd>
            </div>
            <div>
              <dt>
                <Video size={13} />
                Format
              </dt>
              <dd>{invite.format}</dd>
            </div>
            <div>
              <dt>
                <Clock size={13} />
                Durasi
              </dt>
              <dd>{invite.durationMinutes} menit</dd>
            </div>
            <div className="public-summary-choice">
              <dt>Pilihanmu</dt>
              <dd aria-live="polite">
                {selected
                  ? `${formatDate(selected.start)}, ${formatTimeRange(selected)}`
                  : "Belum dipilih"}
              </dd>
            </div>
          </dl>
          {sendFailed && (
            <div className="public-alert" role="alert">
              <TriangleAlert size={16} />
              <span>Jadwal belum tersimpan. Coba lagi sebentar lagi.</span>
            </div>
          )}
          <button
            className="button primary public-submit"
            type="submit"
            disabled={!selected || unchanged || sending}
          >
            {sending ? (
              <>
                <LoaderCircle className="spin" size={16} />
                Menyimpan jadwal...
              </>
            ) : (
              <>
                {currentSlotId ? "Simpan jadwal baru" : "Konfirmasi jadwal"}
                <ArrowRight size={16} />
              </>
            )}
          </button>
          {invite.expiresAt && (
            <p className="public-summary-note">
              Link ini berlaku sampai {formatDate(invite.expiresAt)}.
            </p>
          )}
        </section>
      </aside>
    </form>
  );
}
