import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { wordCount } from "../../shared/text";
import { newId, randomToken, sha256 } from "../crypto";
import type { AppEnv } from "../env";
import { notFound, readJson } from "../util";
import { loadRubric } from "./rubrics";

/** Student-facing routes. No accounts: a join code to submit, a private receipt link to read feedback. */
export const publicRoutes = new Hono<AppEnv>();

const MAX_CHARS = 15_000;
const MIN_WORDS = 20;

publicRoutes.get("/assignments/:code", async (c) => {
  const a = await c.env.DB.prepare(
    `SELECT a.title, a.task, a.cefr_level, a.is_open, t.display_name AS teacher
       FROM assignments a JOIN teachers t ON t.id = a.teacher_id WHERE a.join_code = ?`,
  )
    .bind(c.req.param("code").toUpperCase())
    .first();
  if (!a) notFound("No assignment with that code.");
  return c.json(a);
});

publicRoutes.post("/assignments/:code/submissions", async (c) => {
  const body = await readJson(
    c,
    z.object({
      student_name: z.string().trim().min(1).max(80),
      body: z.string().trim().max(MAX_CHARS, `Essays can be at most ${MAX_CHARS} characters.`),
    }),
  );
  const words = wordCount(body.body);
  if (words < MIN_WORDS) throw new HTTPException(400, { message: `Write at least ${MIN_WORDS} words.` });

  const a = await c.env.DB.prepare("SELECT id, is_open FROM assignments WHERE join_code = ?")
    .bind(c.req.param("code").toUpperCase())
    .first<{ id: string; is_open: number }>();
  if (!a) notFound("No assignment with that code.");
  if (!a.is_open) throw new HTTPException(403, { message: "This assignment is closed." });

  const receipt = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO submissions (id, assignment_id, student_name, body, word_count, receipt_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId(), a.id, body.student_name, body.body, words, await sha256(receipt), Date.now())
    .run();
  return c.json({ receipt }, 201);
});

interface SubmissionForFeedback {
  id: string;
  body: string;
  status: string;
  created_at: number;
  title: string;
  task: string;
  rubric_id: string;
}

const SUBMISSION_FOR_FEEDBACK = `SELECT s.id, s.body, s.status, s.created_at, a.title, a.task, a.rubric_id
  FROM submissions s JOIN assignments a ON a.id = s.assignment_id`;

/** What a student sees on their link. Also used for the teacher's "preview as student". */
export async function studentFeedback(db: D1Database, s: SubmissionForFeedback) {
  const base = { title: s.title, task: s.task, body: s.body, submitted_at: s.created_at };
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
