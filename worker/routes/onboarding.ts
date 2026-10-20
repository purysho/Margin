import { Hono } from "hono";
import { SAMPLE_ASSIGNMENT, SAMPLE_ESSAYS } from "../../shared/sample";
import { wordCount } from "../../shared/text";
import { requireTeacher } from "../auth";
import { newId, randomToken, sha256 } from "../crypto";
import type { AppEnv } from "../env";
import { createAssignment } from "./assignments";
import { ensureDefaultRubric } from "./rubrics";

export const onboarding = new Hono<AppEnv>();
onboarding.use("*", requireTeacher);

/** Creates a sample assignment with three invented essays, so a teacher can try Margin alone. */
onboarding.post("/sample", async (c) => {
  const db = c.env.DB;
  const teacherId = c.get("teacher").id;
  const rubricId = await ensureDefaultRubric(db, teacherId);
  const { id } = await createAssignment(db, teacherId, { ...SAMPLE_ASSIGNMENT, rubric_id: rubricId });
  const now = Date.now();
  const inserts = await Promise.all(
    SAMPLE_ESSAYS.map(async (e, i) =>
      db
        .prepare(
          `INSERT INTO submissions (id, assignment_id, student_name, body, word_count, receipt_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        // Receipts are random and never shown: nobody needs to read sample feedback as a student.
        .bind(newId(), id, e.student_name, e.body, wordCount(e.body), await sha256(randomToken()), now + i),
    ),
  );
  await db.batch(inserts);
  return c.json({ id }, 201);
});
