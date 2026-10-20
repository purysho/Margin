import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNote, Loading } from "../components";
import { useApi } from "../hooks";

interface ProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
  needsKey: boolean;
  privacyNote: string;
  key_hint: string | null;
}
interface Settings {
  provider: string;
  model: string | null;
  providers: ProviderInfo[];
}

const KEY_HELP: Record<string, string> = {
  anthropic: "Create one at console.anthropic.com → API keys. You pay Anthropic per essay.",
  gemini: "Create one at aistudio.google.com → Get API key. Google's free tier works.",
};

export function SettingsPage() {
  const { data, error, reload } = useApi<Settings>("/settings");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setProvider(data.provider);
      setModel(data.model ?? "");
    }
  }, [data]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const current = data.providers.find((p) => p.id === provider);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h1>Settings</h1>
      <section className="card stack">
        <h2>AI provider</h2>
        <p className="muted">
          Used when you draft feedback. <strong>Not sure? Keep the free option.</strong> It needs no setup. Students never see which one you used.
        </p>
        <div className="choices">
          {data.providers.map((p) => (
            <label key={p.id} className={`choice${provider === p.id ? " on" : ""}`}>
              <input
                type="radio"
                name="provider"
                checked={provider === p.id}
                onChange={() => {
                  setProvider(p.id);
                  setModel("");
                }}
              />
              <span>
                <strong>{p.label}</strong>
                <span className="muted small">{p.privacyNote}</span>
              </span>
            </label>
          ))}
        </div>

        {current && current.id !== "demo" && (
          <label>
            Model <span className="muted">(leave empty for {current.defaultModel})</span>
            <input value={model} placeholder={current.defaultModel} onChange={(e) => setModel(e.target.value)} />
          </label>
        )}

        {current?.needsKey && (
          <div className="stack">
            <label>
              API key{" "}
              {current.key_hint ? <span className="muted">(saved, ends in …{current.key_hint})</span> : <span className="muted">(not saved yet)</span>}
              <input type="password" autoComplete="off" value={key} placeholder={current.key_hint ? "Paste a new key to replace it" : "Paste your key"} onChange={(e) => setKey(e.target.value)} />
            </label>
            <p className="muted small">{KEY_HELP[current.id]} Keys are encrypted and never shown again, not even to you.</p>
            <div className="row">
              <button disabled={key.trim().length < 10} onClick={() => run(async () => { await api.put(`/keys/${current.id}`, { key }); setKey(""); }, "Key saved.")}>
                Save key
              </button>
              {current.key_hint && (
                <button className="link" onClick={() => run(() => api.del(`/keys/${current.id}`), "Key removed.")}>
                  Remove key
                </button>
              )}
            </div>
          </div>
        )}

        <ErrorNote error={err} />
        {msg && <p className="ok">{msg}</p>}
        <div>
          <button className="primary" onClick={() => run(() => api.put("/settings", { provider, model: model.trim() || null }), "Settings saved.")}>
            Save provider
          </button>
        </div>
      </section>
    </>
  );
}
