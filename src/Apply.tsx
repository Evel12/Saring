import { useState } from "react";
import { FileText, Send, Upload } from "lucide-react";
import { request } from "./api";
import { useLoad } from "./hooks";
import { Loading } from "./ui";

type Posting = {
  title: string;
  company: string;
  description: string;
  questions: string[];
};

type Receipt = { duplicate: boolean; message: string };

const MAX_FILE = 5 * 1024 * 1024;

function fmt(bytes: number) {
  return bytes > 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + " MB"
    : Math.ceil(bytes / 1024) + " KB";
}

// Public, no-login application page. Everything lives behind the vacancy's
// share token in the URL; no recruiter session is touched or required.
export function ApplyPage({ vacancyId, token }: { vacancyId: string; token: string }) {
  const posting = useLoad<Posting>(
    (signal) => request<Posting>(`/apply/${vacancyId}/${token}`, { signal }),
    [vacancyId, token],
  );
  const [receipt, setReceipt] = useState<Receipt>();
  if (posting.loading)
    return (
      <div className="auth-page">
        <Loading label="Opening application form…" />
      </div>
    );
  if (posting.error || !posting.data)
    return (
      <div className="auth-page">
        <h1>Application form</h1>
        <p className="hint">
          {posting.error && posting.error.message.includes("not available")
            ? "This application link is not available. Check the link or ask the employer for a fresh one."
            : "The application form could not be loaded. Please try again shortly."}
        </p>
      </div>
    );
  const p = posting.data;
  if (receipt)
    return (
      <div className="auth-page">
        <h1>{p.title}</h1>
        <p className="hint">{p.company}</p>
        <div className="card">
          <p>{receipt.message}</p>
        </div>
      </div>
    );
  return <ApplyForm posting={p} vacancyId={vacancyId} token={token} onDone={setReceipt} />;
}

function ApplyForm({
  posting,
  vacancyId,
  token,
  onDone,
}: {
  posting: Posting;
  vacancyId: string;
  token: string;
  onDone: (r: Receipt) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pick(list: FileList | null) {
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const ok = /\.(pdf|docx)$/i.test(f.name);
      if (!ok) {
        setError(`${f.name}: only PDF and DOCX files are accepted.`);
        return;
      }
      if (f.size > MAX_FILE) {
        setError(`${f.name}: files must be 5 MB or smaller.`);
        return;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size) && next.length < 4)
        next.push(f);
    }
    setError(next.length ? "" : "Attach at least one CV document (PDF or DOCX).");
    setFiles(next.slice(0, 4));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    const cleaned: Record<string, string> = {};
    posting.questions.forEach((q, i) => {
      const text = (answers[i] || "").trim();
      if (text) cleaned[q.slice(0, 80)] = text.slice(0, 2000);
    });
    if (!files.length) {
      setError("Attach at least one CV document (PDF or DOCX).");
      return;
    }
    if (!Object.keys(cleaned).length && posting.questions.length) {
      setError("Answer at least one question.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("display_name", name.trim());
      form.set("email", email.trim());
      if (Object.keys(cleaned).length)
        form.set("answers", JSON.stringify(cleaned));
      for (const f of files) form.append("files", f);
      const result = await request<Receipt>(
        `/apply/${vacancyId}/${token}/submit`,
        { method: "POST", body: form },
      );
      onDone(result);
    } catch (err) {
      setError((err as Error).message || "Submission failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>{posting.title}</h1>
      <p className="hint">{posting.company} — apply for this position</p>
      {posting.description && (
        <div className="card" style={{ whiteSpace: "pre-wrap" }}>
          {posting.description}
        </div>
      )}
      <form onSubmit={submit} className="card" style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="hint">Full name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            maxLength={160}
            required
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="hint">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            maxLength={254}
            required
          />
        </label>
        {posting.questions.map((q, i) => (
          <label key={i} style={{ display: "grid", gap: 6 }}>
            <span className="hint">{q}</span>
            <textarea
              rows={3}
              value={answers[i] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
              maxLength={2000}
            />
            <span className="hint" style={{ margin: 0 }}>
              {(answers[i] || "").length}/2000
            </span>
          </label>
        ))}
        <div style={{ display: "grid", gap: 6 }}>
          <span className="hint">
            CV and supporting documents (PDF or DOCX, up to 4 files, 5 MB each)
          </span>
          <label className="secondary" style={{ cursor: "pointer", justifySelf: "start" }}>
            <Upload size={13} />
            Choose files
            <input
              type="file"
              accept=".pdf,.docx,application/pdf"
              multiple
              hidden
              onChange={(e) => pick(e.target.files)}
            />
          </label>
          {files.map((f, i) => (
            <span key={i} className="hint" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
              <FileText size={12} />
              {f.name} ({fmt(f.size)})
              <button
                type="button"
                className="secondary"
                style={{ padding: "2px 6px" }}
                onClick={() => setFiles((fs) => fs.filter((_, x) => x !== i))}
              >
                remove
              </button>
            </span>
          ))}
        </div>
        {error && <p className="hint" style={{ color: "var(--danger, #b33)" }}>{error}</p>}
        <button className="primary" disabled={busy} style={{ justifySelf: "start" }}>
          <Send size={13} />
          {busy ? "Submitting…" : "Submit application"}
        </button>
        <p className="hint" style={{ margin: 0 }}>
          Your documents are reviewed by the employer's recruitment tool. You will be
          contacted at the email above if you are selected for the next step.
        </p>
      </form>
    </div>
  );
}
