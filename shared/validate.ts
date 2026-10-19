import {
  ModelOutputSchema,
  type FeedbackDraft,
  type RubricCriterion,
} from "./feedback";
import { anchorAnnotations } from "./text";

export class DraftValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`AI draft failed validation: ${problems.join("; ")}`);
    this.name = "DraftValidationError";
  }
}

const MAX_ANNOTATIONS = 25;
const MAX_NEXT_STEPS = 3;

/**
 * Turns raw model output into a FeedbackDraft, or throws with every problem
 * found. Checks that each rubric criterion is scored exactly once and in range,
 * and that every annotation quotes text that is really in the essay.
 */
export function validateDraft(
  raw: unknown,
  rubric: RubricCriterion[],
  essay: string,
): FeedbackDraft {
  const parsed = ModelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DraftValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const out = parsed.data;
  const problems: string[] = [];

  const byId = new Map(out.criteria.map((c) => [c.criterion_id, c]));
  if (byId.size !== out.criteria.length) problems.push("a criterion was scored more than once");

  const criteria: FeedbackDraft["criteria"] = [];
  for (const rc of rubric) {
    const c = byId.get(rc.id);
    if (!c) {
      problems.push(`missing score for criterion "${rc.name}"`);
      continue;
    }
    if (c.score < 0 || c.score > rc.max_score) {
      problems.push(`score ${c.score} for "${rc.name}" is outside 0–${rc.max_score}`);
      continue;
    }
    if (!c.comment.trim()) problems.push(`empty comment for "${rc.name}"`);
    criteria.push({ criterion_id: rc.id, score: c.score, comment: c.comment.trim() });
  }
  if (!out.summary.trim()) problems.push("empty summary");
  if (problems.length) throw new DraftValidationError(problems);

  const { kept, dropped } = anchorAnnotations(essay, out.annotations.slice(0, MAX_ANNOTATIONS));
  return {
    criteria,
    annotations: kept,
    summary: out.summary.trim(),
    next_steps: out.next_steps
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_NEXT_STEPS),
    dropped_quotes: dropped + Math.max(0, out.annotations.length - MAX_ANNOTATIONS),
  };
}
