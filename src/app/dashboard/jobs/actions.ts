"use server";

import { revalidatePath } from "next/cache";
import { validateJobInput, type JobInput, type JobInputErrors } from "@/lib/job-input";
import { addJob } from "@/lib/job-store";

export type CreateJobResult =
  | { ok: true; id: string }
  | { ok: false; errors: JobInputErrors };

export async function createJob(input: JobInput): Promise<CreateJobResult> {
  const errors = validateJobInput(input);
  if (Object.keys(errors).length) return { ok: false, errors };
  const job = await addJob(input);
  revalidatePath("/dashboard", "layout");
  return { ok: true, id: job.id };
}
