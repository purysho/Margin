import { Hono } from "hono";
import { z } from "zod";
import { SKILLS } from "../../shared/feedback";
import { SAMPLE_ASSIGNMENT, SAMPLE_ESSAYS } from "../../shared/sample";
import { SAMPLE_SPEAKING_ASSIGNMENT, sampleSpeakingSubmissions } from "../../shared/sample-speaking";
import { wordCount } from "../../shared/text";
import { requireTeacher } from "../auth";
import { newId, randomToken, sha256 } from "../crypto";
import type { AppEnv } from "../env";
import { readJson } from "../util";
import { createAssignment } from "./assignments";
import { ensureDefaultRubric } from "./rubrics";

export const onboarding = new Hono<AppEnv>();
onboarding.use("*", requireTeacher);

/**
 * Creates a sample assignment with three invented answers, so a teacher can try
 * Margin alone. Speaking samples have transcripts and timings but no recordings.
 */
onboarding.post("/sample", async (c) => {
  const { skill } = await readJson(c, z.object({ skill: z.enum(SKILLS).default("writing") }));
  const db = c.env.DB;
  const teacherId = c.get("teacher").id;
  const rubricId = await ensureDefaultRubric(db, teacherId, skill);
  const meta = skill === "speaking" ? SAMPLE_SPEAKING_ASSIGNMENT : SAMPLE_ASSIGNMENT;
  const { id } = await createAssignment(db, teacherId, { ...meta, skill, rubric_id: rubricId });
  const now = Date.now();

  // Receipts are random and never shown: nobody needs to read sample feedback as a student.
  const inserts =
    skill === "speaking"
      ? await Promise.all(
          sampleSpeakingSubmissions().map(async (e, i) =>
            db
              .prepare(
                `INSERT INTO submissions (id, assignment_id, student_name, body, word_count, receipt_hash, kind,
                                          duration_ms, speech, transcript_raw, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'audio', ?, ?, ?, ?)`,
              )
              .bind(
                newId(), id, e.student_name, e.text, wordCount(e.text), await sha256(randomToken()),
                Math.round(e.speech.measures.duration_s * 1000), JSON.stringify(e.speech), e.text, now + i,
              ),
          ),
        )
      : await Promise.all(
          SAMPLE_ESSAYS.map(async (e, i) =>
            db
              .prepare(
                `INSERT INTO submissions (id, assignment_id, student_name, body, word_count, receipt_hash, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(newId(), id, e.student_name, e.body, wordCount(e.body), await sha256(randomToken()), now + i),
          ),
        );
  await db.batch(inserts);
  return c.json({ id }, 201);
});
