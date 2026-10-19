/**
 * Agreement metrics between AI-suggested and teacher-final scores.
 * Pure functions so they can be unit-tested and reused in the UI.
 */

export interface ScorePair {
  ai: number;
  teacher: number;
}

export interface AgreementStats {
  n: number;
  /** Share of pairs where the AI score equals the teacher score. */
  exact: number | null;
  /** Share of pairs within one band of each other. */
  adjacent: number | null;
  /** Mean absolute difference, in bands. */
  mae: number | null;
  /** Mean of (ai - teacher). Positive = AI marks too generously. */
  bias: number | null;
  /** Quadratic weighted Cohen's kappa. Null when undefined (n = 0 or no variance). */
  qwk: number | null;
}

export function agreement(pairs: ScorePair[], maxScore: number): AgreementStats {
  const n = pairs.length;
  if (n === 0) return { n, exact: null, adjacent: null, mae: null, bias: null, qwk: null };
  let exact = 0;
  let adjacent = 0;
  let absSum = 0;
  let diffSum = 0;
  for (const { ai, teacher } of pairs) {
    const d = ai - teacher;
    if (d === 0) exact++;
    if (Math.abs(d) <= 1) adjacent++;
    absSum += Math.abs(d);
    diffSum += d;
  }
  return {
    n,
    exact: exact / n,
    adjacent: adjacent / n,
    mae: absSum / n,
    bias: diffSum / n,
    qwk: quadraticWeightedKappa(pairs, 0, maxScore),
  };
}

/**
 * Quadratic weighted kappa (Cohen, 1968) over integer ratings in [min, max].
 * 1 = perfect agreement, 0 = chance level, negative = worse than chance.
 */
export function quadraticWeightedKappa(
  pairs: ScorePair[],
  min: number,
  max: number,
): number | null {
  const k = max - min + 1;
  const n = pairs.length;
  if (n === 0 || k < 2) return null;

  const observed: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const histA = new Array<number>(k).fill(0);
  const histT = new Array<number>(k).fill(0);
  for (const { ai, teacher } of pairs) {
    const i = clamp(ai, min, max) - min;
    const j = clamp(teacher, min, max) - min;
    observed[i]![j]!++;
    histA[i]!++;
    histT[j]!++;
  }

  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = ((i - j) * (i - j)) / ((k - 1) * (k - 1));
      const expected = (histA[i]! * histT[j]!) / n;
      num += w * observed[i]![j]!;
      den += w * expected;
    }
  }
  if (den === 0) return null; // both raters gave a single identical constant
  return 1 - num / den;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(x)));
}

/** Levenshtein distance, two-row version. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * How much the teacher changed a comment: 0 = kept as-is, 1 = fully rewritten.
 * Whitespace-only edits count as unchanged.
 */
export function editRatio(original: string, final: string): number {
  const a = original.trim().replace(/\s+/g, " ");
  const b = final.trim().replace(/\s+/g, " ");
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return editDistance(a, b) / longest;
}

export type AnnotationDecision = "accepted" | "edited" | "rejected" | "added";

export interface AnnotationStats {
  suggested: number;
  accepted: number;
  edited: number;
  rejected: number;
  added: number;
  /** Share of AI suggestions the teacher kept, with or without edits. */
  keepRate: number | null;
  /** Share of AI suggestions kept without any edit. */
  acceptRate: number | null;
}

export function annotationStats(decisions: AnnotationDecision[]): AnnotationStats {
  const count = (d: AnnotationDecision) => decisions.filter((x) => x === d).length;
  const accepted = count("accepted");
  const edited = count("edited");
  const rejected = count("rejected");
  const added = count("added");
  const suggested = accepted + edited + rejected;
  return {
    suggested,
    accepted,
    edited,
    rejected,
    added,
    keepRate: suggested ? (accepted + edited) / suggested : null,
    acceptRate: suggested ? accepted / suggested : null,
  };
}
