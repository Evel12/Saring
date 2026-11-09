"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyLink({ url }: { url: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      input.current?.select();
      setStatus("manual");
    }
  }

  return (
    <div className="job-copy">
      <div className="job-copy-row">
        <input
          ref={input}
          readOnly
          value={url}
          aria-label="Link lamaran"
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="button primary" onClick={copy}>
          {status === "copied" ? <Check size={15} /> : <Copy size={15} />}
          {status === "copied" ? "Tersalin" : "Salin link"}
        </button>
      </div>
      <span className="job-field-hint" aria-live="polite">
        {status === "manual" && "Browser menolak menyalin. Tekan Ctrl+C untuk menyalin link yang sudah terpilih."}
      </span>
    </div>
  );
}
