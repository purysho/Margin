import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { CATEGORY_LABEL, Essay, ErrorNote, Legend, Loading, selectionOffsets, Tag, Tip, type Category, type Highlight } from "../components";
import { useApi } from "../hooks";
import { Link } from "../router";

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
interface Detail {
  submission: { id: string; assignment_id: string; student_name: string; body: string; word_count: number; status: string; title: string; cefr_level: string };
  rubric: Criterion[];
  draft: { id: string; provider: string; model: string; latency_ms: number; output: DraftOutput } | null;
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
  const { submission: s, draft } = data;

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
          {s.student_name} <span className="muted small">{s.word_count} words · {s.cefr_level}</span>
        </h1>
        <button onClick={makeDraft} disabled={drafting}>
          {drafting ? "Drafting…" : draft ? "Draft again" : "Draft feedback with AI"}
        </button>
      </div>
      <ErrorNote error={actionError} />

      {draft ? (
        // Re-mount the editor whenever a new draft arrives.
        <Editor key={draft.id} detail={data} onReleased={reload} />
      ) : (
        <div className="review-grid">
          <Essay text={s.body} highlights={[]} />
          <aside className="margin-col">
            {drafting ? (
              <p className="progress" role="status">
                <span className="spinner" aria-hidden="true" /> The AI is reading the essay. This usually takes about 20 seconds.
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
              <span className="muted small">Select text in the essay to add your own comment.</span>
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
