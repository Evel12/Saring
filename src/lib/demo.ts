export type Candidate = {
  id: number;
  name: string;
  initials: string;
  color: string;
  role: string;
  email: string;
  score: number;
  status: "Perlu ditinjau" | "Shortlist" | "Interview";
  experience: string;
  skills: string[];
  summary: string;
  evidence: string;
};

export const initialCandidates: Candidate[] = [
  {
    id: 1,
    name: "Nadia Putri",
    initials: "NP",
    color: "peach",
    role: "Frontend Developer",
    email: "nadia@example.com",
    score: 92,
    status: "Perlu ditinjau",
    experience: "2 tahun",
    skills: ["React", "TypeScript", "Tailwind CSS"],
    summary:
      "Pengalaman membangun dashboard dan komponen antarmuka sesuai dengan kebutuhan posisi. Perlu klarifikasi pengalaman pengujian otomatis.",
    evidence:
      "CV, halaman 1: ‘Mengembangkan dashboard operasional menggunakan React dan TypeScript selama 2 tahun.’",
  },
  {
    id: 2,
    name: "Rizky Pratama",
    initials: "RP",
    color: "lavender",
    role: "Frontend Developer",
    email: "rizky@example.com",
    score: 88,
    status: "Shortlist",
    experience: "1,5 tahun",
    skills: ["React", "Next.js", "CSS"],
    summary:
      "Memiliki pengalaman pengembangan aplikasi web dan optimasi performa. Bukti penggunaan TypeScript masih perlu diperjelas saat interview.",
    evidence:
      "CV, halaman 2: ‘Membangun aplikasi pelanggan dengan Next.js dan meningkatkan performa halaman.’",
  },
  {
    id: 3,
    name: "Alya Maharani",
    initials: "AM",
    color: "sage",
    role: "UI/UX Designer",
    email: "alya@example.com",
    score: 95,
    status: "Interview",
    experience: "3 tahun",
    skills: ["Figma", "User Research", "Prototyping"],
    summary:
      "Pengalaman riset pengguna dan perancangan sistem desain relevan dengan kebutuhan tim produk.",
    evidence:
      "CV, halaman 1: ‘Memimpin riset pengguna dan pengembangan design system untuk aplikasi B2B.’",
  },
  {
    id: 4,
    name: "Dimas Saputra",
    initials: "DS",
    color: "sand",
    role: "Backend Developer",
    email: "dimas@example.com",
    score: 85,
    status: "Perlu ditinjau",
    experience: "2 tahun",
    skills: ["Python", "FastAPI", "PostgreSQL"],
    summary:
      "Pengalaman API dan basis data sesuai kriteria inti. Pengalaman deployment dan observabilitas perlu dibahas lebih lanjut.",
    evidence:
      "CV, halaman 1: ‘Membangun REST API dengan Python, FastAPI, dan PostgreSQL.’",
  },
  {
    id: 5,
    name: "Citra Wulandari",
    initials: "CW",
    color: "rose",
    role: "UI/UX Designer",
    email: "citra@example.com",
    score: 82,
    status: "Perlu ditinjau",
    experience: "1 tahun",
    skills: ["Figma", "Wireframing", "Usability Testing"],
    summary:
      "Memiliki dasar desain interaksi dan pengujian kegunaan. Cakupan kontribusi pada proyek tim perlu diklarifikasi.",
    evidence:
      "CV, halaman 2: ‘Melakukan usability testing dan merancang wireframe untuk aplikasi internal.’",
  },
  {
    id: 6,
    name: "Fajar Ramadhan",
    initials: "FR",
    color: "blue",
    role: "Backend Developer",
    email: "fajar@example.com",
    score: 89,
    status: "Shortlist",
    experience: "2,5 tahun",
    skills: ["Python", "Docker", "PostgreSQL"],
    summary:
      "Pengalaman backend dan pengelolaan aplikasi relevan. Perlu pembahasan strategi penanganan kegagalan layanan.",
    evidence:
      "CV, halaman 1: ‘Mengelola layanan backend dan deployment menggunakan Docker.’",
  },
];

export type Job = {
  id: number;
  title: string;
  department: string;
  count: number;
  type: string;
  color: string;
};
export const initialJobs: Job[] = [
  {
    id: 1,
    title: "Frontend Developer",
    department: "Engineering",
    count: 24,
    type: "Full-time",
    color: "sage",
  },
  {
    id: 2,
    title: "UI/UX Designer",
    department: "Design",
    count: 18,
    type: "Full-time",
    color: "lavender",
  },
  {
    id: 3,
    title: "Backend Developer",
    department: "Engineering",
    count: 16,
    type: "Full-time",
    color: "peach",
  },
];

export const interviews = [
  {
    time: "09.00",
    end: "09.45",
    name: "Alya Maharani",
    role: "UI/UX Designer",
    type: "Portfolio review",
    initials: "AM",
    color: "sage",
  },
  {
    time: "11.00",
    end: "11.45",
    name: "Bagas Aditya",
    role: "Frontend Developer",
    type: "Technical interview",
    initials: "BA",
    color: "lavender",
  },
  {
    time: "14.00",
    end: "14.30",
    name: "Sarah Amalia",
    role: "Backend Developer",
    type: "HR interview",
    initials: "SA",
    color: "peach",
  },
];
