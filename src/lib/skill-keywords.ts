// Pencocokan kata kunci skill lintas bahasa (Indonesia <-> Inggris).
// "Empati" pun harus mendeteksi "empathy" di CV berbahasa Inggris, dan sebaliknya.

// Kelompok kata yang saling setara: kriteria berbahasa Indonesia menemukan
// baris CV berbahasa Inggris dan sebaliknya. Bila semua kata di kelompok
// cocok di CV, semua dianggap menandai kriteria tersebut.
const GROUPS: string[][] = [
  ["empati", "empathy", "empathetic", "empathic"],
  ["komunikasi", "communication", "communicate", "communicating", "communicator"],
  ["kepemimpinan", "memimpin", "mengepalai", "leadership", "lead", "leading", "led"],
  ["kerjasama", "kerja sama", "kolaborasi", "teamwork", "collaboration", "collaborate", "collaborative"],
  ["tim", "team"],
  ["pelanggan", "klien", "customer", "customer service", "client", "clients"],
  ["pelayanan", "layanan", "melayani", "service", "support"],
  ["penjualan", "berjualan", "sales", "selling"],
  ["pemasaran", "marketing"],
  ["keuangan", "finance", "financial", "financing"],
  ["akuntansi", "accounting", "accountant"],
  ["analisis", "analisa", "analysis", "analytics", "analytical", "analyze", "analysing"],
  ["laporan", "pelaporan", "melapor", "report", "reports", "reporting"],
  ["desain", "design", "designing", "designed"],
  ["pengujian", "testing", "test", "qa", "verification"],
  ["keamanan", "safety", "security"],
  ["jaringan", "network", "networking"],
  ["manajemen", "mengelola", "pengelolaan", "management", "manage", "managing", "managed"],
  ["negosiasi", "bernegosiasi", "negotiation", "negotiating"],
  ["presentasi", "bepresentasi", "presentation", "presenting", "presented", "public speaking"],
  ["administrasi", "administration", "administrative", "admin"],
  ["ketelitian", "teliti", "detail", "detail-oriented", "accuracy", "accurate", "accurately"],
  ["pemecahan masalah", "problem solving", "problem-solving", "troubleshooting", "troubleshoot", "resolve", "masalah"],
  ["pemrograman", "programming", "coding", "developer"],
  ["perencanaan", "merencanakan", "planning", "plan", "planned"],
  ["bahasa inggris", "english"],
  ["adaptasi", "adaptability", "adaptable", "adapt"],
  ["kreatif", "kreativitas", "creative", "creativity"],
  ["database", "basis data", "databases", "db"],
  ["otomasi", "otomatisasi", "automation", "automate", "automated"],
  ["organisasi", "organization", "organisation"],
  ["keputusan", "decision", "decision making", "decision-making", "decisions"],
  ["fasilitasi", "facilitation", "facilitate", "facilitator"],
  ["data entry", "input data"],
  ["kebersihan", "cleanliness", "cleaning", "clean"],
  ["sosialisasi", "socialization", "socialising", "socializing"],
  ["kejujuran", "integritas"],
  ["eksibisi", "exhibition", "exhibitions"],
];

// Kata layanan/huristic umum di kalimat kriteria yang tidak boleh mengaburkan.
const STOPWORDS = new Set([
  "pengalaman", "nyata", "berkaitan", "kemampuan", "skill", "skills",
  "experience", "relevant", "real", "ability", "bisa", "dapat",
  "and", "with", "the", "for", "into",
  "dan", "atau", "yang", "para", "dalam", "terutama", "terhadap",
  "pada", "kepada", "untuk", "serta", "sehingga", "bila", "jika",
  "satu", "satu-", "hal", "kandidat", "pelamar", "apa", "bagaimana",
]);

const TOKEN = /[a-z][a-z0-9-]+/g;
const norm = (word: string) => word.toLowerCase().replace(/[^a-z0-9 -]+/g, "").trim();

// Kata -> seluruh kelompok yang memuat kata itu.
const MAP = new Map<string, Set<string>>();
for (const group of GROUPS) {
  for (const word of group) {
    const key = norm(word);
    if (!key) continue;
    let entry = MAP.get(key);
    if (!entry) MAP.set(key, (entry = new Set()));
    for (const other of group) entry.add(other);
  }
}

/**
 * Peluas kata kunci: dari satu kriteria ("Empati terutama pada pelanggan")
 * jadi daftar istilah dua-dua bahasa yang bisa disorot / dicocokkan di CV.
 */
export function expandSkill(description: string): string[] {
  const words = (description.toLowerCase().match(TOKEN) ?? []).filter(
    (word) => word.length >= 3 && !STOPWORDS.has(word),
  );
  const terms = new Set<string>();
  for (const word of words) {
    terms.add(word);
    for (const synonym of MAP.get(norm(word)) ?? []) terms.add(synonym);
  }
  // Frasa dua kata ("problem solving", "customer service") dicek sebagai teks.
  for (const group of GROUPS) {
    for (const synonym of group) {
      if (!synonym.includes(" ")) continue;
      if (words.some((word) => synonym.includes(word))) terms.add(synonym);
    }
  }
  return [...terms];
}

/** Apakah teks CV memuat salah satu istilah (pencarian teks biasa). */
export function mentionsAny(text: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}
