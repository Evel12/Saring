import type { Metadata } from "next";

export const metadata: Metadata = { title: "Jadwal interview" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
