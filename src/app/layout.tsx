import type { Metadata } from "next";
import "./glass.css";

export const metadata: Metadata = {
  title: "Saring — Ruang kerja rekrutmen",
  description:
    "Ruang kerja HR untuk meninjau kandidat, memahami bukti, dan menemukan talenta terbaik.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
