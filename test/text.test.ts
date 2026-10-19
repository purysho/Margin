import { describe, expect, test } from "vitest";
import { anchorAnnotations, findQuote, scrubPII, wordCount } from "../shared/text";

describe("scrubPII", () => {
  const essay = "My name is Ana María López. Write to ana.lopez@mail.com or call +34 612 345 678. Ana likes Analytics.";

  test("removes names, emails and phones", () => {
    const out = scrubPII(essay, ["Ana María López"]);
    expect(out).not.toMatch(/Ana\b|María|López|ana\.lopez|612/);
    expect(out).toContain("Analytics"); // only whole words are removed
  });

  test("keeps the same length so offsets still line up", () => {
    expect(scrubPII(essay, ["Ana María López"])).toHaveLength(essay.length);
  });

  test("ignores one-letter name parts", () => {
    expect(scrubPII("I am J and I like it.", ["J"])).toBe("I am J and I like it.");
  });
});

describe("findQuote", () => {
  const essay = "Yesterday i  went to the “big” market.\nPeople is friendly.";

  test("tolerates case, whitespace and curly quotes", () => {
    const pos = findQuote(essay, 'I went to the "big" market');
    expect(pos).not.toBeNull();
    expect(essay.slice(pos!.start, pos!.end)).toBe("i  went to the “big” market");
  });

  test("returns null when the text is not there", () => {
    expect(findQuote(essay, "people are friendly")).toBeNull();
  });
});

describe("anchorAnnotations", () => {
  const essay = "People is friendly. People is happy.";

  test("anchors repeated quotes to successive occurrences", () => {
    const { kept } = anchorAnnotations(essay, [
      { quote: "People is", category: "grammar", comment: "a" },
      { quote: "People is", category: "grammar", comment: "b" },
    ]);
    expect(kept.map((k) => k.start)).toEqual([0, 20]);
  });

  test("drops invented quotes and overlaps", () => {
    const { kept, dropped } = anchorAnnotations(essay, [
      { quote: "People is friendly", category: "grammar", comment: "ok" },
      { quote: "is friendly", category: "grammar", comment: "overlap" },
      { quote: "People are kind", category: "grammar", comment: "invented" },
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(2);
  });
});

test("wordCount", () => {
  expect(wordCount("  It's a well-known fact, isn't it? ")).toBe(6);
  expect(wordCount("")).toBe(0);
});
