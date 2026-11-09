"""Demo data for testing/pitching: 3 vacancies, 9 fictional applicants with CVs.

Run on an EMPTY database (reset first, see README / chat):
    .venv\\Scripts\\python.exe -m backend.seed
No AI review is queued: HR starts it with "Jalankan analisis AI".
"""
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from sqlalchemy import select
from backend.db import Session
from backend import auth, cli, models as m, schemas as d, services as svc

EMAIL, PASSWORD, ORG = "saring@gmail.com", "saring123456", "PT Nusantara Digital"
CVS = Path(__file__).parent / "seed_data" / "cvs"
QUESTION = "Ceritakan singkat kenapa kamu tertarik dengan posisi ini."
WIB = timezone(timedelta(hours=7))


def skill(name, importance):
    return d.RequirementInput(
        description=name, importance=importance,
        acceptable_evidence_types=["candidate_report", "document", "work_sample"],
        minimum_observable_expectation=f"Pengalaman nyata dengan {name}: proyek atau pekerjaan dan kontribusi pribadi pelamar.",
    )


def slots(day_offset):
    day = (datetime.now(WIB) + timedelta(days=day_offset)).date()
    return [
        d.SlotInput(starts_at=datetime(day.year, day.month, day.day, h, 0, tzinfo=WIB).timestamp(),
                    ends_at=datetime(day.year, day.month, day.day, h, 45, tzinfo=WIB).timestamp())
        for h in (9, 11, 14)
    ]


JOBS = [
    dict(title="Backend Engineer", department="Engineering", employment_type="Full-time", location="Jakarta · Hybrid",
         description="Membangun dan merawat REST API serta layanan backend untuk produk internal. Bertanggung jawab atas desain database, performa query, dan deployment layanan dengan container.",
         required=["Python", "FastAPI", "PostgreSQL", "REST API"], preferred=["Docker", "Redis"], day=2,
         applicants=[("Rina Kusuma", "rina_kusuma.pdf", "Saya suka membangun API yang cepat dan rapi."),
                     ("Dimas Prakoso", "dimas_prakoso.pdf", "Ingin belajar backend lebih dalam di tim yang besar."),
                     ("Bagus Hartono", "bagus_hartono.pdf", "Sudah 3 tahun di backend pembayaran, ingin tantangan baru."),
                     ("Ayu Lestari", "ayu_lestari.pdf", "Ingin pindah karier ke dunia teknologi.")]),
    dict(title="Frontend Engineer", department="Engineering", employment_type="Full-time", location="Remote · Indonesia",
         description="Membangun antarmuka web yang cepat dan mudah dipakai bersama tim produk dan desain, dari komponen dasar sampai halaman dashboard.",
         required=["React", "TypeScript", "Next.js", "CSS"], preferred=["Figma", "Testing"], day=3,
         applicants=[("Nadia Putri", "nadia_putri.pdf", "Saya senang membuat UI yang rapi dan aksesibel."),
                     ("Fajar Ramadhan", "fajar_ramadhan.pdf", "Ingin naik level dari landing page ke aplikasi besar."),
                     ("Kevin Wijaya", "kevin_wijaya.pdf", "Ingin mencoba frontend setelah lama di backend Java.")]),
    dict(title="Data Analyst", department="Operations", employment_type="Contract", location="Jakarta",
         description="Mengolah data penjualan dan operasional menjadi laporan serta dashboard yang membantu manajemen mengambil keputusan.",
         required=["SQL", "Python", "Excel", "Dashboard"], preferred=["Power BI"], day=4,
         applicants=[("Citra Wulandari", "citra_wulandari.pdf", "Data membantu toko mengambil keputusan yang lebih baik."),
                     ("Lucía Fernández", "lucia_fernandez.pdf", "Me interesa trabajar con datos en Indonesia.")]),
]


def main():
    with Session() as s:
        if s.scalar(select(m.Vacancy.id).limit(1)):
            raise SystemExit("Database is not empty. Reset it first (delete saring.db and storage).")
        user = s.scalar(select(m.User).where(m.User.email == EMAIL))
        if user:
            member = s.scalar(select(m.Membership).where(m.Membership.user_id == user.id))
            org_id = member.org_id
        else:
            org, user = cli.create_admin(s, ORG, EMAIL, PASSWORD)
            org_id = org.id
        p = auth.Principal(org_id, user.id, "admin", "seed")
        for job in JOBS:
            v = svc.create_vacancy(s, p, d.VacancyInput(
                title=job["title"], description=job["description"], department=job["department"],
                employment_type=job["employment_type"], location=job["location"],
                requirements=[skill(x, "essential") for x in job["required"]] + [skill(x, "preferred") for x in job["preferred"]],
                slots=slots(job["day"])))
            version = s.scalar(select(m.RequirementVersion).where(m.RequirementVersion.vacancy_id == v.id))
            svc.approve_version(s, p, version.id, "Disetujui HR saat membuat lowongan.")
            svc.change_vacancy(s, p, v, d.VacancyPatch(state="published"))
            v.apply_token = secrets.token_urlsafe(24)
            v.intro_questions = [QUESTION]
            s.flush()
            for name, cv, answer in job["applicants"]:
                c = m.Candidate(org_id=org_id, display_name=name,
                                email=name.split()[0].lower().replace("í", "i") + "@example.com")
                s.add(c)
                s.flush()
                a = m.Application(org_id=org_id, candidate_id=c.id, vacancy_id=v.id,
                                  requirement_version_id=v.active_requirement_version_id)
                a.intro_answers = {QUESTION: answer}
                s.add(a)
                s.flush()
                svc.store_upload(s, p, a, (CVS / cv).read_bytes(), "CV_" + cv, "application/pdf")
                svc.event(s, p, "application.applied", "Demo applicant created by the seed script.", v.id, a.id)
            s.commit()
            print(f"{job['title']}: {len(job['applicants'])} pelamar")
    print(f"Done. Login: {EMAIL} / {PASSWORD}")


if __name__ == "__main__":
    main()
