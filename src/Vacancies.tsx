import { useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { all, post, request } from "./api";
import { useLoad, navigate } from "./hooks";
import {
  useApp,
  PageHeading,
  Panel,
  Loading,
  Failed,
  Empty,
  Badge,
} from "./ui";
import { blankCriterion, templates } from "./data";
import type {
  CriterionInput,
  Page,
  Vacancy,
  Version,
  Application,
} from "./types";

export function Vacancies() {
  const { org, revision, perform, busy } = useApp();
  const [offset, setOffset] = useState(0);
  const q = useLoad(
    async (signal) => {
      const [vacancies, apps] = await Promise.all([
        request<Page<Vacancy>>("/vacancies?limit=9&offset=" + offset, {
          signal,
        }),
        all<Application>("/applications", signal),
      ]);
      return { vacancies, apps };
    },
    [revision, offset],
  );
  return (
    <>
      <PageHeading
        title="Vacancies"
        description="A clear, job-related process for every role."
        actions={
          <>
            <a className="primary" href="#/vacancies/new">
              <Plus size={15} />
              Create vacancy
            </a>
            {org.is_demo && (
              <button className="secondary" disabled={busy} onClick={() => perform(async () => {
                const result = await post<{vacancy_ids:string[]}>("/demo/workspace", {});
                navigate("/vacancies/" + result.vacancy_ids[0]);
              }, "Two sample vacancies and five synthetic candidates loaded. Files use real parsers; model and coordination are simulated.")}>Explore complete demo</button>
            )}
            {org.is_demo && (
              <button className="secondary" disabled={busy} onClick={() => perform(async () => {
                const example = await post<{vacancy_id: string}>("/demo/clarification-example", {});
                navigate("/vacancies/" + example.vacancy_id);
              }, "Synthetic Customer Support example loaded. Run the agent to start clarification.")}>Load clarification example</button>
            )}
            {org.is_demo && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  perform(
                    () => post("/demo/sample-vacancies"),
                    "Sample vacancies loaded as drafts.",
                  )
                }
              >
                <BriefcaseBusiness size={14} />
                Load sample vacancies
              </button>
            )}
          </>
        }
      />
      <div className="wide-page">
        {q.loading && !q.data ? (
          <Loading />
        ) : q.error ? (
          <Failed error={q.error} retry={q.reload} />
        ) : (
          q.data && (
            <>
              {!q.data.vacancies.items.length ? (
                <Panel title="Your hiring workspace">
                  <Empty
                    title="Create a vacancy for any job title"
                    action={
                      <a className="primary" href="#/vacancies/new">
                        Create vacancy <ArrowRight size={14} />
                      </a>
                    }
                  >
                    Start from a blank vacancy or an editable role template.
                    Criteria are approved by a person before publication.
                  </Empty>
                </Panel>
              ) : (
                <div className="vacancy-grid">
                  {q.data.vacancies.items.map((v) => (
                    <article className="panel vacancy-card" key={v.id}>
                      <div className="label-row">
                        <span className="summary-icon">
                          <BriefcaseBusiness size={18} />
                        </span>
                        <Badge
                          tone={
                            v.state === "published"
                              ? "green"
                              : v.state === "closed"
                                ? "muted"
                                : "amber"
                          }
                        >
                          {v.state}
                        </Badge>
                      </div>
                      {v.is_sample && (
                        <div className="sample-label">
                          SYNTHETIC SAMPLE VACANCY
                        </div>
                      )}
                      <h2>
                        <a href={"#/vacancies/" + v.id}>{v.title}</a>
                      </h2>
                      <p>{v.description || "No description provided yet."}</p>
                      <div className="vacancy-card-meta">
                        <span>
                          {
                            q.data!.apps.filter(
                              (a) => a.vacancy_id === v.id && !a.withdrawn_at,
                            ).length
                          }{" "}
                          applicants
                        </span>
                        <span>
                          {v.active_requirement_version_id
                            ? "Criteria approved"
                            : "Approval required"}
                        </span>
                      </div>
                      <a className="text-button" href={"#/vacancies/" + v.id}>
                        Open workspace <ArrowRight size={13} />
                      </a>
                    </article>
                  ))}
                </div>
              )}
              <div className="pagination">
                <span>{q.data.vacancies.total} vacancies</span>
                <button
                  className="secondary"
                  disabled={!offset}
                  onClick={() => setOffset((n) => Math.max(0, n - 9))}
                >
                  Previous
                </button>
                <button
                  className="secondary"
                  disabled={!q.data.vacancies.has_more}
                  onClick={() => setOffset((n) => n + 9)}
                >
                  Next
                </button>
              </div>
            </>
          )
        )}
        {org.is_demo && (
          <p className="hint">
            Samples are isolated synthetic records. Creating a custom vacancy
            never labels it as a sample, even if you use a starter template.
          </p>
        )}
      </div>
    </>
  );
}

