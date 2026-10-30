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
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
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
  return (
    <div className="state-error" role="alert">
      <AlertCircle size={20} />
      <div>
        <h3>Unable to load this view</h3>
        <p>{error.message}</p>
        <button className="secondary" onClick={retry}>
          <RefreshCw size={14} />
          Retry connection
        </button>
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
        <div className="terminal" ref={ref} role="log" aria-live="polite">
          <div className="terminal-heading">
            saring / activity history<span>v1</span>
          </div>
          <div className="log-intro">Evidence first. Humans decide.</div>
          {!feed.events.length && (
            <div className="term-muted">
              {feed.connection === "connecting"
                ? "Connecting to stored events…"
                : "No recorded activity yet."}
            </div>
          )}
          {feed.events.map((e) => (
            <div
              className={
                "log-line " +
                (/fail|blocked/.test(e.kind)
                  ? "err"
                  : /approved|await/.test(e.kind)
                    ? "warn"
                    : "ok")
              }
              key={e.id}
            >
              <span className="ts" title={new Date(e.created_at * 1000).toISOString()}>
                {new Date(e.created_at * 1000).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span>
                <span className="event-kind">{e.kind}</span>
                {e.message}
                {(e.application_id || e.run_id) && <div className="term-muted">{e.application_id ? `application ${e.application_id.slice(0,8)}` : ""}{e.run_id ? ` / run ${e.run_id.slice(0,8)}` : ""}</div>}
                {e.details?.tool && <div className="term-muted">{e.details.tool} → {e.details.result}{typeof e.details.duration_seconds === "number" ? ` · ${e.details.duration_seconds.toFixed(2)}s` : ""}{e.details.attempt ? ` · attempt ${e.details.attempt}` : ""}{e.details.error_code ? ` · ${e.details.error_code}` : ""}</div>}
              </span>
            </div>
          ))}
        </div>
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
