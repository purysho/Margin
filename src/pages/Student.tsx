import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Essay, ErrorNote, Legend, Loading, Tag, type Category } from "../components";
import { useApi } from "../hooks";
import { navigate } from "../router";
import { Recorder, type Recording } from "./Recorder";

export function StudentJoin() {
  const [code, setCode] = useState("");
  return (
    <form
      className="card stack narrow"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/s/${code.trim().toUpperCase()}`);
      }}
    >
      <h1>Hand in your writing</h1>
      <label>
        Assignment code from your teacher
        <input required placeholder="ABCD-1234" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button className="primary">Continue</button>
    </form>
  );
}

interface PublicAssignment {
  title: string;
  task: string;
  cefr_level: string;
  is_open: number;
  teacher: string;
  skill: "writing" | "speaking";
  max_audio_seconds: number;
}

const RECEIPTS_KEY = "margin.receipts";

export function StudentSubmit({ code }: { code: string }) {
  const { data, error } = useApi<PublicAssignment>(`/public/assignments/${encodeURIComponent(code)}`);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.is_open) return <div className="card narrow">This assignment is closed. Ask {data.teacher} if you need more time.</div>;

  const speaking = data.skill === "speaking";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const path = `/public/assignments/${encodeURIComponent(code)}/submissions`;
      const r = speaking ? await uploadRecording(path, name, recording!) : await api.post<{ receipt: string }>(path, { student_name: name, body });
      try {
        const saved = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]") as { title: string; token: string }[];
        localStorage.setItem(RECEIPTS_KEY, JSON.stringify([{ title: data.title, token: r.receipt }, ...saved].slice(0, 20)));
      } catch {
        /* storage unavailable: the link on the next page still works */
      }
      navigate(`/r/${r.receipt}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted">{data.teacher} · level {data.cefr_level}</p>
      <h1>{data.title}</h1>
      <p className="task">{data.task}</p>
      <label>
        Your name (only your teacher sees it)
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {speaking ? (
        <div className="stack">
          <span className="field-label">Your spoken answer</span>
          <Recorder maxSeconds={data.max_audio_seconds} onChange={setRecording} />
        </div>
      ) : (
        <label>
          Your writing <span className="muted">({words} words)</span>
          <textarea required rows={16} maxLength={15000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      )}
      <ErrorNote error={err} />
      <div>
        <button className="primary" disabled={busy || (speaking && !recording)}>
          {busy ? (speaking ? "Uploading… (this can take 20 seconds)" : "Sending…") : "Hand in"}
        </button>
      </div>
    </form>
  );
}

/** Multipart upload; the browser adds the Origin header the server requires. */
async function uploadRecording(path: string, name: string, rec: Recording): Promise<{ receipt: string }> {
  const ext = rec.blob.type.includes("mp4") ? "m4a" : rec.blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.set("student_name", name);
  form.set("duration_ms", String(Math.round(rec.durationMs)));
  form.set("audio", new File([rec.blob], `answer.${ext}`, { type: rec.blob.type || "audio/webm" }));
  const res = await fetch(`/api${path}`, { method: "POST", body: form, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { receipt?: string; error?: string };
  if (!res.ok || !data.receipt) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return { receipt: data.receipt };
}

export interface Receipt {
  status: "waiting" | "released";
  kind?: "text" | "audio";
  title: string;
  task: string;
  body: string;
  submitted_at: number;
  summary?: string;
  criteria?: { name: string; max_score: number; score: number | null; comment: string }[];
  annotations?: { start: number; end: number; category: Category; comment: string }[];
}

export function StudentReceipt({ token }: { token: string }) {
  const { data, error, reload } = useApi<Receipt>(`/public/receipts/${encodeURIComponent(token)}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  if (data.status === "waiting")
    return (
      <div className="card stack narrow">
        <h1>Handed in</h1>
        <p>Your teacher will review your {data.kind === "audio" ? "recording" : "writing"}. Your feedback will appear on this page.</p>
        <p>
          <strong>Save this link</strong> (bookmark it, or copy it somewhere safe). It is the only way to see your feedback:
        </p>
        <code className="big">{window.location.href}</code>
        <div>
          <button onClick={() => reload()}>Check for feedback</button>
        </div>
      </div>
    );

  return <FeedbackView data={data} />;
}

/** The released feedback, as the student sees it. Also used for the teacher's preview. */
export function FeedbackView({ data }: { data: Receipt }) {
  const [active, setActive] = useState<string | null>(null);
  const anns = data.annotations ?? [];
  return (
    <>
      <h1>{data.title}</h1>
      <section className="card stack">
        <h2>From your teacher</h2>
        <p className="prewrap">{data.summary}</p>
      </section>

      <h2>{data.kind === "audio" ? "What you said" : "Your writing"}</h2>
      <p className="muted small">
        {data.kind === "audio" ? "This is a transcript of your recording (the recording itself has been deleted for privacy). " : ""}
        Coloured words have a comment from your teacher. Tap one to find it.
      </p>
      <Legend />
      <div className="review-grid">
        <Essay
          text={data.body}
          highlights={anns.map((a, i) => ({ key: String(i), start: a.start, end: a.end, category: a.category }))}
          active={active}
          onPick={setActive}
        />
        <aside className="margin-col">
          {anns.map((a, i) => (
            <div key={i} className={`ann${active === String(i) ? " active" : ""}`} onClick={() => setActive(String(i))}>
              <Tag category={a.category} />
              <q>{data.body.slice(a.start, a.end)}</q>
              <p>{a.comment}</p>
            </div>
          ))}
        </aside>
      </div>

      <section className="card stack">
        <h2>Scores</h2>
        {data.criteria?.map((c) => (
          <div key={c.name} className="criterion">
            <div className="row between">
              <strong>{c.name}</strong>
              <span>{c.score ?? "–"} / {c.max_score}</span>
            </div>
            <p>{c.comment}</p>
          </div>
        ))}
      </section>
    </>
  );
}
