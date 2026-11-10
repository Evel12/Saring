import type { Metadata } from "next";
import { INTRO_SCRIPT } from "@/lib/intro";
import "./glass.css";

export const metadata: Metadata = {
  title: "Saring",
  description:
    "Ruang kerja HR untuk meninjau kandidat, memahami bukti, dan menemukan talenta terbaik.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Kelas "intro" dipasang skrip di <head> sebelum React aktif.
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
