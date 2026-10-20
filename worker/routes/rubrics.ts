import { Hono } from "hono";
import { z } from "zod";
import type { RubricCriterion } from "../../shared/feedback";
import { EFL_WRITING_TEMPLATE } from "../../shared/templates";
import { requireTeacher } from "../auth";
import { newId } from "../crypto";
import type { AppEnv } from "../env";
import { notFound, readJson } from "../util";

const CriterionInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    descriptors: z.array(z.string().trim().min(1).max(500)).min(2).max(11),
  })
  .transform((c) => ({ ...c, max_score: c.descriptors.length - 1 }));

const RubricInput = z.object({
  title: z.string().trim().min(1).max(120),
  criteria: z.array(CriterionInput).min(1).max(8),
});

export async function loadRubric(db: D1Database, rubricId: string): Promise<RubricCriterion[]> {
  const { results } = await db
    .prepare("SELECT id, name, description, max_score, descriptors FROM criteria WHERE rubric_id = ? ORDER BY position")
    .bind(rubricId)
    .all<Omit<RubricCriterion, "descriptors"> & { descriptors: string }>();
  return results.map((r) => ({ ...r, descriptors: JSON.parse(r.descriptors) as string[] }));
}

export async function createRubric(db: D1Database, teacherId: string, input: z.infer<typeof RubricInput>) {
  const id = newId();
  await db.batch([
    db.prepare("INSERT INTO rubrics (id, teacher_id, title, created_at) VALUES (?, ?, ?, ?)").bind(id, teacherId, input.title, Date.now()),
    ...input.criteria.map((c, i) =>
      db
        .prepare(
          "INSERT INTO criteria (id, rubric_id, position, name, description, max_score, descriptors) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(newId(), id, i, c.name, c.description, c.max_score, JSON.stringify(c.descriptors)),
    ),
  ]);
  return id;
}

/** The teacher's most recent rubric, creating the starter EFL rubric if they have none. */
export async function ensureDefaultRubric(db: D1Database, teacherId: string): Promise<string> {
  const existing = await db
    .prepare("SELECT id FROM rubrics WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(teacherId)
    .first<{ id: string }>();
  return existing?.id ?? createRubric(db, teacherId, RubricInput.parse(EFL_WRITING_TEMPLATE));
}

export const rubrics = new Hono<AppEnv>();
rubrics.use("*", requireTeacher);

rubrics.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.created_at, COUNT(cr.id) AS criteria_count
       FROM rubrics r LEFT JOIN criteria cr ON cr.rubric_id = r.id
      WHERE r.teacher_id = ? GROUP BY r.id ORDER BY r.created_at DESC`,
  )
    .bind(c.get("teacher").id)
    .all();
  return c.json(results);
});

rubrics.post("/", async (c) => {
  const input = await readJson(c, RubricInput);
  return c.json({ id: await createRubric(c.env.DB, c.get("teacher").id, input) }, 201);
});

rubrics.post("/from-template", async (c) => {
  const input = RubricInput.parse(EFL_WRITING_TEMPLATE);
  return c.json({ id: await createRubric(c.env.DB, c.get("teacher").id, input) }, 201);
});

rubrics.get("/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT id, title FROM rubrics WHERE id = ? AND teacher_id = ?")
    .bind(c.req.param("id"), c.get("teacher").id)
    .first<{ id: string; title: string }>();
  if (!r) notFound("Rubric not found.");
  return c.json({ ...r, criteria: await loadRubric(c.env.DB, r.id) });
});
