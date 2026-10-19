import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { OUTPUT_JSON_SCHEMA } from "./schema";
import { parseJsonText, ProviderError, type Provider } from "./provider";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string };
}

export const geminiProvider: Provider = {
  info: {
    id: "gemini",
    label: "Gemini (your Google AI Studio key, free tier available)",
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
    privacyNote:
      "On Google's free tier, prompts may be used to improve Google products. Margin removes names, emails and phone numbers first, but use a paid key for real student work if your school requires it.",
  },

  async generate(req, { apiKey, model, note }) {
    if (!apiKey) throw new ProviderError("Add your Gemini API key in Settings first.", 400);
    const text = buildUserMessage(req) + (note ? `\n\n${note}` : "");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: OUTPUT_JSON_SCHEMA,
        },
      }),
    });

    const body = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (res.status === 400 && /api key/i.test(body.error?.message ?? ""))
      throw new ProviderError("Google rejected the API key. Check it in Settings.", 401);
    if (res.status === 401 || res.status === 403)
      throw new ProviderError("Google rejected the API key. Check it in Settings.", 401);
    if (res.status === 429)
      throw new ProviderError("Gemini free-tier limit reached. Try again later.", 429);
    if (!res.ok)
      throw new ProviderError(`Gemini error ${res.status}: ${body.error?.message ?? "unknown"}`);

    const candidate = body.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS")
      throw new ProviderError("The AI response was cut off. Try again.");
    if (candidate?.finishReason === "SAFETY")
      throw new ProviderError("The model declined to give feedback on this essay.");
    const out = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!out) throw new ProviderError("The AI returned no feedback.");

    return {
      raw: parseJsonText(out),
      model: body.modelVersion ?? model,
      inputTokens: body.usageMetadata?.promptTokenCount ?? null,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? null,
    };
  },
};
