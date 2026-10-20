import { speechMeasures, type SpeechData, type TimedWord, type UnsureSegment } from "../../shared/speech";
import { toB64 } from "../crypto";
import type { Env } from "../env";

export const TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** Segments below this average log-probability are flagged for the teacher to listen to. */
const UNSURE_LOGPROB = -0.9;

// Priming the recogniser with a disfluent example makes it keep "um" and "er"
// instead of tidying them away; they are real evidence of fluency.
const VERBATIM_PROMPT = "Umm, let me think, like, hmm... Okay, er, here's what I, um, I think.";

export class TranscriptionError extends Error {}

interface WhisperWord {
  word?: string;
  start?: number;
  end?: number;
}
interface WhisperOutput {
  text?: string;
  words?: WhisperWord[];
  segments?: { start?: number; end?: number; text?: string; avg_logprob?: number; no_speech_prob?: number; words?: WhisperWord[] }[];
  transcription_info?: { duration?: number };
}

export interface Transcript {
  text: string;
  speech: SpeechData;
  model: string;
}

/** Turns a Whisper response into transcript text, timed words and unsure stretches. */
export function parseWhisper(out: WhisperOutput, fallbackDurationS: number): Omit<Transcript, "model"> {
  const rawWords = out.segments?.length ? out.segments.flatMap((s) => s.words ?? []) : (out.words ?? []);
  const words: TimedWord[] = rawWords
    .map((w) => ({ w: (w.word ?? "").trim(), s: w.start ?? 0, e: w.end ?? w.start ?? 0 }))
    .filter((w) => w.w.length > 0);
  const unsure: UnsureSegment[] = (out.segments ?? [])
    .filter((s) => (s.avg_logprob ?? 0) < UNSURE_LOGPROB || (s.no_speech_prob ?? 0) > 0.6)
    .map((s) => ({ text: (s.text ?? "").trim(), start: s.start ?? 0, end: s.end ?? 0 }))
    .filter((s) => s.text.length > 0);
  const text = (out.text ?? words.map((w) => w.w).join(" ")).replace(/\s+/g, " ").trim();
  const duration = out.transcription_info?.duration ?? fallbackDurationS;
  return { text, speech: { words, unsure, measures: speechMeasures(words, duration) } };
}

export async function transcribe(env: Env, audio: Uint8Array, durationS: number): Promise<Transcript> {
  if (!env.AI) throw new TranscriptionError("Speech recognition needs the free AI tier, which is not configured on this server.");
  let out: WhisperOutput;
  try {
    out = (await (env.AI.run as (m: string, i: unknown) => Promise<unknown>)(TRANSCRIBE_MODEL, {
      audio: toB64(audio),
      task: "transcribe",
      language: "en",
      vad_filter: false,
      initial_prompt: VERBATIM_PROMPT,
    })) as WhisperOutput;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/limit|quota|neuron/i.test(msg)) throw new TranscriptionError("Today's free AI allowance is used up. Try again tomorrow.");
    throw new TranscriptionError(`Speech recognition failed: ${msg}`);
  }
  const parsed = parseWhisper(out, durationS);
  if (!parsed.text) throw new TranscriptionError("No speech was found in the recording.");
  return { ...parsed, model: TRANSCRIBE_MODEL };
}