const evidenceTypes = [
  ["candidate_report", "Candidate explanation"],
  ["document", "CV / document"],
  ["work_sample", "Work sample"],
  ["structured_assessment", "Structured assessment"],
  ["reference", "Reference"],
];
export function CriteriaEditor({
  value,
  onChange,
}: {
  value: CriterionInput[];
  onChange: (v: CriterionInput[]) => void;
}) {
  function update(i: number, patch: Partial<CriterionInput>) {
    onChange(value.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  }
  return (
    <div className="criteria-editor">
      {value.map((r, i) => (
        <fieldset key={r.stable_id || i}>
          <legend>Criterion {i + 1}</legend>
          <div className="criterion-top">
            <label>
              Description
              <input
                aria-label={"Criterion " + (i + 1) + " description"}
                required
                maxLength={2000}
                value={r.description}
                onChange={(e) => update(i, { description: e.target.value })}
              />
            </label>
            <label>
              Importance
              <select
                aria-label={"Criterion " + (i + 1) + " importance"}
                value={r.importance}
                onChange={(e) =>
                  update(i, {
                    importance: e.target.value as CriterionInput["importance"],
                  })
                }
              >
                <option value="essential">Essential</option>
                <option value="preferred">Preferred</option>
              </select>
            </label>
          </div>
          <label>
            Minimum observable expectation
            <textarea
              aria-label={"Criterion " + (i + 1) + " expectation"}
              required
              maxLength={2000}
              value={r.minimum_observable_expectation}
              onChange={(e) =>
                update(i, { minimum_observable_expectation: e.target.value })
              }
            />
          </label>
          <div className="field-label">Acceptable evidence</div>
          <div className="check-grid">
            {evidenceTypes.map(([type, label]) => (
              <label className="checkbox" key={type}>
                <input
                  type="checkbox"
                  checked={r.acceptable_evidence_types.includes(type)}
                  onChange={(e) =>
                    update(i, {
                      acceptable_evidence_types: e.target.checked
                        ? [...r.acceptable_evidence_types, type]
                        : r.acceptable_evidence_types.filter((x) => x !== type),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {!r.acceptable_evidence_types.length && (
            <p className="inline-validation">
              Choose at least one evidence type.
            </p>
          )}
          <div className="label-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={r.clarification_permitted}
                onChange={(e) =>
                  update(i, { clarification_permitted: e.target.checked })
                }
              />
              Permit bounded clarification
            </label>
            <button
              type="button"
              className="text-button danger"
              disabled={value.length === 1}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={value.length >= 30}
        onClick={() => onChange([...value, blankCriterion()])}
      >
        <Plus size={14} />
        Add criterion
      </button>
    </div>
  );
}

export function VacancyWizard({ id }: { id?: string }) {
  const { org, perform, busy } = useApp();
  const q = useLoad(
    async (signal) => {
      if (!id) return null;
      const v = await request<Vacancy>("/vacancies/" + id, { signal });
      const versions = await all<Version>(
        "/vacancies/" + id + "/requirement-versions",
        signal,
      );
      const latest = [...versions].sort((a, b) => b.version - a.version)[0];
      const version = latest
        ? await request<Version>("/requirement-versions/" + latest.id, {
            signal,
          })
        : undefined;
      return { v, version };
    },
    [id],
  );
  if (q.loading) return <Loading label="Preparing vacancy editor…" />;
  if (q.error) return <Failed error={q.error} retry={q.reload} />;
  return <WizardForm key={id || "new"} initial={q.data || undefined} />;
}
function WizardForm({
  initial,
}: {
  initial?: { v: Vacancy; version?: Version };
}) {
  const { org, perform, busy } = useApp();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(initial?.v.title || "");
  const [description, setDescription] = useState(initial?.v.description || "");
  const [criteria, setCriteria] = useState<CriterionInput[]>(
    initial?.version?.requirements.map(
      ({
        stable_id,
        description,
        importance,
        acceptable_evidence_types,
        minimum_observable_expectation,
        clarification_permitted,
      }) => ({
        stable_id,
        description,
        importance,
        acceptable_evidence_types,
        minimum_observable_expectation,
        clarification_permitted,
      }),
    ) || [blankCriterion()],
  );
  const [vacancy, setVacancy] = useState(initial?.v);
  const [version, setVersion] = useState(initial?.version);
  const [approved, setApproved] = useState(false);
  const [rationale, setRationale] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [validation, setValidation] = useState("");
  async function save() {
    if (
      criteria.some(
        (r) =>
          !r.description.trim() ||
          !r.minimum_observable_expectation.trim() ||
          !r.acceptable_evidence_types.length,
      )
    ) {
      setValidation(
        "Complete each description, expectation and acceptable evidence type.",
      );
      return;
    }
    setValidation("");
    await perform(async () => {
      let v = vacancy;
      let versionId: string;
      if (!v) {
        v = await post<Vacancy>("/vacancies", {
          title,
          description,
          requirements: criteria,
        });
        setVacancy(v);
        const vs = await all<Version>(
          "/vacancies/" + v.id + "/requirement-versions",
        );
        versionId = vs.sort((a, b) => b.version - a.version)[0].id;
      } else {
        await request("/vacancies/" + v.id, {
          method: "PATCH",
          body: { title, description },
        });
        versionId = (
          await post<Version>("/vacancies/" + v.id + "/requirement-versions", {
            requirements: criteria,
          })
        ).id;
      }
      setVersion(await request<Version>("/requirement-versions/" + versionId));
      setApproved(false);
      setStep(2);
    }, "Draft criteria saved. HR approval is still required.");
  }
  return (
    <>
      <PageHeading
        eyebrow="VACANCY BUILDER"
        title={initial ? "Revise vacancy" : "Create a vacancy"}
        description="Custom titles always work. Templates are an optional starting point."
        actions={
          <a
            className="secondary"
            href={vacancy ? "#/vacancies/" + vacancy.id : "#/vacancies"}
          >
            Leave editor
          </a>
        }
      />
      <div className="wizard-page">
        <div className="wizard-steps">
          {[
            "Vacancy details",
            "Criteria & evidence",
            "HR approval",
            "Publication",
          ].map((name, i) => (
            <div
              key={name}
              className={i === step ? "active" : i < step ? "done" : ""}
            >
              <span>{i < step ? <Check size={13} /> : i + 1}</span>
              {name}
            </div>
          ))}
        </div>
        <Panel
          title={
            [
              "Define the vacancy",
              "Define observable, job-related criteria",
              "Review and approve criteria",
              "Publish when you are ready",
            ][step]
          }
          aside={<span className="tiny mono">STEP {step + 1} / 4</span>}
        >
          {step === 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStep(1);
              }}
              className="editor-form"
            >
              <label>
                Optional starter template
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const t = templates[e.target.value];
                    if (t) {
                      if (!title.trim()) setTitle(e.target.value);
                      setDescription(t.description);
                      setCriteria(structuredClone(t.requirements));
                    }
                  }}
                >
                  <option value="">Blank / custom vacancy</option>
                  {Object.keys(templates).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Job title
                <input
                  autoFocus
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Community Operations Coordinator"
                />
              </label>
              <label>
                Job description
                <textarea
                  maxLength={10000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the work, responsibilities and relevant context."
                />
              </label>
              <p className="hint">
                Applying a template preserves a custom title you have already
                entered.
              </p>
              <div className="form-actions">
                <button className="primary">
                  Continue to criteria <ArrowRight size={14} />
                </button>
              </div>
            </form>
          )}
          {step === 1 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="editor-form"
            >
              <div className="info-strip">
                <Sparkles size={17} />
                <div>
                  <b>Assistance, with your judgment</b>
                  <p>
                    {org.is_demo
                      ? "Demo suggestions are deterministic synthetic examples."
                      : "AI suggestions require a configured server-side provider. You can always write criteria manually."}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    perform(
                      async () => {
                        const result = await post<{
                          requirements: CriterionInput[];
                        }>(
                          org.is_demo
                            ? "/demo/requirements/suggest"
                            : "/requirements/suggest",
                          { title },
                        );
                        setCriteria(result.requirements);
                        setSuggested(true);
                      },
                      org.is_demo
                        ? "Demo suggestions loaded. Review every criterion."
                        : "AI suggestions loaded for HR review.",
                    )
                  }
                >
                  <Sparkles size={13} />
                  {busy
                    ? "Requesting…"
                    : org.is_demo
                      ? "Suggest criteria · DEMO"
                      : "Suggest criteria"}
                </button>
              </div>
              {suggested && (
                <p className="hint">
                  Suggestions are unapproved. Edit the expectations and evidence
                  types before saving.
                </p>
              )}
              <CriteriaEditor value={criteria} onChange={setCriteria} />
              {validation && (
                <p role="alert" className="inline-validation">
                  {validation}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setStep(0)}
                >
                  Back to details
                </button>
                <button className="primary" disabled={busy}>
                  Save criteria draft <ArrowRight size={14} />
                </button>
              </div>
            </form>
          )}
          {step === 2 && version && (
            <div className="editor-form">
              <div className="label-row">
                <div>
                  <h3>{title}</h3>
                  <span className="tiny">
                    Requirement version {version.version}
                  </span>
                </div>
                <Badge tone={version.state === "approved" ? "green" : "amber"}>
                  {version.state}
                </Badge>
              </div>
              {version.requirements.map((r) => (
                <div className="requirement-read" key={r.id}>
                  <h3>
                    {r.description}
                    <Badge>{r.importance}</Badge>
                  </h3>
                  <p>{r.minimum_observable_expectation}</p>
                  <div className="tags">
                    {r.acceptable_evidence_types.map((t) => (
                      <Badge key={t}>{t.replaceAll("_", " ")}</Badge>
                    ))}
                  </div>
                  <p className="hint">
                    Clarification{" "}
                    {r.clarification_permitted ? "permitted" : "not permitted"}
                  </p>
                </div>
              ))}
              <label className="checkbox review-check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I approve these job-related criteria, expectations and
                acceptable evidence. Unknown evidence must not be treated as
                inability.
              </label>
              <label>
                Approval rationale
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Confirm relevance and proportionality to this vacancy."
                />
              </label>
              {initial?.v.active_requirement_version_id && (
                <p className="hint">
                  Approving a changed version preserves history and flags
                  existing applications for reassessment.
                </p>
              )}
              <div className="form-actions">
                <button className="secondary" onClick={() => setStep(1)}>
                  Revise criteria
                </button>
                <button
                  className="primary"
                  disabled={busy || !approved || !rationale.trim()}
                  onClick={() =>
                    perform(async () => {
                      const v = await post<Version>(
                        "/requirement-versions/" + version.id + "/approve",
                        { rationale },
                      );
                      setVersion({ ...version, ...v });
                      setStep(3);
                    }, "HR approval recorded. Publication is a separate action.")
                  }
                >
                  <ShieldIcon />
                  Approve criteria version {version.version}
                </button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="editor-form">
              <div className="success-block">
                <Check size={24} />
                <div>
                  <h3>Criteria approved. Publication is your next choice.</h3>
                  <p>
                    {title} is ready to be published with approved criteria
                    version {version?.version}.
                  </p>
                </div>
              </div>
              <p className="hint">
                Publishing opens this vacancy for applications. It does not
                contact candidates or make selection decisions.
              </p>
              <div className="form-actions">
                <a className="secondary" href={"#/vacancies/" + vacancy!.id}>
                  Keep as draft
                </a>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      await request("/vacancies/" + vacancy!.id, {
                        method: "PATCH",
                        body: { state: "published" },
                      });
                      navigate("/vacancies/" + vacancy!.id);
                    }, "Vacancy published with approved criteria.")
                  }
                >
                  Publish vacancy <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </Panel>
        <p className="hint">
          Approved criteria are immutable. Editing creates a new version,
          preserving previous evidence and decisions.
        </p>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <Check size={14} />;
}
