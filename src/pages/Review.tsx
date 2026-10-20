import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { CATEGORY_LABEL, Essay, ErrorNote, Legend, Loading, selectionOffsets, Tag, Tip, type Category, type Highlight } from "../components";
import { useApi } from "../hooks";
import { Link } from "../router";
import { formatDuration } from "./Assignment";

interface Criterion {
  id: string;
  name: string;
  description: string;
  max_score: number;
  descriptors: string[];
}
interface DraftOutput {
  criteria: { criterion_id: string; score: number; comment: string }[];
  annotations: { quote: string; start: number; end: number; category: Category; comment: string }[];
  summary: string;
  next_steps: string[];
  dropped_quotes: number;
}
interface SpeechMeasures {
  duration_s: number;
  speaking_s: number;
  words: number;
  wpm: number;
  pauses: number;
  long_pauses: number;
  longest_pause_s: number;
  mean_run_words: number;
  fillers: number;
}
interface Submission {
  id: string;
  assignment_id: string;
  student_name: string;
  body: string;
  word_count: number;
  status: string;
  title: string;
  cefr_level: string;
  kind: "text" | "audio";
  duration_ms: number | null;
  has_audio: boolean;
  speech: { measures: SpeechMeasures; unsure: { text: string; start: number; end: number }[] } | null;
  transcript_raw: string | null;
  transcript_edited_at: number | null;
  transcription_error: string | null;
}
interface Detail {
  submission: Submission;
  rubric: Criterion[];
  draft: { id: string; provider: string; model: string; latency_ms: number; created_at: number; output: DraftOutput } | null;
  review: { final_summary: string; released_at: number; scores: { criterion_id: string; teacher_score: number; final_comment: string }[] } | null;
}

interface AnnState {
  keep: boolean;
  comment: string;
}
interface Added {
  start: number;
  end: number;
  category: Category;
  comment: string;
}

