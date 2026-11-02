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
- Profil kandidat dengan bukti dan persetujuan shortlist.
- Form lowongan dan antrean dokumen untuk sesi browser.
- Pengaturan penyedia/model AI sebagai prototipe UI.
- Responsive layout, keyboard focus, native modal dialogs, dan reduced motion.

Semua profil, skor, jadwal, dan hasil analisis menggunakan data fiktif. Perubahan tersimpan dalam memori selama halaman terbuka dan akan direset ketika dimuat ulang. File CV tidak dikirim atau dianalisis. API key tidak disimpan atau dikirim. Backend, AI, autentikasi, email, database, dan kalender belum terhubung.

## Fondasi

Next.js App Router, React, TypeScript, Lucide icons, dan CSS dengan design tokens. Data contoh berada di `src/lib/demo.ts`; UI awal berada di `src/app/page.tsx`.

Desain menggunakan panel bubble glass berwarna putih dan abu-abu, border membulat, ikon berlapis, serta transisi halus. Token dan styling berada di `src/app/glass.css`.

Font Inter dimuat dari Google Fonts, dengan fallback lokal jika jaringan tidak tersedia.
