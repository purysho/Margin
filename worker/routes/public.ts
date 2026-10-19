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

publicRoutes.get("/receipts/:token", async (c) => {
  const s = await c.env.DB.prepare(
    `SELECT s.id, s.body, s.status, s.created_at, a.title, a.task, a.rubric_id
       FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.receipt_hash = ?`,
  )
    .bind(await sha256(c.req.param("token")))
    .first<{ id: string; body: string; status: string; created_at: number; title: string; task: string; rubric_id: string }>();
  if (!s) notFound("This feedback link is not valid.");

  const base = { title: s.title, task: s.task, body: s.body, submitted_at: s.created_at };
  if (s.status !== "released") return c.json({ ...base, status: "waiting" as const });

  const [review, scores, annotations, rubric] = await Promise.all([
    c.env.DB.prepare("SELECT final_summary, released_at FROM reviews WHERE submission_id = ?")
      .bind(s.id)
      .first<{ final_summary: string; released_at: number }>(),
    c.env.DB.prepare("SELECT criterion_id, teacher_score, final_comment FROM review_scores WHERE submission_id = ?")
      .bind(s.id)
      .all<{ criterion_id: string; teacher_score: number; final_comment: string }>(),
    c.env.DB.prepare(
      `SELECT start_offset AS start, end_offset AS end, category, final_comment AS comment
         FROM review_annotations WHERE submission_id = ? AND decision != 'rejected' ORDER BY start_offset`,
    )
      .bind(s.id)
      .all(),
    loadRubric(c.env.DB, s.rubric_id),
  ]);
  const byId = new Map(scores.results.map((r) => [r.criterion_id, r]));
  return c.json({
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
  });
});
