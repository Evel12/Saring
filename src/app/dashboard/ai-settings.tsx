"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ApiError, post, request } from "@/lib/api";
import { Select } from "../ui-select";

type Config = {
  provider: string;
  base_url: string;
  model: string;
  source: string;
  openai_key_present: boolean;
  api_key_stored: boolean;
};

// Semua provider ini memakai format API OpenAI; bedanya hanya alamat dan nama model.
const PRESETS = [
  {
    id: "gemini",
    label: "Google Gemini",
    provider: "openai",
    base: "https://generativelanguage.googleapis.com/v1beta/openai/",
    hint: "gemini-3.1-flash-lite",
  },
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    base: "https://api.openai.com/v1",
    hint: "nama model dari dashboard OpenAI",
  },
  {
    id: "groq",
    label: "Groq",
    provider: "openai",
    base: "https://api.groq.com/openai/v1",
    hint: "nama model dari console Groq",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openai",
    base: "https://openrouter.ai/api/v1",
    hint: "contoh: penyedia/nama-model",
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    provider: "openai",
    base: "https://ollama.com/v1",
    hint: "contoh: gpt-oss:20b",
  },
  {
    id: "ollama",
    label: "Ollama (lokal)",
    provider: "ollama",
    base: "http://localhost:11434/v1",
    hint: "model yang sudah di-pull",
  },
  {
    id: "custom",
    label: "Lainnya (OpenAI-compatible)",
    provider: "openai",
    base: "",
    hint: "nama model",
  },
];

const presetOf = (c: Config) =>
  PRESETS.find(
    (p) => p.provider === c.provider && p.base && c.base_url.startsWith(p.base),
  ) ??
  PRESETS.find(
    (p) => p.id === (c.provider === "ollama" ? "ollama" : "custom"),
  )!;

// Pengaturan model AI. Berlaku untuk seluruh server, jadi hanya platform admin yang bisa mengubah.
export function AiSettings({ canEdit }: { canEdit: boolean }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [preset, setPreset] = useState(PRESETS[0]);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    request<Config>("/ai/config")
      .then((c) => {
        setConfig(c);
        if (c.provider !== "none") {
          setPreset(presetOf(c));
          setBaseUrl(c.base_url);
          setModel(c.model);
        }
      })
      .catch(() => setMessage("Status model AI tidak bisa dibaca."));
  }, []);

  if (!config) return <small>{message || "Memuat…"}</small>;
  const active =
    config.provider === "none"
      ? "Belum dikonfigurasi"
      : `${presetOf(config).label} · ${config.model}`;
  if (!canEdit)
    return (
      <>
        {active}
        <small>
          Diatur oleh pemilik platform Saring. API key tidak pernah dikirim ke
          browser.
        </small>
      </>
    );

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const next = await post<Config>("/ai/config", {
        provider: preset.provider,
        model: model.trim(),
        base_url: baseUrl.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      setConfig(next);
      setApiKey("");
      setMessage("Tersimpan. Analisis berikutnya memakai model ini.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Gagal menyimpan.");
    }
    setBusy(false);
  }

  return (
    <div className="ai-settings">
      <span>Aktif: {active}</span>
      <label>
        Provider
        <Select
          aria-label="Provider"
          value={preset.id}
          onChange={(id) => {
            const next = PRESETS.find((p) => p.id === id)!;
            setPreset(next);
            setBaseUrl(next.base);
          }}
          options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      {preset.id === "custom" && (
        <label>
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://…/v1"
          />
        </label>
      )}
      <label>
        Nama model
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={preset.hint}
        />
      </label>
      {preset.provider !== "ollama" && (
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              config.api_key_stored
                ? "Tersimpan (kosongkan jika tidak diganti)"
                : "Tempel API key"
            }
          />
        </label>
      )}
      <small>
        API key disimpan terenkripsi di server dan tidak pernah ditampilkan
        lagi.
      </small>
      <button
        type="button"
        className="button primary"
        onClick={save}
        disabled={busy || !model.trim()}
      >
        {busy && <LoaderCircle className="spin" size={14} />}
        Simpan model AI
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
