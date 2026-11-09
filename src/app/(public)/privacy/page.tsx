import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kebijakan privasi pelamar — Saring",
};

const sections = [
  {
    title: "Data yang kami proses",
    items: [
      "Nama, email, file CV, dan link GitHub atau portofolio yang kamu isi di form.",
      "Waktu kamu memberi persetujuan dan jadwal interview yang kamu pilih.",
    ],
  },
  {
    title: "Cara data dipakai",
    items: [
      "CV dibaca oleh AI agent untuk menilai kecocokan skill dan pengalamanmu dengan lowongan.",
      "Foto, agama, tanggal lahir atau usia, status pernikahan, dan jenis kelamin disembunyikan sebelum penilaian.",
      "Hasil penilaian ditinjau oleh tim HR. Email hanya dikirim setelah disetujui tim HR.",
    ],
  },
  {
    title: "Pemeriksaan link",
    items: [
      "Kami hanya memeriksa link yang kamu berikan sendiri.",
      "Kami tidak mencari informasi tentangmu di internet.",
      "Link yang kosong atau bermasalah tidak mengurangi nilaimu.",
    ],
  },
  {
    title: "Penyimpanan dan hak kamu",
    items: [
      "File CV tidak dibuka untuk publik dan hanya bisa diakses tim HR perusahaan yang kamu lamar.",
      "Data disimpan dan dihapus sesuai kebijakan retensi perusahaan tersebut.",
      "Kamu bisa meminta data lamaranmu dihapus dengan menghubungi tim HR perusahaan tersebut, sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <div className="page-heading public-heading">
        <div>
          <h1>Kebijakan privasi pelamar</h1>
          <p>Ringkasan cara Saring memperlakukan data lamaranmu.</p>
        </div>
      </div>
      <div className="public-privacy">
        {sections.map((section) => (
          <section className="panel public-card" key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
