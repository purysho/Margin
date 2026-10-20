/**
 * Speech measures computed from the recogniser's word timings, plus word
 * error rate for measuring the recogniser against the teacher's corrections.
 * Pure functions, shared by server, UI and tests.
 */

export interface TimedWord {
  /** The word as transcribed. */
  w: string;
  /** Start and end, in seconds from the start of the recording. */
  s: number;
  e: number;
}

export interface UnsureSegment {
  text: string;
  start: number;
  end: number;
}

export interface SpeechMeasures {
  /** Length of the recording, seconds. */
  duration_s: number;
  /** From the first word to the last, seconds. */
  speaking_s: number;
  words: number;
  /** Words per minute over the speaking time (pauses included). */
  wpm: number;
  /** Silences of at least PAUSE_S between words. */
  pauses: number;
  /** Silences of at least LONG_PAUSE_S. */
  long_pauses: number;
  longest_pause_s: number;
  /** Average number of words between pauses: a common fluency measure. */
  mean_run_words: number;
  /** um, uh, er, erm, hmm... */
  fillers: number;
}

export interface SpeechData {
  words: TimedWord[];
  unsure: UnsureSegment[];
  measures: SpeechMeasures;
}

export const PAUSE_S = 0.5;
export const LONG_PAUSE_S = 1.5;
const FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "hmm", "mm", "ah", "eh"]);

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function bare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

export function speechMeasures(words: TimedWord[], durationS: number): SpeechMeasures {
  const n = words.length;
  if (n === 0) {
    return { duration_s: round(durationS), speaking_s: 0, words: 0, wpm: 0, pauses: 0, long_pauses: 0, longest_pause_s: 0, mean_run_words: 0, fillers: 0 };
  }
  const speaking = Math.max(0.001, words[n - 1]!.e - words[0]!.s);
  let pauses = 0;
  let long = 0;
  let longest = 0;
  for (let i = 1; i < n; i++) {
    const gap = words[i]!.s - words[i - 1]!.e;
    if (gap >= PAUSE_S) pauses++;
    if (gap >= LONG_PAUSE_S) long++;
    longest = Math.max(longest, gap);
  }
  const fillers = words.filter((w) => FILLERS.has(bare(w.w))).length;
  return {
    duration_s: round(Math.max(durationS, words[n - 1]!.e)),
    speaking_s: round(speaking),
    words: n,
    wpm: Math.round((n / speaking) * 60),
    pauses,
    long_pauses: long,
    longest_pause_s: round(Math.max(0, longest)),
    mean_run_words: round(n / (pauses + 1)),
    fillers,
  };
}

/** Normalises text into comparable words: lower case, no punctuation. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}']/gu, ""))
    .filter(Boolean);
}

/**
 * Word error rate of `hypothesis` (the recogniser) against `reference`
 * (the teacher's corrected transcript): (substitutions + deletions + insertions) / reference words.
 */
export function wordErrorRate(reference: string, hypothesis: string): number | null {
  const r = tokens(reference);
  const h = tokens(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : null;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const curr = [i];
    for (let j = 1; j <= h.length; j++) {
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[h.length]! / r.length;
}

/**
 * Builds plausible word timings for a written transcript. Used only for the
 * sample class (which has no real recordings). "/" in the text marks a long pause,
 * "," a short one. Deterministic, so samples look the same every time.
 */
export function syntheticTimings(script: string, wordsPerMinute: number): { text: string; words: TimedWord[] } {
  const perWord = 60 / wordsPerMinute;
  const words: TimedWord[] = [];
  let t = 0.6;
  const parts = script.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "/") {
      t += 1.9;
      continue;
    }
    const w = part;
    const len = perWord * (0.5 + Math.min(w.length, 10) / 20);
    words.push({ w, s: round(t, 2), e: round(t + len, 2) });
    out.push(w);
    t += len + 0.08;
    // Commas and full stops get natural short breaths, below the 0.5 s pause threshold
    // except at sentence ends, where speakers often pause briefly.
    if (/[,]$/.test(w)) t += 0.2;
    if (/[.?!]$/.test(w)) t += 0.5;
  }
  return { text: out.join(" "), words };
}
