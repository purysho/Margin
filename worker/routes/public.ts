import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { wordCount } from "../../shared/text";
import { transcribe, TranscriptionError } from "../ai/transcribe";
import { newId, randomToken, sha256 } from "../crypto";
import type { AppEnv } from "../env";
import { notFound, readJson } from "../util";
import { loadRubric } from "./rubrics";

/** Student-facing routes. No accounts: a join code to submit, a private receipt link to read feedback. */
export const publicRoutes = new Hono<AppEnv>();

const MAX_CHARS = 15_000;
const MIN_WORDS = 20;

/** Recordings are capped so one fits comfortably in a D1 row (2 MB limit). */
export const MAX_AUDIO_BYTES = 1_500_000;
export const MAX_AUDIO_SECONDS = 180;

publicRoutes.get("/assignments/:code", async (c) => {
  const a = await c.env.DB.prepare(
    `SELECT a.title, a.task, a.cefr_level, a.skill, a.is_open, t.display_name AS teacher
       FROM assignments a JOIN teachers t ON t.id = a.teacher_id WHERE a.join_code = ?`,
  )
    .bind(c.req.param("code").toUpperCase())
    .first();
  if (!a) notFound("No assignment with that code.");
  return c.json({ ...a, max_audio_seconds: MAX_AUDIO_SECONDS });
});

publicRoutes.post("/assignments/:code/submissions", async (c) => {
  const a = await c.env.DB.prepare("SELECT id, is_open, skill FROM assignments WHERE join_code = ?")
    .bind(c.req.param("code").toUpperCase())
    .first<{ id: string; is_open: number; skill: string }>();
  if (!a) notFound("No assignment with that code.");
  if (!a.is_open) throw new HTTPException(403, { message: "This assignment is closed." });

  if (a.skill === "speaking") return submitRecording(c, a.id);

  const body = await readJson(
    c,
    z.object({
      student_name: z.string().trim().min(1).max(80),
      body: z.string().trim().max(MAX_CHARS, `Essays can be at most ${MAX_CHARS} characters.`),
    }),
  );
  const words = wordCount(body.body);
  if (words < MIN_WORDS) throw new HTTPException(400, { message: `Write at least ${MIN_WORDS} words.` });

  const receipt = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO submissions (id, assignment_id, student_name, body, word_count, receipt_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId(), a.id, body.student_name, body.body, words, await sha256(receipt), Date.now())
    .run();
  return c.json({ receipt }, 201);
});

/**
 * Stores a spoken answer and transcribes it straight away, so the teacher sees
 * the transcript when they open it. If transcription fails, the recording is
 * still kept and the teacher can retry; the student is not blocked.
 */
async function submitRecording(c: Context<AppEnv>, assignmentId: string) {
  const type = c.req.header("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) throw new HTTPException(415, { message: "Send the recording as a file upload." });
  const form = await c.req.parseBody();
  const name = typeof form.student_name === "string" ? form.student_name.trim() : "";
  if (!name || name.length > 80) throw new HTTPException(400, { message: "Enter your name (up to 80 characters)." });
  const file = form.audio;
  if (!(file instanceof File)) throw new HTTPException(400, { message: "Record or choose an audio file first." });
  if (file.size > MAX_AUDIO_BYTES)
    throw new HTTPException(413, { message: `The recording is too large (max ${Math.round(MAX_AUDIO_BYTES / 1e6 * 10) / 10} MB, about ${MAX_AUDIO_SECONDS / 60} minutes).` });
  if (file.size < 2000) throw new HTTPException(400, { message: "The recording is empty. Try recording again." });
  const mime = (file.type || "audio/webm").split(";")[0]!;
  if (!/^(audio|video)\/[\w.+-]+$/.test(mime)) throw new HTTPException(415, { message: "That file is not an audio recording." });
  const claimedMs = Number(form.duration_ms);
  const durationMs = Number.isFinite(claimedMs) && claimedMs > 0 ? Math.min(claimedMs, MAX_AUDIO_SECONDS * 1000 + 5000) : null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = newId();
  const receipt = randomToken();
  const now = Date.now();

  let text = "";
  let speech: string | null = null;
  let error: string | null = null;
  let duration = durationMs;
  try {
    const t = await transcribe(c.env, bytes, (durationMs ?? 0) / 1000);
    text = t.text;
    speech = JSON.stringify(t.speech);
    duration = Math.round(t.speech.measures.duration_s * 1000);
  } catch (err) {
    if (!(err instanceof TranscriptionError)) throw err;
    error = err.message;
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO submissions (id, assignment_id, student_name, body, word_count, receipt_hash, kind, duration_ms,
                                speech, transcript_raw, transcription_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'audio', ?, ?, ?, ?, ?)`,
    ).bind(id, assignmentId, name, text, wordCount(text), await sha256(receipt), duration, speech, text || null, error, now),
    c.env.DB.prepare("INSERT INTO audio_clips (submission_id, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      id, mime, bytes, bytes.byteLength, now,
    ),
  ]);
  return c.json({ receipt }, 201);
}

interface SubmissionForFeedback {
  id: string;
  body: string;
  status: string;
  created_at: number;
  title: string;
  task: string;
  rubric_id: string;
  kind: "text" | "audio";
}

const SUBMISSION_FOR_FEEDBACK = `SELECT s.id, s.body, s.status, s.created_at, s.kind, a.title, a.task, a.rubric_id
  FROM submissions s JOIN assignments a ON a.id = s.assignment_id`;

/** What a student sees on their link. Also used for the teacher's "preview as student". */
export async function studentFeedback(db: D1Database, s: SubmissionForFeedback) {
  const base = { title: s.title, task: s.task, body: s.body, kind: s.kind, submitted_at: s.created_at };
  if (s.status !== "released") return { ...base, status: "waiting" as const };

  const [review, scores, annotations, rubric] = await Promise.all([
    db.prepare("SELECT final_summary, released_at FROM reviews WHERE submission_id = ?")
      .bind(s.id)
      .first<{ final_summary: string; released_at: number }>(),
    db.prepare("SELECT criterion_id, teacher_score, final_comment FROM review_scores WHERE submission_id = ?")
      .bind(s.id)
      .all<{ criterion_id: string; teacher_score: number; final_comment: string }>(),
    db.prepare(
      `SELECT start_offset AS start, end_offset AS end, category, final_comment AS comment
         FROM review_annotations WHERE submission_id = ? AND decision != 'rejected' ORDER BY start_offset`,
    )
      .bind(s.id)
      .all(),
    loadRubric(db, s.rubric_id),
  ]);
  const byId = new Map(scores.results.map((r) => [r.criterion_id, r]));
  return {
    ...base,
    status: "released" as const,
    summary: review?.final_summary ?? "",
    released_at: review?.released_at ?? null,
    criteria: rubric.map((rc) => ({
      name: rc.name,
      max_score: rc.max_score,
      score: byId.get(rc.id)?.teacher_score ?? null,
      comment: byId.get(rc.id)?.final_comment ?? "",
    })),
    annotations: annotations.results,
  };
}

export async function loadSubmissionForFeedback(db: D1Database, where: string, ...params: unknown[]) {
  return db.prepare(`${SUBMISSION_FOR_FEEDBACK} WHERE ${where}`).bind(...params).first<SubmissionForFeedback>();
}

publicRoutes.get("/receipts/:token", async (c) => {
  const s = await loadSubmissionForFeedback(c.env.DB, "s.receipt_hash = ?", await sha256(c.req.param("token")));
  if (!s) notFound("This feedback link is not valid.");
  return c.json(await studentFeedback(c.env.DB, s));
});
