import { Link2Off } from "lucide-react";
import { PublicMessage } from "../../public-ui";

export default function ScheduleNotFound() {
  return (
    <PublicMessage
      icon={<Link2Off size={22} />}
      tone="sand"
      title="Link jadwal tidak ditemukan"
    >
      <p>
        Pastikan kamu membuka link lengkap dari email undangan. Kalau masih
        bermasalah, hubungi tim HR yang mengirim undangan.
      </p>
    </PublicMessage>
  );
}
