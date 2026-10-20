import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ANNOTATION_CATEGORIES, type CefrLevel, type FeedbackDraft, type Skill } from "../../shared/feedback";
import { editRatio } from "../../shared/metrics";
import type { SpeechData } from "../../shared/speech";
import { wordCount } from "../../shared/text";
import { generateDraft, isProviderId, PROVIDERS } from "../ai/draft";
import { ProviderError } from "../ai/provider";
import { transcribe, TranscriptionError } from "../ai/transcribe";
import { requireTeacher } from "../auth";
import { decryptSecret, newId } from "../crypto";
import type { AppEnv, Env, Teacher } from "../env";
import { notFound, readJson } from "../util";
import { loadSubmissionForFeedback, studentFeedback } from "./public";
import { loadRubric } from "./rubrics";

interface SubmissionRow {
  id: string;
  assignment_id: string;
  student_name: string;
  body: string;
  word_count: number;
  status: string;
  created_at: number;
  title: string;
  task: string;
  cefr_level: CefrLevel;
  rubric_id: string;
  skill: Skill;
  kind: "text" | "audio";
  duration_ms: number | null;
  speech: string | null;
  transcript_raw: string | null;
  transcript_edited_at: number | null;
  transcription_error: string | null;
}

async function loadOwned(db: D1Database, submissionId: string, teacherId: string) {
  const row = await db
    .prepare(
      `SELECT s.id, s.assignment_id, s.student_name, s.body, s.word_count, s.status, s.created_at,
              s.kind, s.duration_ms, s.speech, s.transcript_raw, s.transcript_edited_at, s.transcription_error,
              a.title, a.task, a.cefr_level, a.rubric_id, a.skill
         FROM submissions s JOIN assignments a ON a.id = s.assignment_id
        WHERE s.id = ? AND a.teacher_id = ?`,
    )
    .bind(submissionId, teacherId)
    .first<SubmissionRow>();
  if (!row) notFound("Submission not found.");
  return row;
}

