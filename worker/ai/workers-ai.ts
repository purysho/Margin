import { buildUserMessage, systemPrompt } from "./prompt";
import { OUTPUT_JSON_SCHEMA } from "./schema";
import { parseJsonText, ProviderError, type Provider } from "./provider";

/**
 * Free tier: open models on Cloudflare Workers AI, billed against the account's
 * free daily allocation. No key for the teacher, nothing for the host to pay
 * while usage stays under the daily cap (see FREE_DAILY_LIMIT).
 */
export const workersAiProvider: Provider = {
  info: {
    id: "free",
    label: "Free (open model on Cloudflare Workers AI, no key needed)",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    needsKey: false,
    privacyNote:
      "Essays are processed by Cloudflare Workers AI with names, emails and phone numbers removed. Cloudflare does not use Workers AI inputs to train models. Daily limit applies.",
  },

  async generate(req, { env, model, note }) {
    if (!env.AI) throw new ProviderError("The free AI tier is not configured on this server.", 400);
    const text = buildUserMessage(req) + (note ? `\n\n${note}` : "");

    let res: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      // Model ids come from settings, so the typed overloads cannot narrow them.
      res = (await (env.AI.run as (m: string, i: unknown) => Promise<unknown>)(model, {
        messages: [
          { role: "system", content: systemPrompt(req) },
          { role: "user", content: text },
        ],
        max_tokens: 4096,
        response_format: { type: "json_schema", json_schema: OUTPUT_JSON_SCHEMA },
      })) as typeof res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/limit|quota|neuron/i.test(msg))
        throw new ProviderError("Today's free AI allowance is used up. Try again tomorrow, or add your own key in Settings.", 429);
      throw new ProviderError(`Workers AI error: ${msg}`);
    }

    const out = res.response;
    if (out == null || out === "") throw new ProviderError("The AI returned no feedback.");
    return {
      raw: typeof out === "string" ? parseJsonText(out) : out,
      model,
      inputTokens: res.usage?.prompt_tokens ?? null,
      outputTokens: res.usage?.completion_tokens ?? null,
    };
  },
};
