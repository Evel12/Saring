import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { initialCandidates } from "@/lib/demo";
import { CandidateDetail } from "./candidate-detail";

type Props = { params: Promise<{ id: string }> };

const findCandidate = (id: string) =>
  initialCandidates.find((candidate) => String(candidate.id) === id);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${findCandidate(id)?.name ?? "Kandidat"} — Saring` };
}

export default async function CandidatePage({ params }: Props) {
  const { id } = await params;
  const candidate = findCandidate(id);
  if (!candidate) notFound();
  return <CandidateDetail id={candidate.id} />;
}
