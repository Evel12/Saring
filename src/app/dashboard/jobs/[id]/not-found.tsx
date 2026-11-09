import Link from "next/link";
import { Search } from "lucide-react";

export default function JobNotFound() {
  return (
    <section className="panel">
      <div className="empty-state">
        <Search size={25} />
        <h3>Lowongan tidak ditemukan</h3>
        <p>Lowongan ini mungkin sudah dihapus atau link-nya salah.</p>
        <Link className="button secondary" href="/dashboard/jobs">
          Kembali ke lowongan
        </Link>
      </div>
    </section>
  );
}
