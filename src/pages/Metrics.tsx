import { ErrorNote, Loading, num, pct } from "../components";
import { useApi } from "../hooks";

interface Stats {
  n: number;
  exact: number | null;
  adjacent: number | null;
  mae: number | null;
  bias: number | null;
  qwk: number | null;
  comment_edit_ratio: number | null;
}
interface Metrics {
  reviewed_submissions: number;
  overall: Stats;
  by_criterion: (Stats & { name: string; max_score: number })[];
  by_version: (Stats & { label: string })[];
  annotations: { suggested: number; accepted: number; edited: number; rejected: number; added: number; keepRate: number | null; acceptRate: number | null };
  transcription: { checked: number; corrected: number; mean_wer: number | null };
  drafts: { n: number; avg_latency_ms: number | null; dropped_quotes: number | null; input_tokens: number | null; output_tokens: number | null } | null;
}

function biasLabel(b: number | null) {
  if (b == null) return "–";
  if (Math.abs(b) < 0.15) return "about right";
  return b > 0 ? `${b.toFixed(2)} too generous` : `${(-b).toFixed(2)} too harsh`;
}

export function MetricsPage() {
  const { data, error } = useApi<Metrics>("/metrics");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  if (data.reviewed_submissions === 0)
    return (
      <>
        <h1>AI accuracy</h1>
        <div className="card empty">Release feedback on a few essays and this page will show how closely the AI matched your marking.</div>
      </>
    );

  const o = data.overall;
  const a = data.annotations;
  return (
    <>
      <h1>AI accuracy</h1>
      <p className="muted">From {data.reviewed_submissions} essay{data.reviewed_submissions === 1 ? "" : "s"} you reviewed and released. Your final scores are the reference.</p>

      <div className="tiles">
        <Tile label="Exact score match" value={pct(o.exact)} hint={`${o.n} criterion scores`} />
        <Tile label="Within one band" value={pct(o.adjacent)} />
        <Tile label="Agreement (QWK)" value={num(o.qwk)} hint={o.qwk == null ? "needs 5+ scores" : "1 = perfect, 0 = chance"} />
        <Tile label="AI comments kept" value={pct(a.keepRate)} hint={`${pct(a.acceptRate)} kept without edits`} />
      </div>

      <h2>By criterion</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Scores</th>
            <th>Exact</th>
            <th>±1 band</th>
            <th>QWK</th>
            <th>AI tends to be</th>
            <th>Comment rewritten</th>
          </tr>
        </thead>
        <tbody>
          {data.by_criterion.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.n}</td>
              <td>{pct(c.exact)}</td>
              <td>{pct(c.adjacent)}</td>
              <td>{num(c.qwk)}</td>
              <td>{biasLabel(c.bias)}</td>
              <td>{pct(c.comment_edit_ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Inline comments</h2>
      <p>
        The AI suggested {a.suggested}. You kept {a.accepted} as written, edited {a.edited}, removed {a.rejected}, and added {a.added} of your own.
      </p>

      <h2>By model and prompt version</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Provider · model · prompt</th>
            <th>Scores</th>
            <th>Exact</th>
            <th>±1 band</th>
            <th>QWK</th>
          </tr>
        </thead>
        <tbody>
          {data.by_version.map((v) => (
            <tr key={v.label}>
              <td><code>{v.label}</code></td>
              <td>{v.n}</td>
              <td>{pct(v.exact)}</td>
              <td>{pct(v.adjacent)}</td>
              <td>{num(v.qwk)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.transcription.checked > 0 && (
        <>
          <h2>Speech recognition</h2>
          <p>
            Of {data.transcription.checked} spoken answer{data.transcription.checked === 1 ? "" : "s"} you checked, you corrected the transcript of{" "}
            {data.transcription.corrected}. Average word error rate: <strong>{pct(data.transcription.mean_wer)}</strong>{" "}
            <span className="muted small">(share of words the recogniser got wrong compared with your final transcript; lower is better).</span>
          </p>
        </>
      )}

      {data.drafts && (
        <p className="muted small">
          {data.drafts.n} draft{data.drafts.n === 1 ? "" : "s"} · average {((data.drafts.avg_latency_ms ?? 0) / 1000).toFixed(1)}s ·{" "}
          {data.drafts.dropped_quotes ?? 0} AI comment{data.drafts.dropped_quotes === 1 ? "" : "s"} discarded for quoting text not in the essay
          {data.drafts.input_tokens ? ` · ${data.drafts.input_tokens.toLocaleString()} input / ${(data.drafts.output_tokens ?? 0).toLocaleString()} output tokens` : ""}
        </p>
      )}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}
