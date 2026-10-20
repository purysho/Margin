import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { CEFR_LEVELS, SKILLS, type CefrLevel, type Skill } from "../../shared/feedback";
import { requireTeacher } from "../auth";
import { joinCode, newId } from "../crypto";
import type { AppEnv } from "../env";
import { notFound, readJson } from "../util";
import { ensureDefaultRubric, loadRubric } from "./rubrics";

export const assignments = new Hono<AppEnv>();
assignments.use("*", requireTeacher);

assignments.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.cefr_level, a.skill, a.join_code, a.is_open, a.created_at,
            COUNT(s.id) AS submissions,
            SUM(CASE WHEN s.status IN ('drafted', 'released') THEN 1 ELSE 0 END) AS drafted,
            SUM(CASE WHEN s.status = 'released' THEN 1 ELSE 0 END) AS released
       FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE a.teacher_id = ? GROUP BY a.id ORDER BY a.created_at DESC`,
  )
    .bind(c.get("teacher").id)
    .all();
  return c.json(results);
});

export async function createAssignment(
  db: D1Database,
  teacherId: string,
  input: { title: string; task: string; cefr_level: CefrLevel; skill: Skill; rubric_id: string },
): Promise<{ id: string; join_code: string }> {
  const id = newId();
  // Join codes are random; retry on the (very unlikely) collision.
  for (let attempt = 0; ; attempt++) {
    const code = joinCode();
    try {
      await db
        .prepare(
          `INSERT INTO assignments (id, teacher_id, rubric_id, title, task, cefr_level, skill, join_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, teacherId, input.rubric_id, input.title, input.task, input.cefr_level, input.skill, code, Date.now())
        .run();
      return { id, join_code: code };
    } catch (err) {
      if (attempt >= 3 || !String(err).includes("UNIQUE")) throw err;
    }
  }
}

assignments.post("/", async (c) => {
  const body = await readJson(
    c,
    z.object({
      title: z.string().trim().min(1).max(120),
      task: z.string().trim().min(10).max(3000),
      cefr_level: z.enum(CEFR_LEVELS),
      skill: z.enum(SKILLS).default("writing"),
      // Optional: beginners get the built-in rubric for the skill without an extra step.
      rubric_id: z.string().optional(),
    }),
  );
  const teacherId = c.get("teacher").id;
  let rubricId = body.rubric_id;
  if (rubricId) {
    const owned = await c.env.DB.prepare("SELECT skill FROM rubrics WHERE id = ? AND teacher_id = ?")
      .bind(rubricId, teacherId)
      .first<{ skill: Skill }>();
    if (!owned) throw new HTTPException(400, { message: "Rubric not found." });
    if (owned.skill !== body.skill) throw new HTTPException(400, { message: `That rubric is for ${owned.skill}, not ${body.skill}.` });
  } else {
    rubricId = await ensureDefaultRubric(c.env.DB, teacherId, body.skill);
  }
  const { id } = await createAssignment(c.env.DB, teacherId, { ...body, rubric_id: rubricId });
  return c.json({ id }, 201);
});

assignments.get("/:id", async (c) => {
  const a = await c.env.DB.prepare(
    "SELECT id, title, task, cefr_level, skill, join_code, is_open, rubric_id, created_at FROM assignments WHERE id = ? AND teacher_id = ?",
  )
    .bind(c.req.param("id"), c.get("teacher").id)
    .first<{ id: string; rubric_id: string }>();
  if (!a) notFound("Assignment not found.");
  const { results: submissions } = await c.env.DB.prepare(
    `SELECT id, student_name, word_count, status, kind, duration_ms, transcription_error, created_at FROM submissions
      WHERE assignment_id = ? ORDER BY created_at`,
  )
    .bind(a.id)
    .all();
  return c.json({ ...a, rubric: await loadRubric(c.env.DB, a.rubric_id), submissions });
});

assignments.patch("/:id", async (c) => {
  const { is_open } = await readJson(c, z.object({ is_open: z.boolean() }));
  const res = await c.env.DB.prepare("UPDATE assignments SET is_open = ? WHERE id = ? AND teacher_id = ?")
    .bind(is_open ? 1 : 0, c.req.param("id"), c.get("teacher").id)
    .run();
  if (!res.meta.changes) notFound("Assignment not found.");
  return c.json({ ok: true });
});

/** Deletes an assignment and everything under it (essays, drafts, reviews). */
assignments.delete("/:id", async (c) => {
  const db = c.env.DB;
  const a = await db.prepare("SELECT id FROM assignments WHERE id = ? AND teacher_id = ?")
    .bind(c.req.param("id"), c.get("teacher").id)
    .first<{ id: string }>();
  if (!a) notFound("Assignment not found.");
  const sub = "SELECT id FROM submissions WHERE assignment_id = ?";
  await db.batch([
    db.prepare(`DELETE FROM review_annotations WHERE submission_id IN (${sub})`).bind(a.id),
    db.prepare(`DELETE FROM review_scores WHERE submission_id IN (${sub})`).bind(a.id),
    db.prepare(`DELETE FROM reviews WHERE submission_id IN (${sub})`).bind(a.id),
    db.prepare(`DELETE FROM ai_drafts WHERE submission_id IN (${sub})`).bind(a.id),
    db.prepare(`DELETE FROM audio_clips WHERE submission_id IN (${sub})`).bind(a.id),
    db.prepare("DELETE FROM submissions WHERE assignment_id = ?").bind(a.id),
    db.prepare("DELETE FROM assignments WHERE id = ?").bind(a.id),
  ]);
  return c.json({ ok: true });
});