export function ReviewPage({ id }: { id: string }) {
  const { data, error, reload } = useApi<Detail>(`/submissions/${id}`);
  const [drafting, setDrafting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const { submission: s } = data;
  const audio = s.kind === "audio";
  // A draft made before the transcript was corrected no longer lines up with it.
  const stale = !!(data.draft && s.transcript_edited_at && data.draft.created_at < s.transcript_edited_at && s.status !== "released");
  const draft = stale ? null : data.draft;

  const makeDraft = async () => {
    setDrafting(true);
    setActionError(null);
    try {
      await api.post(`/submissions/${id}/draft`);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <>
      <p className="crumbs">
        <Link to="/">Assignments</Link> / <Link to={`/assignments/${s.assignment_id}`}>{s.title}</Link> /
      </p>
      <div className="row between">
        <h1>
          {s.student_name}{" "}
          <span className="muted small">
            {audio ? `${formatDuration(s.duration_ms)} recording · ` : ""}
            {s.word_count} words · {s.cefr_level}
          </span>
        </h1>
        <button onClick={makeDraft} disabled={drafting}>
          {drafting ? "Drafting…" : data.draft ? "Draft again" : "Draft feedback with AI"}
        </button>
      </div>
      <ErrorNote error={actionError} />

      {audio && <SpeechPanel s={s} hasDraft={!!data.draft} onChanged={reload} />}
      {stale && (
        <p className="hint">
          You corrected the transcript after the last AI draft, so its comments no longer line up. Click <strong>Draft again</strong>.
        </p>
      )}

      {draft ? (
        // Re-mount the editor whenever a new draft arrives.
        <Editor key={draft.id} detail={data} onReleased={reload} />
      ) : (
        <div className="review-grid">
          {s.body ? <Essay text={s.body} highlights={[]} /> : <div />}
          <aside className="margin-col">
            {drafting ? (
              <p className="progress" role="status">
                <span className="spinner" aria-hidden="true" /> The AI is reading the {audio ? "transcript" : "essay"}. This usually takes about 20 seconds.
              </p>
            ) : (
              <p className="muted">
                No draft yet. Click <strong>Draft feedback with AI</strong> to get suggested scores and comments. The student sees nothing until you release it.
              </p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Editor({ detail, onReleased }: { detail: Detail; onReleased: () => void }) {
  const { submission: s, rubric, review } = detail;
  const draft = detail.draft!;
  const out = draft.output;
  const essayRef = useRef<HTMLDivElement>(null);

  const [anns, setAnns] = useState<AnnState[]>(() => out.annotations.map((a) => ({ keep: true, comment: a.comment })));
  const [added, setAdded] = useState<Added[]>([]);
  const [scores, setScores] = useState<Record<string, { score: number; comment: string }>>(() => {
    const fromReview = new Map(review?.scores.map((r) => [r.criterion_id, r]));
    return Object.fromEntries(
      out.criteria.map((c) => {
        const r = fromReview.get(c.criterion_id);
        return [c.criterion_id, r ? { score: r.teacher_score, comment: r.final_comment } : { score: c.score, comment: c.comment }];
      }),
    );
  });
  const [summary, setSummary] = useState(
    () => review?.final_summary ?? [out.summary, out.next_steps.length ? `\nNext time:\n${out.next_steps.map((n) => `- ${n}`).join("\n")}` : ""].join("\n").trim(),
  );
  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const on = () => setSelection(essayRef.current ? selectionOffsets(essayRef.current) : null);
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, []);

  useEffect(() => {
    if (active) document.getElementById(`ann-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const highlights: Highlight[] = useMemo(
    () => [
      ...out.annotations.map((a, i) => ({ key: `ai${i}`, start: a.start, end: a.end, category: a.category, muted: !anns[i]?.keep })),
      ...added.map((a, i) => ({ key: `me${i}`, start: a.start, end: a.end, category: a.category })),
    ],
    [out.annotations, anns, added],
  );

  const kept = anns.filter((a) => a.keep).length;

  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/submissions/${s.id}/release`, {
        draft_id: draft.id,
        scores: rubric.map((c) => ({ criterion_id: c.id, score: scores[c.id]!.score, comment: scores[c.id]!.comment })),
        annotations: anns.map((a, index) => ({ index, keep: a.keep, comment: a.comment })),
        added,
        summary,
      });
      setDone(true);
      onReleased();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted small">
        Draft by {draft.provider === "demo" ? "demo rules" : draft.model} in {(draft.latency_ms / 1000).toFixed(1)}s.
        {out.dropped_quotes > 0 && ` ${out.dropped_quotes} AI comment${out.dropped_quotes === 1 ? " was" : "s were"} removed because the quoted text was not in the essay.`}
        {review && ` Released ${new Date(review.released_at).toLocaleString()}; releasing again replaces it.`}
      </p>

      <Tip id="review" title="How to review">
        <ul className="small">
          <li><strong>Comments:</strong> click a highlight to find its comment. Untick <em>Keep</em> to remove it, or edit the text.</li>
          <li><strong>Your own comments:</strong> select any words in the essay, then click <em>+ Comment</em>.</li>
          <li><strong>Scores:</strong> the small <span className="ai-chip">AI</span> mark shows the AI's suggestion. Click a number to change it.</li>
          <li><strong>Release</strong> when you're happy. You can edit and release again later.</li>
        </ul>
      </Tip>

      <Legend />
      <div className="review-grid">
        <div>
          <Essay text={s.body} highlights={highlights} active={active} onPick={setActive} innerRef={essayRef} />
          <div className="selection-bar">
            {selection ? (
              <button onClick={() => {
                setAdded([...added, { ...selection, category: "grammar", comment: "" }]);
                setActive(`me${added.length}`);
                window.getSelection()?.removeAllRanges();
              }}>
                + Comment on “{s.body.slice(selection.start, selection.end).slice(0, 40)}”
              </button>
            ) : (
              <span className="muted small">Select text in the {s.kind === "audio" ? "transcript" : "essay"} to add your own comment.</span>
            )}
          </div>
        </div>

        <aside className="margin-col">
          <h3>
            Comments <span className="muted">({kept} of {out.annotations.length} kept{added.length ? `, ${added.length} yours` : ""})</span>
          </h3>
          {out.annotations.map((a, i) => (
            <div key={i} id={`ann-ai${i}`} className={`ann${anns[i]!.keep ? "" : " off"}${active === `ai${i}` ? " active" : ""}`} onClick={() => setActive(`ai${i}`)}>
              <div className="row between">
                <Tag category={a.category} />
                <label className="toggle">
                  <input type="checkbox" checked={anns[i]!.keep} onChange={(e) => setAnns(anns.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  Keep
                </label>
              </div>
              <q>{a.quote}</q>
              <textarea rows={3} disabled={!anns[i]!.keep} value={anns[i]!.comment} onChange={(e) => setAnns(anns.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} />
            </div>
          ))}
          {added.map((a, i) => (
            <div key={`me${i}`} id={`ann-me${i}`} className={`ann mine${active === `me${i}` ? " active" : ""}`} onClick={() => setActive(`me${i}`)}>
              <div className="row between">
                <select value={a.category} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, category: e.target.value as Category } : x)))}>
                  {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
                <button className="link" onClick={() => setAdded(added.filter((_, j) => j !== i))}>Remove</button>
              </div>
              <q>{s.body.slice(a.start, a.end)}</q>
              <textarea rows={3} autoFocus placeholder="Your comment" value={a.comment} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} />
            </div>
          ))}
        </aside>
      </div>

      <section className="card stack">
        <h2>Scores</h2>
        {rubric.map((c) => {
          const ai = out.criteria.find((x) => x.criterion_id === c.id);
          const cur = scores[c.id]!;
          return (
            <div key={c.id} className="criterion">
              <div className="row between">
                <strong>{c.name}</strong>
                <span className="muted small">AI suggested {ai?.score ?? "–"} / {c.max_score}</span>
              </div>
              <div className="scale" role="radiogroup" aria-label={c.name}>
                {c.descriptors.map((_, n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={cur.score === n}
                    className={`${cur.score === n ? "on" : ""}${ai?.score === n ? " ai" : ""}`}
                    onClick={() => setScores({ ...scores, [c.id]: { ...cur, score: n } })}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="muted small">{c.descriptors[cur.score]}</p>
              <textarea rows={2} value={cur.comment} onChange={(e) => setScores({ ...scores, [c.id]: { ...cur, comment: e.target.value } })} />
            </div>
          );
        })}
      </section>

      <section className="card stack">
        <h2>Message to the student</h2>
        <textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
        <ErrorNote error={error} />
        {(done || review) && (
          <p className={done ? "ok" : "muted"}>
            {done ? `Released. ${s.student_name} can now see this feedback on their link. ` : ""}
            <Link to={`/submissions/${s.id}/preview`}>Preview what the student sees</Link>
          </p>
        )}
        <div>
          <button className="primary" onClick={release} disabled={busy || added.some((a) => !a.comment.trim())}>
            {busy ? "Releasing…" : review ? "Release updated feedback" : "Release to student"}
          </button>
        </div>
      </section>
    </>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Recording, speech measures, unsure stretches and transcript correction for a spoken answer. */
function SpeechPanel({ s, hasDraft, onChanged }: { s: Submission; hasDraft: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = s.speech?.measures;
  const released = s.status === "released";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card speech-panel">
      <div className="speech-grid">
        <div className="stack">
          <h3>Recording</h3>
          {s.has_audio ? (
            <audio controls preload="none" src={`/api/submissions/${s.id}/audio`} className="rec-audio" />
          ) : (
            <p className="muted small">
              {released
                ? "Deleted after release, for privacy. The transcript is kept."
                : "No recording: this is a sample answer, or the recording was deleted after 30 days."}
            </p>
          )}
          <p className="muted small">Listen for pronunciation: the AI cannot judge it from a transcript, so it's left to you.</p>
        </div>
        {m && (
          <dl className="measures">
            <div><dt>Speaking rate</dt><dd>{m.wpm} <span>words/min</span></dd></div>
            <div><dt>Pauses</dt><dd>{m.pauses} <span>({m.long_pauses} long)</span></dd></div>
            <div><dt>Words between pauses</dt><dd>{fmt(m.mean_run_words)}</dd></div>
            <div><dt>Fillers (um, er)</dt><dd>{m.fillers}</dd></div>
            <div><dt>Longest pause</dt><dd>{fmt(m.longest_pause_s)} <span>s</span></dd></div>
            <div><dt>Speaking time</dt><dd>{fmt(m.speaking_s)} <span>s</span></dd></div>
          </dl>
        )}
      </div>

      {s.speech && s.speech.unsure.length > 0 && (
        <div className="unsure">
          <strong className="small">The recogniser was unsure here. Worth a listen:</strong>
          <ul className="small">
            {s.speech.unsure.map((u, i) => (
              <li key={i}>
                <span className="muted">{formatDuration(u.start * 1000)}</span> “{u.text}”
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.transcription_error && !s.body && (
        <div className="hint">
          <p className="small">Transcription didn't work yet: {s.transcription_error}</p>
          <button disabled={busy} onClick={() => run(() => api.post(`/submissions/${s.id}/transcribe`))}>
            {busy ? "Transcribing…" : "Try transcribing again"}
          </button>
        </div>
      )}

      {!released && s.body && (
        <div className="transcript-edit">
          {editing ? (
            <div className="stack">
              <label>
                Correct the transcript <span className="muted">(fix words the recogniser misheard; keep the student's own mistakes)</span>
                <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {hasDraft && <p className="muted small">Saving means drafting again, so the AI's comments line up with the corrected text.</p>}
              <ErrorNote error={error} />
              <div className="row">
                <button className="primary" disabled={busy || !text.trim()} onClick={() => run(() => api.patch(`/submissions/${s.id}/transcript`, { text }))}>
                  {busy ? "Saving…" : "Save transcript"}
                </button>
                <button className="link" onClick={() => { setEditing(false); setText(s.body); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <p className="small">
              <button className="link" onClick={() => setEditing(true)}>Correct the transcript</button>
              {s.transcript_edited_at ? <span className="muted"> · corrected by you</span> : <span className="muted"> · automatic transcript</span>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
