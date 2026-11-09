import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listJobs } from "@/lib/job-store";
import { loadCandidates } from "@/lib/load-candidates";
import { serverGet } from "@/lib/server-api";
import type { Me } from "@/lib/session";
import { DashboardProvider } from "./dashboard-context";
import { DashboardShell } from "./dashboard-shell";
import "./dashboard.css";

export const metadata: Metadata = {
  robots: { index: false },
};

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await serverGet<Me>("/auth/me");
  if (!me?.user_id) redirect("/login");
  const jobs = await listJobs();
  const { candidates, interviews } = await loadCandidates(jobs);
  return (
    <DashboardProvider jobs={jobs} candidates={candidates} interviews={interviews}>
      <DashboardShell me={me}>{children}</DashboardShell>
    </DashboardProvider>
  );
}
