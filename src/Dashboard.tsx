import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
} from "lucide-react";
import { all, download, post, request } from "./api";
import { useLoad, useEvents, navigate } from "./hooks";
import { snapshot, stage, coverage, STAGES } from "./data";
import {
  useApp,
  PageHeading,
  Panel,
  Loading,
  Failed,
  Empty,
  Badge,
  ActivityPanel,
  Modal,
  Confirm,
  words,
} from "./ui";
import type {
  Application,
  Vacancy,
  Version,
  Candidate,
  Run,
  Job,
  Outbox,
  Snapshot,
} from "./types";

export async function loadDashboard(id: string, signal?: AbortSignal) {
  const [vacancy, versions, apps, candidates, runs, outbox] = await Promise.all(
    [
      request<Vacancy>("/vacancies/" + id, { signal }),
      all<Version>("/vacancies/" + id + "/requirement-versions", signal),
      all<Application>("/applications?vacancy_id=" + id, signal),
      all<Candidate>("/candidates", signal),
      all<Run>("/workflow-runs", signal),
      all<Outbox>("/outbox", signal),
    ],
  );
  const chosen = [...versions].sort((a, b) => b.version - a.version);
  const activeId = vacancy.active_requirement_version_id || chosen[0]?.id;
  const [version, rows, jobs] = await Promise.all([
    activeId
      ? request<Version>("/requirement-versions/" + activeId, { signal })
      : undefined,
    Promise.all(
      apps
        .filter((a) => !a.withdrawn_at)
        .map((a) => snapshot(a, candidates, signal)),
    ),
    Promise.all(
      runs
        .filter((r) => r.vacancy_id === id)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 3)
        .map((r) => all<Job>("/workflow-runs/" + r.id + "/jobs", signal)),
    ).then((xs) => xs.flat()),
  ]);
  return {
    vacancy,
    versions,
    version,
    rows,
    jobs,
    runs: runs
      .filter((r) => r.vacancy_id === id)
      .sort((a, b) => b.created_at - a.created_at),
    outbox: outbox.filter((o) => apps.some((a) => a.id === o.application_id)),
  };
}
export function CandidateTable({
  rows,
  jobs,
  outbox,
  blind = false,
}: {
  rows: Snapshot[];
  jobs: Job[];
  outbox: Outbox[];
  blind?: boolean;
}) {
  const [search, setSearch] = useState("");
  return (
    <>
      <div className="table-toolbar">
        <label className="search">
          <Search size={14} />
          <input
            aria-label="Search applicants"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              blind ? "Find by blind identifier…" : "Search applicants…"
            }
          />
        </label>
        <span className="tiny">Essential findings · evidence completeness</span>
      </div>
      <div className="table-wrap">
        <table className="applicants-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>
                Essential findings
                <br />
                <span className="th-sub">Supported / Partial / Unknown</span>
              </th>
              <th>Evidence coverage</th>
              <th>Next action</th>
              <th>Pipeline status</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) =>
                (blind
                  ? row.application.id.slice(0, 8)
                  : row.candidate?.display_name || row.application.id
                )
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((row, i) => {
                const { application: a, brief } = row;
                const state = stage(row, jobs, outbox);
                const essentials = brief.requirements.filter(
                  (r) => r.importance === "essential",
                );
                const counts = ["supported", "partial", "unknown"].map(
                  (s) =>
                    essentials.filter(
                      (r) =>
                        (brief.findings.find((f) => f.requirement_id === r.id)
                          ?.latest_revision?.state || "unknown") === s,
                    ).length,
                );
                const conflicts = essentials.filter(
                  (r) =>
                    brief.findings.find((f) => f.requirement_id === r.id)
                      ?.latest_revision?.state === "conflicting",
                ).length;
                const amount = coverage(row);
                const label = blind
                  ? "Applicant " + a.id.slice(0, 8)
                  : row.candidate?.display_name ||
                    "Applicant " + a.id.slice(0, 8);
                return (
                  <tr
                    key={a.id}
                    onClick={() => navigate("/applications/" + a.id)}
                  >
                    <td>
                      <a
                        className="candidate-name"
                        href={"#/applications/" + a.id}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className={"candidate-avatar color-" + (i % 5)}>
                          {blind
                            ? "#"
                            : label
                                .split(" ")
                                .map((w) => w[0])
                                .slice(0, 2)
                                .join("")}
                        </span>
                        <span>
                          <b>{label}</b>
                          <small>
                            {row.candidate?.synthetic
                              ? "Synthetic applicant"
                              : a.id.slice(0, 8)}
                          </small>
                        </span>
                      </a>
                    </td>
                    <td>
                      <span
                        className="finding-counts"
                        aria-label={`${counts[0]} supported, ${counts[1]} partial, ${counts[2]} unknown, ${conflicts} conflicting essential requirements`}
                      >
                        <b className="green">{counts[0]}</b>
                        <b className="amber">{counts[1]}</b>
                        <b>{counts[2]}</b>
                      </span>
                      {conflicts > 0 && (
                        <span className="conflict-note">
                          {conflicts} conflicting
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="coverage">
                        {amount}
                        <small> / {brief.requirements.length}</small>
                      </span>
                      <div
                        className="meter"
                        aria-label={`Evidence associated with ${amount} of ${brief.requirements.length} requirements`}
                      >
                        <i
                          style={{
                            width: `${brief.requirements.length ? (amount / brief.requirements.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="next-action">{state.next}</td>
                    <td>
                      <Badge
                        tone={
                          state.attention
                            ? "amber"
                            : state.index === 8
                              ? "green"
                              : ""
                        }
                      >
                        {state.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        Coverage counts criteria with source evidence. It is not ability or a
        probability of hiring success.
      </div>
      {!rows.length && (
        <Empty title="No applicants yet">{`Add CVs or ${"load synthetic applicants in DEMO"} to begin an evidence review.`}</Empty>
      )}
    </>
  );
}

export function Dashboard({ id }: { id: string }) {
  const { org, revision, refresh, perform, busy } = useApp();
  const q = useLoad((signal) => loadDashboard(id, signal), [id, revision]);
  const feed = useEvents({ vacancy_id: id }, refresh);
  const [blind, setBlind] = useState(false);
  const [modal, setModal] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [appName, setAppName] = useState("");
  const [appEmail, setAppEmail] = useState("");
  const [file, setFile] = useState<File>();
  const [confirmed, setConfirmed] = useState(false);
  const [pendingUploadId, setPendingUploadId] = useState<string>();
  const [fixture, setFixture] = useState("support");
  if (q.loading && !q.data)
    return <Loading label="Loading vacancy, applicants and workflow state…" />;
  if (q.error)
    return (
      <div className="wide-page">
        <Failed error={q.error} retry={q.reload} />
      </div>
    );
  if (!q.data) return null;
  const { vacancy: v, version, versions, rows, jobs, runs, outbox } = q.data;
  const active = runs.find((r) =>
    ["queued", "running", "paused"].includes(r.state),
  );
  const failed = runs[0]?.state === "failed" ? runs[0] : undefined;
  const drafts = rows.filter((r) =>
    r.rounds.some((round) => round.state === "draft"),
  );
  const attention = rows.filter((r) => stage(r, jobs, outbox).attention);
  const decisions = rows.filter(
    (r) => r.application.decision !== "undecided",
  ).length;
  const newProposal = versions.some(
    (x) => x.state === "proposed" && (!version || x.version > version.version),
  );
  async function run() {
    await perform(
      () =>
        active?.state === "paused"
          ? post("/workflow-runs/" + active.id + "/control", {
              action: "resume",
            })
          : failed
            ? post("/workflow-runs/" + failed.id + "/control", {
                action: "retry",
              })
            : post("/workflow-runs", { vacancy_id: id }),
      "Workflow request saved. The worker owns progress.",
    );
  }
  return (
    <>
      <PageHeading
        title={v.title}
        description={
          v.description ||
          "Job-related evidence, with decisions owned by your team."
        }
        actions={
          <>
            <Badge tone={v.state === "published" ? "green" : "amber"}>
              {v.state}
            </Badge>
            <a className="secondary" href={"#/review/" + id}>
              <Users size={14} />
              Recruiter review
            </a>
          </>
        }
      />
      <div className="dashboard-layout">
        <aside className="left-col">
          <Panel
            title="Job opening"
            aside={
              <span className="tiny mono">
                JOB-{id.slice(0, 4).toUpperCase()}
              </span>
            }
          >
            <div className="panel-body">
              <div className="label-row">
                <label>Position</label>
                <button
                  className="text-button"
                  onClick={() => {
                    setTitle(v.title);
                    setDescription(v.description);
                    setModal("summary");
                  }}
                >
                  Edit summary
                </button>
              </div>
              <div className="field-value">{v.title}</div>
              {v.is_sample && (
                <p className="sample-label">SYNTHETIC SAMPLE VACANCY</p>
              )}
              <div className="field">
                <label>Essential requirements</label>
                <div className="tags">
                  {version?.requirements
                    .filter((r) => r.importance === "essential")
                    .map((r) => (
                      <span key={r.id} className="tag req">
                        {r.description}
                      </span>
                    ))}
                </div>
              </div>
              <div className="field">
                <label>Preferred requirements</label>
                <div className="tags">
                  {version?.requirements
                    .filter((r) => r.importance === "preferred")
                    .map((r) => (
                      <Badge key={r.id}>{r.description}</Badge>
                    ))}
                </div>
              </div>
              <a className="text-button" href={"#/vacancies/" + id + "/edit"}>
                <SlidersHorizontal size={13} />
                Edit criteria & evidence <ArrowUpRight size={12} />
              </a>
              <p
                className={
                  "approved-note " +
                  (version?.state === "approved" ? "green" : "amber")
                }
              >
                <ShieldCheck size={14} />
                {version?.state === "approved"
                  ? `Approved criteria · version ${version.version}`
                  : "Criteria need HR approval"}
              </p>
              <p className="hint">
                Edits create a new version. Existing review history is retained.
              </p>
            </div>
            <div className="upload-section">
              <div className="label-row">
                <h3>Uploaded CVs</h3>
                <Badge>
                  {rows.reduce((n, r) => n + r.documents.length, 0)}
                </Badge>
              </div>
              <ul className="files">
                {rows.flatMap((row, i) =>
                  row.documents.map((doc) => (
                    <li key={doc.id}>
                      <FileText size={13} />
                      <button
                        className="file-link"
                        title={
                          doc.synthetic
                            ? "Synthetic extraction only; no original binary"
                            : doc.original_name
                        }
                        onClick={() =>
                          doc.synthetic
                            ? perform(async () =>
                                navigate(
                                  "/applications/" +
                                    row.application.id +
                                    "?tab=Evidence",
                                ),
                              )
                            : perform(() => download(doc.id, doc.original_name))
                        }
                      >
                        {blind
                          ? "Applicant " + (i + 1) + " CV"
                          : doc.original_name}
                      </button>
                      <Check size={12} className="green" />
                    </li>
                  )),
                )}
              </ul>
              {org.is_demo && <div className="field"><label htmlFor="synthetic-file">Synthetic CV file</label><select id="synthetic-file" value={fixture} onChange={e=>setFixture(e.target.value)}><option value="support">Customer Support · readable DOCX</option><option value="developer">Developer · private GitHub · DOCX</option><option value="scan">Scanned support CV · PDF · real OCR</option><option value="unreadable">Unreadable PDF · recovery exercise</option><option value="hostile">Embedded hostile instructions · DOCX</option></select><button className="secondary" disabled={busy||v.state!=="published"} onClick={()=>perform(()=>post("/demo/vacancies/"+id+"/synthetic-file",{variant:fixture}),"Generated synthetic original saved privately. The worker will run the real parser; analysis and messages remain DEMO.")}>Add synthetic file</button><p className="hint">Closed synthetic catalog. No real applicant uploads. OCR requires a configured local runtime.</p></div>}
              {org.is_demo ? (
                <button
                  className="upload-box"
                  disabled={busy || !!rows.length || v.state !== "published"}
                  onClick={() =>
                    perform(
                      () => post("/demo/vacancies/" + id + "/seed"),
                      "Five synthetic applicants added. No real files were uploaded.",
                    )
                  }
                >
                  <Upload size={18} />
                  <b>
                    {rows.length
                      ? "Synthetic applicants loaded"
                      : "Load synthetic CVs"}
                  </b>
                  <span>Explicit demo adapter · 5 sample records</span>
                </button>
              ) : (
                <button
                  className="upload-box"
                  disabled={v.state !== "published"}
                  onClick={() => setModal("upload")}
                >
                  <Upload size={18} />
                  <b>Add applicant & upload CV</b>
                  <span>PDF / DOCX · up to 5 MB</span>
                </button>
              )}
              <button
                className="primary run"
                disabled={
                  busy ||
                  !rows.length ||
                  version?.state !== "approved" ||
                  (!!active && active.state !== "paused")
                }
                onClick={run}
              >
                <Play size={14} />
                {active?.state === "paused"
                  ? "Resume agent"
                  : active
                    ? "Agent workflow active"
                    : failed
                      ? "Retry failed workflow"
                      : "Run agent"}
                <ArrowRight size={14} />
              </button>
              {active && (
                <div className="workflow-controls">
                  {active.state !== "paused" && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        perform(
                          () =>
                            post("/workflow-runs/" + active.id + "/control", {
                              action: "pause",
                            }),
                          "Workflow paused.",
                        )
                      }
                    >
                      <Pause size={12} />
                      Pause
                    </button>
                  )}
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => setModal("cancel")}
                  >
                    Cancel workflow
                  </button>
                </div>
              )}
              <p className="hint">
                The worker extracts evidence and identifies gaps. HR approves
                contact and makes every shortlist, rejection and hiring
                decision.
              </p>
            </div>
          </Panel>
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <div>
              <b>Job-related evaluation only</b>
              <p>
                Photos and irrelevant personal fields are excluded from
                automatic association. This does not eliminate bias.
              </p>
            </div>
          </div>
        </aside>
        <div className="center-col">
          <Panel
            title="Applicant workflow"
            aside={
              <span className="tiny mono">
                {rows.length} INDEPENDENT APPLICATIONS
              </span>
            }
          >
            <div className="pipeline real-pipeline">
              {STAGES.map((name, i) => {
                const count = rows.filter(
                  (r) => stage(r, jobs, outbox).index === i,
                ).length;
                return (
                  <div
                    className={"stage " + (count ? "active" : "")}
                    key={name}
                  >
                    <div className="bar" />
                    <span className="stage-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{name}</span>
                    <b>{count || "–"}</b>
                  </div>
                );
              })}
            </div>
            <div className="workflow-footer">
              <ShieldCheck size={13} />
              Each applicant advances independently. Counts come from stored
              reviews and jobs.
            </div>
          </Panel>
          <div className="summary-grid">
            <div>
              <span className="summary-icon blue">
                <Users size={17} />
              </span>
              <div>
                <b>{rows.length}</b>
                <span>Applicants</span>
              </div>
            </div>
            <div>
              <span className="summary-icon teal">
                <FileText size={17} />
              </span>
              <div>
                <b>{rows.filter((r) => r.brief.findings.length).length}</b>
                <span>Evidence reviewed</span>
              </div>
            </div>
            <div>
              <span className="summary-icon amber">
                <ShieldCheck size={17} />
              </span>
              <div>
                <b>{drafts.length + attention.length}</b>
                <span>Need HR attention</span>
              </div>
            </div>
          </div>
          {(version?.state !== "approved" ||
            v.state === "draft" ||
            newProposal) && (
            <div className="approval">
              <ShieldCheck size={20} className="amber" />
              <div>
                <h3>
                  {version?.state !== "approved"
                    ? "Approve the criteria before processing"
                    : newProposal
                      ? "A new criteria proposal needs review"
                      : "Approved criteria, unpublished vacancy"}
                </h3>
                <p>
                  {v.state === "draft"
                    ? "Review job-related expectations and publish explicitly before adding applicants."
                    : "Review the new proposal. Approving it flags existing reviews for reassessment."}
                </p>
                {version?.state === "approved" && v.state === "draft" ? (
                  <button
                    className="text-button"
                    onClick={() => setModal("publish")}
                  >
                    Review publication <ArrowRight size={13} />
                  </button>
                ) : (
                  <a
                    className="text-button"
                    href={"#/vacancies/" + id + "/edit"}
                  >
                    Open vacancy editor <ArrowRight size={13} />
                  </a>
                )}
              </div>
            </div>
          )}
          {drafts.length > 0 && (
            <div className="approval">
              <ShieldCheck size={20} className="amber" />
              <div>
                <h3>
                  {drafts.length} clarification{" "}
                  {drafts.length === 1 ? "draft needs" : "drafts need"} your
                  review
                </h3>
                <p>
                  No candidate message has been sent. Review questions and
                  source limitations before approving a portal.
                </p>
                <a
                  className="text-button"
                  href={
                    "#/applications/" +
                    drafts[0].application.id +
                    "?tab=Clarification"
                  }
                >
                  Review questions <ArrowRight size={13} />
                </a>
              </div>
              <Badge tone="amber">HR approval</Badge>
            </div>
          )}
          {attention.length > 0 && (
            <div className="notice warning">
              <b>
                {attention.length}{" "}
                {attention.length === 1
                  ? "application needs"
                  : "applications need"}{" "}
                attention
              </b>
              <p>
                Review failed jobs, changed criteria or unconfigured actions.
                Other applicants can continue independently.
              </p>
              {failed && (
                <button className="secondary" disabled={busy} onClick={run}>
                  <RefreshCw size={13} />
                  Retry failed jobs
                </button>
              )}
            </div>
          )}
          <Panel
            title="Candidates"
            aside={
              <label className="checkbox compact">
                <input
                  type="checkbox"
                  checked={blind}
                  onChange={(e) => setBlind(e.target.checked)}
                />
                Blind identifiers
              </label>
            }
          >
            <CandidateTable
              rows={rows}
              jobs={jobs}
              outbox={outbox}
              blind={blind}
            />
          </Panel>
          <div className="center-foot">
            <ShieldCheck size={13} />
            Evidence completeness, never a match score
            <span>{decisions} human decisions recorded</span>
          </div>
          {blind && (
            <p className="hint">
              Blind identifiers are a display aid. Opening original source
              documents may reveal identity.
            </p>
          )}
        </div>
        <aside>
          <ActivityPanel feed={feed} />
          <div className="adapter-panel">
            <span className="eyebrow">APPROVAL & RECOVERY</span>
            <p>
              Candidate outreach is never assumed. Portal links are shared
              manually; calendar results are confirmed by the server.
            </p>
            <a href="#/settings" className="text-button">
              Connection settings <ArrowUpRight size={12} />
            </a>
          </div>
        </aside>
      </div>
      {modal === "summary" && (
        <Modal title="Edit vacancy summary" close={() => setModal("")}>
          <form
            className="editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              perform(async () => {
                await request("/vacancies/" + id, {
                  method: "PATCH",
                  body: { title, description },
                });
                setModal("");
              }, "Vacancy summary updated.");
            }}
          >
            <label>
              Job title
              <input
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={10000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Save summary
            </button>
          </form>
        </Modal>
      )}
      {modal === "publish" && (
        <Confirm
          title="Publish this vacancy?"
          description={
            <>
              <p>
                {v.title} will accept applications with approved criteria
                version {version?.version}.
              </p>
              <p>
                No candidate contact or selection is authorized by publishing.
              </p>
            </>
          }
          label="Publish vacancy"
          close={() => setModal("")}
          confirm={() =>
            perform(async () => {
              await request("/vacancies/" + id, {
                method: "PATCH",
                body: { state: "published" },
              });
              setModal("");
            }, "Vacancy published.")
          }
        />
      )}
      {modal === "cancel" && active && (
        <Confirm
          title="Cancel this workflow?"
          description={
            <p>
              Pending work is cancelled and running leases are invalidated.
              Existing evidence and history remain available.
            </p>
          }
          label="Cancel workflow"
          close={() => setModal("")}
          confirm={() =>
            perform(async () => {
              await post("/workflow-runs/" + active.id + "/control", {
                action: "cancel",
              });
              setModal("");
            }, "Workflow cancelled.")
          }
        />
      )}
      {modal === "upload" && (
        <Modal title="Add applicant and CV" close={() => setModal("")}>
          <form
            className="editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!file) return;
              perform(async () => {
                const a = pendingUploadId
                  ? { id: pendingUploadId }
                  : await post<Application>("/applications", {
                      vacancy_id: id,
                      display_name: appName,
                      email: appEmail || null,
                    });
                setPendingUploadId(a.id);
                const body = new FormData();
                body.append("file", file);
                await post("/applications/" + a.id + "/documents", body);
                setModal("");
                setFile(undefined);
                setPendingUploadId(undefined);
              }, "Applicant and private document saved.");
            }}
          >
            <label>
              Candidate name
              <input
                disabled={Boolean(pendingUploadId)}
                required
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
              />
            </label>
            <label>
              Email (optional)
              <input
                disabled={Boolean(pendingUploadId)}
                type="email"
                value={appEmail}
                onChange={(e) => setAppEmail(e.target.value)}
              />
            </label>
            <label>
              CV · PDF or DOCX
              <input
                required
                type="file"
                accept=".pdf,.docx"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            {file && file.size > 5 * 1024 * 1024 && (
              <p role="alert" className="inline-validation">
                This file exceeds 5 MB.
              </p>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I am authorized to process this applicant document for this
              vacancy.
            </label>
            <button
              className="primary"
              disabled={busy || !file || file.size > 5 * 1024 * 1024}
            >
              {pendingUploadId
                ? "Retry upload for saved applicant"
                : "Save applicant & upload"}
            </button>
            <p className="hint">
              Files stay private and are available only through authorized
              download endpoints.
            </p>
          </form>
        </Modal>
      )}
    </>
  );
}
