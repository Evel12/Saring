import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { post } from "./api";
import { useLoad } from "./hooks";
import { loadDashboard } from "./Dashboard";
import { BriefEditor } from "./CandidateDetail";
import {
  useApp,
  PageHeading,
  Panel,
  Badge,
  Loading,
  Failed,
  Empty,
  Confirm,
} from "./ui";

export function Review({ id }: { id: string }) {
  const { revision, perform, busy } = useApp();
  const q = useLoad((signal) => loadDashboard(id, signal), [id, revision]);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [rationale, setRationale] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (q.data && !focus) {
      setFocus(q.data.rows[0]?.application.id || "");
      setSelected(q.data.rows.slice(0, 3).map((r) => r.application.id));
    }
  }, [q.data?.vacancy.id, q.data?.rows.length]);
  if (q.loading && !q.data)
    return <Loading label="Loading comparison evidence…" />;
  if (q.error) return <Failed error={q.error} retry={q.reload} />;
  if (!q.data) return null;
  const data = q.data;
  const row = data.rows.find((r) => r.application.id === focus);
  const compared = data.rows.filter((r) => selected.includes(r.application.id));
  return (
    <>
      <PageHeading
        title="Recruiter review"
        back={"#/vacancies/" + id}
        description={data.vacancy.title + " · compare sources, not scores"}
      />
      <div className="wide-page">
        <Panel title="Compare job-related evidence">
          <div className="panel-body">
            <p className="hint">
              Choose up to four applicants. A changed expectation requires
              reassessment; an older finding is not automatically support for
              the new version.
            </p>
            <div className="compare-picker">
              {data.rows.map((r) => (
                <label className="checkbox" key={r.application.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.application.id)}
                    disabled={
                      !selected.includes(r.application.id) &&
                      selected.length >= 4
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, r.application.id]
                          : selected.filter((x) => x !== r.application.id),
                      )
                    }
                  />
                  {r.candidate?.display_name || r.application.id.slice(0, 8)}
                </label>
              ))}
            </div>
          </div>
          {compared.length ? (
            <div className="table-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Approved criterion / expectation</th>
                    {compared.map((r) => (
                      <th key={r.application.id}>
                        <a
                          href={
                            "#/applications/" +
                            r.application.id +
                            "?tab=Evidence"
                          }
                        >
                          {r.candidate?.display_name ||
                            r.application.id.slice(0, 8)}
                        </a>
                        <small>
                          Review version{" "}
                          {r.brief.requirements[0]?.version || "—"}
                        </small>
                        {r.application.reassessment_required && (
                          <Badge tone="amber">Reassess</Badge>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.version?.requirements.map((criterion) => (
                    <tr key={criterion.id}>
                      <td>
                        <b>{criterion.description}</b>
                        <small>
                          {criterion.minimum_observable_expectation}
                        </small>
                        <Badge>{criterion.importance}</Badge>
                      </td>
                      {compared.map((r) => {
                        const peer = r.brief.requirements.find(
                          (x) => x.stable_id === criterion.stable_id,
                        );
                        const finding = r.brief.findings.find(
                          (f) => f.requirement_id === peer?.id,
                        )?.latest_revision;
                        return (
                          <td key={r.application.id}>
                            <Badge
                              tone={
                                finding?.state === "supported"
                                  ? "green"
                                  : finding?.state === "conflicting"
                                    ? "red"
                                    : ""
                              }
                            >
                              {finding?.state || "unknown"}
                            </Badge>
                            <small>
                              {finding?.evidence_ids.length || 0} associated
                              sources
                            </small>
                            {peer?.version !== criterion.version && (
                              <small className="amber">
                                Earlier criterion version
                              </small>
                            )}
                            <a
                              className="text-button"
                              href={
                                "#/applications/" +
                                r.application.id +
                                "?tab=Evidence"
                              }
                            >
                              Review source <ArrowRight size={11} />
                            </a>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Choose applicants to compare">
              No ranking or match probability is generated.
            </Empty>
          )}
        </Panel>
        <div className="review-workspace">
          <Panel title="Focused recruiter review">
            <div className="panel-body">
              <label>
                Application
                <select
                  value={focus}
                  onChange={(e) => {
                    setFocus(e.target.value);
                    setRationale("");
                  }}
                >
                  <option value="">Choose an application</option>
                  {data.rows.map((r) => (
                    <option key={r.application.id} value={r.application.id}>
                      {r.candidate?.display_name || r.application.id}
                    </option>
                  ))}
                </select>
              </label>
              {row ? (
                <>
                  <div className="notice">
                    <ShieldCheck size={17} />
                    <p>
                      Review the exact evidence and source limitations before a
                      decision. This does not send a candidate message.
                    </p>
                  </div>
                  <a
                    className="secondary"
                    href={
                      "#/applications/" + row.application.id + "?tab=Evidence"
                    }
                  >
                    Revise findings / inspect sources <ArrowRight size={13} />
                  </a>
                  <label>
                    Job-related shortlist rationale
                    <textarea
                      value={rationale}
                      maxLength={2000}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !rationale.trim() ||
                      row.application.reassessment_required
                    }
                    onClick={() => setConfirm(true)}
                  >
                    Review human shortlist approval
                  </button>
                  {row.application.reassessment_required && (
                    <p className="inline-validation">
                      Reassessment is required before approval.
                    </p>
                  )}
                  <p className="hint">
                    Other decisions, including rejection or hiring, require
                    explicit action in the application Overview.
                  </p>
                </>
              ) : (
                <Empty title="Select an applicant" />
              )}
            </div>
          </Panel>
          <Panel title="Interview preparation">
            <div className="panel-body">
              {row ? (
                <BriefEditor key={row.application.id} row={row} />
              ) : (
                <Empty title="No focused application" />
              )}
            </div>
          </Panel>
        </div>
      </div>
      {confirm && row && (
        <Confirm
          title="Record a human shortlist decision?"
          description={
            <>
              <p>{row.candidate?.display_name}</p>
              <p>{rationale}</p>
              <p>
                This records your decision only. Interview scheduling requires a
                separate approval.
              </p>
            </>
          }
          label="Record shortlist approval"
          close={() => setConfirm(false)}
          confirm={() =>
            perform(async () => {
              await post("/applications/" + row.application.id + "/decisions", {
                decision: "shortlist",
                rationale,
              });
              setConfirm(false);
              setRationale("");
            }, "Human shortlist recorded.")
          }
        />
      )}
    </>
  );
}
