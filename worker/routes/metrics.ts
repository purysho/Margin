import { Hono } from "hono";
import { agreement, annotationStats, editRatio, type AnnotationDecision } from "../../shared/metrics";
import { wordErrorRate } from "../../shared/speech";
import { requireTeacher } from "../auth";
import type { AppEnv } from "../env";

/**
 * How closely the AI matched the teacher, from released reviews only.
 * Optional ?assignment_id= narrows to one assignment.
 */
export const metrics = new Hono<AppEnv>();

const MIN_SCORES_FOR_KAPPA = 5;
metrics.use("*", requireTeacher);

metrics.get("/", async (c) => {
  const teacherId = c.get("teacher").id;
  const assignmentId = c.req.query("assignment_id") ?? null;
  const scope = `a.teacher_id = ?1 AND (?2 IS NULL OR a.id = ?2)`;
  const db = c.env.DB;

  const [scoreRows, annRows, drafts, transcripts] = await Promise.all([
    db
      .prepare(
        `SELECT rs.submission_id, rs.criterion_id, cr.name, cr.max_score, rs.ai_score, rs.teacher_score, rs.ai_comment, rs.final_comment,
                d.provider, d.model, d.prompt_version
           FROM review_scores rs
           JOIN criteria cr ON cr.id = rs.criterion_id
           JOIN ai_drafts d ON d.id = rs.draft_id
           JOIN submissions s ON s.id = rs.submission_id
           JOIN assignments a ON a.id = s.assignment_id
          WHERE ${scope}`,
      )
      .bind(teacherId, assignmentId)
      .all<{
        submission_id: string; criterion_id: string; name: string; max_score: number; ai_score: number; teacher_score: number;
        ai_comment: string; final_comment: string; provider: string; model: string; prompt_version: string;
      }>(),
    db
      .prepare(
        `SELECT ra.decision FROM review_annotations ra
           JOIN submissions s ON s.id = ra.submission_id
           JOIN assignments a ON a.id = s.assignment_id
          WHERE ${scope}`,
      )
      .bind(teacherId, assignmentId)
      .all<{ decision: AnnotationDecision }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n, AVG(d.latency_ms) AS avg_latency_ms, SUM(d.dropped_quotes) AS dropped_quotes,
                SUM(d.input_tokens) AS input_tokens, SUM(d.output_tokens) AS output_tokens
           FROM ai_drafts d
           JOIN submissions s ON s.id = d.submission_id
           JOIN assignments a ON a.id = s.assignment_id
          WHERE ${scope}`,
      )
      .bind(teacherId, assignmentId)
      .first(),
    // Spoken answers whose transcript the teacher has checked (released) or corrected.
    db
      .prepare(
        `SELECT s.body, s.transcript_raw, s.transcript_edited_at, s.status FROM submissions s
           JOIN assignments a ON a.id = s.assignment_id
          WHERE ${scope} AND s.kind = 'audio' AND s.transcript_raw IS NOT NULL
            AND (s.status = 'released' OR s.transcript_edited_at IS NOT NULL)`,
      )
      .bind(teacherId, assignmentId)
      .all<{ body: string; transcript_raw: string; transcript_edited_at: number | null; status: string }>(),
  ]);

  // Word error rate of the speech recogniser, with the teacher's final transcript as the reference.
  const wers = transcripts.results
    .map((t) => wordErrorRate(t.body, t.transcript_raw))
    .filter((x): x is number => x !== null);

  const rows = scoreRows.results;
  const groupBy = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, typeof rows>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const stats = (rs: typeof rows) => {
    // Pooled kappa assumes criteria share a scale (true for the built-in rubric);
    // per-criterion rows are the precise view.
    const maxScore = Math.max(1, ...rs.map((r) => r.max_score));
    const base = agreement(rs.map((r) => ({ ai: r.ai_score, teacher: r.teacher_score })), maxScore);
    return {
      ...base,
      // Kappa on a handful of scores is noise; hide it until there is enough data.
      qwk: base.n >= MIN_SCORES_FOR_KAPPA ? base.qwk : null,
      comment_edit_ratio: rs.length ? rs.reduce((s, r) => s + editRatio(r.ai_comment, r.final_comment), 0) / rs.length : null,
    };
  };

  return c.json({
    reviewed_submissions: new Set(rows.map((r) => r.submission_id)).size,
    overall: stats(rows),
    by_criterion: [...groupBy((r) => r.criterion_id).values()].map((rs) => ({ name: rs[0]!.name, max_score: rs[0]!.max_score, ...stats(rs) })),
    by_version: [...groupBy((r) => `${r.provider} · ${r.model} · ${r.prompt_version}`).entries()].map(([label, rs]) => ({ label, ...stats(rs) })),
    annotations: annotationStats(annRows.results.map((r) => r.decision)),
    drafts,
    transcription: {
      checked: wers.length,
      corrected: transcripts.results.filter((t) => t.transcript_edited_at !== null).length,
      mean_wer: wers.length ? wers.reduce((a, b) => a + b, 0) / wers.length : null,
    },
  });
});
