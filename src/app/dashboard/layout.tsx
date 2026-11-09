import type { Metadata } from "next";
import { listJobs } from "@/lib/job-store";
import { DashboardProvider } from "./dashboard-context";
import { DashboardShell } from "./dashboard-shell";
import "./dashboard.css";

export const metadata: Metadata = {
  robots: { index: false },
};

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const jobs = await listJobs();
  return (
    <DashboardProvider jobs={jobs}>
      <DashboardShell>{children}</DashboardShell>
    </DashboardProvider>
  );
}
