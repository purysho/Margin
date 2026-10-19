import { describe, expect, test } from "vitest";
import type { RubricCriterion } from "../shared/feedback";
import { DraftValidationError, validateDraft } from "../shared/validate";

const rubric: RubricCriterion[] = [
  { id: "c1", name: "Task", description: "", max_score: 5, descriptors: ["0", "1", "2", "3", "4", "5"] },
  { id: "c2", name: "Grammar", description: "", max_score: 5, descriptors: ["0", "1", "2", "3", "4", "5"] },
];
const essay = "I has a dog. It is very friendly and I love him.";

const good = {
  criteria: [
    { criterion_id: "c1", score: 3, comment: "Clear." },
    { criterion_id: "c2", score: 2, comment: "Check verbs." },
  ],
  annotations: [
    { quote: "I has", category: "grammar", comment: "Use 'have'." },
    { quote: "I had a cat", category: "grammar", comment: "Not in the essay." },
  ],
  summary: "Nice start.",
  next_steps: ["a", "b", "c", "d"],
};

describe("validateDraft", () => {
  test("accepts a good draft, anchors quotes and caps next steps", () => {
    const d = validateDraft(good, rubric, essay);
    expect(d.criteria).toHaveLength(2);
    expect(d.annotations).toEqual([{ quote: "I has", start: 0, end: 5, category: "grammar", comment: "Use 'have'." }]);
    expect(d.dropped_quotes).toBe(1);
    expect(d.next_steps).toHaveLength(3);
  });

  test("rejects missing and out-of-range scores with every problem listed", () => {
    const bad = { ...good, criteria: [{ criterion_id: "c1", score: 9, comment: "x" }] };
    try {
      validateDraft(bad, rubric, essay);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DraftValidationError);
      expect((e as DraftValidationError).problems).toEqual([
        'score 9 for "Task" is outside 0–5',
        'missing score for criterion "Grammar"',
      ]);
    }
  });

  test("rejects malformed output", () => {
    expect(() => validateDraft({ criteria: "nope" }, rubric, essay)).toThrow(DraftValidationError);
  });

  test("rejects unknown annotation categories", () => {
    const bad = { ...good, annotations: [{ quote: "I has", category: "style", comment: "x" }] };
    expect(() => validateDraft(bad, rubric, essay)).toThrow(DraftValidationError);
  });
});
