import { useState, type FormEvent } from "react";
import { api } from "../api";
import { ErrorNote, Loading } from "../components";
import { useApi } from "../hooks";
import { Link, navigate } from "../router";

interface AssignmentRow {
  id: string;
  title: string;
  cefr_level: string;
  join_code: string;
  is_open: number;
  submissions: number;
  released: number | null;
}
interface RubricRow {
  id: string;
  title: string;
  criteria_count: number;
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function Dashboard() {
  const assignments = useApi<AssignmentRow[]>("/assignments");
  const rubrics = useApi<RubricRow[]>("/rubrics");
  const [creating, setCreating] = useState(false);

  if (assignments.loading && !assignments.data) return <Loading />;

  return (
    <>
      <div className="row between">
        <h1>Assignments</h1>
        {!creating && (
          <button className="primary" onClick={() => setCreating(true)}>
            New assignment
          </button>
        )}
      </div>
      <ErrorNote error={assignments.error} />

      {creating && <NewAssignment rubrics={rubrics.data ?? []} onRubricMade={rubrics.reload} onCancel={() => setCreating(false)} />}

      {assignments.data?.length === 0 && !creating && (
        <div className="card empty">
          <p>No assignments yet. Create one, share its code with your class, and student essays will appear here.</p>
        </div>
      )}

      <ul className="list">
        {assignments.data?.map((a) => (
          <li key={a.id} className="card list-item">
            <Link to={`/assignments/${a.id}`}>
              <strong>{a.title}</strong>
            </Link>
            <span className="muted">
              {a.cefr_level} · code <code>{a.join_code}</code> · {a.submissions} essay{a.submissions === 1 ? "" : "s"} · {a.released ?? 0} released
              {a.is_open ? "" : " · closed"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function NewAssignment({ rubrics, onRubricMade, onCancel }: { rubrics: RubricRow[]; onRubricMade: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ title: "", task: "", cefr_level: "B1", rubric_id: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rubricId = form.rubric_id || rubrics[0]?.id || "";

  const useTemplate = async () => {
    const r = await api.post<{ id: string }>("/rubrics/from-template");
    // Functional update: the teacher may have typed while this request was in flight.
    setForm((f) => ({ ...f, rubric_id: r.id }));
    onRubricMade();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/assignments", { ...form, rubric_id: rubricId });
      navigate(`/assignments/${r.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New assignment</h2>
      <label>
        Title
        <input required maxLength={120} placeholder="Opinion essay: city or countryside?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label>
        Task (what students see and answer)
        <textarea required rows={4} minLength={10} maxLength={3000} placeholder="Some people prefer to live in a big city, others in the countryside. Which do you prefer and why? Write 150–200 words." value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Target level
          <select value={form.cefr_level} onChange={(e) => setForm({ ...form, cefr_level: e.target.value })}>
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        {rubrics.length ? (
          <label className="grow">
            Rubric
            <select value={rubricId} onChange={(e) => setForm({ ...form, rubric_id: e.target.value })}>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grow stack-tight">
            <span className="field-label">Rubric</span>
            <button type="button" onClick={useTemplate}>
              Add the starter EFL writing rubric
            </button>
          </div>
        )}
      </div>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={busy || !rubricId}>
          Create
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
