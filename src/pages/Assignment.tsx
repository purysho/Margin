import { useState } from "react";
import { api } from "../api";
import { ErrorNote, Loading } from "../components";
import { useApi } from "../hooks";
import { Link } from "../router";

interface AssignmentDetail {
  id: string;
  title: string;
  task: string;
  cefr_level: string;
  join_code: string;
  is_open: number;
  submissions: { id: string; student_name: string; word_count: number; status: string; created_at: number }[];
}

const STATUS: Record<string, string> = { submitted: "New", drafted: "AI draft ready", released: "Released" };

export function AssignmentPage({ id }: { id: string }) {
  const { data, error, reload } = useApi<AssignmentDetail>(`/assignments/${id}`);
  const [batch, setBatch] = useState<{ done: number; total: number; error: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  const link = `${window.location.origin}/s/${data.join_code}`;
  const pending = data.submissions.filter((s) => s.status === "submitted");

  // One at a time keeps us inside free-tier rate limits and shows progress.
  const draftAll = async () => {
    setBatch({ done: 0, total: pending.length, error: null });
    for (let i = 0; i < pending.length; i++) {
      try {
        await api.post(`/submissions/${pending[i]!.id}/draft`);
        setBatch({ done: i + 1, total: pending.length, error: null });
      } catch (e) {
        setBatch({ done: i, total: pending.length, error: e instanceof Error ? e.message : String(e) });
        break;
      }
    }
    await reload();
  };

  const toggleOpen = async () => {
    await api.patch(`/assignments/${id}`, { is_open: !data.is_open });
    await reload();
  };

  return (
    <>
      <p className="crumbs">
        <Link to="/">Assignments</Link> /
      </p>
      <h1>{data.title}</h1>
      <p className="task">{data.task}</p>

      <div className="card share">
        <div>
          <div className="muted">Students go to</div>
          <code className="big">{link}</code>
          <div className="muted">
            or enter code <code>{data.join_code}</code> at {window.location.host}/s
          </div>
        </div>
        <div className="row">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button onClick={toggleOpen}>{data.is_open ? "Close submissions" : "Reopen"}</button>
        </div>
      </div>

      <div className="row between">
        <h2>
          Essays <span className="muted">({data.submissions.length})</span>
        </h2>
        <div className="row">
          <button onClick={() => reload()}>Refresh</button>
          {pending.length > 0 && (
            <button className="primary" onClick={draftAll} disabled={!!batch && batch.done < batch.total && !batch.error}>
              Draft feedback for {pending.length} new
            </button>
          )}
        </div>
      </div>
      {batch && (
        <p className="muted">
          Drafted {batch.done} of {batch.total}.
        </p>
      )}
      <ErrorNote error={batch?.error ?? null} />

      {data.submissions.length === 0 ? (
        <div className="card empty">No essays yet. Share the link above with your class.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Words</th>
              <th>Submitted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.submissions.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/submissions/${s.id}`}>{s.student_name}</Link>
                </td>
                <td>{s.word_count}</td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>
                  <span className={`status status-${s.status}`}>{STATUS[s.status] ?? s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
