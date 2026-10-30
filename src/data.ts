import { all, request } from "./api";
import type {
  Application,
  Brief,
  Candidate,
  Document,
  Round,
  Interview,
  Snapshot,
  CriterionInput,
  Job,
  Outbox,
} from "./types";
export const blankCriterion = (): CriterionInput => ({
  description: "",
  importance: "essential",
  acceptable_evidence_types: ["candidate_report", "document"],
  minimum_observable_expectation: "",
  clarification_permitted: true,
});
export const templates: Record<
  string,
  { description: string; requirements: CriterionInput[] }
> = Object.fromEntries(
  [
    [
      "Software Developer",
      "Build, test and maintain software with a collaborative team.",
      ["Software development", "Testing", "Version control"],
    ],
    [
      "Customer Support",
      "Help customers resolve questions and document useful solutions.",
      ["Customer communication", "Issue resolution", "Support documentation"],
    ],
    [
      "Administrative Assistant",
      "Coordinate schedules, documents and day-to-day office operations.",
      ["Scheduling", "Document preparation", "Record management"],
    ],
  ].map(([title, description, names]) => [
    title,
    {
      description,
      requirements: (names as string[]).map((name, i) => ({
        description: name,
        importance: i < 2 ? "essential" : "preferred",
        acceptable_evidence_types: [
          "candidate_report",
          "document",
          "work_sample",
        ],
        minimum_observable_expectation:
          "Describe a relevant example and your own contribution.",
        clarification_permitted: true,
      })),
    },
  ]),
);
export async function snapshot(
  a: Application,
  candidates: Candidate[],
  signal?: AbortSignal,
): Promise<Snapshot> {
  const [brief, documents, rounds, interviews] = await Promise.all([
    request<Brief>("/applications/" + a.id + "/interview-brief", { signal }),
    all<Document>("/applications/" + a.id + "/documents", signal),
    all<Round>("/applications/" + a.id + "/clarification-rounds", signal),
    all<Interview>("/applications/" + a.id + "/interviews", signal),
  ]);
  const extractions = (await Promise.all(documents.map(doc => all<Snapshot["extractions"][number]>("/documents/" + doc.id + "/extractions", signal)))).flat();
  return {
    extractions,
    application: a,
    candidate: candidates.find((c) => c.id === a.candidate_id),
    brief,
    documents,
    rounds,
    interviews,
  };
}
export const STAGES = [
  "Ingest",
  "Filter fields",
  "Collect evidence",
  "Identify gaps",
  "Await clarification",
  "Update findings",
  "Recruiter review",
  "Schedule",
  "Complete",
];
export function stage(row: Snapshot, jobs: Job[] = [], outbox: Outbox[] = []) {
  const a = row.application;
  const job = jobs
    .filter((j) => j.application_id === a.id)
    .sort((x, y) => y.created_at - x.created_at)[0];
  const round = [...row.rounds].sort((x, y) => y.number - x.number)[0];
  const interview = [...row.interviews].sort(
    (x, y) => y.starts_at - x.starts_at,
  )[0];
  const failed = outbox.find(
    (o) =>
      o.application_id === a.id &&
      ["not_configured", "failed"].includes(o.state),
  );
  if (a.reassessment_required)
    return {
      index: 6,
      status: "Needs reassessment",
      next: "Run review for new criteria",
      attention: true,
    };
  if (job?.state === "failed")
    return {
      index: 2,
      status: "Needs attention",
      next: "Retry failed review",
      attention: true,
    };
  if (failed)
    return {
      index: 7,
      status: "Needs attention",
      next:
        failed.state === "not_configured"
          ? "Configure calendar / messaging"
          : "Retry approved action",
      attention: true,
    };
  if (interview && ["booked", "simulated"].includes(interview.state))
    return {
      index: 8,
      status:
        interview.state === "simulated"
          ? "Demo interview recorded"
          : "Interview booked",
      next: "Prepare for interview",
      attention: false,
    };
  if (interview || a.decision === "shortlist")
    return {
      index: 7,
      status:
        interview?.state === "proposed"
          ? "Interview approval needed"
          : "Ready to coordinate",
      next:
        interview?.state === "proposed"
          ? "Review interview slot"
          : "Coordinate interview",
      attention: false,
    };
  if (job && ["running", "queued"].includes(job.state))
    return {
      index: 0,
      status:
        job.state === "running" ? "Review in progress" : "Queued for review",
      next: "Wait for persisted results",
      attention: false,
    };
  if (round?.state === "approved")
    return {
      index: 4,
      status: a.review_state === "pending_delivery" ? "Invitation pending" : "Awaiting candidate response",
      next: "Check persisted clarification / delivery status",
      attention: false,
    };
    if (round?.state === "draft")
      return {index: 3, status: "Clarification approval needed", next: "Approve or revise questions", attention: false};
  if (a.review_state === "updating_findings") return {index: 5, status: "Updating evidence", next: "Submission queued the worker automatically", attention: false};
  if (a.decision === "reject" || a.decision === "hire")
    return {
      index: 8,
      status: "Human decision recorded",
      next: "No notification sent automatically",
      attention: false,
    };
  if (row.brief.findings.length)
    return {
      index: 6,
      status: "Recruiter review",
      next: "Review evidence and decide",
      attention: false,
    };
  return {
    index: 0,
    status: "Not started",
    next: "Run evidence review",
    attention: false,
  };
}
export function coverage(row: Snapshot) {
  return row.brief.requirements.filter(
    (r) =>
      row.brief.findings.find((f) => f.requirement_id === r.id)?.latest_revision
        ?.evidence_ids.length,
  ).length;
}
