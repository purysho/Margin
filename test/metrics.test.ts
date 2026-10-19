import { describe, expect, test } from "vitest";
import { agreement, annotationStats, editDistance, editRatio, quadraticWeightedKappa } from "../shared/metrics";

const pairs = (ai: number[], teacher: number[]) => ai.map((a, i) => ({ ai: a, teacher: teacher[i]! }));

describe("quadraticWeightedKappa", () => {
  // Reference values computed with sklearn.metrics.cohen_kappa_score(weights="quadratic", labels=range(6)).
  test.each([
    [[0, 1, 2, 3, 4, 5, 3, 2], [0, 1, 2, 3, 4, 4, 2, 2], 0.9375],
    [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], -1],
    [[2, 3, 3, 1, 4], [2, 3, 4, 1, 4], 0.9180327868852459],
  ])("matches sklearn for %j vs %j", (ai, teacher, expected) => {
    expect(quadraticWeightedKappa(pairs(ai, teacher), 0, 5)).toBeCloseTo(expected, 10);
  });

  test("is 1 for perfect agreement", () => {
    expect(quadraticWeightedKappa(pairs([0, 2, 5], [0, 2, 5]), 0, 5)).toBeCloseTo(1);
  });

  test("is undefined with no data or no variance", () => {
    expect(quadraticWeightedKappa([], 0, 5)).toBeNull();
    expect(quadraticWeightedKappa(pairs([3, 3], [3, 3]), 0, 5)).toBeNull();
  });
});

describe("agreement", () => {
  test("computes exact, adjacent, MAE and bias", () => {
    const s = agreement(pairs([3, 4, 2, 5], [3, 3, 4, 5]), 5);
    expect(s.n).toBe(4);
    expect(s.exact).toBe(0.5);
    expect(s.adjacent).toBe(0.75);
    expect(s.mae).toBe(0.75);
    expect(s.bias).toBe(-0.25);
  });

  test("returns nulls when there is nothing to compare", () => {
    expect(agreement([], 5)).toEqual({ n: 0, exact: null, adjacent: null, mae: null, bias: null, qwk: null });
  });
});

describe("editRatio", () => {
  test("is 0 for unchanged or whitespace-only edits", () => {
    expect(editRatio("Good work.", "  Good   work. ")).toBe(0);
  });
  test("is 1 for a full rewrite of equal length", () => {
    expect(editRatio("abc", "xyz")).toBe(1);
  });
  test("edit distance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

test("annotationStats", () => {
  const s = annotationStats(["accepted", "accepted", "edited", "rejected", "added"]);
  expect(s).toMatchObject({ suggested: 4, accepted: 2, edited: 1, rejected: 1, added: 1, keepRate: 0.75, acceptRate: 0.5 });
});
