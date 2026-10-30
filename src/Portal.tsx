import {SchedulingPortal} from "./SchedulingPortal";
import { useEffect, useState } from "react";
import { ArrowRight, Check, FileText, ShieldCheck } from "lucide-react";
import { ApiError, post, request, selectOrganization } from "./api";
import { useLoad } from "./hooks";
import { Badge, Empty, Failed, Loading, Modal, time, words } from "./ui";
import type { Health, Me, Permissions } from "./types";
type PortalApplication = {
  id: string;
  vacancy_title: string;
  application_status: string;
  demo: boolean;
  profile: { display_name: string; email: string | null };
  clarification: {
    id: string;
    state: string;
    deadline?: number | null;
    invitation_expires_at?: number;
    questions: { id: string; text: string }[];
  } | null;
};
type Receipt = {
  application_id: string;
  application_status: string;
  submitted_at: number;
};
type SubmittedAnswer = {id: string; question_id: string; text: string};
export function Portal({
  token,
  applicationId,
}: {
  token?: string;
  applicationId?: string;
}) {
  useEffect(() => selectOrganization(""), []);
  const [id, setId] = useState(applicationId || "");
  const [me, setMe] = useState<Me>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(
    localStorage.getItem("saring-theme") || "system",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [submittedAnswers, setSubmittedAnswers] = useState<SubmittedAnswer[]>([]);
  const [correctionId, setCorrectionId] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<Permissions>({
    public_links: false,
    work_samples: false,
    followup: false,
  });
  const [saved, setSaved] = useState<number>();
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState<Receipt>();
  const boot = useLoad(
    async (signal) => {
      const health = await request<Health>("/api/health", { signal });
      let session: Me | undefined;
      try {
        session = await request<Me>("/auth/me", { signal });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
      }
      let submitted: (Receipt & {responses: SubmittedAnswer[]}) | undefined;
      if (!session && applicationId) {
        try { submitted = await request<Receipt & {responses: SubmittedAnswer[]}>("/candidate/applications/"+applicationId+"/submission", {signal}); }
        catch(e) { if (!(e instanceof ApiError) || ![401,404].includes(e.status)) throw e; }
      }
      return { health, session, submitted };
    },
    [attempt],
  );
  useEffect(() => {
    if (boot.data?.submitted) { setReceipt(boot.data.submitted); setSubmittedAnswers(boot.data.submitted.responses); }
    const session = boot.data?.session;
    if (
      session?.role === "candidate" &&
      !token &&
      (!applicationId || session.application_id === applicationId)
    ) {
      setMe(session);
      setId(session.application_id!);
      history.replaceState(null, "", "#/candidate/" + session.application_id);
    }
  }, [boot.data]);
  const q = useLoad(
    async (signal) => {
      if (!id || !me) return null;
      const application = await request<PortalApplication>(
        "/candidate/applications/" + id,
        { signal },
      );
      const [draft, source] = await Promise.all([
        me.scopes.includes("clarification:respond") &&
        application.clarification?.state === "approved"
          ? request<{
              responses: { question_id: string; text: string; disposition?: string; artifact_document_id?: string }[];
              updated_at: number | null;
            }>("/candidate/applications/" + id + "/draft", { signal })
          : Promise.resolve({ responses: [], updated_at: null }),
        request<Permissions>(
          "/candidate/applications/" + id + "/source-permissions",
          { signal },
        ),
      ]);
      return { application, draft, source };
    },
    [id, me?.application_id, attempt],
  );
  useEffect(() => {
    if (q.data && !dirty) {
      setAnswers(
        Object.fromEntries(
          q.data.draft.responses.map((r) => [r.question_id, r.text]),
        ),
      );
      setChoices(Object.fromEntries(q.data.draft.responses.map(r=>[r.question_id, r.disposition || "answer"])));
      setArtifacts(Object.fromEntries(q.data.draft.responses.map(r=>[r.question_id, r.artifact_document_id || ""])));
      setSaved(q.data.draft.updated_at || undefined);
      setName(q.data.application.profile.display_name);
      setEmail(q.data.application.profile.email || "");
      setPermissions(q.data.source);
    }
  }, [q.data]);
  async function act(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const application = q.data?.application;
  const questions = application?.clarification?.questions || [];
  const responseBody = {
    responses: questions.map((q) => ({
      question_id: q.id,
      text: answers[q.id] || "",
      disposition: choices[q.id] || "answer",
      artifact_document_id: artifacts[q.id] || null,
    })),
  };
  return (
    <div className="portal-page">
      <div className="portal-heading">
        <a className="brand" href="#/vacancies">
          saring<span>.</span>
        </a>
        <select
          aria-label="Color theme"
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value);
            localStorage.setItem("saring-theme", e.target.value);
            document.documentElement.dataset.theme = e.target.value;
          }}
        >
          <option value="system">System theme</option>
          <option value="light">Light theme</option>
          <option value="dark">Dark theme</option>
        </select>
      </div>
      {(application ? application.demo : boot.data?.health.mode === "demo") && (
        <div className="portal-demo">
          DEMO · isolated synthetic application · no real candidate contact
        </div>
      )}
      <div className="portal-card">
        <span className="eyebrow">PRIVATE CANDIDATE WORKSPACE</span>
        <h1>
          {receipt
            ? "Your answers are submitted"
            : application?.vacancy_title || "Your application"}
        </h1>
        {error && (
          <div className="notice danger-notice" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice success" role="status">
            {notice}
          </div>
        )}
        {boot.loading ? (
          <Loading label="Checking your invitation session…" />
        ) : boot.error ? (
          <Failed error={boot.error} retry={boot.reload} />
        ) : receipt ? (
          <>
            <div className="success-block">
              <Check size={25} />
              <div>
                <h3>Submitted for recruiter review</h3>
                <p>
                  Recorded {time(receipt.submitted_at)} for application{" "}
                  {receipt.application_id.slice(0, 8)}.
                </p>
              </div>
            </div>
            <p>
              Your answers remain candidate-reported information. A recruiter
              will review the job-related evidence and make any selection
              decision.
            </p>
            <div className="notice">
              <ShieldCheck size={18} />
              <p>
                Submission closes access to the original questions. Within the active session you can append one factual correction per answer below. No automatic hiring decision has been made.
              </p>
            </div>
            {submittedAnswers.map(answer=><details className="portal-section" key={answer.id}><summary>Submitted answer · factual correction</summary><p>{answer.text || "No answer supplied"}</p><button className="secondary" onClick={()=>{setCorrectionId(answer.id);setCorrectionText(answer.text);setCorrectionReason("");}}>Correct this answer</button></details>)}
          </>
        ) : !me ? (
          <>
            <p>
              This private invitation gives access only to your application and
              the questions your recruiter approved.
            </p>
            {boot.data?.session?.role !== "candidate" && boot.data?.session && (
              <div className="notice warning">
                You are signed in as a recruiter. Continuing replaces this
                browser’s recruiter session. Use a private window to preview as
                a candidate.
              </div>
            )}
            {token ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const result = await post<{ application_id: string }>(
                      "/auth/invitations/exchange",
                      { token },
                    );
                    const session = await request<Me>("/auth/me");
                    setMe(session);
                    setId(result.application_id);
                    history.replaceState(
                      null,
                      "",
                      "#/candidate/" + result.application_id,
                    );
                  })
                }
              >
                Continue with private invitation <ArrowRight size={14} />
              </button>
            ) : (
              <Empty title="Your candidate session is unavailable">
                The invitation may be expired, revoked or already submitted. Ask
                your recruiter for a new scoped invitation.
              </Empty>
            )}
            <p className="hint">
              Invitations expire, can be revoked and cannot be exchanged twice.
            </p>
          </>
        ) : q.loading ? (
          <Loading label="Loading only your permitted application fields…" />
        ) : q.error ? (
          <Failed error={q.error} retry={q.reload} />
        ) : (
          application && (
            <>
              <div className="portal-status">
                <span>Application {application.id.slice(0, 8)}</span>
                <Badge>{words(application.application_status)}</Badge>
                <button
                  className="text-button"
                  onClick={() => {
                    setAttempt((n) => n + 1);
                  }}
                >
                  Refresh status
                </button>
              </div>
              <p>
                Share factual, job-related context. You may leave a question
                blank or say you do not have an example. Do not include
                sensitive or irrelevant personal information.
              </p>
              {me.scopes.includes("interview:schedule") && <SchedulingPortal applicationId={id}/>}
              <details className="portal-section">
                <summary>Factual profile corrections</summary>
                <p className="hint">
                  Your request is reviewed by the recruiter. It does not change
                  your evidence or infer personal characteristics.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      () =>
                        post(
                          "/candidate/applications/" +
                            id +
                            "/profile-corrections",
                          { display_name: name, email: email || null },
                        ),
                      "Correction request saved for your recruiter.",
                    );
                  }}
                >
                  <label>
                    Your name
                    <input
                      required
                      maxLength={160}
                      disabled={!me.scopes.includes("profile:correct")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      maxLength={254}
                      disabled={!me.scopes.includes("profile:correct")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || !me.scopes.includes("profile:correct")}
                  >
                    Request factual correction
                  </button>
                  {!me.scopes.includes("profile:correct") && (
                    <p className="hint">
                      This invitation does not permit profile corrections.
                      Contact your recruiter.
                    </p>
                  )}
                </form>
              </details>
              <details className="portal-section">
                <summary>Consent and optional source permissions</summary>
                <p className="hint">
                  These choices are optional and can be changed while this
                  invitation is active. They do not grant access to other
                  applications or verify any source. Saring does not
                  automatically fetch public profiles or contact references.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    disabled={!me.scopes.includes("permissions:write")}
                    checked={permissions.public_links}
                    onChange={(e) =>
                      setPermissions({
                        ...permissions,
                        public_links: e.target.checked,
                      })
                    }
                  />
                  I permit review of job-related public links I choose to
                  provide.
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    disabled={!me.scopes.includes("permissions:write")}
                    checked={permissions.work_samples}
                    onChange={(e) =>
                      setPermissions({
                        ...permissions,
                        work_samples: e.target.checked,
                      })
                    }
                  />
                  I permit requests for relevant work samples, subject to
                  confidentiality.
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    disabled={!me.scopes.includes("permissions:write")}
                    checked={permissions.followup}
                    onChange={(e) =>
                      setPermissions({
                        ...permissions,
                        followup: e.target.checked,
                      })
                    }
                  />
                  I permit follow-up about this application.
                </label>
                <button
                  className="secondary"
                  disabled={busy || !me.scopes.includes("permissions:write")}
                  onClick={() =>
                    act(
                      () =>
                        post(
                          "/candidate/applications/" +
                            id +
                            "/source-permissions",
                          permissions,
                        ),
                      "Your permission choices have been saved.",
                    )
                  }
                >
                  Save permission choices
                </button>
                {!me.scopes.includes("permissions:write") && (
                  <p className="hint">
                    This invitation provides read-only access to source
                    permissions.
                  </p>
                )}
              </details>
              {questions.length &&
              me.scopes.includes("clarification:respond") ? (
                <form
                  className="portal-answers"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setConfirm(true);
                  }}
                >
                  <div className="label-row">
                    <h2>Clarification questions</h2>
                    <Badge>{questions.length} / 3</Badge>
                  </div>
                  {application?.clarification?.deadline && <p className="hint">Response deadline: {time(application.clarification.deadline)}. You may decline or provide an alternative. No response is not a finding about your ability.</p>}
                  {application?.clarification?.invitation_expires_at && <p className="tiny">Invitation link expires: {time(application.clarification.invitation_expires_at)}. An active session can expire earlier; contact your recruiter if needed.</p>}
                  {questions.map((q, i) => (
                    <label key={q.id}>
                      <span className="question-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {q.text}
                      <select aria-label={`Response choice ${i+1}`} value={choices[q.id] || "answer"} onChange={e=>{setChoices({...choices,[q.id]:e.target.value});setDirty(true);}}><option value="answer">Provide an example</option><option value="alternative">Offer an alternative</option><option value="decline">Decline to answer</option></select>
                      <textarea
                        maxLength={2000}
                        value={answers[q.id] || ""}
                        onChange={(e) => {
                          setAnswers({ ...answers, [q.id]: e.target.value });
                          setDirty(true);
                        }}
                      />
                      <span className="tiny">
                        {(answers[q.id] || "").length} / 2,000 · optional
                      </span>
                      {me.scopes.includes("document:upload") && !application?.demo && <span>Optional relevant PDF/DOCX artifact<input type="file" accept=".pdf,.docx" disabled={busy} aria-label={`Artifact for question ${i+1}`} onChange={e=>{const file=e.target.files?.[0];if(!file)return;act(async()=>{const body=new FormData();body.append("file",file);const doc=await post<{id:string}>("/candidate/applications/"+id+"/documents",body);setArtifacts({...artifacts,[q.id]:doc.id});setDirty(true);},"Private artifact uploaded. Its presence does not establish authorship or expertise.");}}/></span>}
                      {artifacts[q.id] && <span className="tiny">Private artifact attached · authorship unverified</span>}
                    </label>
                  ))}
                  <div className="draft-status" role="status">
                    {dirty
                      ? "Unsaved edits in this tab"
                      : saved
                        ? "Draft saved on server " + time(saved)
                        : "No saved draft yet"}
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const result = await post<{ updated_at: number }>(
                            "/candidate/applications/" + id + "/draft",
                            responseBody,
                          );
                          setSaved(result.updated_at);
                          setDirty(false);
                        }, "Draft saved on the server. You can return with this session before expiry.")
                      }
                    >
                      Save draft
                    </button>
                    <button className="primary" disabled={busy}>
                      Review before submitting <ArrowRight size={14} />
                    </button>
                  </div>
                  <p className="hint">
                    Saving a draft does not submit it. Your private draft is not
                    a recruiter finding.
                  </p>
                </form>
              ) : (
                <Empty title="No questions awaiting your response">
                  Your recruiter will contact you if more context is needed.
                </Empty>
              )}
            </>
          )
        )}
      </div>
      <div className="portal-footer">
        <ShieldCheck size={14} />
        Application-scoped access · factual context · human review
      </div>
      {confirm && (
        <Modal
          error={error}
          title="Confirm your clarification submission"
          close={() => setConfirm(false)}
        >
          <div className="editor-form">
            <p>
              Review these answers. Submission closes this invitation; a
              recruiter will review them as self-reported context.
            </p>
            {questions.map((q) => (
              <div className="submission-answer" key={q.id}>
                <h3>{q.text}</h3>
                <p>{answers[q.id] || "(No answer supplied)"}</p>
              </div>
            ))}
            <div className="form-actions">
              <button className="secondary" onClick={() => setConfirm(false)}>
                Keep editing
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const result = await post<Receipt>(
                      "/candidate/applications/" + id + "/responses",
                      responseBody,
                    );
                    setReceipt(result);
                    const submitted = await request<{responses: SubmittedAnswer[]}>("/candidate/applications/"+id+"/submission");
                    setSubmittedAnswers(submitted.responses);
                    setConfirm(false);
                    setAnswers({});
                  })
                }
              >
                Submit factual answers
              </button>
            </div>
          </div>
        </Modal>
      )}
      {correctionId && <Modal error={error} title="Append a factual answer correction" close={()=>setCorrectionId("")}><form className="editor-form" onSubmit={e=>{e.preventDefault();act(async()=>{await post("/candidate/applications/"+id+"/answer-corrections",{response_id:correctionId,text:correctionText,reason:correctionReason});setCorrectionId("");},"Correction appended; original retained. Evidence update resumes automatically.");}}><label>Corrected factual answer<textarea required maxLength={2000} value={correctionText} onChange={e=>setCorrectionText(e.target.value)}/></label><label>Reason for correction<input required maxLength={500} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)}/></label><p className="hint">One correction per answer within the active session and approved deadline. This adds candidate-reported evidence and retains the original.</p><button className="primary" disabled={busy}>Submit factual correction</button></form></Modal>}
    </div>
  );
}
