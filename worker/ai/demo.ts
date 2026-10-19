import type { ModelOutput } from "../../shared/feedback";
import { wordCount } from "../../shared/text";
import type { Provider } from "./provider";

interface Rule {
  re: RegExp;
  category: ModelOutput["annotations"][number]["category"];
  comment: string;
}

// A handful of very common EFL patterns. Not a grammar checker: this provider
// exists so the whole app can be tried, demoed and tested with no API key.
const RULES: Rule[] = [
  // Quote "i" with the next word: one-letter quotes are too ambiguous to anchor.
  { re: /\bi\s+[a-z']+/g, category: "grammar", comment: 'Write "I" with a capital letter when it means you.' },
  { re: /\b(informations|advices|furnitures|homeworks|equipments|researches|knowledges)\b/gi, category: "vocabulary", comment: "This noun is uncountable in English, so it has no plural -s." },
  { re: /\bpeople is\b/gi, category: "grammar", comment: '"People" is plural, so use "are".' },
  { re: /\b(he|she|it) don't\b/gi, category: "grammar", comment: 'With he/she/it, use "doesn\'t".' },
  { re: /\bmore (better|easier|bigger|faster|cheaper|worse)\b/gi, category: "grammar", comment: 'This adjective is already comparative, so drop "more".' },
  { re: /\bmake (a|some) (photo|photos|picture|pictures)\b/gi, category: "vocabulary", comment: 'We usually say "take a photo".' },
  { re: /\bin my opinion,? i think\b/gi, category: "coherence", comment: 'Choose one: "In my opinion" or "I think". Both together repeat the same idea.' },
  { re: /\bvery very\b/gi, category: "vocabulary", comment: 'Try one stronger word instead of "very very" (for example "extremely" or "huge").' },
  { re: /\bdiscuss about\b/gi, category: "grammar", comment: '"Discuss" takes no preposition: "discuss the problem".' },
];

const STRENGTHS = /\b(However|Moreover|Furthermore|For example|For instance|On the other hand|In conclusion|As a result),/g;

export function demoFeedback(essay: string, criteria: { id: string; name: string; max_score: number }[]): ModelOutput {
  const annotations: ModelOutput["annotations"] = [];
  let issues = 0;
  for (const rule of RULES) {
    for (const m of essay.matchAll(rule.re)) {
      issues++;
      if (annotations.length < 10) annotations.push({ quote: m[0], category: rule.category, comment: rule.comment });
    }
  }
  const linkers = [...essay.matchAll(STRENGTHS)];
  for (const m of linkers.slice(0, 2)) {
    annotations.push({ quote: m[0], category: "strength", comment: "Good linking word: it shows the reader how your ideas connect." });
  }

  const words = wordCount(essay);
  const lengthFactor = Math.min(1, words / 180);
  const errorRate = words ? issues / (words / 100) : 0; // issues per 100 words
  const accuracy = Math.max(0.2, 1 - errorRate / 15);
  const organisation = Math.min(1, 0.4 + linkers.length * 0.15);

  return {
    criteria: criteria.map((c, i) => {
      const factor = [lengthFactor * 0.9, organisation, accuracy * 0.9 + 0.1, accuracy][i % 4]!;
      const score = Math.max(0, Math.min(c.max_score, Math.round(c.max_score * factor)));
      return {
        criterion_id: c.id,
        score,
        comment: `Demo estimate for ${c.name.toLowerCase()} from simple text features (${words} words, ${issues} flagged patterns). Connect an AI provider in Settings for real feedback.`,
      };
    }),
    annotations,
    summary: `This is demo feedback made without AI. Your essay has ${words} words. ${issues ? `It flags ${issues} common pattern${issues === 1 ? "" : "s"} to check.` : "No common error patterns were found."}`,
    next_steps: [
      issues ? "Re-read your essay and fix the highlighted patterns." : "Try using a wider range of sentence structures.",
      linkers.length < 2 ? 'Add linking words such as "However," or "For example," to connect ideas.' : "Keep using linking words to guide the reader.",
    ],
  };
}

export const demoProvider: Provider = {
  info: {
    id: "demo",
    label: "Demo mode (no AI, no key needed)",
    defaultModel: "rules-v1",
    needsKey: false,
    privacyNote: "Nothing leaves Margin. Feedback comes from simple pattern rules, not AI.",
  },
  async generate(req) {
    return {
      raw: demoFeedback(req.essay, req.rubric),
      model: "rules-v1",
      inputTokens: null,
      outputTokens: null,
    };
  },
};
