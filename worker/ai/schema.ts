import { z } from "zod";
import { ModelOutputSchema } from "../../shared/feedback";

const UNSUPPORTED_KEYS = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!UNSUPPORTED_KEYS.has(k)) out[k] = strip(v);
    }
    return out;
  }
  return node;
}

/**
 * JSON Schema for the model output, without keywords that provider
 * structured-output modes reject (zod adds safe-integer bounds to ints).
 */
export const OUTPUT_JSON_SCHEMA = strip(z.toJSONSchema(ModelOutputSchema)) as Record<string, unknown>;
