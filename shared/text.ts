import type { AnchoredAnnotation, ModelOutput } from "./feedback";

export function wordCount(text: string): number {
  const words = text.trim().match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// 7+ digits, optionally separated by spaces, dots, dashes or brackets.
const PHONE = /(?<!\w)\+?\d(?:[\s().-]*\d){6,}(?!\w)/g;
const URL = /\bhttps?:\/\/\S+/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes things that identify a student before an essay leaves our server:
 * their name (each part separately, case-insensitive), emails, phone numbers
 * and URLs. Replacements keep the same length so that quote offsets returned
 * by the model still line up with the original essay.
 */
export function scrubPII(text: string, names: string[]): string {
  const mask = (m: string, label: string) => {
    const tag = `[${label}]`;
    return tag.length <= m.length ? tag.padEnd(m.length, " ") : "#".repeat(m.length);
  };
  let out = text.replace(EMAIL, (m) => mask(m, "email")).replace(URL, (m) => mask(m, "link"));
  out = out.replace(PHONE, (m) => mask(m, "phone"));
  const parts = names
    .flatMap((n) => n.split(/\s+/))
    .map((p) => p.trim())
    .filter((p) => p.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const part of parts) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, (m) => mask(m, "name"));
  }
  return out;
}

/** Normalise quotes, dashes and whitespace so model quotes match the essay. */
function normaliseChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if ("‘’‛′`".includes(ch)) return "'";
  if ("“”„″".includes(ch)) return '"';
  if ("–—‐‑".includes(ch)) return "-";
  // Some characters (e.g. "İ") lowercase to two code units, which would break the offset map.
  const lower = ch.toLowerCase();
  return lower.length === 1 ? lower : ch;
}

/**
 * Builds a normalised copy of `text` (collapsed whitespace, unified quotes,
 * lower case) plus a map from each normalised index back to the original index.
 */
function normaliseWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = normaliseChar(text[i]!);
    if (c === " " && (norm.length === 0 || norm.endsWith(" "))) continue;
    norm += c;
    map.push(i);
  }
  return { norm, map };
}

/**
 * Finds `quote` in `essay`, tolerant of whitespace, curly quotes and case.
 * Returns original-text offsets, preferring the first match at or after `from`.
 */
export function findQuote(
  essay: string,
  quote: string,
  from = 0,
): { start: number; end: number } | null {
  const q = normaliseWithMap(quote.trim()).norm.trim();
  if (q.length < 2) return null;
  const { norm, map } = normaliseWithMap(essay);
  const fromNorm = map.findIndex((orig) => orig >= from);
  let idx = fromNorm >= 0 ? norm.indexOf(q, fromNorm) : -1;
  if (idx < 0) idx = norm.indexOf(q);
  if (idx < 0) return null;
  const start = map[idx]!;
  const end = map[idx + q.length - 1]! + 1;
  return { start, end };
}

/**
 * Keeps only annotations whose quote really appears in the essay, and attaches
 * offsets. The model is never trusted to cite text that is not there.
 * Overlapping annotations are dropped, keeping the earlier one.
 */
export function anchorAnnotations(
  essay: string,
  annotations: ModelOutput["annotations"],
): { kept: AnchoredAnnotation[]; dropped: number } {
  const kept: AnchoredAnnotation[] = [];
  let dropped = 0;
  const cursorByQuote = new Map<string, number>();
  for (const a of annotations) {
    const key = a.quote.trim().toLowerCase();
    const pos = findQuote(essay, a.quote, cursorByQuote.get(key) ?? 0);
    if (!pos) {
      dropped++;
      continue;
    }
    const overlaps = kept.some((k) => pos.start < k.end && k.start < pos.end);
    if (overlaps) {
      dropped++;
      continue;
    }
    cursorByQuote.set(key, pos.end);
    kept.push({
      quote: essay.slice(pos.start, pos.end),
      start: pos.start,
      end: pos.end,
      category: a.category,
      comment: a.comment.trim(),
    });
  }
  kept.sort((x, y) => x.start - y.start);
  return { kept, dropped };
}
