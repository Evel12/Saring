import { InterviewCoordination } from "./InterviewCoordination";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  FileText,
  History,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { all, download, post, request } from "./api";
import { useLoad, useEvents, navigate } from "./hooks";
import { snapshot, stage } from "./data";
import {
  useApp,
  ActivityPanel,
  ProgressPanel,
  Badge,
  Confirm,
  Empty,
  Failed,
  Loading,
  Modal,
  PageHeading,
  Panel,
  Tabs,
  time,
  words,
} from "./ui";
import type {
  Application,
  BriefDraft,
  Candidate,
  Correction,
  Criterion,
  Finding,
  FindingState,
  Interview,
  Revision,
  Round,
  Snapshot,
  Question,
  Permissions,
  Outbox,
  EvidenceSuggestion,
} from "./types";

export async function loadCandidate(id: string, signal?: AbortSignal) {
  const application = await request<Application>("/applications/" + id, {
    signal,
  });
  const candidates = await all<Candidate>("/candidates", signal);
  return snapshot(application, candidates, signal);
}
export function CandidateDetail({
  id,
  initialTab = "Overview",
}: {
  id: string;
  initialTab?: string;
}) {
  const { revision, refresh } = useApp();
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const q = useLoad((signal) => loadCandidate(id, signal), [id, revision]);
  const feed = useEvents({ application_id: id }, refresh);
  if (q.loading && !q.data)
    return <Loading label="Loading application and source evidence…" />;
  if (q.error)
    return (
      <div className="wide-page">
        <Failed error={q.error} retry={q.reload} />
      </div>
    );
  if (!q.data) return null;
  const row = q.data;
  return (
    <>
      <PageHeading
        title={row.candidate?.display_name || "Applicant " + id.slice(0, 8)}
        back={"#/vacancies/" + row.application.vacancy_id}
        description={
          row.brief.vacancy_title + " · application " + id.slice(0, 8)
        }
        actions={
          <Badge tone={row.application.reassessment_required ? "amber" : ""}>
            {row.application.reassessment_required
              ? "Reassessment required"
              : words(row.application.review_state)}
          </Badge>
        }
      />
      <div className="detail-layout">
        <Panel
          title="Application workspace"
        >
          <Tabs
            tabs={[
              "Overview",
              "Findings",
              "Evidence",
              "Clarification",
              "Interview",
              "History",
            ]}
            value={tab}
            change={(t) => {
              setTab(t);
              navigate("/applications/" + id + "?tab=" + t);
            }}
          />
          <div className="tab-content" role="tabpanel" aria-label={tab}>
            {tab === "Overview" && <Overview row={row} />}{" "}
            {tab === "Findings" && <FindingsPane row={row} />}{" "}
            {tab === "Evidence" && <EvidencePane row={row} />}{" "}
            {tab === "Clarification" && <ClarificationPane row={row} />}{" "}
            {tab === "Interview" && <InterviewPane row={row} />}{" "}
            {tab === "History" && (
              <>
                <h3>Persisted application history</h3>
                <p className="hint">
                  Events are recorded by the server. Finding revisions are
                  available in the Evidence tab.
                </p>
                <ol className="history-list">
                  {feed.events.map((e) => (
                    <li key={e.id}>
                      <span className="mono tiny">{time(e.created_at)}</span>
                      <b>{words(e.kind)}</b>
                      <p>{e.message}</p>
                    </li>
                  ))}
                </ol>
                {!feed.events.length && (
                  <Empty title="No history recorded yet" />
                )}
              </>
            )}
          </div>
        </Panel>
        <aside>
          <Panel title="Recruiter checklist">
            <div className="panel-body">
              <h3>
                {row.application.reassessment_required
                  ? "Review the new criteria"
                  : "Keep the source in view"}
              </h3>
              <ul className="checklist">
                <li>Read exact passages and their limitations.</li>
                <li>Distinguish self-report from an observed artifact.</li>
                <li>Use unknowns to guide factual questions.</li>
                <li>Make and record your own decision.</li>
              </ul>
              <a
                className="text-button"
                href={"#/review/" + row.application.vacancy_id}
              >
                Compare applicants <ArrowRight size={13} />
              </a>
            </div>
          </Panel>
          <ProgressPanel feed={feed} />
          <ActivityPanel feed={feed} />
        </aside>
      </div>
    </>
  );
}

