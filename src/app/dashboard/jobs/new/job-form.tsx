"use client";

import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Plus, TriangleAlert, X } from "lucide-react";
import { formatDate, formatTimeRange } from "@/lib/schedule";
import {
  DEPARTMENTS,
  JOB_TYPES,
  validateJobInput,
  type JobInput,
  type JobInputErrors,
  type JobSlotInput,
} from "@/lib/job-input";
import { ApiError, post, request } from "@/lib/api";
import type { Page, Vacancy, Version } from "@/lib/types";

const criterion = (skill: string, importance: "essential" | "preferred") => ({
  description: skill,
  importance,
  acceptable_evidence_types: ["candidate_report", "document", "work_sample"],
  minimum_observable_expectation: `Pengalaman nyata dengan ${skill}: proyek atau pekerjaan dan kontribusi pribadi pelamar.`,
  clarification_permitted: true,
});

// Lowongan baru langsung dibuka: buat, setujui kriteria (klik HR ini = persetujuan),
// publikasikan, lalu aktifkan link lamaran.
async function createJob(input: JobInput) {
  const toSeconds = (iso: string) => Date.parse(iso) / 1000;
  const vacancy = await post<Vacancy>("/vacancies", {
    title: input.title.trim(),
    description: input.description.trim(),
    department: input.department,
    employment_type: input.type,
    location: input.location.trim(),
    requirements: [
      ...input.requiredSkills.map((s) => criterion(s, "essential")),
      ...input.niceToHaveSkills.map((s) => criterion(s, "preferred")),
    ],
    slots: input.slots.map((s) => ({
      starts_at: toSeconds(s.start),
      ends_at: toSeconds(s.end),
    })),
  });
  const versions = await request<Page<Version>>(
    `/vacancies/${vacancy.id}/requirement-versions`,
  );
  await post(`/requirement-versions/${versions.items[0].id}/approve`, {
    rationale: "Disetujui HR saat membuat lowongan.",
  });
  await request(`/vacancies/${vacancy.id}`, {
    method: "PATCH",
    body: { state: "published" },
  });
  await post(`/vacancies/${vacancy.id}/apply-link`, {
    questions: ["Ceritakan singkat kenapa kamu tertarik dengan posisi ini."],
  });
  return vacancy.id;
}

const FIELD_ORDER: [keyof JobInputErrors, string][] = [
  ["title", "job-title"],
  ["location", "job-location"],
  ["description", "job-description"],
  ["requiredSkills", "job-required-skills"],
  ["slots", "slot-date"],
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span className="job-field-error" id={id}>
      <TriangleAlert size={13} />
      {message}
    </span>
  );
}

