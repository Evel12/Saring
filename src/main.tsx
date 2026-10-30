import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
} from "lucide-react";
import { ApiError, all, post, request, selectOrganization } from "./api";
import { useHash, useLoad, navigate } from "./hooks";
import { AppContext, Failed, Loading } from "./ui";
import { Vacancies, VacancyWizard } from "./Vacancies";
import { Dashboard } from "./Dashboard";
import { CandidateDetail } from "./CandidateDetail";
import { Review } from "./Review";
import { CalendarView, Metrics, Settings } from "./Operations";
import { Portal } from "./Portal";
import type { Health, Me, Org, Run } from "./types";
import "./style.css";
import "./workspace.css";

function Root() {
  document.documentElement.dataset.theme =
    localStorage.getItem("saring-theme") || "system";
  const route = useHash();
  const invitation =
    new URLSearchParams(route.startsWith("/") ? "" : route).get("invite") ||
    new URLSearchParams(route.startsWith("/") ? "" : route).get("portal");
  if (invitation) return <Portal token={invitation} />;
  if (route.startsWith("/candidate/"))
    return <Portal applicationId={route.split("/")[2]} />;
  return <RecruiterApp route={route} />;
}
function RecruiterApp({ route }: { route: string }) {
  const [bootstrap, setBootstrap] = useState(0);
  const [organization, setOrganization] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; error: boolean }>();
  const [theme, setTheme] = useState(
    localStorage.getItem("saring-theme") || "system",
  );
  const [login, setLogin] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Theme is the only browser-persisted preference; credentials and candidate drafts stay off localStorage.
  document.documentElement.dataset.theme = theme;
  const q = useLoad(
    async (signal) => {
      const health = await request<Health>("/api/health", { signal });
      let me: Me | undefined;
      try {
        me = await request<Me>("/auth/me", { signal });
      } catch (e) {
        if (!(e instanceof ApiError) || ![401, 403].includes(e.status)) throw e;
      }
      if (!me && health.mode === "demo" && !login && !signedOut) {
        await post("/api/demo-session");
        me = await request<Me>("/auth/me", { signal });
      }
      const org =
        me && me.role !== "candidate"
          ? await request<Org>("/organization", { signal })
          : undefined;
      return { health, me, org };
    },
    [bootstrap, organization],
  );
  async function perform(fn: () => Promise<unknown>, message?: string) {
    if (busy) return false;
    setBusy(true);
    setFlash(undefined);
    try {
      await fn();
      setRevision((n) => n + 1);
      if (message) setFlash({ text: message, error: false });
      return true;
    } catch (e) {
      setFlash({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }
  function signOut() {
    perform(async () => {
      await post("/auth/logout");
      selectOrganization("");
      setOrganization("");
      setSignedOut(true);
      setLogin(true);
      setBootstrap((n) => n + 1);
      navigate("/vacancies");
    }, "Session signed out.");
  }
  function changeTheme(value: string) {
    setTheme(value);
    localStorage.setItem("saring-theme", value);
  }
  const session = q.data?.me;
  const agent = useLoad(
    (signal) =>
      q.data?.org ? all<Run>("/workflow-runs", signal) : Promise.resolve([]),
    [q.data?.org?.id, revision, route.split("?")[0]],
  );
  const agentActive = agent.data?.some((r) =>
    ["queued", "running"].includes(r.state),
  );
  const agentPaused =
    !agentActive && agent.data?.some((r) => r.state === "paused");
  const org = q.data?.org;
  const demo = org?.is_demo;
  const page = route.split("?")[0];
  const segments = page.split("/").filter(Boolean);
  const tab =
    new URLSearchParams(route.split("?")[1] || "").get("tab") || "Overview";
  let content: ReactNode;
  if (q.loading) content = <Loading label="Connecting to Saring API…" />;
  else if (q.error)
    content = (
      <div className="wide-page">
        <Failed error={q.error} retry={q.reload} />
      </div>
    );
  else if (session?.role === "candidate")
    content = (
      <div className="auth-page">
        <h1>Candidate session active</h1>
        <p>This session is restricted to one candidate application.</p>
        <a className="primary" href={"#/candidate/" + session.application_id}>
          Open permitted application
        </a>
        <button className="secondary" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  else if (!session || !org)
    content = (
      <form
        className="auth-page panel"
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            await post("/auth/login", { email, password });
            setPassword("");
            setLogin(false);
            setSignedOut(false);
            setBootstrap((n) => n + 1);
          }, "Recruiter session established.");
        }}
      >
        <div className="eyebrow">RECRUITER ACCESS</div>
        <h1>Sign in to your workspace</h1>
        <p>
          Use an organization account. Sessions are private, revocable and
          protected by secure cookie authentication.
        </p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Sign in
        </button>
        {q.data?.health.mode === "demo" && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await post("/api/demo-session");
                setSignedOut(false);
                setLogin(false);
                setBootstrap((n) => n + 1);
              }, "Isolated synthetic demo session opened.")
            }
          >
            Open isolated demo workspace
          </button>
        )}
        <p className="hint">
          An administrator provisions accounts through the local CLI. No shared
          bearer token is used.
        </p>
      </form>
    );
  else {
    if (segments[0] === "vacancies" && segments[1] === "new")
      content = <VacancyWizard />;
    else if (segments[0] === "vacancies" && segments[2] === "edit")
      content = <VacancyWizard id={segments[1]} />;
    else if (segments[0] === "vacancies" && segments[1])
      content = <Dashboard key={segments[1]} id={segments[1]} />;
    else if (segments[0] === "applications" && segments[1])
      content = (
        <CandidateDetail key={segments[1]} id={segments[1]} initialTab={tab} />
      );
    else if (segments[0] === "review" && segments[1])
      content = <Review id={segments[1]} />;
    else if (page === "/calendar") content = <CalendarView />;
    else if (page === "/settings") content = <Settings />;
    else if (page === "/metrics") content = <Metrics />;
    else content = <Vacancies />;
    content = (
      <AppContext.Provider
        key={org.id}
        value={{
          me: session,
          org,
          health: q.data!.health,
          revision,
          refresh: () => setRevision((n) => n + 1),
          perform,
          busy,
          error: flash?.error ? flash.text : undefined,
          signOut,
        }}
      >
        {content}
      </AppContext.Provider>
    );
  }
  return (
    <>
      <a
        className="skip-link"
        href="#workspace-content"
        onClick={(e) => {
          e.preventDefault();
          const content = document.getElementById("workspace-content");
          (content?.querySelector("h1") || content)?.focus();
          content?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to content
      </a>
      <header>
        <a className="brand" href="#/vacancies">
          <span className="brand-mark">s</span>
          <b>
            saring<span>.</span>
          </b>
        </a>
        <span className="header-divider" />
        <span className="product-name">Recruitment workspace</span>
        {q.data && (
          <span className="mode">
            {demo
              ? "DEMO"
              : session
                ? "LIVE"
                : q.data.health.mode.toUpperCase()}
          </span>
        )}
        <div className="header-right">
          {session && session.role !== "candidate" && (
            <div
              className={
                "agent-state " +
                (agentActive ? "running" : agentPaused ? "paused" : "idle")
              }
              title="Latest persisted workflow status"
            >
              <i />
              <span>
                {agent.error
                  ? "Agent status unavailable"
                  : agent.loading && !agent.data
                    ? "Checking agent…"
                    : agentActive
                      ? "Workflow queued / active"
                      : agentPaused
                        ? "Workflow paused"
                        : "Agent idle"}
              </span>
            </div>
          )}
          {session?.memberships.length && session.memberships.length > 1 ? (
            <select
              aria-label="Organization"
              value={organization || session.organization_id}
              onChange={(e) => {
                selectOrganization(e.target.value);
                setOrganization(e.target.value);
                navigate("/vacancies");
              }}
            >
              {session.memberships.map((m) => (
                <option key={m.org_id} value={m.org_id}>
                  {m.organization_name}
                </option>
              ))}
            </select>
          ) : (
            <span className="organization-name">{org?.name}</span>
          )}
          <select
            aria-label="Color theme"
            value={theme}
            onChange={(e) => changeTheme(e.target.value)}
          >
            <option value="system">System theme</option>
            <option value="light">Light theme</option>
            <option value="dark">Dark theme</option>
          </select>
          {session && (
            <button
              className="icon"
              title="Sign out"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>
      {demo && (
        <div className="demo-banner">
          <ShieldCheck size={14} />
          <b>DEMO</b>
          <span>
            Isolated synthetic records. No real messages or calendar actions.
          </span>
          <a href="#/settings">Sandbox settings</a>
        </div>
      )}
      {session && session.role !== "candidate" && (
        <nav className="app-nav" aria-label="Workspace navigation">
          {[
            ["/vacancies", "Vacancies", BriefcaseBusiness],
            ["/calendar", "Calendar", CalendarDays],
            ["/metrics", "Metrics", BarChart3],
            ["/settings", "Settings", SettingsIcon],
          ].map(([href, label, Icon]) => {
            const ItemIcon = Icon as typeof BriefcaseBusiness;
            return (
              <a
                key={href as string}
                className={page.startsWith(href as string) ? "active" : ""}
                href={"#" + href}
              >
                <ItemIcon size={14} />
                {label as string}
              </a>
            );
          })}
          <span className="nav-caption">
            <ShieldCheck size={12} />
            Private workspace
          </span>
        </nav>
      )}
      {flash && (
        <div
          className={
            "global-flash " + (flash.error ? "is-error" : "is-success")
          }
          role={flash.error ? "alert" : "status"}
        >
          <span>{flash.text}</span>
          <button
            className="icon"
            aria-label="Dismiss notification"
            onClick={() => setFlash(undefined)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div id="workspace-content" role="main" tabIndex={-1}>
        {content}
      </div>
      <footer>
        <span>
          <b>saring.</b> Evidence first. Humans decide.
        </span>
        <span>
          {demo ? "DEMO · synthetic data" : "Organization-scoped access"} · No
          automated hiring decisions
        </span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
