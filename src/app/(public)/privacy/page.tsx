import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kebijakan privasi pelamar — Saring",
};

const sections = [
  {
    title: "Data yang kami proses",
    items: [
      "Nama, email, file CV, jawaban pertanyaan lamaran, dan link portofolio yang kamu isi.",
      "Jadwal interview yang kamu pilih, jika kamu diundang.",
    ],
  },
  {
    title: "Cara data dipakai",
    items: [
      "CV dibaca oleh AI agent untuk mencari bukti skill dan pengalaman yang diminta lowongan.",
      "Sebelum dikirim ke penyedia model AI, nama, kontak, alamat, foto, agama, tanggal lahir, status pernikahan, dan jenis kelamin disaring.",
      "AI tidak pernah menolak atau memilih pelamar. Semua keputusan diambil oleh tim HR.",
    ],
  },
  {
    title: "Pemeriksaan link",
    items: [
      "Agent hanya membuka link yang tertulis di CV atau form-mu, misalnya profil GitHub lewat API resminya.",
      "Kami tidak mencari informasi tentangmu di internet dan tidak mengambil isi LinkedIn.",
      "Hasil pemeriksaan link tidak memengaruhi nilaimu.",
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