async function latestDraft(db: D1Database, submissionId: string) {
  const d = await db
    .prepare(
      `SELECT id, provider, model, prompt_version, output, latency_ms, created_at
         FROM ai_drafts WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(submissionId)
    .first<{ id: string; output: string } & Record<string, unknown>>();
  return d ? { ...d, output: JSON.parse(d.output) as FeedbackDraft } : null;
}

function parseSpeech(s: SubmissionRow): SpeechData | null {
  return s.speech ? (JSON.parse(s.speech) as SpeechData) : null;
}

/** What the review screen needs: the submission without raw word timings. */
function forClient(s: SubmissionRow, hasAudio: boolean) {
  const { speech: _, ...rest } = s;
  const speech = parseSpeech(s);
  return { ...rest, has_audio: hasAudio, speech: speech ? { measures: speech.measures, unsure: speech.unsure } : null };
}

async function hasAudio(db: D1Database, submissionId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM audio_clips WHERE submission_id = ?").bind(submissionId).first());
}

/** Transcribes the stored recording and saves the result. Drafts made before this become stale. */
async function retranscribe(env: Env, s: SubmissionRow): Promise<void> {
  const clip = await env.DB.prepare("SELECT bytes FROM audio_clips WHERE submission_id = ?")
    .bind(s.id)
    .first<{ bytes: ArrayBuffer | number[] }>();
  if (!clip) throw new HTTPException(410, { message: "The recording has been deleted, so it can't be transcribed again." });
  const bytes = clip.bytes instanceof ArrayBuffer ? new Uint8Array(clip.bytes) : Uint8Array.from(clip.bytes);
  let t;
  try {
    t = await transcribe(env, bytes, (s.duration_ms ?? 0) / 1000);
  } catch (err) {
    if (!(err instanceof TranscriptionError)) throw err;
    await env.DB.prepare("UPDATE submissions SET transcription_error = ? WHERE id = ?").bind(err.message, s.id).run();
    throw new HTTPException(502, { message: err.message });
  }
  await env.DB.prepare(
    `UPDATE submissions SET body = ?, word_count = ?, speech = ?, transcript_raw = ?, transcription_error = NULL,
            duration_ms = ?, transcript_edited_at = ?, status = CASE WHEN status = 'drafted' THEN 'submitted' ELSE status END
      WHERE id = ?`,
  )
    .bind(t.text, wordCount(t.text), JSON.stringify(t.speech), t.text, Math.round(t.speech.measures.duration_s * 1000), Date.now(), s.id)
    .run();
}

async function apiKeyFor(env: Env, teacher: Teacher, provider: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT ciphertext, iv FROM provider_keys WHERE teacher_id = ? AND provider = ?")
    .bind(teacher.id, provider)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return null;
  if (!env.KEY_ENCRYPTION_SECRET)
    throw new HTTPException(503, { message: "KEY_ENCRYPTION_SECRET is not set on this server, so saved API keys can't be read." });
  return decryptSecret(env.KEY_ENCRYPTION_SECRET, row.ciphertext, row.iv, `${teacher.id}:${provider}`);
}

/** Drafts made on the free tier by this teacher in the last 24 hours. */
async function freeDraftsToday(db: D1Database, teacherId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ai_drafts d
         JOIN submissions s ON s.id = d.submission_id
         JOIN assignments a ON a.id = s.assignment_id
        WHERE a.teacher_id = ? AND d.provider = 'free' AND d.created_at > ?`,
    )
    .bind(teacherId, Date.now() - 86_400_000)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export const submissions = new Hono<AppEnv>();
submissions.use("*", requireTeacher);

submissions.get("/:id", async (c) => {
  const s = await loadOwned(c.env.DB, c.req.param("id"), c.get("teacher").id);
  const db = c.env.DB;
  const [rubric, draft, review, scores, annotations, audio] = await Promise.all([
    loadRubric(db, s.rubric_id),
    latestDraft(db, s.id),
    db.prepare("SELECT final_summary, released_at FROM reviews WHERE submission_id = ?").bind(s.id).first(),
    db.prepare("SELECT criterion_id, teacher_score, final_comment FROM review_scores WHERE submission_id = ?").bind(s.id).all(),
    db.prepare(
      "SELECT start_offset, end_offset, category, final_comment, decision FROM review_annotations WHERE submission_id = ? AND decision != 'rejected' ORDER BY start_offset",
    )
      .bind(s.id)
      .all(),
    hasAudio(db, s.id),
  ]);
  return c.json({
    submission: forClient(s, audio),
    rubric,
    draft,
    review: review ? { ...review, scores: scores.results, annotations: annotations.results } : null,
  });
});

/** Exactly what the student will see on their link. */
submissions.get("/:id/student-view", async (c) => {
  const s = await loadSubmissionForFeedback(c.env.DB, "s.id = ? AND a.teacher_id = ?", c.req.param("id"), c.get("teacher").id);
  if (!s) notFound("Submission not found.");
  return c.json(await studentFeedback(c.env.DB, s));
});

/** The student's recording, for the teacher only. Gone once feedback is released. */
submissions.get("/:id/audio", async (c) => {
  const s = await loadOwned(c.env.DB, c.req.param("id"), c.get("teacher").id);
  const clip = await c.env.DB.prepare("SELECT mime, bytes FROM audio_clips WHERE submission_id = ?")
    .bind(s.id)
    .first<{ mime: string; bytes: ArrayBuffer | number[] }>();
  if (!clip) notFound("The recording has been deleted.");
  const bytes = clip.bytes instanceof ArrayBuffer ? new Uint8Array(clip.bytes) : Uint8Array.from(clip.bytes);
  return new Response(bytes, {
    headers: { "content-type": clip.mime, "cache-control": "private, no-store", "content-length": String(bytes.byteLength) },
  });
});

submissions.post("/:id/transcribe", async (c) => {
  const s = await loadOwned(c.env.DB, c.req.param("id"), c.get("teacher").id);
  if (s.kind !== "audio") throw new HTTPException(400, { message: "This is a written answer." });
  if (s.status === "released") throw new HTTPException(409, { message: "Feedback is already released." });
  await retranscribe(c.env, s);
  return c.json({ ok: true });
});

/**
 * The teacher corrects what the recogniser heard. The original stays in
 * transcript_raw, so the recogniser's accuracy (word error rate) can be measured.
 */
submissions.patch("/:id/transcript", async (c) => {
  const s = await loadOwned(c.env.DB, c.req.param("id"), c.get("teacher").id);
  if (s.kind !== "audio") throw new HTTPException(400, { message: "Only spoken answers have a transcript." });
  if (s.status === "released")
    throw new HTTPException(409, { message: "Feedback is already released, so the transcript can't change." });
  const { text } = await readJson(c, z.object({ text: z.string().trim().min(1).max(15_000) }));
  if (text === s.body) return c.json({ ok: true, changed: false });
  await c.env.DB.prepare(
    `UPDATE submissions SET body = ?, word_count = ?, transcript_edited_at = ?,
            status = CASE WHEN status = 'drafted' THEN 'submitted' ELSE status END
      WHERE id = ?`,
  )
    .bind(text, wordCount(text), Date.now(), s.id)
    .run();
  return c.json({ ok: true, changed: true });
});

submissions.post("/:id/draft", async (c) => {
  const teacher = c.get("teacher");
  let s = await loadOwned(c.env.DB, c.req.param("id"), teacher.id);
  if (s.kind === "audio" && !s.body.trim()) {
    // Transcription failed when the student handed in; try again before drafting.
    await retranscribe(c.env, s);
    s = await loadOwned(c.env.DB, s.id, teacher.id);
  }
  const providerId = isProviderId(teacher.ai_provider) ? teacher.ai_provider : "free";

  if (providerId === "free") {
    const limit = Number(c.env.FREE_DAILY_LIMIT ?? "20");
    if ((await freeDraftsToday(c.env.DB, teacher.id)) >= limit)
      throw new HTTPException(429, {
        message: `You have used today's ${limit} free drafts. Add your own Claude or Gemini key in Settings for more.`,
      });
  }

  const apiKey = PROVIDERS[providerId].info.needsKey ? await apiKeyFor(c.env, teacher, providerId) : null;
  const rubric = await loadRubric(c.env.DB, s.rubric_id);

  let result;
  try {
    result = await generateDraft(
      providerId,
      { env: c.env, apiKey, model: teacher.ai_model, studentName: s.student_name },
      {
        task: s.task,
        cefr: s.cefr_level,
        rubric,
        essay: s.body,
        skill: s.skill,
        speech: (() => {
          const sp = parseSpeech(s);
          return sp ? { measures: sp.measures, unsure: sp.unsure } : undefined;
        })(),
      },
    );
  } catch (err) {
    if (err instanceof ProviderError) throw new HTTPException(err.status, { message: err.message });
    throw err;
  }

  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO ai_drafts (id, submission_id, provider, model, prompt_version, output, dropped_quotes,
                              latency_ms, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, s.id, result.provider, result.model, result.promptVersion, JSON.stringify(result.draft),
      result.draft.dropped_quotes, result.latencyMs, result.inputTokens, result.outputTokens, Date.now(),
    ),
    c.env.DB.prepare("UPDATE submissions SET status = 'drafted' WHERE id = ? AND status = 'submitted'").bind(s.id),
  ]);
  return c.json({ draft: await latestDraft(c.env.DB, s.id) }, 201);
});

