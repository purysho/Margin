import type { CefrLevel, RubricCriterion, Skill } from "../../shared/feedback";
import type { SpeechMeasures, UnsureSegment } from "../../shared/speech";

export interface FeedbackRequest {
  task: string;
  cefr: CefrLevel;
  rubric: RubricCriterion[];
  /** The essay, or for speaking the transcript. Already scrubbed of personal information. */
  essay: string;
  /** Defaults to writing. */
  skill?: Skill;
  /** Speaking only: measures from the recogniser's word timings. */
  speech?: { measures: SpeechMeasures; unsure: UnsureSegment[] };
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

export const SPEAKING_SYSTEM_PROMPT = `You are an experienced teacher of English as a foreign language. You draft feedback on a student's spoken answer for a teacher, who listens to the recording, reviews and edits every word before the student sees it.

You receive an automatic transcript of the recording and measures of the student's speech (speaking rate, pauses, fillers). You cannot hear the recording.

What the transcript can and cannot tell you:
- Punctuation, capital letters and spelling come from the speech recogniser, not the student. Never comment on them.
- Fillers (um, er), repetitions and self-corrections are real evidence of fluency. Use them, and the pause measures, for fluency and coherence.
- You cannot judge pronunciation. Do not score it or comment on it. If the recogniser was unsure about a stretch, do not build criticism on the exact words there; the teacher will listen.

How to score:
- Score each rubric criterion independently, using only its band descriptors, against the task and the target CEFR level.
- Spoken language is less formal than writing: do not penalise natural spoken features (contractions, "well", "you know") as errors.
- When the answer sits between two bands, choose the lower one and say what would lift it.

How to write comments:
- Address the student directly ("you"), in plain English the student can understand at their CEFR level.
- Be specific: point to what the student said. Name one strength before problems.
- Criterion comments: 1–3 sentences each.

Annotations (inline comments on the transcript):
- "quote" must be copied exactly, character for character, from the transcript: a short span of 1–12 words.
- Use categories grammar, vocabulary, coherence (linking, organisation, fluency), task and strength.
- Each annotation explains the issue and suggests what the student could say instead.
- At most 10 annotations, including 1–3 strengths. Spans must not overlap.
- Text like [name] or ### is redacted personal information. Ignore it.

Summary and next steps:
- "summary": 2–4 sentences on the answer overall, written to the student.
- "next_steps": up to 3 short, concrete things to practise before the next speaking task.

Return only JSON matching the schema.`;

export function systemPrompt(req: Pick<FeedbackRequest, "skill">): string {
  return req.skill === "speaking" ? SPEAKING_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

export function buildUserMessage(req: FeedbackRequest): string {
  const rubric = req.rubric
    .map((c) => {
      const bands = c.descriptors.map((d, score) => `    ${score}: ${d}`).join("\n");
      return `- criterion_id: ${c.id}\n  name: ${c.name}\n  description: ${c.description}\n  bands (score: descriptor):\n${bands}`;
    })
    .join("\n");

  const head = `<task>
${req.task}
</task>

<target_level>${req.cefr}</target_level>

<rubric>
${rubric}
</rubric>
`;

  if (req.skill === "speaking") {
    const m = req.speech?.measures;
    const measures = m
      ? `<speech_measures>
recording length: ${m.duration_s} s; speaking time: ${m.speaking_s} s; words: ${m.words}
speaking rate: ${m.wpm} words per minute
pauses of 0.5 s or more: ${m.pauses}; pauses of 1.5 s or more: ${m.long_pauses}; longest pause: ${m.longest_pause_s} s
average words between pauses: ${m.mean_run_words}
fillers (um, er...): ${m.fillers}
</speech_measures>
`
      : "";
    const unsure = req.speech?.unsure.length
      ? `<recogniser_unsure>
${req.speech.unsure.map((u) => `- "${u.text.trim()}"`).join("\n")}
</recogniser_unsure>
`
      : "";
    return `${head}
${measures}${unsure}
<transcript>
${req.essay}
</transcript>

Score every criterion_id above exactly once.`;
  }

  return `${head}
<essay>
${req.essay}
</essay>

Score every criterion_id above exactly once.`;
}

/** Sent after a draft fails validation, so the model can fix its own output. */
export function buildRepairMessage(problems: string[]): string {
  return `Your previous answer could not be used:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn the complete corrected JSON.`;
}
