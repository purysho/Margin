import { useState, type FormEvent } from "react";
import { api } from "../api";
import { ErrorNote } from "../components";
import { Link } from "../router";

export function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/auth/${mode}`, mode === "login" ? { email: form.email, password: form.password } : form);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page auth">
      <section className="hero">
        <h1>Margin</h1>
        <p className="lede">AI drafts the feedback. You approve every word.</p>
        <ul className="points">
          <li>Rubric-aligned scores and inline comments on EFL writing, drafted in seconds.</li>
          <li>Nothing reaches a student until you have reviewed and released it.</li>
          <li>See how often the AI agrees with your marking, per criterion.</li>
          <li>Free to use. Names and contact details are removed before any essay reaches an AI.</li>
        </ul>
        <h2 className="how-title">How it works</h2>
        <ol className="how">
          <li><span>1</span><div><strong>Set a task</strong><p className="muted small">Write the question and pick your class's level. A marking rubric is built in.</p></div></li>
          <li><span>2</span><div><strong>Students hand in</strong><p className="muted small">They open a link and type or paste their writing. No student accounts.</p></div></li>
          <li><span>3</span><div><strong>AI drafts feedback</strong><p className="muted small">Scores for each criterion and comments on specific words, in about 20 seconds.</p></div></li>
          <li><span>4</span><div><strong>You approve it</strong><p className="muted small">Keep, edit or delete every suggestion. Students only see what you release.</p></div></li>
        </ol>
        <p className="muted">
          Try it in two minutes: create an account, then choose <em>Try a sample class</em>.
        </p>
        <p className="muted">
          Student? <Link to="/s">Enter your assignment code</Link>.
        </p>
      </section>

      <form className="card auth-form" onSubmit={submit}>
        <h2>{mode === "signup" ? "Create a teacher account" : "Log in"}</h2>
        {mode === "signup" && (
          <label>
            Your name (shown to students)
            <input required maxLength={80} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </label>
        )}
        <label>
          Email
          <input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Password {mode === "signup" && <span className="muted">(10+ characters)</span>}
          <input
            type="password"
            required
            minLength={mode === "signup" ? 10 : 1}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "I already have an account" : "Create an account instead"}
        </button>
      </form>
    </div>
  );
}
