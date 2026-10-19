import type { Env } from "../env";
import type { FeedbackRequest } from "./prompt";

export type ProviderId = "free" | "demo" | "anthropic" | "gemini";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  needsKey: boolean;
  /** Shown in settings so teachers know where essays go. */
  privacyNote: string;
}

export interface GenerateResult {
  /** Parsed JSON from the model, not yet validated. */
  raw: unknown;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface GenerateOptions {
  env: Env;
  apiKey: string | null;
  model: string;
  /** Extra instructions appended to the user message (used for repair retries). */
  note?: string;
}

export interface Provider {
  info: ProviderInfo;
  generate(req: FeedbackRequest, opts: GenerateOptions): Promise<GenerateResult>;
}

/** Errors that are the teacher's to fix (bad key, quota), shown to them as-is. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 402 | 429 | 502 = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new ProviderError("The AI returned text that is not valid JSON.");
  }
}
