import { describe, expect, test } from "vitest";
import { speechMeasures, syntheticTimings, tokens, wordErrorRate, type TimedWord } from "../shared/speech";
import { sampleSpeakingSubmissions } from "../shared/sample-speaking";
import { parseWhisper } from "../worker/ai/transcribe";

const w = (word: string, s: number, e: number): TimedWord => ({ w: word, s, e });

describe("speechMeasures", () => {
  test("rate, pauses, runs and fillers", () => {
    const words = [w("Well,", 1, 1.3), w("um,", 1.4, 1.6), w("I", 2.3, 2.4), w("like", 2.45, 2.7), w("it.", 4.5, 4.8)];
    const m = speechMeasures(words, 6);
    expect(m.words).toBe(5);
    expect(m.speaking_s).toBe(3.8);
    expect(m.wpm).toBe(79); // 5 words in 3.8 s
    expect(m.pauses).toBe(2); // 0.7 s and 1.8 s gaps
    expect(m.long_pauses).toBe(1);
    expect(m.longest_pause_s).toBe(1.8);
    expect(m.mean_run_words).toBe(1.7);
    expect(m.fillers).toBe(1);
    expect(m.duration_s).toBe(6);
  });

  test("empty speech", () => {
    expect(speechMeasures([], 3)).toMatchObject({ words: 0, wpm: 0, pauses: 0 });
  });
});

describe("wordErrorRate", () => {
  test("ignores case and punctuation", () => {
    expect(wordErrorRate("I went to the beach.", "i went to the Beach")).toBe(0);
  });
  test("counts substitutions, insertions and deletions against the reference", () => {
    // reference 5 words; hypothesis: 1 substitution (want→won't), 1 deletion (to)
    expect(wordErrorRate("I want to go home", "I won't go home")).toBeCloseTo(2 / 5);
    expect(wordErrorRate("hello", "hello there friend")).toBe(2);
  });
  test("tokens keep apostrophes", () => {
    expect(tokens("It’s fine, isn't it?")).toEqual(["it's", "fine", "isn't", "it"]);
  });
});

describe("parseWhisper", () => {
  test("flattens segment words and flags unsure segments", () => {
    const out = parseWhisper(
      {
        text: " I like the sea. Mumble words. ",
        transcription_info: { duration: 5.2 },
        segments: [
          { start: 0, end: 2, text: " I like the sea.", avg_logprob: -0.2, words: [{ word: " I", start: 0.1, end: 0.2 }, { word: " like", start: 0.3, end: 0.6 }, { word: " the", start: 0.7, end: 0.8 }, { word: " sea.", start: 0.9, end: 1.3 }] },
          { start: 2.5, end: 4, text: " Mumble words.", avg_logprob: -1.4, words: [{ word: " Mumble", start: 2.6, end: 3 }, { word: " words.", start: 3.1, end: 3.6 }] },
        ],
      },
      0,
    );
    expect(out.text).toBe("I like the sea. Mumble words.");
    expect(out.speech.words).toHaveLength(6);
    expect(out.speech.unsure).toEqual([{ text: "Mumble words.", start: 2.5, end: 4 }]);
    expect(out.speech.measures.duration_s).toBe(5.2);
    expect(out.speech.measures.pauses).toBe(1);
  });

  test("accepts the older top-level words shape", () => {
    const out = parseWhisper({ text: "Hi there", words: [{ word: "Hi", start: 0, end: 0.3 }, { word: "there", start: 0.4, end: 0.8 }] }, 1);
    expect(out.speech.words.map((x) => x.w)).toEqual(["Hi", "there"]);
  });
});

test("synthetic sample timings are plausible and ordered by level", () => {
  const { text, words } = syntheticTimings("Um, I like / the sea.", 100);
  expect(text).toBe("Um, I like the sea.");
  expect(words.every((x, i) => i === 0 || x.s >= words[i - 1]!.e)).toBe(true);
  const samples = sampleSpeakingSubmissions();
  const wpm = samples.map((s) => s.speech.measures.wpm);
  expect(wpm[0]!).toBeLessThan(wpm[1]!);
  expect(wpm[1]!).toBeLessThan(wpm[2]!);
  expect(samples[0]!.speech.measures.long_pauses).toBeGreaterThan(samples[2]!.speech.measures.long_pauses);
});
