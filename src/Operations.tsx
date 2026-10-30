import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Link2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { all, post, request } from "./api";
import { useLoad, useEvents } from "./hooks";
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
  time,
  words,
} from "./ui";
import type {
  Application,
  Candidate,
  Connection,
  Interview,
  Outbox,
} from "./types";

export function Settings() {
  const { me, org, health, revision, perform, busy, signOut } = useApp();
  const [provider, setProvider] = useState("google_calendar");
  const [calendar, setCalendar] = useState("primary");
  const [fromEmail, setFromEmail] = useState("");
  const [reset, setReset] = useState(false);
  const oauth=useLoad(signal=>me.role==="admin"?request<{state:string;detail?:string}>("/oauth/google/status",{signal}):Promise.resolve(null),[revision,me.role]);
  const q = useLoad(
    (signal) =>
      me.role === "admin"
        ? all<Connection>("/provider-connections", signal)
        : Promise.resolve([]),
    [revision, me.role],
  );
  return (
    <>
      <PageHeading
        title="Settings & integrations"
        description="Server-side credentials, explicit permissions, and truthful connection status."
      />
      <div className="operations-grid wide-page">
        <Panel title="Provider connections" aside={<Link2 size={15} />}>
          <div className="panel-body">
            {q.loading && !q.data ? (
              <Loading label="Checking organization connections…" />
            ) : q.error ? (
              <Failed error={q.error} retry={q.reload} />
            ) : me.role !== "admin" ? (
              <div className="notice warning">
                Only organization admins can inspect or configure provider
                connections. Ask an admin to review the calendar configuration.
              </div>
            ) : (
              <>
                {["google_calendar", "openai", "email"].map((name) => {
                  const c = q.data?.find((c) => c.provider === name);
                  const status =
                    org.is_demo
                        ? "Deterministic demo adapter"
                        : name === "openai" ? health.model : c?.state || "not_configured";
                  return (
                    <div className="integration-row" key={name}>
                      <span className="summary-icon">
                        <Link2 size={17} />
                      </span>
                      <div>
                        <h3>
                          {name === "google_calendar"
                            ? "Google Calendar"
                            : name === "openai"
                              ? "Model provider"
                              : "Candidate email"}
                        </h3>
                        <p>
                          {name === "email"
                            ? "Resend adapter for separately approved clarification and interview messages. Provider acceptance is not confirmed inbox delivery."
                            : name === "openai" && !org.is_demo
                              ? "Configured by OPENAI_API_KEY, OPENAI_MODEL and OPENAI_BASE_URL in the API and worker environment. Configuration is not proof of a successful model call."
                            : org.is_demo
                              ? "No real service is called by the demo workflow."
                              : c
                                ? "Saved organization connection; credentials remain server-side."
                                : "No organization connection record exists."}
                        </p>
                        {c && name !== "openai" && (
                          <small className="mono">
                            {Object.entries(c.config)
                              .map(([key, value]) => key + ": " + value)
                              .join(" · ") || "No non-secret options"}
                          </small>
                        )}
                      </div>
                      <Badge
                        tone={
                          org.is_demo
                            ? "amber"
                            : status === "configured"
                              ? "green"
                              : "amber"
                        }
                      >
                        {words(status)}
                      </Badge>
                    </div>
                  );
                })}
                <div className="notice">
                  <ShieldCheck size={17} />
                  <p>
                    Configuration records are not proof that a provider call
                    succeeded. Calendar and messaging actions keep their
                    persisted result: queued, completed, simulated, failed or
                    not configured.
                  </p>
                </div>
                <div className="round-card"><h3>Google Calendar OAuth</h3><Badge>{oauth.data?.state || "disconnected"}</Badge>{oauth.error&&<Failed error={oauth.error} retry={oauth.reload}/>}<p className="hint">Access is limited to availability and events on calendars owned by the connected account. Tokens stay encrypted on the server. Interviewer calendars must be accessible for free/busy queries.</p><button className="secondary" disabled={busy} onClick={()=>perform(async()=>{const result=await post<{authorization_url:string|null}>("/oauth/google/start",{});if(result.authorization_url)window.location.assign(result.authorization_url);},"Calendar connection request processed. DEMO uses a synthetic adapter.")}>Connect Google Calendar</button><button className="secondary" disabled={busy||org.is_demo} onClick={()=>perform(()=>post("/oauth/google/disconnect",{}),"Google Calendar disconnected locally. Check provider revocation status separately.")}>Disconnect Google Calendar</button></div>
                <h3>Save non-secret connection configuration</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    perform(
                      () =>
                        post("/provider-connections", {
                          provider,
                          config:
                            provider === "google_calendar"
                              ? { calendar_id: calendar }
                              : {from_email: fromEmail},
                        }),
                      "Connection options saved. Server credentials must be configured separately.",
                    );
                  }}
                >
                  <label>
                    Provider
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      <option value="google_calendar">Google Calendar</option>
                      <option value="email">Email adapter status</option>
                    </select>
                  </label>
                  {provider === "google_calendar" && (
                    <label>
                      Calendar ID
                      <input
                        required
                        maxLength={500}
                        value={calendar}
                        onChange={(e) => setCalendar(e.target.value)}
                      />
                    </label>
                  )}
                  <p className="hint">Model selection and credentials are configured in the server environment; this form changes calendar and email options only.</p>
                  {provider === "email" && <label>Verified sender email<input type="email" required value={fromEmail} onChange={e=>setFromEmail(e.target.value)} placeholder="recruitment@example.com"/></label>}
                  <button className="primary" disabled={busy}>
                    Save connection options
                  </button>
                </form>
                <p className="hint">
                  No API keys or OAuth access tokens are accepted in this
                  browser. An administrator supplies organization credentials
                  through the server/worker environment.
                </p>
              </>
            )}
          </div>
        </Panel>
        <div>
          <Panel title="Workspace">
            <div className="panel-body">
              <label>Organization</label>
              <p>{org.name}</p>
              <label>Your role</label>
              <Badge>{me.role}</Badge>
              <div className="settings-details">
                <div>
                  <span>Workspace data</span>
                  <b>
                    {org.is_demo
                      ? "Synthetic DEMO"
                      : "Authenticated organization"}
                  </b>
                </div>
                <div>
                  <span>Suggestion adapter</span>
                  <b>{org.is_demo ? "Deterministic demo" : health.model}</b>
                </div>
                <div>
                  <span>API schema</span>
                  <b>{health.schema}</b>
                </div>
                <div>
                  <span>Authentication</span>
                  <b>HttpOnly session</b>
                </div>
                <div>
                  <span>Theme preference</span>
                  <b>Use the header theme selector</b>
                </div>
              </div>
              <button className="secondary" onClick={signOut}>
                Sign out of this session
              </button>
            </div>
          </Panel>
          {org.is_demo && (
            <Panel title="Isolated demo reset">
              <div className="panel-body">
                <p>
                  Reset only your synthetic organization. Other demo visitors
                  and real organizations are unaffected.
                </p>
                <button
                  className="secondary danger"
                  onClick={() => setReset(true)}
                >
                  Review sandbox reset
                </button>
              </div>
            </Panel>
          )}
        </div>
      </div>
      {reset && (
        <Confirm
          title="Reset your synthetic sandbox?"
          description={
            <p>
              This removes only this demo workspace’s synthetic vacancies,
              applications, drafts and history. It rotates to a new isolated
              demo session.
            </p>
          }
          label="Reset my demo sandbox"
          close={() => setReset(false)}
          confirm={() =>
            perform(async () => {
              await post("/demo/reset");
              location.assign("/");
            }, "Demo sandbox reset.")
          }
        />
      )}
    </>
  );
}