const ReleaseInput = z.object({
  draft_id: z.string(),
  scores: z.array(z.object({ criterion_id: z.string(), score: z.number().int(), comment: z.string().trim().min(1).max(2000) })),
  /** One entry per AI annotation, by index in the draft. */
  annotations: z.array(z.object({ index: z.number().int(), keep: z.boolean(), comment: z.string().trim().max(1000) })),
  /** Comments the teacher added themselves. */
  added: z
    .array(z.object({ start: z.number().int(), end: z.number().int(), category: z.enum(ANNOTATION_CATEGORIES), comment: z.string().trim().min(1).max(1000) }))
    .max(50),
  summary: z.string().trim().min(1).max(3000),
});

/**
 * Saves the teacher's final feedback and makes it visible to the student.
 * The server, not the client, decides whether each AI suggestion was
 * accepted, edited or rejected, so the agreement metrics can be trusted.
 */
submissions.post("/:id/release", async (c) => {
  const teacher = c.get("teacher");
  const s = await loadOwned(c.env.DB, c.req.param("id"), teacher.id);
  const body = await readJson(c, ReleaseInput);
  const draftRow = await c.env.DB.prepare("SELECT output, created_at FROM ai_drafts WHERE id = ? AND submission_id = ?")
    .bind(body.draft_id, s.id)
    .first<{ output: string; created_at: number }>();
  if (!draftRow) throw new HTTPException(400, { message: "Draft not found for this submission." });
  if (s.transcript_edited_at && draftRow.created_at < s.transcript_edited_at)
    throw new HTTPException(409, { message: "The transcript changed after this draft was made. Draft again so the comments match it." });
  const draft = JSON.parse(draftRow.output) as FeedbackDraft;
  const rubric = await loadRubric(c.env.DB, s.rubric_id);

  const problems: string[] = [];
  const scoreById = new Map(body.scores.map((x) => [x.criterion_id, x]));
  const aiById = new Map(draft.criteria.map((x) => [x.criterion_id, x]));
  for (const rc of rubric) {
    const sc = scoreById.get(rc.id);
    if (!sc) problems.push(`missing score for "${rc.name}"`);
    else if (sc.score < 0 || sc.score > rc.max_score) problems.push(`score for "${rc.name}" must be 0–${rc.max_score}`);
    if (!aiById.has(rc.id)) problems.push(`draft has no score for "${rc.name}"; draft again`);
  }
  if (body.annotations.length !== draft.annotations.length) problems.push("every AI comment needs a keep/remove decision");
  for (const a of body.added) {
    if (a.start < 0 || a.end > s.body.length || a.end <= a.start) problems.push("an added comment points outside the essay");
  }
  if (problems.length) throw new HTTPException(400, { message: problems.join("; ") });

  const db = c.env.DB;
  const statements = [
    db.prepare("DELETE FROM review_scores WHERE submission_id = ?").bind(s.id),
    db.prepare("DELETE FROM review_annotations WHERE submission_id = ?").bind(s.id),
    db.prepare("DELETE FROM reviews WHERE submission_id = ?").bind(s.id),
    ...rubric.map((rc) => {
      const sc = scoreById.get(rc.id)!;
      const ai = aiById.get(rc.id)!;
      return db
        .prepare(
          `INSERT INTO review_scores (submission_id, criterion_id, draft_id, ai_score, teacher_score, ai_comment, final_comment)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(s.id, rc.id, body.draft_id, ai.score, sc.score, ai.comment, sc.comment);
    }),
    ...draft.annotations.map((a, index) => {
      const d = body.annotations.find((x) => x.index === index);
      const keep = d?.keep ?? false;
      const comment = d?.comment || a.comment;
      const decision = !keep ? "rejected" : editRatio(a.comment, comment) === 0 ? "accepted" : "edited";
      return db
        .prepare(
          `INSERT INTO review_annotations (id, submission_id, draft_id, quote, start_offset, end_offset, category, ai_comment, final_comment, decision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), s.id, body.draft_id, a.quote, a.start, a.end, a.category, a.comment, keep ? comment : null, decision);
    }),
    ...body.added.map((a) =>
      db
        .prepare(
          `INSERT INTO review_annotations (id, submission_id, draft_id, quote, start_offset, end_offset, category, ai_comment, final_comment, decision)
           VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, 'added')`,
        )
        .bind(newId(), s.id, s.body.slice(a.start, a.end), a.start, a.end, a.category, a.comment),
    ),
    db
      .prepare("INSERT INTO reviews (submission_id, draft_id, ai_summary, final_summary, released_at) VALUES (?, ?, ?, ?, ?)")
      .bind(s.id, body.draft_id, draft.summary, body.summary, Date.now()),
    db.prepare("UPDATE submissions SET status = 'released' WHERE id = ?").bind(s.id),
    // Privacy: the recording is only needed for review. Once released, only the transcript stays.
    db.prepare("DELETE FROM audio_clips WHERE submission_id = ?").bind(s.id),
  ];
  await db.batch(statements);
  return c.json({ ok: true });
});
