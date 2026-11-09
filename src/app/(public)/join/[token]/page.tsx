import type { Metadata } from "next";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Gabung ke tim — Saring",
  robots: { index: false },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <JoinForm token={decodeURIComponent(token)} />;
}
