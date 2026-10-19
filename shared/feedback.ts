import { z } from "zod";

/**
 * Prompt version is stored with every AI draft, so agreement metrics can be
 * split by prompt version. Bump it whenever the prompt or schema changes.
 */
export const PROMPT_VERSION = "2026-10-19.1";

export const ANNOTATION_CATEGORIES = [
  "grammar",
  "vocabulary",
  "coherence",
  "task",
  "strength",
] as const;
export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * What the model must return. Kept free of numeric range constraints so it is
 * accepted by structured-output modes of every provider; ranges are checked in
 * `validateDraft` against the actual rubric.
 */
export const ModelOutputSchema = z.object({
  criteria: z.array(
    z.object({
      criterion_id: z.string(),
      score: z.number().int(),
      comment: z.string(),
    }),
  ),
  annotations: z.array(
    z.object({
      quote: z.string(),
      category: z.enum(ANNOTATION_CATEGORIES),
      comment: z.string(),
    }),
  ),
  summary: z.string(),
  next_steps: z.array(z.string()),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  max_score: number;
  /** descriptors[score] describes that band. Length = max_score + 1. */
  descriptors: string[];
}

export interface AnchoredAnnotation {
  quote: string;
  start: number;
  end: number;
  category: AnnotationCategory;
  comment: string;
}

/** A model output that has been checked against the rubric and the essay. */
export interface FeedbackDraft {
  criteria: { criterion_id: string; score: number; comment: string }[];
  annotations: AnchoredAnnotation[];
  summary: string;
  next_steps: string[];
  /** Annotations removed because their quote could not be found in the essay. */
  dropped_quotes: number;
}
