import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { ErrorNote, Loading } from "../components";
import { useApi } from "../hooks";
import { Link, navigate } from "../router";

type Skill = "writing" | "speaking";

interface AssignmentRow {
  id: string;
  title: string;
  skill: Skill;
  cefr_level: string;
  join_code: string;
  is_open: number;
  submissions: number;
  drafted: number | null;
  released: number | null;
}
interface RubricRow {
  id: string;
  title: string;
  skill: Skill;
  criteria_count: number;
}

const LEVELS: { value: string; label: string }[] = [
  { value: "A1", label: "A1 (beginner)" },
  { value: "A2", label: "A2 (elementary)" },
  { value: "B1", label: "B1 (intermediate)" },
  { value: "B2", label: "B2 (upper intermediate)" },
  { value: "C1", label: "C1 (advanced)" },
  { value: "C2", label: "C2 (proficient)" },
];

const CHECKLIST_HIDDEN_KEY = "margin.checklistHidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(CHECKLIST_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function Dashboard() {
  const assignments = useApi<AssignmentRow[]>("/assignments");
  const rubrics = useApi<RubricRow[]>("/rubrics");
  const [creating, setCreating] = useState(false);
  const [hidden, setHidden] = useState(readHidden);

  if (assignments.loading && !assignments.data) return <Loading />;
  const list = assignments.data ?? [];

  const total = (k: "submissions" | "drafted" | "released") => list.reduce((n, a) => n + (a[k] ?? 0), 0);
  const steps = {
    assignment: list.length > 0,
    essays: total("submissions") > 0,
    drafted: total("drafted") > 0,
    released: total("released") > 0,
  };
  const allDone = Object.values(steps).every(Boolean);

  return (
    <>
      <div className="row between">
        <h1>Assignments</h1>
        {!creating && list.length > 0 && (
          <button className="primary" onClick={() => setCreating(true)}>
            New assignment
          </button>
        )}
      </div>
      <ErrorNote error={assignments.error} />

      {!allDone && !hidden && (
        <GettingStarted
          steps={steps}
          firstAssignment={list[0]}
          onNew={() => setCreating(true)}
          onHide={() => {
            try {
              localStorage.setItem(CHECKLIST_HIDDEN_KEY, "1");
            } catch {
              /* ignore */
            }
            setHidden(true);
          }}
        />
      )}

      {creating && <NewAssignment rubrics={rubrics.data ?? []} onCancel={() => setCreating(false)} />}

      <ul className="list">
        {list.map((a) => (
          <li key={a.id} className="card list-item">
            <Link to={`/assignments/${a.id}`}>
              <strong>{a.title}</strong>
            </Link>
            <span className="muted">
              <span className={`skill-tag skill-${a.skill}`}>{a.skill === "speaking" ? "Speaking" : "Writing"}</span> {a.cefr_level} · code <code>{a.join_code}</code> · {a.submissions} {a.skill === "speaking" ? "recording" : "essay"}{a.submissions === 1 ? "" : "s"} · {a.released ?? 0} released
              {a.is_open ? "" : " · closed"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function GettingStarted({
  steps,
  firstAssignment,
  onNew,
  onHide,
}: {
  steps: { assignment: boolean; essays: boolean; drafted: boolean; released: boolean };
  firstAssignment: AssignmentRow | undefined;
  onNew: () => void;
  onHide: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trySample = async (skill: Skill) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/onboarding/sample", { skill });
      navigate(`/assignments/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const go = firstAssignment ? `/assignments/${firstAssignment.id}` : null;
  const items: { done: boolean; title: string; body: ReactNode }[] = [
    {
      done: steps.assignment,
      title: "Create an assignment",
      body: (
        <>
          A writing or speaking task for your students.{" "}
          {!steps.assignment && (
            <button className="link" onClick={onNew}>
              Create one
            </button>
          )}
        </>
      ),
    },
    {
      done: steps.essays,
      title: "Collect answers",
      body: (
        <>
          Each assignment has a link and a code. Students open it, type their name and hand in their writing or a recording. No student accounts.
          {go && !steps.essays && (
            <>
              {" "}
              <Link to={go}>Get the link</Link>
            </>
          )}
        </>
      ),
    },
    {
      done: steps.drafted,
      title: "Draft feedback with AI",
      body: "One click drafts scores and comments for every new answer, about 20 seconds each. Recordings are transcribed automatically. Students see nothing yet.",
    },
    {
      done: steps.released,
      title: "Review and release",
      body: "Keep, edit or remove each AI comment, set the final scores, then release. Only then can the student see it.",
    },
  ];

  return (
    <section className="card onboarding">
      <div className="row between">
        <h2>Getting started</h2>
        <button className="link small" onClick={onHide}>
          Hide
        </button>
      </div>
      {!steps.assignment && (
        <div className="sample-cta">
          <div>
            <strong>New here? Try it with a sample class first.</strong>
            <p className="muted small">
              We'll create an assignment with three invented answers at different levels, so you can see the whole process in two minutes. Delete it whenever you like.
            </p>
          </div>
          <div className="row">
            <button className="primary" onClick={() => trySample("writing")} disabled={busy}>
              {busy ? "Creating…" : "Try a sample class"}
            </button>
            <button onClick={() => trySample("speaking")} disabled={busy}>
              Try a speaking sample
            </button>
          </div>
        </div>
      )}
      <ErrorNote error={error} />
      <ol className="steps">
        {items.map((it, i) => (
          <li key={it.title} className={it.done ? "done" : ""}>
            <span className="step-mark" aria-hidden="true">
              {it.done ? "✓" : i + 1}
            </span>
            <div>
              <strong>
                {it.title}
                {it.done && <span className="visually-hidden"> (done)</span>}
              </strong>
              <p className="muted small">{it.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NewAssignment({ rubrics, onCancel }: { rubrics: RubricRow[]; onCancel: () => void }) {
  const [form, setForm] = useState({ title: "", task: "", cefr_level: "B1", rubric_id: "", skill: "writing" as Skill });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forSkill = rubrics.filter((r) => r.skill === form.skill);
  const rubricId = (forSkill.some((r) => r.id === form.rubric_id) && form.rubric_id) || forSkill[0]?.id || "";
  const speaking = form.skill === "speaking";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Without a rubric id the server uses the built-in EFL writing rubric.
      const r = await api.post<{ id: string }>("/assignments", { ...form, rubric_id: rubricId || undefined });
      navigate(`/assignments/${r.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New assignment</h2>
      <fieldset className="skill-choice">
        <legend>Skill</legend>
        {(["writing", "speaking"] as const).map((k) => (
          <label key={k} className={`choice${form.skill === k ? " on" : ""}`}>
            <input type="radio" name="skill" checked={form.skill === k} onChange={() => setForm({ ...form, skill: k, rubric_id: "" })} />
            <span>
              <strong>{k === "writing" ? "Writing" : "Speaking"}</strong>
              <span className="muted small">
                {k === "writing" ? "Students type or paste an essay." : "Students record a spoken answer (up to 3 minutes) on a phone or computer."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Title
        <input required maxLength={120} placeholder={speaking ? "Speaking: a place you love" : "Opinion essay: city or countryside?"} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label>
        Task <span className="muted">(what students see and answer)</span>
        <textarea required rows={4} minLength={10} maxLength={3000} placeholder={
            speaking
              ? "Talk for about one minute. Describe a place you love to visit: where it is, what you do there, and why it is special to you."
              : "Some people prefer to live in a big city, others in the countryside. Which do you prefer and why? Write 150–200 words."
          } value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Students' level
          <select value={form.cefr_level} onChange={(e) => setForm({ ...form, cefr_level: e.target.value })}>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {forSkill.length > 1 ? (
          <label className="grow">
            Rubric
            <select value={rubricId} onChange={(e) => setForm({ ...form, rubric_id: e.target.value })}>
              {forSkill.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted small grow">
            {speaking
              ? "Marked with the built-in EFL speaking rubric: Fluency and coherence, Vocabulary, Grammar and Task response, each scored 0–5. Pronunciation is left to you: listen to the recording."
              : "Marked with the built-in EFL writing rubric: Task response, Organisation, Vocabulary and Grammar, each scored 0–5."}
          </p>
        )}
      </div>
      <p className="muted small">The level tells the AI how simply to write its comments, and what to expect from the writing.</p>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create assignment"}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
