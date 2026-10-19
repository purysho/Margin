import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { app } from "../worker/index";
import type { Env } from "../worker/env";
import schemaSql from "../migrations/0001_init.sql?raw";

/**
 * End-to-end over the real routes and a real (local, in-memory) D1 database.
 * Uses the rule-based demo provider, so it needs no network or API key.
 */
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: "test/wrangler.test.jsonc", persist: false });
  env = { ...proxy.env, AI: undefined, KEY_ENCRYPTION_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) };
  const statements = schemaSql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

const ORIGIN = "http://margin.test";

/** Tiny client that keeps one teacher's session cookie. */
function client() {
  let cookie = "";
  return async function call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(
      `${ORIGIN}${path}`,
      {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: res.status, body: (await res.json()) as T };
  };
}

const ESSAY = `My name is Sofia Rossi and i think people is too busy today. In my opinion I think we need more free time.
However, many people say work is more better than rest. For example, my father works every day and he don't relax.
We can make a photo of the city at night, but we never see our families. I want to discuss about this problem with my class.`;

describe("teacher → student → teacher flow", () => {
  const teacher = client();
  const student = client();
  let assignmentId = "";
  let joinCode = "";
  let receipt = "";
  let submissionId = "";

  test("teacher signs up and switches to demo mode", async () => {
    const r = await teacher("POST", "/api/auth/signup", { email: "t@school.test", password: "long enough pw", display_name: "Ms T" });
    expect(r.status).toBe(201);
    const s = await teacher("GET", "/api/settings");
    expect(s.body.provider).toBe("free");
    expect(s.body.providers.map((p: any) => p.id)).toEqual(["free", "anthropic", "gemini", "demo"]);
    expect((await teacher("PUT", "/api/settings", { provider: "demo", model: null })).status).toBe(200);
  });

  test("teacher creates a rubric from the template and an assignment", async () => {
    const rub = await teacher("POST", "/api/rubrics/from-template", {});
    expect(rub.status).toBe(201);
    const a = await teacher("POST", "/api/assignments", {
      title: "Free time", task: "Is modern life too busy? Give your opinion with examples.", cefr_level: "B1", rubric_id: rub.body.id,
    });
    expect(a.status).toBe(201);
    assignmentId = a.body.id;
    const list = await teacher("GET", "/api/assignments");
    joinCode = list.body[0].join_code;
    expect(joinCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  test("student submits with the join code and gets a private receipt", async () => {
    const info = await student("GET", `/api/public/assignments/${joinCode.toLowerCase()}`);
    expect(info.body).toMatchObject({ title: "Free time", teacher: "Ms T", is_open: 1 });
    const tooShort = await student("POST", `/api/public/assignments/${joinCode}/submissions`, { student_name: "Sofia", body: "Too short." });
    expect(tooShort.status).toBe(400);
    const r = await student("POST", `/api/public/assignments/${joinCode}/submissions`, { student_name: "Sofia Rossi", body: ESSAY });
    expect(r.status).toBe(201);
    receipt = r.body.receipt;
    const waiting = await student("GET", `/api/public/receipts/${receipt}`);
    expect(waiting.body.status).toBe("waiting");
  });

  test("teacher drafts feedback; every annotation is anchored to the essay", async () => {
    const a = await teacher("GET", `/api/assignments/${assignmentId}`);
    submissionId = a.body.submissions[0].id;
    const d = await teacher("POST", `/api/submissions/${submissionId}/draft`, {});
    expect(d.status).toBe(201);
    const draft = d.body.draft.output;
    expect(draft.criteria).toHaveLength(4);
    expect(draft.annotations.length).toBeGreaterThan(4);
    for (const ann of draft.annotations) expect(ESSAY.slice(ann.start, ann.end)).toBe(ann.quote);
  });

  test("teacher edits, rejects and releases; student sees only the final version", async () => {
    const view = await teacher("GET", `/api/submissions/${submissionId}`);
    const draft = view.body.draft;
    const out = draft.output;
    const r = await teacher("POST", `/api/submissions/${submissionId}/release`, {
      draft_id: draft.id,
      scores: out.criteria.map((c: any, i: number) => ({ criterion_id: c.criterion_id, score: i === 0 ? Math.max(0, c.score - 1) : c.score, comment: c.comment })),
      annotations: out.annotations.map((a: any, index: number) => ({
        index,
        keep: index !== 1,
        comment: index === 0 ? "Teacher rewrote this comment." : a.comment,
      })),
      added: [{ start: 0, end: 7, category: "strength", comment: "Nice clear opening." }],
      summary: "Well done, Sofia. Focus on verb agreement next.",
    });
    expect(r.status).toBe(200);

    const fb = await student("GET", `/api/public/receipts/${receipt}`);
    expect(fb.body.status).toBe("released");
    expect(fb.body.summary).toContain("verb agreement");
    expect(fb.body.criteria).toHaveLength(4);
    expect(fb.body.annotations).toHaveLength(out.annotations.length); // one rejected, one added
    expect(fb.body.annotations.some((a: any) => a.comment === "Teacher rewrote this comment.")).toBe(true);
  });

  test("metrics reflect the teacher's decisions", async () => {
    const m = await teacher("GET", `/api/metrics?assignment_id=${assignmentId}`);
    expect(m.body.reviewed_submissions).toBe(1);
    expect(m.body.overall.n).toBe(4);
    expect(m.body.overall.exact).toBe(0.75);
    expect(m.body.annotations).toMatchObject({ edited: 1, rejected: 1, added: 1 });
    expect(m.body.by_version[0].label).toMatch(/^demo · rules-v1 · /);
  });

  test("closing the assignment stops new submissions", async () => {
    await teacher("PATCH", `/api/assignments/${assignmentId}`, { is_open: false });
    const r = await student("POST", `/api/public/assignments/${joinCode}/submissions`, { student_name: "Late", body: ESSAY });
    expect(r.status).toBe(403);
  });

  test("other teachers cannot see this teacher's data", async () => {
    const other = client();
    await other("POST", "/api/auth/signup", { email: "other@school.test", password: "another long pw", display_name: "Mr O" });
    expect((await other("GET", `/api/assignments/${assignmentId}`)).status).toBe(404);
    expect((await other("GET", `/api/submissions/${submissionId}`)).status).toBe(404);
    expect((await other("POST", `/api/submissions/${submissionId}/draft`, {})).status).toBe(404);
    expect((await other("GET", "/api/assignments")).body).toEqual([]);
  });
});

describe("security basics", () => {
  test("API requires a session", async () => {
    expect((await client()("GET", "/api/assignments")).status).toBe(401);
  });

  test("cross-origin and non-JSON writes are blocked", async () => {
    const c = client();
    const cross = await c("POST", "/api/auth/login", { email: "t@school.test", password: "x" }, { origin: "https://evil.test" });
    expect(cross.status).toBe(403);
    const res = await app.request(`${ORIGIN}/api/auth/login`, { method: "POST", body: "email=a", headers: { "content-type": "application/x-www-form-urlencoded" } }, env);
    expect(res.status).toBe(415);
  });

  test("wrong password and duplicate signup", async () => {
    const c = client();
    expect((await c("POST", "/api/auth/login", { email: "t@school.test", password: "nope nope nope" })).status).toBe(401);
    expect((await c("POST", "/api/auth/signup", { email: "T@school.test", password: "long enough pw", display_name: "Dup" })).status).toBe(409);
  });

  test("saved API keys are never returned, only a hint", async () => {
    const c = client();
    await c("POST", "/api/auth/signup", { email: "keys@school.test", password: "long enough pw", display_name: "K" });
    expect((await c("PUT", "/api/keys/anthropic", { key: "sk-ant-api03-abcdefgh1234" })).status).toBe(200);
    const s = await c("GET", "/api/settings");
    expect(JSON.stringify(s.body)).not.toContain("abcdefgh");
    expect(s.body.providers.find((p: any) => p.id === "anthropic").key_hint).toBe("1234");
  });

  test("free tier without the AI binding gives a clear error", async () => {
    const c = client();
    await c("POST", "/api/auth/signup", { email: "free@school.test", password: "long enough pw", display_name: "F" });
    const rub = await c("POST", "/api/rubrics/from-template", {});
    await c("POST", "/api/assignments", { title: "x", task: "Write about your town please.", cefr_level: "A2", rubric_id: rub.body.id });
    const code = (await c("GET", "/api/assignments")).body[0].join_code;
    await client()("POST", `/api/public/assignments/${code}/submissions`, { student_name: "S", body: ESSAY });
    const a = (await c("GET", "/api/assignments")).body[0];
    const sub = (await c("GET", `/api/assignments/${a.id}`)).body.submissions[0];
    const r = await c("POST", `/api/submissions/${sub.id}/draft`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/free AI tier is not configured/);
  });
});
