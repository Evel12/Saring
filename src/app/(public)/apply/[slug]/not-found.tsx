import { Link2Off } from "lucide-react";
import { PublicMessage } from "../../public-ui";

export default function ApplyNotFound() {
  return (
    <PublicMessage
      icon={<Link2Off size={22} />}
      tone="sand"
      title="Link lamaran tidak ditemukan"
    >
      <p>
        Periksa kembali link yang kamu terima, atau buka lagi dari pengumuman
        lowongan perusahaan.
      </p>
    </PublicMessage>
  );
}