export function CalendarView() {
  const { revision, perform, busy, org } = useApp();
  const q = useLoad(
    async (signal) => {
      const [applications, candidates, outbox, coordinations] = await Promise.all([
        all<Application>("/applications", signal),
        all<Candidate>("/candidates", signal),
        all<Outbox>("/outbox", signal),
        all<{id:string;application_id:string;state:string;error:string;provider_event_id:string}>("/interview-coordinations",signal),
      ]);
      const interviews = (
        await Promise.all(
          applications.map((a) =>
            all<Interview>("/applications/" + a.id + "/interviews", signal),
          ),
        )
      ).flat();
      return { applications, candidates, outbox, interviews, coordinations };
    },
    [revision],
  );
  return (
    <>
      <PageHeading
        title="Interview calendar"
        description="Proposals, approved actions and confirmed results stay distinct."
        actions={
          <a className="secondary" href="#/settings">
            <SlidersHorizontal size={14} />
            Calendar configuration
          </a>
        }
      />
      <div className="wide-page">
        <div className="notice">
          <CalendarDays size={18} />
          <p>
            {org.is_demo
              ? "DEMO bookings are simulated records. No real calendar or candidate inbox is touched."
              : "Live availability and event creation require organization calendar credentials. A queued action is not a confirmed booking."}
          </p>
        </div>
        {q.loading && !q.data ? (
          <Loading label="Loading interview proposals and action results…" />
        ) : q.error ? (
          <Failed error={q.error} retry={q.reload} />
        ) : (
          q.data && (
            <Panel
              title="Interview coordination"
              aside={<Badge>{q.data.interviews.length} records</Badge>}
            >
              {q.data.coordinations.map(coord=><div className="calendar-card" key={coord.id}><div className="label-row"><a href={"#/applications/"+coord.application_id+"?tab=Interview"}>Review interview coordination</a><Badge>{words(coord.state)}</Badge></div>{coord.error&&<p>{coord.error}</p>}<p className="tiny">Provider event reference: {coord.provider_event_id}</p></div>)}
              {!q.data.interviews.length ? (
                <Empty
                  title="No interviews proposed yet"
                  action={
                    <a className="secondary" href="#/vacancies">
                      Review applicants <ArrowRight size={13} />
                    </a>
                  }
                >
                  A recruiter must shortlist the applicant and approve an interview invitation plan. The candidate selects an explicit dated option before booking.
                </Empty>
              ) : (
                <div className="calendar-list">
                  {q.data.interviews
                    .sort((a, b) => a.starts_at - b.starts_at)
                    .map((i) => {
                      const a = q.data!.applications.find(
                        (a) => a.id === i.application_id,
                      );
                      const candidate = q.data!.candidates.find(
                        (c) => c.id === a?.candidate_id,
                      );
                      const action = q
                        .data!.outbox.filter((o) => o.interview_id === i.id)
                        .at(-1);
                      return (
                        <article className="calendar-card" key={i.id}>
                          <div className="calendar-date">
                            <span>
                              {new Date(i.starts_at * 1000).toLocaleDateString(
                                [],
                                { month: "short" },
                              )}
                            </span>
                            <b>{new Date(i.starts_at * 1000).getDate()}</b>
                          </div>
                          <div>
                            <h3>
                              {candidate?.display_name ||
                                "Application " + i.application_id.slice(0, 8)}
                            </h3>
                            <p>
                              {time(i.starts_at)} · {i.timezone} ·{" "}
                              {(i.ends_at - i.starts_at) / 60} min
                            </p>
                            <div className="tags">
                              <Badge
                                tone={
                                  i.state === "simulated"
                                    ? "amber"
                                    : i.state === "booked"
                                      ? "green"
                                      : ""
                                }
                              >
                                {i.state === "simulated"
                                  ? "DEMO simulated booking"
                                  : words(i.state)}
                              </Badge>
                              {action && (
                                <Badge
                                  tone={
                                    ["not_configured", "failed"].includes(
                                      action.state,
                                    )
                                      ? "amber"
                                      : ""
                                  }
                                >
                                  Action: {words(action.state)}
                                </Badge>
                              )}
                            </div>
                            {action?.error && (
                              <p className="inline-validation">
                                {action.error}
                              </p>
                            )}
                            <a
                              className="text-button"
                              href={
                                "#/applications/" +
                                i.application_id +
                                "?tab=Interview"
                              }
                            >
                              Review application & slot <ArrowRight size={12} />
                            </a>
                          </div>
                          {action &&
                            ["not_configured", "failed"].includes(
                              action.state,
                            ) && (
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  perform(
                                    () =>
                                      post("/outbox/" + action.id + "/retry"),
                                    "Approved action requeued. Check its persisted result.",
                                  )
                                }
                              >
                                <RefreshCw size={13} />
                                Retry approved action
                              </button>
                            )}
                        </article>
                      );
                    })}
                </div>
              )}
            </Panel>
          )
        )}
      </div>
    </>
  );
}

