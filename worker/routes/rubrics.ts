import { Hono } from "hono";
import { z } from "zod";
import { SKILLS, type RubricCriterion, type Skill } from "../../shared/feedback";
import { EFL_SPEAKING_TEMPLATE, EFL_WRITING_TEMPLATE } from "../../shared/templates";
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
  skill: z.enum(SKILLS).default("writing"),
  criteria: z.array(CriterionInput).min(1).max(8),
});

const TEMPLATES: Record<Skill, { title: string; criteria: unknown[] }> = {
  writing: EFL_WRITING_TEMPLATE,
  speaking: EFL_SPEAKING_TEMPLATE,
};

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
    db
      .prepare("INSERT INTO rubrics (id, teacher_id, title, skill, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, teacherId, input.title, input.skill, Date.now()),
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

export function templateFor(skill: Skill) {
  return RubricInput.parse({ ...TEMPLATES[skill], skill });
}

/** The teacher's most recent rubric for this skill, creating the starter rubric if they have none. */
export async function ensureDefaultRubric(db: D1Database, teacherId: string, skill: Skill = "writing"): Promise<string> {
  const existing = await db
    .prepare("SELECT id FROM rubrics WHERE teacher_id = ? AND skill = ? ORDER BY created_at DESC LIMIT 1")
    .bind(teacherId, skill)
    .first<{ id: string }>();
  return existing?.id ?? createRubric(db, teacherId, templateFor(skill));
}

export const rubrics = new Hono<AppEnv>();
rubrics.use("*", requireTeacher);

rubrics.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.skill, r.created_at, COUNT(cr.id) AS criteria_count
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
  const { skill } = await readJson(c, z.object({ skill: z.enum(SKILLS).default("writing") }));
  return c.json({ id: await createRubric(c.env.DB, c.get("teacher").id, templateFor(skill)) }, 201);
});

rubrics.get("/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT id, title, skill FROM rubrics WHERE id = ? AND teacher_id = ?")
    .bind(c.req.param("id"), c.get("teacher").id)
    .first<{ id: string; title: string; skill: Skill }>();
  if (!r) notFound("Rubric not found.");
  return c.json({ ...r, criteria: await loadRubric(c.env.DB, r.id) });
});