function Overview({ row }: { row: Snapshot }) {
  const { perform, busy, revision, org } = useApp();
  const [newDocument, setNewDocument] = useState<File>();
  const [decision, setDecision] = useState(row.application.decision);
  const [rationale, setRationale] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [excludeDoc, setExcludeDoc] = useState<string>();
  const [exclusionReason, setExclusionReason] = useState("");
  const [replacement, setReplacement] = useState("support");
  const q = useLoad(
    async (signal) => ({
      corrections: await all<Correction>(
        "/applications/" + row.application.id + "/profile-corrections",
        signal,
      ),
      permissions: await all<Permissions & { created_at: number }>(
        "/applications/" + row.application.id + "/source-permissions",
        signal,
      ),
    }),
    [row.application.id, revision],
  );
  return (
    <>
      <div className="overview-grid">
        <div>
          <span className="field-label">Current criteria version</span>
          <p className="mono">{row.brief.requirements[0]?.version || "—"}</p>
        </div>
        <div>
          <span className="field-label">Recruiter decision</span>
          <p>
            <Badge>{words(row.application.decision)}</Badge>
          </p>
        </div>
        <div>
          <span className="field-label">Evidence items</span>
          <p className="mono">{row.brief.evidence.length}</p>
        </div>
        <div>
          <span className="field-label">Clarification rounds</span>
          <p className="mono">{row.rounds.length} / 2</p>
        </div>
      </div>
      <div className="notice">
        <ShieldCheck size={18} />
        <div>
          <b>No automatic selection decision</b>
          <p>
            Coverage describes evidence completeness. Missing or private sources
            are not evidence of inability.
          </p>
        </div>
      </div>

      {Object.entries(row.brief.intro_answers || {}).length > 0 && (
        <section className="round-card" aria-label="Apply form answers">
          <div className="label-row">
            <h3>Intro answers</h3>
            <Badge>self-declared via apply link</Badge>
          </div>
          <p className="hint" style={{ margin: "4px 0 8px" }}>
            The applicant's own words from the public apply form, shown
            verbatim. Answers are contact-level input, not verified evidence.
          </p>
          <ul className="detail-chips" style={{ gridAutoFlow: "row", gap: 8 }}>
            {Object.entries(row.brief.intro_answers || {}).map(([question, answer]) => (
              <li key={question}>
                <span className="hint" style={{ fontWeight: 600 }}>{question}</span>
                <span>{answer as string}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h3>Documents</h3>
      {row.extractions.map(ex => <details key={ex.id} className="notice">
        <summary>Extraction revision {ex.version} · {ex.engine}{ex.passages.some(p => p.quality === "uncertain") ? " · Needs source correction" : ""}</summary>
        <p>{ex.limitations}</p>
        <ul>{ex.passages.map((p, i) => <li key={i}>{p.page ? `Page ${p.page}` : p.paragraph ? `Paragraph ${p.paragraph}` : "Source without locator"} · {p.method || "cv"} · {p.quality || "unverified"}{p.ocr_confidence != null ? ` · OCR confidence ${Math.round(p.ocr_confidence)} (not a factual accuracy score)` : ""}</li>)}</ul>
        <p>Review the original. Upload a corrected accessible document below, or request factual clarification, then run the agent with re-extraction. Earlier sources remain in history.</p>
      </details>)}
      {row.documents.length ? (
        <ul className="document-list">
          {row.documents.map((doc) => (
            <li key={doc.id}>
              <FileText size={15} />
              <span>
                {doc.original_name}
                <small>
                  {`${Math.ceil(doc.size_bytes / 1024)} KB · private`}
                </small>
                {doc.excluded_at && <small>Excluded from processing · {doc.exclusion_reason}</small>}
              </span>
              <button
                className="secondary"
                onClick={() =>
                  perform(() => download(doc.id, doc.original_name))
                }
              >
                Download source
              </button>
              {!doc.excluded_at && <button className="secondary" onClick={()=>{setExcludeDoc(doc.id);setExclusionReason("");}}>Exclude unreadable source</button>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No documents attached.</p>
      )}
      <button className="secondary" disabled={busy||Boolean(row.application.withdrawn_at)} onClick={()=>perform(()=>post("/workflow-runs",{vacancy_id:row.application.vacancy_id,reextract_documents:true}),"Source reanalysis queued. Historical records remain available.")}>Reanalyze sources</button>
      {excludeDoc && <Confirm title="Exclude this original from future processing?" description={<><p>The original and earlier evidence remain in history. New analysis is required before another decision.</p><label>Source exclusion reason<input minLength={5} maxLength={500} value={exclusionReason} onChange={e=>setExclusionReason(e.target.value)}/></label></>} label="Confirm source exclusion" close={()=>setExcludeDoc(undefined)} confirm={()=>perform(async()=>{if(exclusionReason.trim().length<5)throw new Error("Give a source-related reason of at least five characters.");await post("/documents/"+excludeDoc+"/exclude",{reason:exclusionReason});setExcludeDoc(undefined);},"Source excluded. Add a replacement and reanalyze.")}/>}
      <form
          className="additional-upload"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newDocument) return;
            perform(async () => {
              const body = new FormData();
              body.append("file", newDocument);
              await post(
                "/applications/" + row.application.id + "/documents",
                body,
              );
              setNewDocument(undefined);
            }, "Private source saved. Run the vacancy agent to associate its evidence.");
          }}
        >
          <label>
            Add or retry a source document
            <input
              type="file"
              accept=".pdf,.docx"
              required
              onChange={(e) => setNewDocument(e.target.files?.[0])}
            />
          </label>
          <button
            className="secondary"
            disabled={
              busy || !newDocument || newDocument.size > 5 * 1024 * 1024
            }
          >
            Upload to this application
          </button>
          {newDocument && newDocument.size > 5 * 1024 * 1024 && (
            <p className="inline-validation">Maximum document size is 5 MB.</p>
          )}
        </form>
      {q.error && <Failed error={q.error} retry={q.reload} />}{" "}
      {q.data?.corrections
        .filter((c) => c.state === "pending")
        .map((c) => (
          <div className="approval" key={c.id}>
            <div>
              <h3>Candidate requested a factual correction</h3>
              <p>
                {c.display_name} · {c.email || "No email supplied"}
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  perform(
                    () =>
                      post("/profile-corrections/" + c.id + "/approve", {
                        rationale:
                          "Recruiter reviewed factual identity correction.",
                      }),
                    "Profile correction approved.",
                  )
                }
              >
                Approve factual correction
              </button>
            </div>
          </div>
        ))}
      {q.data && (
        <details className="source-details">
          <summary>Candidate source permissions</summary>
          {q.data.permissions.length ? (
            <>
              <p className="hint">
                Latest candidate choice, saved{" "}
                {time(q.data.permissions.at(-1)!.created_at)}. Permission does
                not verify a source or grant additional application access.
              </p>
              <div className="tags">
                {Object.entries(q.data.permissions.at(-1)!)
                  .filter(([k]) =>
                    ["public_links", "work_samples", "followup"].includes(k),
                  )
                  .map(([key, val]) => (
                    <Badge key={key} tone={val ? "green" : ""}>
                      {words(key)}: {val ? "permitted" : "not permitted"}
                    </Badge>
                  ))}
              </div>
            </>
          ) : (
            <p>No optional source permissions have been recorded.</p>
          )}
        </details>
      )}
      <div className="decision-box">
        <h3>Record a recruiter decision</h3>
        <p className="hint">
          This records your judgment and rationale. No candidate message is
          sent.
        </p>
        <label>
          Decision
          <select
            aria-label="Decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            <option value="undecided">Undecided</option>
            <option value="shortlist">Shortlist</option>
            <option value="reject">Reject</option>
            <option value="request_more_information">Request more information</option>
            <option value="hire">Hire</option>
          </select>
        </label>
        <label>
          Job-related rationale
          <textarea
            aria-label="Job-related rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            maxLength={2000}
            placeholder="Explain your decision using the approved criteria and source evidence."
          />
        </label>
        {row.application.reassessment_required && (
          <p className="inline-validation">
            Run reassessment against the newly approved criteria before making a
            new decision.
          </p>
        )}
        <button
          className="primary"
          disabled={
            busy || !rationale.trim() || row.application.reassessment_required
          }
          onClick={() => setConfirm(true)}
        >
          Review decision <ChevronRight size={14} />
        </button>
      </div>
      {confirm && (
        <Confirm
          title="Record this human decision?"
          description={
            <>
              <p>
                <b>{words(decision)}</b> for {row.candidate?.display_name}.
              </p>
              <p>{rationale}</p>
              <p>No email or calendar action is authorized by this decision.</p>
            </>
          }
          label="Record decision"
          close={() => setConfirm(false)}
          confirm={() =>
            perform(async () => {
              await post("/applications/" + row.application.id + "/decisions", {
                decision,
                rationale,
              });
              setConfirm(false);
              setRationale("");
            }, "Recruiter decision recorded.")
          }
        />
      )}
    </>
  );
}

type InsightLink = {
  id: string;
  url: string;
  created_at: number;
  state?: string;
  title?: string;
  message?: string;
  status_code?: number | null;
  subject?: string;
  review?: string;
  primary_language?: string;
  languages?: string;
  public_repositories?: number | null;
  last_public_commit_utc?: string;
  fork?: boolean;
};
type Insights = {
  application_id: string;
  summary?: string | null;
  strengths: { id: string; text: string; created_at: number }[];
  relevant_details: { id: string; text: string; created_at: number }[];
  links: InsightLink[];
};

export function FindingsPane({ row }: { row: Snapshot }) {
  const { revision, perform, busy } = useApp();
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const q = useLoad(
    (signal) =>
      request<Insights>(
        "/applications/" + row.application.id + "/insights",
        { signal },
      ),
    [row.application.id, revision],
  );
  if (q.loading && !q.data) return <Loading label="Loading AI findings…" />;
  if (q.error) return <Failed error={q.error} retry={q.reload} />;
  if (!q.data) return null;
  const data = q.data;
  const empty =
    !data.summary &&
    !data.strengths.length &&
    !data.relevant_details.length &&
    !data.links.length;
  return (
    <>
      <p className="hint">
        What the AI found during the last agent review. Strengths and details
        are exact quotes from the linked source evidence. Link checks are
        neutral reachability observations, never a judgment about the
        candidate. You still make the decision.
      </p>
      <details className="round-card explainer" aria-label="How evidence categories work">
        <summary><b>How evidence works</b></summary>
        <ul>
          <li>
            <b>Extracted CV lines</b> — the agent converts each linked document
            into short passages and keeps only labelled professional lines.
            Every one is stored as <i>candidate-reported</i>: the source is what
            the candidate submitted, and the exact quote is kept with its
            page/paragraph reference.
          </li>
          <li>
            <b>Link checks</b> — links written in the CV are opened and recorded
            as reachability states only: <i>observed</i> (page reached and
            described), <i>manual</i> (root-only address, 404 or private — you
            review it yourself). A link state is never a judgment about the
            candidate.
          </li>
          <li>
            <b>Clarification answers</b> — when you run a clarification round,
            the candidate's emailed/portal answers enter evidence the same way,
            tied to the specific question they answered.
          </li>
          <li>
            <b>Criteria associations</b> — the AI picks which passages relate to
            each approved criterion and records the exact cited quote with its
            passage ID, so you can always read the origin. A citation shows
            provenance, not truth: you confirm relevance yourself in the
            Evidence tab.
          </li>
        </ul>
      </details>
      <section className="round-card" aria-label="CV summary">
        <div className="label-row">
          <h3>CV summary</h3>
          <Badge>neutral · source-grounded</Badge>
        </div>
        {data.summary ? (
          <p>{data.summary}</p>
        ) : (
          <p className="hint">
            No summary yet — run the agent review to generate one from the
            linked evidence.
          </p>
        )}
      </section>
      <section className="round-card" aria-label="Link verification">
        <div className="label-row">
          <h3>Link verification</h3>
          <Badge>{data.links.length} checked</Badge>
        </div>
        {data.links.length ? (
          <ul className="history-list">
            {data.links.map((l) => (
              <li key={l.id}>
                <span className="tiny mono">{time(l.created_at)}</span>
                <Badge
                  tone={
                    l.state === "observed"
                      ? "green"
                      : l.state === "not_found" || l.state === "unreachable"
                        ? "red"
                        : "amber"
                  }
                >
                  {words(l.state || "manual")}
                </Badge>
                <p className="mono">
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.url}
                  </a>
                  {l.title ? <> — “{l.title}”</> : null}
                </p>
                {l.message && <p className="hint">{l.message}</p>}
                {l.subject === "repository" && (
                  <p className="link-meta">
                    <b>Public repository metadata</b>
                    {(l.primary_language || l.languages) && <> · languages {l.primary_language || l.languages}</>}
                    {typeof l.fork === "boolean" && <> · {l.fork ? "a fork" : "not a fork"}</>}
                    {l.last_public_commit_utc && <> · last public push {new Date(l.last_public_commit_utc).toLocaleDateString()}</>}
                  </p>
                )}
                {l.subject === "profile" && typeof l.public_repositories === "number" && (
                  <p className="link-meta">
                    <b>Public profile metadata</b> · {l.public_repositories} public repository/repositories
                  </p>
                )}
                {(reviews[l.url] || l.review) && (
                  <blockquote className="link-review">
                    {reviews[l.url] || l.review}
                  </blockquote>
                )}
                <div className="card-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      perform(
                        () =>
                          post(
                            "/applications/" + row.application.id + "/links/verify",
                            { url: l.url },
                          ),
                        "Link verification refreshed.",
                      )
                    }
                  >
                    <ShieldCheck size={13} />
                    Re-verify link
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        const result = await post<InsightLink>(
                          "/applications/" + row.application.id + "/links/review",
                          { url: l.url },
                        );
                        setReviews((r) => ({ ...r, [l.url]: result.review || "" }));
                      }, "AI opened the link and recorded a neutral review of its contents.")
                    }
                  >
                    <ShieldCheck size={13} />
                    Open &amp; AI review
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">
            No public links were found in the linked evidence to verify.
          </p>
        )}
      </section>
      <section className="round-card" aria-label="Strong points">
        <div className="label-row">
          <h3>Notable strong points</h3>
          <Badge>{data.strengths.length} highlighted</Badge>
        </div>
        {data.strengths.length ? (
          <ul className="strength-cards">
            {data.strengths.map((s) => (
              <li key={s.id}>
                <Check size={13} />
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">
            No standout strength was grounded in the linked evidence. This is
            not an assessment of the candidate — absent evidence is not
            inability.
          </p>
        )}
      </section>
      <section className="round-card" aria-label="Job-relevant details">
        <div className="label-row">
          <h3>Job-relevant details</h3>
          <Badge>{data.relevant_details.length} extracted</Badge>
        </div>
        {data.relevant_details.length ? (
          <ul className="detail-chips">
            {data.relevant_details.map((d) => (
              <li key={d.id}>{d.text}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">
            No extra job-relevant details were extracted from the linked
            evidence.
          </p>
        )}
      </section>
      {empty && (
        <Empty title="No AI findings yet">
          Run the agent review for this application, then reload this tab.
        </Empty>
      )}
    </>
  );
}

function RevisionHistory({ findingId }: { findingId: string }) {
  const q = useLoad(
    (signal) => all<Revision>("/findings/" + findingId + "/revisions", signal),
    [findingId],
  );
  return q.loading ? (
    <Loading label="Loading finding revisions…" />
  ) : q.error ? (
    <Failed error={q.error} retry={q.reload} />
  ) : (
    <ol className="history-list">
      {q.data?.map((r) => (
        <li key={r.id}>
          <span className="tiny mono">
            Revision {r.revision} · {time(r.created_at)}
          </span>
          <Badge
            tone={
              r.state === "supported"
                ? "green"
                : r.state === "conflicting"
                  ? "red"
                  : ""
            }
          >
            {r.state}
          </Badge>
          <p>{r.explanation}</p>
          {r.unresolved_question && (
            <p className="hint">Open question: {r.unresolved_question}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
export function EvidencePane({ row }: { row: Snapshot }) {
  const { perform } = useApp();
  const [edit, setEdit] = useState<{
    requirement: Criterion;
    finding?: Finding;
    approve?: boolean;
  }>();
  const [history, setHistory] = useState<string>();
  // Deterministic passage suggestions per requirement (no model call).
  const [suggestions, setSuggestions] = useState<Record<string, EvidenceSuggestion[]>>();
  return (
    <>
      <p className="hint">
        Findings describe how evidence meets an expectation. Evidence type
        describes its provenance. Neither is a numerical match score. Optional
        private or unavailable portfolios are not fetched by this build.
        Missing artifact evidence stays unknown; offer an alternative example
        or code sample. Mostly Python projects do not contradict a Go claim.
      </p>
      {row.brief.requirements.map((r) => {
        const finding = row.brief.findings.find(
          (f) => f.requirement_id === r.id,
        );
        const rev = finding?.latest_revision;
        const evidence = row.brief.evidence.filter((e) =>
          rev?.evidence_ids.includes(e.id),
        );
        return (
          <article className="evidence-card" key={r.id}>
            <div className="label-row">
              <h3>{r.description}</h3>
              <div className="tags">
                <Badge>{r.importance}</Badge>
                <Badge
                  tone={
                    rev?.state === "supported"
                      ? "green"
                      : rev?.state === "conflicting"
                        ? "red"
                        : "amber"
                  }
                >
                  {rev?.state || "Not reviewed"}
                </Badge>
                {rev?.provenance?.association_mode && (
                  <Badge
                    tone={
                      rev.provenance.association_mode === "cache"
                        ? "green"
                        : rev.provenance.association_mode === "rescue"
                          ? ""
                          : "amber"
                    }
                  >
                    {words(rev.provenance.association_mode)}
                  </Badge>
                )}
              </div>
            </div>
            <p className="expectation">
              <b>Observable expectation</b>
              <br />
              {r.minimum_observable_expectation}
            </p>
            {rev && <p>{rev.explanation}</p>}
            {rev && (
              <p className="hint">
                {rev.evidence_ids.length
                  ? "Cited passages: " + rev.evidence_ids.length + " · read each quote's origin above."
                  : "No passage was associated with this criterion by the run. Open question below guides your manual review."}
              </p>
            )}
            {rev?.provenance?.model && <p className="hint">Analysis: {rev.provenance.provider} · {rev.provenance.model} · {rev.provenance.prompt_version}. Exact citations establish provenance; a recruiter must review factual accuracy.</p>}
            {evidence.map((e) => (
              <div className="source-card" key={e.id}>
                <div className="label-row">
                  <Badge
                    tone={e.strength === "candidate_reported" ? "" : "green"}
                  >
                    {words(e.strength)}
                  </Badge>
                  <span className="tiny">
                    {words(e.source_kind)} · {time(e.observed_at)}
                  </span>
                </div>
                <blockquote>{e.passage}</blockquote>
                <div className="source-meta">
                  <span>
                    {e.page
                      ? "Page " + e.page
                      : e.paragraph
                        ? "Paragraph " + e.paragraph
                        : e.response_id
                          ? "Candidate response"
                          : "Artifact location"}
                  </span>
                  <code>{e.response_id || e.artifact_location}</code>
                </div>
                {e.document_id && (
                  <button
                    className="text-button"
                    onClick={() =>
                      perform(() =>
                        download(
                          e.document_id!,
                          row.documents.find((d) => d.id === e.document_id)
                            ?.original_name || "source-document",
                        ),
                      )
                    }
                  >
                    <FileText size={13} />
                    Open authorized source document
                  </button>
                )}
                <p className="hint">
                  {e.extraction_version_id
                    ? "Extraction version " +
                      e.extraction_version_id.slice(0, 8)
                    : "No extraction version: response or observed artifact"}
                  {e.supersedes_id
                    ? " · supersedes evidence " + e.supersedes_id.slice(0, 8)
                    : ""}
                </p>
              </div>
            ))}
            {!evidence.length && (
              <div className="unknown-source">
                No associated source evidence. Unknown is not inability.
              </div>
            )}
            <div className="open-question">
              <b>Open question</b>
              <p>
                {rev?.unresolved_question ||
                  "No open question recorded. Review the observable expectation before deciding."}
              </p>
            </div>
            <div className="card-actions">
              <button
                className="secondary"
                onClick={() => setEdit({ requirement: r, finding })}
              >
                Revise finding
              </button>
              <button
                className="secondary"
                disabled={!evidence.length}
                onClick={() =>
                  setEdit({ requirement: r, finding, approve: true })
                }
              >
                <ShieldCheck size={13} />
                Review as supported
              </button>
              {finding && (
                <button
                  className="text-button"
                  onClick={() =>
                    setHistory(history === finding.id ? undefined : finding.id)
                  }
                >
                  <History size={13} />
                  Change history
                </button>
              )}
              {finding && (
                <button
                  className="text-button"
                  onClick={() =>
                    perform(async () => {
                      const result = await request<{ suggestions: EvidenceSuggestion[] }>(
                        "/findings/" + finding.id + "/suggest-evidence",
                      );
                      setSuggestions((prev) => ({
                        ...prev,
                        [r.id]: result.suggestions,
                      }));
                    }, "Deterministic text-overlap suggestions computed locally; no model call.")
                  }
                >
                  <Sparkles size={13} />
                  Suggest passages
                </button>
              )}
            </div>
            {suggestions && suggestions[r.id] && (
              <div className="unknown-source">
                {suggestions[r.id].length ? (
                  <ul>
                    {suggestions[r.id].slice(0, 5).map((s) => (
                      <li key={s.id}>
                        {s.passage.slice(0, 160)}
                        {s.passage.length > 160 ? "…" : ""}
                        {s.document_id && <> <code>{s.document_id.slice(0, 8)}</code></>}
                      </li>
                    ))}
                  </ul>
                ) : "No linked passage shares wording with this criterion."}
              </div>
            )}
            {history === finding?.id && finding && (
              <RevisionHistory findingId={finding.id} />
            )}
          </article>
        );
      })}
      {edit && (
        <FindingEditor row={row} {...edit} close={() => setEdit(undefined)} />
      )}
    </>
  );
}
function FindingEditor({
  row,
  requirement,
  finding,
  approve,
  close,
}: {
  row: Snapshot;
  requirement: Criterion;
  finding?: Finding;
  approve?: boolean;
  close: () => void;
}) {
  const { perform, busy } = useApp();
  const [state, setState] = useState<FindingState>(
    approve ? "supported" : finding?.latest_revision?.state || "unknown",
  );
  const [ids, setIds] = useState(finding?.latest_revision?.evidence_ids || []);
  const [explanation, setExplanation] = useState("");
  const [question, setQuestion] = useState(
    finding?.latest_revision?.unresolved_question || "",
  );
  return (
    <Modal
      title={
        approve
          ? "Review support for this requirement"
          : "Revise requirement finding"
      }
      close={close}
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            await post("/applications/" + row.application.id + "/findings", {
              requirement_id: requirement.id,
              state,
              evidence_ids: ids,
              explanation,
              unresolved_question: question,
            });
            close();
          }, "Finding revision saved. Source strength has not changed.");
        }}
      >
        <h3>{requirement.description}</h3>
        <p>{requirement.minimum_observable_expectation}</p>
        <label>
          Finding
          <select
            value={state}
            onChange={(e) => setState(e.target.value as FindingState)}
          >
            {["supported", "partial", "unknown", "conflicting"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Source evidence for this judgment</legend>
          {row.brief.evidence.map((e) => (
            <label className="checkbox evidence-option" key={e.id}>
              <input
                type="checkbox"
                checked={ids.includes(e.id)}
                onChange={(event) =>
                  setIds(
                    event.target.checked
                      ? [...ids, e.id]
                      : ids.filter((id) => id !== e.id),
                  )
                }
              />
              <span>
                {words(e.strength)} · {e.passage.slice(0, 180)}
              </span>
            </label>
          ))}
          {!row.brief.evidence.length && (
            <p className="hint">
              No source evidence is available. A supported or partial finding
              requires accepted evidence.
            </p>
          )}
        </fieldset>
        <label>
          Brief job-related explanation
          <textarea
            required
            value={explanation}
            maxLength={2000}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </label>
        <label>
          Unresolved question
          <textarea
            value={question}
            maxLength={1000}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <p className="hint">
          Self-reported sources remain self-reported, even if you judge the
          expectation supported. The server checks accepted evidence types.
        </p>
        <button
          className="primary"
          disabled={
            busy ||
            (["supported", "partial"].includes(state) && !ids.length) ||
            (state === "conflicting" && ids.length < 2)
          }
        >
          Save finding revision
        </button>
      </form>
    </Modal>
  );
}

function ClarificationWorkflowPanel({applicationId}: {applicationId: string}) {
  const {org, revision, perform, busy} = useApp();
  const q = useLoad(async (signal) => {
    const workflow = await request<{workflow: null | {state: string; resume_seq: number; deadline: number | null; max_reminders: number; reminders_sent: number; error: string; brief: {reason?: string; requirements?: {requirement_id: string; description: string; state: string; remaining_uncertainty: string; interview_followup: string}[]}}; delivery_actions?: {id: string; state: string; error: string}[]; actions: {id: string; action: string; rationale: string; result: {before?: string; after?: string}}[]}>("/applications/"+applicationId+"/clarification-workflow", {signal});
    return {...workflow};
  }, [applicationId, revision]);
  if(q.error) return <Failed error={q.error} retry={q.reload}/>;
  if(!q.data?.workflow) return null;
  const w=q.data.workflow;
  return <section className="round-card" aria-label="Persisted clarification workflow">
    <div className="label-row"><h3>Clarification workflow</h3><Badge>{words(w.state)}</Badge></div>
    {w.deadline && <p className="hint">Response deadline: {time(w.deadline)} · Reminders reserved: {w.reminders_sent} / {w.max_reminders}. No response means unresolved evidence, not inability.</p>}
    {w.error && <p role="status" className="notice warning">{w.error}</p>}
    {w.state === "needs_attention" && w.resume_seq > 0 && <button className="secondary" disabled={busy} onClick={()=>perform(()=>post("/applications/"+applicationId+"/clarification-workflow/retry",{}),"Evidence update retry requested. Delivery errors use the outbox retry controls.")}>Retry evidence update</button>}
    {q.data.delivery_actions?.map(action=><div key={action.id} className="label-row"><span className="hint">Invitation action: {words(action.state)}{action.error ? " ? "+action.error : ""}</span>{["failed","not_configured"].includes(action.state) && <button className="secondary" disabled={busy} onClick={()=>perform(()=>post("/outbox/"+action.id+"/retry",{}),"Approved email action queued for retry with the same idempotency key.")}>Retry approved delivery</button>}</div>)}
    {!!w.brief.requirements?.length && <details open><summary>Review-ready brief and remaining uncertainties</summary><p>{w.brief.reason}</p>{w.brief.requirements.map(r => <div key={r.requirement_id}><b>{r.description} · {r.state}</b><p>{r.remaining_uncertainty}</p><p className="hint">Interview: {r.interview_followup}</p></div>)}</details>}
    <details><summary>Validated actions and finding changes</summary><ol>{q.data.actions.map(a=><li key={a.id}><b>{words(a.action)}</b>: {a.rationale}{a.result.before && <p>Before: {a.result.before} → After: {a.result.after}</p>}</li>)}</ol></details>
  </section>;
}

export function ClarificationPane({ row }: { row: Snapshot }) {
  const { perform, busy, revision } = useApp();
  const [create, setCreate] = useState(false);
  const editable = row.brief.requirements.filter(
    (r) => r.clarification_permitted,
  );
  return (
    <>
      <ClarificationWorkflowPanel applicationId={row.application.id} />
      <div className="label-row">
        <div>
          <h3>Bounded factual clarification</h3>
          <p className="hint">
            One round per approved criteria version, up to three questions. Approval authorizes the exact questions and a bounded reminder policy. Candidates may decline or offer an alternative.
          </p>
        </div>
        <button
          className="secondary"
          disabled={
            row.rounds.some(r => r.state !== "closed") ||
            !editable.length ||
            row.application.reassessment_required
          }
          onClick={() => setCreate(true)}
        >
          <Plus size={13} />
          Draft round
        </button>
      </div>
      {row.application.reassessment_required && (
        <p className="notice warning">
          Reassess the new criteria before drafting clarification.
        </p>
      )}
      {!row.rounds.length && (
        <Empty title="No clarification drafted">
          Ask only about important job-related unknowns. Candidates may state
          that no example is available.
        </Empty>
      )}
      {[...row.rounds]
        .sort((a, b) => a.number - b.number)
        .map((r) => (
          <RoundCard key={r.id} id={r.id} row={row} />
        ))}
      {create && <RoundEditor row={row} close={() => setCreate(false)} />}
    </>
  );
}
function RoundCard({ id, row }: { id: string; row: Snapshot }) {
  const { revision, perform, busy } = useApp();
  const q = useLoad(
    (signal) => request<Round>("/clarification-rounds/" + id, { signal }),
    [id, revision],
  );
  const [edit, setEdit] = useState(false);
  const [approve, setApprove] = useState(false);
  const [invite, setInvite] = useState(false);
  const [reminders, setReminders] = useState(1);
  const [responseHours, setResponseHours] = useState(72);
  if (q.loading && !q.data)
    return <Loading label="Loading approved question scope…" />;
  if (q.error) return <Failed error={q.error} retry={q.reload} />;
  if (!q.data) return null;
  const round = q.data;
  return (
    <section className="round-card">
      <div className="label-row">
        <h3>Round {round.number}</h3>
        <Badge
          tone={
            round.state === "approved"
              ? "amber"
              : round.state === "answered"
                ? "green"
                : ""
          }
        >
          {round.state}
        </Badge>
      </div>
      <ol className="question-list">
        {round.questions?.map((q) => (
          <li key={q.id}>
            <b>
              {row.brief.requirements.find((r) => r.id === q.requirement_id)
                ?.description || "Approved criterion"}
            </b>
            <p>{q.text}</p>
          </li>
        ))}
      </ol>
      <div className="card-actions">
        {round.state === "draft" && (
          <>
            <button className="secondary" onClick={() => setEdit(true)}>
              Revise draft questions
            </button>
            <button
              className="primary"
              disabled={busy || row.application.reassessment_required}
              onClick={() => setApprove(true)}
            >
              Review & approve questions
            </button>
          </>
        )}
        {round.state === "approved" && (
          <>
            <span className="hint">
              Approved questions · candidate response pending. No delivery is
              assumed.
            </span>
            <button className="primary" onClick={() => setInvite(true)}>
              Create candidate invitation
            </button>
          </>
        )}
        {round.state === "answered" && (
          <p className="hint">
            Candidate response is recorded with self-report provenance. Review
            findings in the Evidence tab.
          </p>
        )}
      </div>
      {edit && (
        <RoundEditor row={row} round={round} close={() => setEdit(false)} />
      )}{" "}
      {approve && (
        <Confirm
          title="Approve these candidate questions?"
          description={
            <>
              <p>
                Only these {round.questions?.length} job-related questions will
                be available in this round.
              </p>
              <ol>
                {round.questions?.map((q) => (
                  <li key={q.id}>{q.text}</li>
                ))}
              </ol>
              <p>
                Approval queues one portal invitation and authorizes only the reminder policy below. Worker evidence updates need no further approval. Live email delivery requires a configured email connection.
              </p>
              <label>Response deadline (hours)<input type="number" min={25} max={168} value={responseHours} onChange={e => setResponseHours(Number(e.target.value))} /></label>
              <label>Reminder policy<select value={reminders} onChange={e => setReminders(Number(e.target.value))}><option value={1}>At most one reminder after 24 hours</option><option value={0}>No reminder</option></select></label>
            </>
          }
          label="Approve questions"
          close={() => setApprove(false)}
          confirm={() =>
            perform(async () => {
              await post("/clarification-rounds/" + id + "/approve", {
                rationale:
                  "Recruiter reviewed relevance, limits and source gaps.",
                response_hours: responseHours, max_reminders: reminders, reminder_hours: 24,
              });
              setApprove(false);
            }, "Approved questions and reminder policy saved. Invitation queued; delivery status is shown below.")
          }
        />
      )}{" "}
      {invite && (
        <InvitationDialog
          applicationId={row.application.id}
          roundId={id}
          close={() => setInvite(false)}
        />
      )}
    </section>
  );
}
function RoundEditor({
  row,
  round,
  close,
}: {
  row: Snapshot;
  round?: Round;
  close: () => void;
}) {
  const { perform, busy } = useApp();
  const permitted = row.brief.requirements.filter(
    (r) => r.clarification_permitted,
  );
  const [questions, setQuestions] = useState<
    { requirement_id: string; text: string }[]
  >(
    round?.questions?.map((q) => ({
      requirement_id: q.requirement_id,
      text: q.text,
    })) ||
      permitted
        .filter(
          (r) =>
            !row.brief.findings.find((f) => f.requirement_id === r.id)
              ?.latest_revision?.evidence_ids.length,
        )
        .slice(0, 3)
        .map((r) => ({
          requirement_id: r.id,
          text: `Describe a relevant example of ${r.description} and your own contribution. You may say that no example is available.`,
        })),
  );
  return (
    <Modal
      title={
        round ? "Revise unapproved questions" : "Draft clarification round"
      }
      close={close}
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            await request(
              round
                ? "/clarification-rounds/" + round.id
                : "/applications/" +
                    row.application.id +
                    "/clarification-rounds",
              { method: round ? "PATCH" : "POST", body: { questions } },
            );
            close();
          }, "Question draft saved; HR approval required.");
        }}
      >
        {questions.map((q, i) => (
          <fieldset key={i}>
            <legend>Question {i + 1}</legend>
            <label>
              Permitted criterion
              <select
                value={q.requirement_id}
                onChange={(e) =>
                  setQuestions((xs) =>
                    xs.map((x, j) =>
                      j === i ? { ...x, requirement_id: e.target.value } : x,
                    ),
                  )
                }
              >
                {permitted.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Factual question
              <textarea
                aria-label="Factual question"
                required
                maxLength={1000}
                value={q.text}
                onChange={(e) =>
                  setQuestions((xs) =>
                    xs.map((x, j) =>
                      j === i ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="text-button danger"
              onClick={() => setQuestions((xs) => xs.filter((_, j) => j !== i))}
            >
              Remove question
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={
            questions.length >= 3 || questions.length >= permitted.length
          }
          onClick={() => {
            const r = permitted.find(
              (r) => !questions.some((q) => q.requirement_id === r.id),
            );
            if (r)
              setQuestions([...questions, { requirement_id: r.id, text: "" }]);
          }}
        >
          <Plus size={13} />
          Add question
        </button>
        <p className="hint">
          Do not request personal or protected information. Unavailable evidence
          is an acceptable answer.
        </p>
        <div className="form-actions">
          <button
            className="primary"
            disabled={
              busy ||
              !questions.length ||
              new Set(questions.map((q) => q.requirement_id)).size !==
                questions.length
            }
          >
            Save question draft
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function InvitationDialog({
  applicationId,
  roundId,
  close,
}: {
  applicationId: string;
  roundId: string;
  close: () => void;
}) {
  const { perform, busy, org } = useApp();
  const [link, setLink] = useState("");
  const [expires, setExpires] = useState(3600);
  const [profile, setProfile] = useState(true);
  const [permissions, setPermissions] = useState(true);
  const [expiresAt, setExpiresAt] = useState<number>();
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Create scoped candidate invitation" close={close}>
      <div className="editor-form">
        <p>
          Only this application and its approved clarification questions are
          available. Internal review notes are never included.
        </p>
        {!link ? (
          <>
            <label>
              Invitation lifetime
              <select
                value={expires}
                onChange={(e) => setExpires(Number(e.target.value))}
              >
                <option value={900}>15 minutes</option>
                <option value={3600}>1 hour</option>
                <option value={86400}>24 hours</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={profile}
                onChange={(e) => setProfile(e.target.checked)}
              />
              Allow factual profile correction requests
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={permissions}
                onChange={(e) => setPermissions(e.target.checked)}
              />
              Allow optional source/consent preferences
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  const result = await post<{
                    token: string;
                    expires_at: number;
                  }>("/applications/" + applicationId + "/invitations", {
                    round_id: roundId,
                    expires_in_seconds: expires,
                    scopes: [
                      "application:read",
                      "clarification:respond",
                      ...(profile ? ["profile:correct"] : []),
                      ...(permissions ? ["permissions:write"] : []),
                    ],
                  });
                  setExpiresAt(result.expires_at);
                  setLink(location.origin + "/#invite=" + result.token);
                }, "Invitation created. No message sent.")
              }
            >
              Create private invitation
            </button>
          </>
        ) : (
          <>
            <label>
              Private link · expires {expiresAt && time(expiresAt)}
              <input
                aria-label="Candidate invitation link"
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Copy size={13} />
              {copied ? "Copied" : "Copy invitation link"}
            </button>
            <p className="hint">
              Share manually with the intended candidate. Anyone holding the
              link can exchange it once for this application’s limited session.
            </p>
            <p className="notice warning">
              Use a separate browser profile or private window to preview.
              Exchanging a candidate invitation replaces the current browser’s
              recruiter session.
            </p>
          </>
        )}
        <p className="hint">
          This separately created link is shared manually. Approved workflow
          email status appears in Clarification.
        </p>
      </div>
    </Modal>
  );
}

export function BriefEditor({ row }: { row: Snapshot }) {
  const { revision, perform, busy } = useApp();
  const q = useLoad(
    (signal) =>
      all<BriefDraft>(
        "/applications/" + row.application.id + "/brief-drafts",
        signal,
      ),
    [row.application.id, revision],
  );
  const generated = `INTERVIEW BRIEF · ${row.candidate?.display_name || row.application.id}\nRole: ${row.brief.vacancy_title}\n\n${row.brief.requirements.map((r) => `${r.description} (${r.importance})\nExpectation: ${r.minimum_observable_expectation}\nFinding: ${row.brief.findings.find((f) => f.requirement_id === r.id)?.latest_revision?.state || "unknown"}\nQuestion: ${row.brief.findings.find((f) => f.requirement_id === r.id)?.latest_revision?.unresolved_question || "Explore a relevant example and personal contribution."}`).join("\n\n")}\n\nLimitations:\n${row.brief.limitations.join("\n")}`;
  const [text, setText] = useState(generated);
  const [dirty, setDirty] = useState(false);
  const [approve, setApprove] = useState(false);
  const latest = q.data?.slice().sort((a, b) => b.revision - a.revision)[0];
  useEffect(() => {
    if (latest && !dirty) setText(latest.content);
  }, [latest?.id]);
  return (
    <section className="brief-editor">
      <div className="label-row">
        <h3>Editable interview brief</h3>
        <Badge>
          {dirty
            ? "Unsaved changes"
            : latest
              ? `Revision ${latest.revision} · ${latest.state}`
              : "Generated · not saved"}
        </Badge>
      </div>
      <p className="hint">
        Plain text. Keep questions tied to approved expectations and evidence
        gaps. Saving and approving are separate actions.
      </p>
      {q.error && <Failed error={q.error} retry={q.reload} />}
      <button className="secondary" disabled={busy} onClick={()=>perform(async()=>{const generated=await post<{content:string}>("/applications/"+row.application.id+"/generated-interview-brief",{});setText(generated.content);setDirty(true);},"Brief generated from stored findings, exact evidence and approved criteria; edit before approval.")}>Generate source-linked brief</button>
      <label>
        Brief content
        <textarea
          className="brief-content"
          id={"brief-" + row.application.id}
          aria-label="Interview brief content"
          maxLength={20000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <div className="card-actions">
        {latest?.state === "approved" && !dirty && (
          <button
            className="secondary"
            onClick={() => {
              setDirty(true);
              document.getElementById("brief-" + row.application.id)?.focus();
            }}
          >
            Revise approved brief
          </button>
        )}
        <button
          className="secondary"
          disabled={busy || !text.trim()}
          onClick={() =>
            perform(async () => {
              await post(
                "/applications/" + row.application.id + "/brief-drafts",
                { content: text },
              );
              setDirty(false);
            }, "Interview brief revision saved as draft.")
          }
        >
          Save brief draft
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !latest ||
            dirty ||
            latest.state !== "draft" ||
            row.application.reassessment_required
          }
          onClick={() => setApprove(true)}
        >
          Review & approve brief
        </button>
        <button className="text-button" onClick={() => window.print()}>
          Print brief
        </button>
      </div>
      {approve && latest && (
        <Confirm
          title="Approve this interview brief?"
          description={
            <>
              <p>
                Approve revision {latest.revision} against the application’s
                current criteria version.
              </p>
              <pre className="brief-preview">{latest.content}</pre>
            </>
          }
          label="Approve brief"
          close={() => setApprove(false)}
          confirm={() =>
            perform(async () => {
              await post("/brief-drafts/" + latest.id + "/approve", {
                rationale:
                  "Recruiter reviewed source context and interview questions.",
              });
              setApprove(false);
            }, "Interview brief approved.")
          }
        />
      )}
    </section>
  );
}
export function InterviewPane({ row }: { row: Snapshot }) {
  return <><BriefEditor row={row}/><InterviewCoordination row={row}/></>;
}
