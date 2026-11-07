# Saring

Prototipe antarmuka recruitment agent untuk GTNIC 2026.

## Jalankan lokal

```sh
npm install
npm run dev
```

Buka http://127.0.0.1:3000.

## Pemeriksaan

```sh
npm run typecheck
npm run build
```

## Cakupan saat ini

- Dashboard ringkasan, lowongan, kandidat, jadwal, dan aktivitas.
- Pencarian, filter posisi/status, pengurutan skor, dan ekspor CSV.
- Detail kandidat: rincian skor, verifikasi skill, blind screening, langkah agent, dan pertanyaan interview.
- Persetujuan shortlist dengan draf email yang bisa diedit sebelum dikirim.
- Form lowongan lengkap dan detail lowongan dengan link lamaran yang bisa disalin.
- Login HRD, jejak aktivitas agent, jadwal interview dengan pengingat, dan laporan per lowongan.
- Responsive layout, keyboard focus, native modal dialogs, dan reduced motion.

## Halaman pelamar (tanpa login)

| Halaman | Contoh URL |
|---|---|
| Form lamaran | `/apply/frontend-developer-x7k2` |
| Lowongan ditutup | `/apply/data-analyst-z2c6` |
| Pilih jadwal | `/schedule/demo-aktif-8f3k` |
| Slot habis | `/schedule/demo-penuh-5h2w` |
| Link kedaluwarsa | `/schedule/demo-kedaluwarsa-7q1p` |
| Link sudah dipakai | `/schedule/demo-terpakai-3t6n` |
| Kebijakan privasi | `/privacy` |

Skenario gagal untuk demo: kirim form dengan email `gagal@contoh.test`, atau pilih slot Kamis 10.00–10.45 di halaman jadwal.

## Halaman HRD (perlu login)

Akun demo: `hr@contoh.test` dengan kata sandi `saring-demo`.

| Halaman | URL |
|---|---|
| Login | `/login` |
| Ringkasan | `/dashboard` |
| Lowongan | `/dashboard/jobs` |
| Buat lowongan | `/dashboard/jobs/new` |
| Detail lowongan | `/dashboard/jobs/[id]` |
| Kandidat | `/dashboard/candidates` |
| Detail kandidat | `/dashboard/candidates/[id]` |
| Persetujuan shortlist | `/dashboard/jobs/[id]/approval` |
| Laporan lowongan | `/dashboard/jobs/[id]/report` |
| Jadwal interview | `/dashboard/schedule` |
| Aktivitas agent | `/dashboard/activity` |

## Menyambungkan backend

- Lowongan: ganti isi `listJobs`, `getJob`, `getJobBySlug`, dan `addJob` di `src/lib/job-store.ts`. Sekarang datanya disimpan di memori server dan kembali ke awal saat server restart.
- Pelamar: ganti isi `submitApplication`, `getScheduleInvite`, dan `bookSlot` di `src/lib/applicant-demo.ts`.
- Kandidat dan jadwal HRD: data contoh ada di `src/lib/demo.ts`. Bentuk hasil agent ada di tipe `Candidate`.
- Undangan: ganti isi `sendInvitation` di `src/lib/invitation-demo.ts`.
- Login: `src/lib/demo-auth.ts`, `src/app/login/actions.ts`, dan `src/proxy.ts` masih tiruan (cookie penanda tanpa verifikasi). Wajib diganti autentikasi sungguhan sebelum dipakai dengan data asli.
- Jejak aktivitas dibentuk dari `pipeline` tiap kandidat (`src/lib/agent-log.ts`), jadi backend cukup mengirim langkah agent beserta waktunya (`at`).

Skenario demo: Nadia (skill bertentangan), Dimas (CV scan dan link mati), Citra (teks tersembunyi di CV), Rizky (output LLM diperbaiki), Fajar (email pertama gagal, kirim ulang berhasil), Galih (belum memilih jadwal, pengingat 48 jam terkirim).

Semua profil, skor, jadwal, dan hasil analisis menggunakan data fiktif. Perubahan pada kandidat direset ketika halaman dimuat ulang. File CV tidak dikirim atau dianalisis. API key tidak disimpan atau dikirim. Backend, AI, email, database, dan kalender belum terhubung, dan login masih tiruan.

## Fondasi

Next.js App Router, React, TypeScript, Lucide icons, dan CSS dengan design tokens. Data contoh berada di `src/lib/`; halaman HRD di `src/app/dashboard/`, halaman pelamar di `src/app/(public)/`.

Desain menggunakan panel bubble glass berwarna putih dan abu-abu, border membulat, ikon berlapis, serta transisi halus. Token dan styling berada di `src/app/glass.css`.

Font Inter dimuat dari Google Fonts, dengan fallback lokal jika jaringan tidak tersedia.
