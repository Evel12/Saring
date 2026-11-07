import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  FileText,
  Link2,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { Health, Me, Org } from "./types";
import type { useEvents } from "./hooks";
export type AppContextValue = {
  error?: string;
  me: Me;
  org: Org;
  health: Health;
  revision: number;
  refresh: () => void;
  perform: (fn: () => Promise<unknown>, message?: string) => Promise<boolean>;
  busy: boolean;
  signOut: () => void;
};
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"tag badge " + tone}>{children}</span>;
}
export function Loading({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={18} className="spin" />
      {label}
    </div>
  );
}
export function Failed({ error, retry }: { error: Error; retry: () => void }) {
  const app = useContext(AppContext);
  // A dead session (#401) cannot be fixed by retrying this one request;
  // guide the user to sign in again instead of looping on Retry connection.
  const expired =
    (error as { status?: number }).status === 401 ||
    /authentication required/i.test(error.message);
  return (
    <div className="state-error" role="alert">
      <AlertCircle size={20} />
      <div>
        <h3>{expired ? "Sign-in session expired" : "Unable to load this view"}</h3>
        <p>
          {expired
            ? "Your signed-in session is no longer valid. Sign in again to reload this workspace."
            : error.message}
        </p>
        {expired && app ? (
          <button className="secondary" onClick={() => app.signOut()}>
            <RefreshCw size={14} />
            Sign in again
          </button>
        ) : (
          <button className="secondary" onClick={retry}>
            <RefreshCw size={14} />
            Retry connection
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <ShieldCheck size={25} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  error,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  error?: string;
}) {
  const app = useContext(AppContext);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      {(error || app?.error) && (
        <div className="modal-inline-error" role="alert">
          {error || app?.error}
        </div>
      )}
      {children}
    </dialog>
  );
}
export function PageHeading({
  eyebrow = "RECRUITMENT WORKSPACE",
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {back && (
          <a className="back-link" href={back}>
            <ChevronLeft size={13} />
            Back to vacancy
          </a>
        )}
        <div className="eyebrow">{eyebrow}</div>
        <h1 tabIndex={-1}>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function Tabs({
  tabs,
  value,
  change,
}: {
  tabs: string[];
  value: string;
  change: (v: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          role="tab"
          tabIndex={value === t ? 0 : -1}
          aria-selected={value === t}
          key={t}
          className={value === t ? "active" : ""}
          onClick={() => change(t)}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const index =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (tabs.indexOf(t) +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              change(tabs[index]);
              (
                e.currentTarget.parentElement?.children[index] as HTMLElement
              )?.focus();
            }
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
const AI_STAGES = [
  { step: "ingest", label: "Scope sources" },
  { step: "extraction", label: "Extract document text" },
  { step: "evidence", label: "Link source evidence" },
  { step: "analysis", label: "AI criteria analysis" },
  { step: "review", label: "Commit findings" },
] as const;
export function ProgressPanel({
  feed,
}: {
  feed: ReturnType<typeof useEvents>;
}) {
  const progress = feed.events.filter((e) => e.kind === "analysis.progress");
  const last = progress[progress.length - 1];
  if (!last) return null;
  // A terminal event for the same run after the latest progress event means
  // the worker finished (or flagged) this attempt.
  const terminal = feed.events.find(
    (e) =>
      e.run_id === last.run_id &&
      e.created_at >= last.created_at &&
      (e.kind === "review.completed" ||
        e.kind === "review.failed" ||
        e.kind === "execution.completed"),
  );
  const failed = terminal?.kind === "review.failed";
  const current = AI_STAGES.findIndex((s) => s.step === last.details?.step);
  const currentIdx = current === -1 ? 0 : current;
  const count =
    last.details?.index !== undefined && last.details?.total !== undefined
      ? last.details.index + " / " + last.details.total
      : undefined;
  // Fraction within the analysis stage uses the index/total pair so the bar
  // moves during the long per-requirement loop, not just between stages.
  const stageFrac =
    AI_STAGES[currentIdx]?.step === "analysis" &&
    typeof last.details?.index === "number" &&
    typeof last.details?.total === "number"
      ? (last.details.index - 1) / Math.max(1, last.details.total)
      : 0;
  const pct = failed
    ? Math.round(((currentIdx + stageFrac) / AI_STAGES.length) * 100)
    : terminal
      ? 100
      : Math.round(((currentIdx + stageFrac) / AI_STAGES.length) * 100);
  return (
    <div className="log-col">
      <Panel title="AI progression">
        <div className="progress-bar" role="progressbar"
          aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={"progress-fill" + (failed ? " fail" : terminal ? " done" : "")}
            style={{ width: Math.max(pct, 4) + "%" }} />
        </div>
        <div className="progress-meta">
          <span className={"mono tiny" + (failed ? " warn-hint" : "")}>
            {failed ? "Stalled" : terminal ? "Completed" : "Running"} · {pct}%
          </span>
          <span className="mono tiny">
            {count || ""}{last.details?.result ? " · " + last.details.result : ""}
            {typeof last.details?.cited === "number" ? " · " + last.details.cited + " cited" : ""}
            {typeof last.details?.without_citations === "number" ? " · " + last.details.without_citations + " without passages" : ""}
            {typeof last.details?.skipped === "number" && last.details.skipped > 0 ? " · " + last.details.skipped + " skipped (no overlap)" : ""}
          </span>
        </div>
        <ol className="progress-steps" aria-label="AI progression">
          {AI_STAGES.map((stage, i) => {
            const state =
              failed && i >= currentIdx
                ? "attention"
                : terminal
                  ? "done"
                  : i < currentIdx
                    ? "done"
                    : i === currentIdx
                      ? "active"
                      : "todo";
            return (
              <li key={stage.step} className={"step-" + state}>
                <span className="step-marker" aria-hidden="true" />
                <span>
                  {stage.label}
                  {stage.step === "analysis" && state !== "todo" && (
                    <>
                      {count && <span className="mono tiny"> {count}</span>}
                      {last.details?.result && (
                        <span className="mono tiny"> · {last.details.result}</span>
                      )}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className={"hint" + (failed ? " warn-hint" : "")}>
          {failed
            ? "Stalled at this stage — see agent activity for the failure."
            : terminal
              ? "Persisted. Human recruiter review decides next."
              : "Live from persisted events; the worker owns progress."}
        </p>
      </Panel>
    </div>
  );
}
const ACTIVITY: { match: RegExp; label: string; icon: ReactNode }[] = [
  { match: /^analysis\.progress/, label: "Step in progress", icon: <LoaderCircle size={13} /> },
  { match: /^analysis\.summary/, label: "CV summary", icon: <Sparkles size={13} /> },
  { match: /^analysis\.details/, label: "Job-relevant details", icon: <Sparkles size={13} /> },
  { match: /^analysis\.highlights/, label: "Strong points", icon: <Sparkles size={13} /> },
  { match: /^link\.observed/, label: "Link verified", icon: <Link2 size={13} /> },
  { match: /^link\.reviewed/, label: "AI link review", icon: <Link2 size={13} /> },
  { match: /^extraction/, label: "Document extraction", icon: <FileText size={13} /> },
  { match: /fail|blocked|attention/, label: "Attention needed", icon: <AlertCircle size={13} /> },
  { match: /^review\.completed|^execution\.completed/, label: "Review completed", icon: <Check size={13} /> },
  { match: /^review\.retained/, label: "Findings retained", icon: <ShieldCheck size={13} /> },
  { match: /^clarification/, label: "Clarification", icon: <Settings2 size={13} /> },
  { match: /^approval|^decision|^brief/, label: "Recruiter action", icon: <ShieldCheck size={13} /> },
];
function activityItem(kind: string) {
  const found = ACTIVITY.find((a) => a.match.test(kind));
  return { label: found?.label || words(kind), icon: found?.icon ?? <Check size={13} /> };
}
export function ActivityPanel({
  feed,
}: {
  feed: ReturnType<typeof useEvents>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [feed.events.length]);
  return (
    <div className="log-col">
      <Panel
        title="Agent activity"
        aside={
          <span className={"connection-state " + feed.connection}>
            <i />
            {feed.connection === "connected"
              ? "PERSISTED FEED"
              : feed.connection.toUpperCase()}
          </span>
        }
      >
        <ol className="activity-timeline" aria-label="Agent activity">
          {!feed.events.length && (
            <li className="term-muted">
              {feed.connection === "connecting"
                ? "Connecting to stored events…"
                : "No recorded activity yet."}
            </li>
          )}
          {feed.events.map((e) => {
            // Intermediate progress lines are superseded within seconds;
            // only the latest one stays in the timeline to avoid noise.
            const latestProgress = [...feed.events].reverse().find(
              (x) => x.kind === "analysis.progress",
            );
            if (e.kind === "analysis.progress" && e.id !== latestProgress?.id)
              return null;
            const activity = activityItem(e.kind);
            const err = /fail|blocked/.test(e.kind);
            return (
              <li
                className={
                  "activity-item" +
                  (err ? " err" : /approved|await/.test(e.kind) ? " warn" : "") +
                  (e.kind === "analysis.progress" ? " progress" : "")
                }
                key={e.id}
              >
                <span className="activity-icon" aria-hidden="true">
                  {activity.icon}
                </span>
                <span className="activity-body">
                  <span className="activity-head">
                    <b>{activity.label}</b>
                    <span className="ts" title={new Date(e.created_at * 1000).toISOString()}>
                      {new Date(e.created_at * 1000).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </span>
                  <p className="activity-message">{e.message}</p>
                  {(e.details?.tool || e.details?.result || typeof e.details?.duration_seconds === "number") && (
                    <p className="term-muted">
                      {e.details.tool ? e.details.tool : ""}{e.details.result ? " → " + e.details.result : ""}
                      {typeof e.details.duration_seconds === "number" ? ` · ${e.details.duration_seconds.toFixed(2)}s` : ""}
                      {e.details.attempt ? ` · attempt ${e.details.attempt}` : ""}
                      {e.details.error_code ? ` · ${e.details.error_code}` : ""}
                    </p>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="log-footer">
          <span>{feed.events.length} recent persisted events</span>
          <span>
            {feed.updated
              ? new Date(feed.updated).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Not synced"}
          </span>
        </div>
      </Panel>
      {feed.connection === "disconnected" && (
        <div className="connection-warning" role="status">
          <b>Feed disconnected</b>
          <p>
            Progress may continue on the server. Reconnecting with the last
            event cursor.
          </p>
          <button className="secondary" onClick={feed.reconnect}>
            <RefreshCw size={13} />
            Reconnect now
          </button>
        </div>
      )}
    </div>
  );
}
export function Confirm({
  title,
  description,
  confirm,
  close,
  label = "Approve",
}: {
  title: string;
  description: ReactNode;
  confirm: () => void;
  close: () => void;
  label?: string;
}) {
  const { busy } = useApp();
  return (
    <Modal title={title} close={close}>
      <div className="panel-body">
        <div className="confirmation-copy">{description}</div>
        <div className="form-actions">
          <button className="secondary" onClick={close}>
            Keep reviewing
          </button>
          <button className="primary" onClick={confirm} disabled={busy}>
            <Check size={15} />
            {busy ? "Saving…" : label}
          </button>
        </div>
      </div>
    </Modal>
  );
}
export const time = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString();
export const words = (text: string) => text.replaceAll("_", " ");