export function Metrics() {
  const { revision, refresh, org } = useApp();
  const feed = useEvents({}, refresh);
  const q = useLoad(
    async (signal) => ({
      summary: await request<Record<string, number | string | null | Record<string, number>>>("/metrics", { signal }),
      history: await all<{
        id: string;
        name: string;
        value: number;
        created_at: number;
      }>("/metrics/history", signal),
    }),
    [revision],
  );
  const labels: Record<string, string> = {
    applications: "Applications",
    reassessment_required: "Need reassessment",
    jobs_queued: "Queued jobs",
    jobs_failed: "Failed jobs",
    outbox_blocked: "Unconfigured actions",
    interviews_booked: org.is_demo
      ? "Simulated interviews"
      : "Booked interviews",
  };
  return (
    <>
      <PageHeading
        title="Operational metrics"
        description="Measured server activity, not predictions about candidates."
      />
      <div className="metrics-layout wide-page">
        <div>
          {q.loading && !q.data ? (
            <Loading label="Reading persisted metrics…" />
          ) : q.error ? (
            <Failed error={q.error} retry={q.reload} />
          ) : (
            q.data && (
              <>
                <div className="metric-grid">
                    {Object.entries(q.data.summary).filter(([, value]) => typeof value === "number" || value === null).map(([key, value]) => (
                    <article className="panel metric-card" key={key}>
                      <span className="field-label">
                        {labels[key] || words(key)}
                      </span>
                        <strong>{value === null ? "Not measured" : String(value)}</strong>
                      <span className="tiny">
                          {key.includes("cost") ? "Estimated USD · configured prices and recorded usage" : key.includes("seconds") ? "Observed processing time · excludes waiting" : "Current organization · persisted observation"}
                      </span>
                    </article>
                  ))}
                </div>
                <Panel title="Recorded worker observations">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Recorded</th>
                          <th>Metric</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.data.history
                          .slice(-50)
                          .reverse()
                          .map((m) => (
                            <tr key={m.id}>
                              <td>{time(m.created_at)}</td>
                              <td className="mono">{m.name}</td>
                              <td>
                                {m.name.endsWith("_seconds")
                                  ? m.value.toFixed(2) + " s"
                                  : m.value}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!q.data.history.length && (
                      <Empty title="No measured work yet">
                        Run an evidence workflow or an approved outbox action to
                        record observations.
                      </Empty>
                    )}
                  </div>
                  <p className="muted">Processing time excludes candidate and HR waits. Interrupted attempts have unknown duration. Provider token usage covers committed analysis and clarification; failed calls may still be billed. Missing usage or prices stay unmeasured. Active HR review time and manual baselines are not instrumented. Evidence coverage does not measure accuracy or hiring success.</p>
                </Panel>
                <p className="hint">
                  Recent 50 recorded observations. A missing measurement is not
                  displayed as zero latency or a successful delivery.
                </p>
              </>
            )
          )}
        </div>
        <ActivityPanel feed={feed} />
      </div>
    </>
  );
}
