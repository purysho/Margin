import { promptVersion, type FeedbackDraft } from "../../shared/feedback";
import { scrubPII } from "../../shared/text";
import { DraftValidationError, validateDraft } from "../../shared/validate";
import { anthropicProvider } from "./anthropic";
import { demoProvider } from "./demo";
import { geminiProvider } from "./gemini";
import { workersAiProvider } from "./workers-ai";
import type { Env } from "../env";
import { buildRepairMessage, type FeedbackRequest } from "./prompt";
import { ProviderError, type Provider, type ProviderId } from "./provider";

// Order is the order shown in Settings.
export const PROVIDERS: Record<ProviderId, Provider> = {
  free: workersAiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  demo: demoProvider,
};

export function isProviderId(x: string): x is ProviderId {
  return Object.hasOwn(PROVIDERS, x);
}

export interface DraftResult {
  draft: FeedbackDraft;
  provider: ProviderId;
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  attempts: number;
}

/**
 * Scrubs the essay, asks the provider for feedback, validates it against the
 * rubric and the essay, and retries once with the validation problems if needed.
 * Quotes are anchored against the original essay; scrubbing keeps offsets aligned.
 */
export async function generateDraft(
  providerId: ProviderId,
  opts: { env: Env; apiKey: string | null; model: string | null; studentName: string },
  req: Omit<FeedbackRequest, "essay"> & { essay: string },
): Promise<DraftResult> {
  const provider = PROVIDERS[providerId];
  const model = opts.model || provider.info.defaultModel;
  const scrubbed = scrubPII(req.essay, [opts.studentName]);
  const started = Date.now();

  let note: string | undefined;
  let lastError: DraftValidationError | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await provider.generate({ ...req, essay: scrubbed }, { env: opts.env, apiKey: opts.apiKey, model, note });
    if (res.inputTokens != null) {
      sawUsage = true;
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens ?? 0;
    }
    try {
      const draft = validateDraft(res.raw, req.rubric, req.essay);
      return {
        draft,
        provider: providerId,
        model: res.model,
        promptVersion: promptVersion(req.skill ?? "writing"),
        latencyMs: Date.now() - started,
        inputTokens: sawUsage ? inputTokens : null,
        outputTokens: sawUsage ? outputTokens : null,
        attempts: attempt,
      };
    } catch (err) {
      if (!(err instanceof DraftValidationError)) throw err;
      lastError = err;
      note = buildRepairMessage(err.problems);
    }
  }
  throw new ProviderError(`The AI draft did not match the rubric: ${lastError?.problems.join("; ")}`);
}
