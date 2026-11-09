"use client";

import { useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileText,
  LoaderCircle,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { submitApplication } from "@/lib/applicant-demo";

const MAX_CV_SIZE = 10 * 1024 * 1024;

type Field = "name" | "email" | "cv" | "link" | "consent";
type Errors = Partial<Record<Field, string>>;

function validateName(value: string) {
  return value.trim() ? undefined : "Isi nama lengkapmu.";
}
function validateEmail(value: string) {
  if (!value.trim()) return "Isi alamat emailmu.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? undefined
    : "Format email belum benar. Contoh: nama@email.com.";
}
function validateCv(file: File | null) {
  if (!file) return "Unggah CV dalam format PDF atau DOCX.";
  if (!/\.(pdf|docx)$/i.test(file.name))
    return "CV harus berformat PDF atau DOCX.";
  if (file.size > MAX_CV_SIZE) return "Ukuran CV maksimal 10 MB.";
  if (file.size === 0) return "File ini kosong. Pilih file CV lain.";
}
function normalizeLink(value: string) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
function validateLink(value: string) {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(normalizeLink(value));
    if (url.hostname.includes(".") && !url.username) return undefined;
  } catch {}
  return "Link belum benar. Contoh: github.com/nama-kamu.";
}
function validateConsent(value: boolean) {
  return value ? undefined : "Centang persetujuan ini agar lamaran bisa dikirim.";
}
function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span className="public-field-error" id={id}>
      <TriangleAlert size={13} />
      {message}
    </span>
  );
}

export function ApplyForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cv, setCv] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const cvInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);

  function setError(field: Field, message?: string) {
    setErrors((prev) => ({ ...prev, [field]: message }));
  }
  function pickFiles(files: File[]) {
    if (files.length > 1) {
      setCv(null);
      setError("cv", "Pilih satu file CV saja.");
      return;
    }
    const file = files[0];
    if (!file) return;
    const message = validateCv(file);
    setCv(message ? null : file);
    setError("cv", message);
  }
  function removeCv() {
    setCv(null);
    requestAnimationFrame(() => cvInput.current?.focus());
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    pickFiles(Array.from(event.dataTransfer.files));
  }
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const next: Errors = {
      name: validateName(name),
      email: validateEmail(email),
      cv: validateCv(cv),
      link: validateLink(link),
      consent: validateConsent(consent),
    };
    setErrors(next);
    setSendFailed(false);
    if (next.name) return nameInput.current?.focus();
    if (next.email) return emailInput.current?.focus();
    if (next.cv) return cvInput.current?.focus();
    if (next.link) return linkInput.current?.focus();
    if (next.consent) return consentInput.current?.focus();
    if (!cv) return;
    setSending(true);
    try {
      await submitApplication(slug, {
        name: name.trim(),
        email: email.trim(),
        cv,
        link: link.trim() ? normalizeLink(link) : undefined,
        consent: true,
      });
      router.push(`/apply/${slug}/success`);
    } catch {
      setSending(false);
      setSendFailed(true);
    }
  }

  return (
    <form className="panel public-card public-form" onSubmit={onSubmit} noValidate>
      <div className="public-form-heading">
        <h2>Data lamaran</h2>
        <p>Semua kolom wajib diisi, kecuali yang bertanda opsional.</p>
      </div>
      <div className="form-row">
        <div className="public-field">
          <label htmlFor="apply-name">Nama lengkap</label>
          <input
            ref={nameInput}
            id="apply-name"
            value={name}
            autoComplete="name"
            maxLength={120}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "apply-name-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setError("name", validateName(e.target.value));
            }}
          />
          <FieldError id="apply-name-error" message={errors.name} />
        </div>
        <div className="public-field">
          <label htmlFor="apply-email">Email</label>
          <input
            ref={emailInput}
            id="apply-email"
            type="email"
            value={email}
            placeholder="nama@email.com"
            autoComplete="email"
            spellCheck={false}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "apply-email-error" : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setError("email", validateEmail(e.target.value));
            }}
          />
          <FieldError id="apply-email-error" message={errors.email} />
        </div>
      </div>

      <div className="public-field">
        <span className="public-field-label">CV</span>
        {cv ? (
          <div className="public-file">
            <span className="job-icon sage">
              <FileText size={16} />
            </span>
            <span className="public-file-name">
              <strong>{cv.name}</strong>
              <small>{formatFileSize(cv.size)}</small>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Hapus ${cv.name}`}
              onClick={removeCv}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <label
            className={`upload-zone ${dragging ? "dragging" : ""} ${errors.cv ? "invalid" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <Upload size={24} />
            <strong>Klik atau letakkan CV di sini</strong>
            <span>PDF atau DOCX · maksimal 10 MB</span>
            <input
              ref={cvInput}
              type="file"
              accept=".pdf,.docx"
              aria-label="Unggah CV, PDF atau DOCX, maksimal 10 MB"
              aria-invalid={!!errors.cv}
              aria-describedby={errors.cv ? "apply-cv-error" : undefined}
              onChange={(e) => {
                pickFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        )}
        <FieldError id="apply-cv-error" message={errors.cv} />
        <span className="public-field-hint">
          Foto, agama, atau usia yang tertulis di CV disembunyikan sebelum
          penilaian.
        </span>
      </div>

      <div className="public-field">
        <label htmlFor="apply-link">
          Link GitHub atau portofolio <em>opsional</em>
        </label>
        <input
          ref={linkInput}
          id="apply-link"
          value={link}
          inputMode="url"
          placeholder="github.com/nama-kamu"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!errors.link}
          aria-describedby={`apply-link-hint${errors.link ? " apply-link-error" : ""}`}
          onChange={(e) => {
            setLink(e.target.value);
            if (errors.link) setError("link", validateLink(e.target.value));
          }}
        />
        <FieldError id="apply-link-error" message={errors.link} />
        <span className="public-field-hint" id="apply-link-hint">
          Dipakai untuk membuktikan skill di CV. Tanpa link, atau kalau link
          bermasalah, nilaimu tidak berkurang.
        </span>
      </div>

      <div className="public-field">
        <label className={`public-consent ${errors.consent ? "invalid" : ""}`}>
          <input
            ref={consentInput}
            type="checkbox"
            checked={consent}
            aria-invalid={!!errors.consent}
            aria-describedby={errors.consent ? "apply-consent-error" : undefined}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (errors.consent)
                setError("consent", validateConsent(e.target.checked));
            }}
          />
          <span>
            Saya setuju Saring memproses CV saya dan memeriksa link yang saya
            berikan untuk lamaran ini. Baca{" "}
            <Link href="/privacy" target="_blank">
              kebijakan privasi
            </Link>
            .
          </span>
        </label>
        <FieldError id="apply-consent-error" message={errors.consent} />
      </div>

      {sendFailed && (
        <div className="public-alert" role="alert">
          <TriangleAlert size={16} />
          <span>
            <strong>Lamaran belum terkirim.</strong> Isian dan CV-mu masih ada
            di sini. Periksa koneksi internet, lalu coba kirim lagi.
          </span>
        </div>
      )}

      <button
        className="button primary public-submit"
        type="submit"
        disabled={sending}
      >
        {sending ? (
          <>
            <LoaderCircle className="spin" size={16} />
            Mengirim lamaran...
          </>
        ) : (
          <>
            Kirim lamaran
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  );
}
