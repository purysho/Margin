import Anthropic from "@anthropic-ai/sdk";
import { buildUserMessage, systemPrompt } from "./prompt";
import { OUTPUT_JSON_SCHEMA } from "./schema";
import { parseJsonText, ProviderError, type Provider } from "./provider";

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-fable-5-1",
]);

export const anthropicProvider: Provider = {
  info: {
    id: "anthropic",
    label: "Claude (your Anthropic API key)",
    defaultModel: "claude-opus-5-5",
    needsKey: true,
    privacyNote:
      "Essays are sent to Anthropic with names, emails and phone numbers removed. API data is not used for training by default.",
  },

  async generate(req, { apiKey, model, note }) {
    if (!apiKey) throw new ProviderError("Add your Anthropic API key in Settings first.", 400);
    const client = new Anthropic({ apiKey, maxRetries: 2 });
    const text = buildUserMessage(req) + (note ? `\n\n${note}` : "");
    const useFallbacks = FALLBACK_MODELS.has(model);

    let res;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: systemPrompt(req), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: text }],
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA },
        },
        ...(useFallbacks
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError)
        throw new ProviderError("Anthropic rejected the API key. Check it in Settings.", 401);
      if (err instanceof Anthropic.PermissionDeniedError)
        throw new ProviderError("This API key cannot use the selected model.", 401);
      if (err instanceof Anthropic.RateLimitError)
        throw new ProviderError("Anthropic rate limit reached. Try again in a minute.", 429);
      if (err instanceof Anthropic.BadRequestError)
        throw new ProviderError(`Anthropic rejected the request: ${err.message}`, 400);
      if (err instanceof Anthropic.APIError)
        throw new ProviderError(`Anthropic error (${err.status ?? "network"}). Try again.`);
      throw err;
    }

    if (res.stop_reason === "refusal")
      throw new ProviderError("The model declined to give feedback on this essay.");
    if (res.stop_reason === "max_tokens")
      throw new ProviderError("The AI response was cut off. Try again.");

    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") throw new ProviderError("The AI returned no feedback.");

    return {
      raw: parseJsonText(out.text),
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  },
};
