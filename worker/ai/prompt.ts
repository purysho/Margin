import type { CefrLevel, RubricCriterion } from "../../shared/feedback";

export interface FeedbackRequest {
  task: string;
  cefr: CefrLevel;
  rubric: RubricCriterion[];
  /** Already scrubbed of personal information. */
  essay: string;
}

/**
 * Stable instructions go in the system prompt so they can be cached;
 * the per-essay content goes in the user message.
 */
export const SYSTEM_PROMPT = `You are an experienced teacher of English as a foreign language. You draft feedback on student writing for a teacher, who reviews and edits every word before the student sees it.

How to score:
- Score each rubric criterion independently, using only its band descriptors. Choose the band whose descriptor best fits the essay as a whole, not its best or worst sentence.
- Judge the writing against the task and the target CEFR level. Do not reward length for its own sake.
- When the essay sits between two bands, choose the lower one and say what would lift it.

How to write comments:
- Address the student directly ("you"), in plain English the student can understand at their CEFR level. Avoid grammar jargon below B2.
- Be specific: point to what the student wrote. Name one strength before problems.
- Criterion comments: 1–3 sentences each.

Annotations (inline comments on the essay):
- "quote" must be copied exactly, character for character, from the essay: a short span of 1–12 words. Never paraphrase or correct inside the quote.
- Each annotation explains the issue and suggests a fix, without rewriting the whole sentence for the student.
- Prioritise patterns that recur or block meaning over one-off slips. Include 1–3 "strength" annotations.
- At most 12 annotations. Spans must not overlap.
- Text like [name], [email] or ### is redacted personal information. Ignore it; never comment on it.

Summary and next steps:
- "summary": 2–4 sentences on the essay overall, written to the student.
- "next_steps": up to 3 short, concrete actions for the student's next piece of writing.

Return only JSON matching the schema.`;

export function buildUserMessage(req: FeedbackRequest): string {
  const rubric = req.rubric
    .map((c) => {
      const bands = c.descriptors.map((d, score) => `    ${score}: ${d}`).join("\n");
      return `- criterion_id: ${c.id}\n  name: ${c.name}\n  description: ${c.description}\n  bands (score: descriptor):\n${bands}`;
    })
    .join("\n");

  return `<task>
${req.task}
</task>

<target_level>${req.cefr}</target_level>

<rubric>
${rubric}
</rubric>

<essay>
${req.essay}
</essay>

Score every criterion_id above exactly once.`;
}

/** Sent after a draft fails validation, so the model can fix its own output. */
export function buildRepairMessage(problems: string[]): string {
  return `Your previous answer could not be used:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn the complete corrected JSON.`;
}