function SkillInput({
  id,
  skills,
  onChange,
  placeholder,
  error,
}: {
  id: string;
  skills: string[];
  onChange: (skills: string[]) => void;
  placeholder: string;
  error?: string;
}) {
  const [text, setText] = useState("");

  function commit() {
    const value = text.trim().replace(/,$/, "").trim();
    setText("");
    if (
      value &&
      !skills.some((skill) => skill.toLowerCase() === value.toLowerCase())
    )
      onChange([...skills, value]);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !text && skills.length) {
      onChange(skills.slice(0, -1));
    }
  }

  return (
    <div className={`job-skill-input ${error ? "invalid" : ""}`}>
      {skills.map((skill) => (
        <span className="job-skill" key={skill}>
          {skill}
          <button
            type="button"
            aria-label={`Hapus ${skill}`}
            onClick={() => onChange(skills.filter((item) => item !== skill))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        maxLength={40}
        placeholder={skills.length ? "" : placeholder}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
}

export function JobForm({ today }: { today: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [type, setType] = useState(JOB_TYPES[0]);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
  const [niceToHaveSkills, setNiceToHaveSkills] = useState<string[]>([]);
  const [slots, setSlots] = useState<JobSlotInput[]>([]);
  const [slotDate, setSlotDate] = useState("");
  const [slotTime, setSlotTime] = useState("09:00");
  const [slotDuration, setSlotDuration] = useState("45");
  const [slotError, setSlotError] = useState("");
  const [errors, setErrors] = useState<JobInputErrors>({});
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState<string | false>(false);

  function clearError(field: keyof JobInputErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }
  function addSlot() {
    if (!slotDate || !slotTime) {
      setSlotError("Pilih tanggal dan jam mulai.");
      return;
    }
    const startMs = Date.parse(`${slotDate}T${slotTime}:00+07:00`);
    if (Number.isNaN(startMs)) {
      setSlotError("Tanggal atau jam belum benar.");
      return;
    }
    if (startMs <= Date.now()) {
      setSlotError("Waktu slot sudah lewat. Pilih waktu yang akan datang.");
      return;
    }
    const endMs = startMs + Number(slotDuration) * 60_000;
    const overlaps = slots.some(
      (slot) =>
        startMs < Date.parse(slot.end) && endMs > Date.parse(slot.start),
    );
    if (overlaps) {
      setSlotError("Slot ini bertabrakan dengan slot yang sudah ada.");
      return;
    }
    setSlots((prev) =>
      [
        ...prev,
        {
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
        },
      ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    );
    setSlotError("");
    clearError("slots");
  }
  function focusFirstError(next: JobInputErrors) {
    const first = FIELD_ORDER.find(([field]) => next[field]);
    if (first) document.getElementById(first[1])?.focus();
  }
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const input: JobInput = {
      title,
      department,
      type,
      location,
      description,
      requiredSkills,
      niceToHaveSkills,
      slots,
    };
    const next = validateJobInput(input);
    setErrors(next);
    setSendFailed(false);
    if (Object.keys(next).length) return focusFirstError(next);
    setSending(true);
    try {
      const id = await createJob(input);
      router.push(`/dashboard/jobs/${id}?baru=1`);
      router.refresh();
      return;
    } catch (err) {
      setSendFailed(
        err instanceof ApiError ? err.message : "server tidak terhubung",
      );
    }
    setSending(false);
  }

  const days = new Map<string, JobSlotInput[]>();
  for (const slot of slots) {
    const day = formatDate(slot.start);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }

  return (
    <form className="job-form" onSubmit={onSubmit} noValidate>
      <section className="panel job-panel">
        <h2>Posisi</h2>
        <div className="job-field">
          <label htmlFor="job-title">Nama posisi</label>
          <input
            id="job-title"
            value={title}
            maxLength={80}
            placeholder="Contoh: Backend Engineer"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "job-title-error" : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              clearError("title");
            }}
          />
          <FieldError id="job-title-error" message={errors.title} />
        </div>
        <div className="job-form-row">
          <div className="job-field">
            <label htmlFor="job-department">Departemen</label>
            <select
              id="job-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {DEPARTMENTS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="job-field">
            <label htmlFor="job-type">Tipe pekerjaan</label>
            <select
              id="job-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {JOB_TYPES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="job-field">
            <label htmlFor="job-location">Lokasi</label>
            <input
              id="job-location"
              value={location}
              maxLength={60}
              placeholder="Contoh: Jakarta · Hybrid"
              aria-invalid={!!errors.location}
              aria-describedby={
                errors.location ? "job-location-error" : undefined
              }
              onChange={(e) => {
                setLocation(e.target.value);
                clearError("location");
              }}
            />
            <FieldError id="job-location-error" message={errors.location} />
          </div>
        </div>
      </section>

      <section className="panel job-panel">
        <h2>Kriteria penilaian</h2>
        <div className="job-field">
          <label htmlFor="job-description">Deskripsi pekerjaan</label>
          <textarea
            id="job-description"
            rows={5}
            value={description}
            placeholder="Ceritakan tanggung jawab dan pengalaman yang dibutuhkan..."
            aria-invalid={!!errors.description}
            aria-describedby={
              errors.description ? "job-description-error" : undefined
            }
            onChange={(e) => {
              setDescription(e.target.value);
              clearError("description");
            }}
          />
          <FieldError id="job-description-error" message={errors.description} />
        </div>
        <div className="job-field">
          <label htmlFor="job-required-skills">Skill wajib</label>
          <SkillInput
            id="job-required-skills"
            skills={requiredSkills}
            placeholder="Ketik skill, lalu tekan Enter"
            error={errors.requiredSkills}
            onChange={(skills) => {
              setRequiredSkills(skills);
              clearError("requiredSkills");
            }}
          />
          <FieldError
            id="job-required-skills-error"
            message={errors.requiredSkills}
          />
          <span className="job-field-hint" id="job-required-skills-hint">
            Tekan Enter atau koma untuk menambahkan.
          </span>
        </div>
        <div className="job-field">
          <label htmlFor="job-nice-skills">
            Skill tambahan <em>opsional</em>
          </label>
          <SkillInput
            id="job-nice-skills"
            skills={niceToHaveSkills}
            placeholder="Ketik skill, lalu tekan Enter"
            onChange={setNiceToHaveSkills}
          />
          <span className="job-field-hint" id="job-nice-skills-hint">
            Menambah nilai, tetapi pelamar tanpa skill ini tetap bisa lolos.
          </span>
        </div>
      </section>

      <section className="panel job-panel">
        <h2>Slot interview</h2>
        <p className="job-panel-intro">
          Pelamar yang kamu setujui memilih sendiri dari slot ini. Semua waktu
          dalam WIB.
        </p>
        <div className="job-slot-add">
          <div className="job-field">
            <label htmlFor="slot-date">Tanggal</label>
            <input
              id="slot-date"
              type="date"
              min={today}
              value={slotDate}
              aria-invalid={!!errors.slots || !!slotError}
              onChange={(e) => {
                setSlotDate(e.target.value);
                setSlotError("");
              }}
            />
          </div>
          <div className="job-field">
            <label htmlFor="slot-time">Jam mulai</label>
            <input
              id="slot-time"
              type="time"
              value={slotTime}
              onChange={(e) => {
                setSlotTime(e.target.value);
                setSlotError("");
              }}
            />
          </div>
          <div className="job-field">
            <label htmlFor="slot-duration">Durasi</label>
            <select
              id="slot-duration"
              value={slotDuration}
              onChange={(e) => setSlotDuration(e.target.value)}
            >
              <option value="30">30 menit</option>
              <option value="45">45 menit</option>
              <option value="60">60 menit</option>
            </select>
          </div>
          <button type="button" className="button secondary" onClick={addSlot}>
            <Plus size={15} />
            Tambah slot
          </button>
        </div>
        <FieldError id="slot-error" message={slotError || errors.slots} />
        {slots.length > 0 && (
          <div className="job-slot-list">
            {[...days].map(([day, daySlots]) => (
              <div key={day}>
                <h3>{day}</h3>
                <ul>
                  {daySlots.map((slot) => (
                    <li key={slot.start}>
                      {formatTimeRange(slot)}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Hapus slot ${day}, ${formatTimeRange(slot)}`}
                        onClick={() =>
                          setSlots((prev) =>
                            prev.filter((item) => item.start !== slot.start),
                          )
                        }
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {sendFailed && (
        <div className="job-alert" role="alert">
          <TriangleAlert size={16} />
          <span>
            Lowongan belum tersimpan. Isian kamu masih ada di sini, coba lagi
            sebentar lagi.
            {sendFailed && <small> ({sendFailed})</small>}
          </span>
        </div>
      )}
      <div className="job-form-actions">
        <Link className="button secondary" href="/dashboard/jobs">
          Batal
        </Link>
        <button className="button primary" type="submit" disabled={sending}>
          {sending ? (
            <>
              <LoaderCircle className="spin" size={16} />
              Menyimpan...
            </>
          ) : (
            <>
              Buat lowongan
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
