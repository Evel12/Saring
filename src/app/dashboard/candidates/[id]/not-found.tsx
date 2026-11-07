import Link from "next/link";
import { Search } from "lucide-react";

export default function CandidateNotFound() {
  return (
    <section className="panel">
      <div className="empty-state">
        <Search size={25} />
        <h3>Kandidat tidak ditemukan</h3>
        <p>Data lamaran ini mungkin sudah dihapus atau link-nya salah.</p>
        <Link className="button secondary" href="/dashboard/candidates">
          Kembali ke kandidat
        </Link>
      </div>
    </section>
  );
}
