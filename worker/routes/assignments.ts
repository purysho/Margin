import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { CEFR_LEVELS } from "../../shared/feedback";
import { requireTeacher } from "../auth";
import { joinCode, newId } from "../crypto";
import type { AppEnv } from "../env";
import { notFound, readJson } from "../util";
import { loadRubric } from "./rubrics";

export const assignments = new Hono<AppEnv>();
assignments.use("*", requireTeacher);

assignments.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.cefr_level, a.join_code, a.is_open, a.created_at,
            COUNT(s.id) AS submissions,
            SUM(CASE WHEN s.status = 'released' THEN 1 ELSE 0 END) AS released
       FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE a.teacher_id = ? GROUP BY a.id ORDER BY a.created_at DESC`,
  )
    .bind(c.get("teacher").id)
    .all();
  return c.json(results);
});

assignments.post("/", async (c) => {
  const body = await readJson(
    c,
    z.object({
      title: z.string().trim().min(1).max(120),
      task: z.string().trim().min(10).max(3000),
      cefr_level: z.enum(CEFR_LEVELS),
      rubric_id: z.string(),
    }),
  );
  const teacherId = c.get("teacher").id;
  const rubric = await c.env.DB.prepare("SELECT 1 FROM rubrics WHERE id = ? AND teacher_id = ?")
    .bind(body.rubric_id, teacherId)
    .first();
  if (!rubric) throw new HTTPException(400, { message: "Rubric not found." });
  const id = newId();
  // Join codes are random; retry on the (very unlikely) collision.
  for (let attempt = 0; ; attempt++) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO assignments (id, teacher_id, rubric_id, title, task, cefr_level, join_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, teacherId, body.rubric_id, body.title, body.task, body.cefr_level, joinCode(), Date.now())
        .run();
      break;
    } catch (err) {
      if (attempt >= 3 || !String(err).includes("UNIQUE")) throw err;
    }
  }
  return c.json({ id }, 201);
});

assignments.get("/:id", async (c) => {
  const a = await c.env.DB.prepare(
    "SELECT id, title, task, cefr_level, join_code, is_open, rubric_id, created_at FROM assignments WHERE id = ? AND teacher_id = ?",
  )
    .bind(c.req.param("id"), c.get("teacher").id)
    .first<{ id: string; rubric_id: string }>();
  if (!a) notFound("Assignment not found.");
  const { results: submissions } = await c.env.DB.prepare(
    `SELECT id, student_name, word_count, status, created_at FROM submissions
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
