import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { app } from "../worker/index";
import type { Env } from "../worker/env";
import schemaSql from "../migrations/0001_init.sql?raw";
import speakingSql from "../migrations/0002_speaking.sql?raw";

/**
 * End-to-end over the real routes and a real (local, in-memory) D1 database.
 * Uses the rule-based demo provider, so it needs no network or API key.
 */
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: "test/wrangler.test.jsonc", persist: false });
  env = { ...proxy.env, AI: undefined, KEY_ENCRYPTION_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) };
  const statements = (schemaSql + "\n" + speakingSql)
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

const cookies = new WeakMap<object, () => string>();
async function cookieOf(c: object): Promise<string> {
  return cookies.get(c)!();
}

/** Tiny client that keeps one teacher's session cookie. */
function client() {
  let cookie = "";
  const call = async function call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
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
  cookies.set(call, () => cookie);
  return call;
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

describe("onboarding", () => {
  test("sample class, default rubric, student preview and delete", async () => {
    const c = client();
    await c("POST", "/api/auth/signup", { email: "new@school.test", password: "long enough pw", display_name: "New" });
    await c("PUT", "/api/settings", { provider: "demo", model: null });

    // Assignment without choosing a rubric uses the built-in one.
    const own = await c("POST", "/api/assignments", { title: "Mine", task: "Describe your favourite place.", cefr_level: "A2" });
    expect(own.status).toBe(201);
    expect((await c("GET", `/api/assignments/${own.body.id}`)).body.rubric).toHaveLength(4);

    const sample = await c("POST", "/api/onboarding/sample", {});
    expect(sample.status).toBe(201);
    const a = (await c("GET", `/api/assignments/${sample.body.id}`)).body;
    expect(a.submissions).toHaveLength(3);
    expect((await c("GET", "/api/rubrics")).body).toHaveLength(1); // reused, not duplicated

    const subId = a.submissions[0].id;
    expect((await c("GET", `/api/submissions/${subId}/student-view`)).body.status).toBe("waiting");
    const draft = (await c("POST", `/api/submissions/${subId}/draft`, {})).body.draft;
    await c("POST", `/api/submissions/${subId}/release`, {
      draft_id: draft.id,
      scores: draft.output.criteria.map((x: any) => ({ criterion_id: x.criterion_id, score: x.score, comment: x.comment })),
      annotations: draft.output.annotations.map((_: any, index: number) => ({ index, keep: true, comment: "" })),
      added: [],
      summary: "Good effort.",
    });
    const preview = await c("GET", `/api/submissions/${subId}/student-view`);
    expect(preview.body).toMatchObject({ status: "released", summary: "Good effort." });

    const list = (await c("GET", "/api/assignments")).body;
    expect(list.find((x: any) => x.id === sample.body.id)).toMatchObject({ submissions: 3, drafted: 1, released: 1 });

    expect((await c("DELETE", `/api/assignments/${sample.body.id}`)).status).toBe(200);
    expect((await c("GET", `/api/assignments/${sample.body.id}`)).status).toBe(404);
    expect((await c("GET", `/api/submissions/${subId}`)).status).toBe(404);
  });

  test("teachers cannot delete or preview each other's work", async () => {
    const a = client();
    const b = client();
    await a("POST", "/api/auth/signup", { email: "a1@school.test", password: "long enough pw", display_name: "A" });
    await b("POST", "/api/auth/signup", { email: "b1@school.test", password: "long enough pw", display_name: "B" });
    const sample = (await a("POST", "/api/onboarding/sample", {})).body;
    const sub = (await a("GET", `/api/assignments/${sample.id}`)).body.submissions[0].id;
    expect((await b("DELETE", `/api/assignments/${sample.id}`)).status).toBe(404);
    expect((await b("GET", `/api/submissions/${sub}/student-view`)).status).toBe(404);
  });
});

describe("speaking", () => {
  const WHISPER = {
    text: "I think i love the beach near my city because, um, it is very relax.",
    transcription_info: { duration: 9.5 },
    segments: [
      {
        start: 0, end: 9, text: "I think i love the beach near my city because, um, it is very relax.", avg_logprob: -0.3,
        words: "I think i love the beach near my city because, um, it is very relax."
          .split(" ")
          .map((word, i) => ({ word, start: 0.5 + i * 0.5 + (i > 9 ? 1.2 : 0), end: 0.9 + i * 0.5 + (i > 9 ? 1.2 : 0) })),
      },
    ],
  };
  const calls: { model: string; input: any }[] = [];
  const fakeAI = { run: async (model: string, input: any) => (calls.push({ model, input }), WHISPER) };

  async function upload(code: string, name: string, bytes: Uint8Array, origin = ORIGIN) {
    const form = new FormData();
    form.set("student_name", name);
    form.set("duration_ms", "9500");
    form.set("audio", new File([bytes], "answer.webm", { type: "audio/webm;codecs=opus" }));
    const res = await app.request(`${ORIGIN}/api/public/assignments/${code}/submissions`, { method: "POST", body: form, headers: { origin } }, env);
    return { status: res.status, body: (await res.json()) as any };
  }

  test("record, transcribe, correct, draft, release, and the recording is deleted", async () => {
    const saved = env.AI;
    env.AI = fakeAI as any;
    try {
      const t = client();
      await t("POST", "/api/auth/signup", { email: "speak@school.test", password: "long enough pw", display_name: "Ms S" });
      await t("PUT", "/api/settings", { provider: "demo", model: null });
      const created = await t("POST", "/api/assignments", { title: "A place you love", task: "Talk for one minute about a place you love.", cefr_level: "B1", skill: "speaking" });
      expect(created.status).toBe(201);
      const a = (await t("GET", `/api/assignments/${created.body.id}`)).body;
      expect(a.skill).toBe("speaking");
      expect(a.rubric.map((r: any) => r.name)).toEqual(["Fluency and coherence", "Vocabulary", "Grammar", "Task response"]);

      const pub = (await client()("GET", `/api/public/assignments/${a.join_code}`)).body;
      expect(pub).toMatchObject({ skill: "speaking", max_audio_seconds: 180 });

      // A JSON essay is not accepted for a speaking task; cross-site uploads are blocked.
      expect((await client()("POST", `/api/public/assignments/${a.join_code}/submissions`, { student_name: "x", body: "words ".repeat(30) })).status).toBe(415);
      const audio = new Uint8Array(4000).fill(7);
      expect((await upload(a.join_code, "Ana", audio, "https://evil.test")).status).toBe(403);
      expect((await upload(a.join_code, "Ana", new Uint8Array(1_600_000))).status).toBe(413);

      const up = await upload(a.join_code, "Ana", audio);
      expect(up.status).toBe(201);
      expect(calls.at(-1)!.model).toBe("@cf/openai/whisper-large-v3-turbo");
      expect(calls.at(-1)!.input.language).toBe("en");

      const subId = (await t("GET", `/api/assignments/${a.id}`)).body.submissions[0].id;
      const view = (await t("GET", `/api/submissions/${subId}`)).body;
      expect(view.submission).toMatchObject({ kind: "audio", has_audio: true, body: WHISPER.text, transcript_raw: WHISPER.text });
      expect(view.submission.speech.measures).toMatchObject({ words: 15, pauses: 1, fillers: 1 });

      // The teacher can play it back; nobody else can.
      const audioRes = await app.request(`${ORIGIN}/api/submissions/${subId}/audio`, { headers: { cookie: await cookieOf(t) } }, env);
      expect(audioRes.status).toBe(200);
      expect(audioRes.headers.get("content-type")).toBe("audio/webm");
      expect(new Uint8Array(await audioRes.arrayBuffer())).toEqual(audio);
      expect((await app.request(`${ORIGIN}/api/submissions/${subId}/audio`, {}, env)).status).toBe(401);

      const d1 = (await t("POST", `/api/submissions/${subId}/draft`, {})).body.draft;
      expect(d1.prompt_version).toMatch(/^speaking-/);

      // Correct the transcript: the old draft is now stale and can't be released.
      const fixed = "I think I love the beach near my city because, um, it is very relaxing.";
      expect((await t("PATCH", `/api/submissions/${subId}/transcript`, { text: fixed })).body.changed).toBe(true);
      const releaseWith = (draft: any) =>
        t("POST", `/api/submissions/${subId}/release`, {
          draft_id: draft.id,
          scores: draft.output.criteria.map((x: any) => ({ criterion_id: x.criterion_id, score: x.score, comment: x.comment })),
          annotations: draft.output.annotations.map((_: any, index: number) => ({ index, keep: true, comment: "" })),
          added: [],
          summary: "Nice answer.",
        });
      expect((await releaseWith(d1)).status).toBe(409);
      const d2 = (await t("POST", `/api/submissions/${subId}/draft`, {})).body.draft;
      expect((await releaseWith(d2)).status).toBe(200);

      // Released: recording deleted, transcript kept, student sees it.
      expect((await t("GET", `/api/submissions/${subId}`)).body.submission.has_audio).toBe(false);
      expect((await app.request(`${ORIGIN}/api/submissions/${subId}/audio`, { headers: { cookie: await cookieOf(t) } }, env)).status).toBe(404);
      const fb = (await client()("GET", `/api/public/receipts/${up.body.receipt}`)).body;
      expect(fb).toMatchObject({ status: "released", kind: "audio", body: fixed });
      expect((await t("PATCH", `/api/submissions/${subId}/transcript`, { text: "changed" })).status).toBe(409);

      // Transcription accuracy: only "relax" vs "relaxing" counts ("i" vs "I" is just case): 1 of 15 words.
      const m = (await t("GET", `/api/metrics?assignment_id=${a.id}`)).body;
      expect(m.transcription).toMatchObject({ checked: 1, corrected: 1 });
      expect(m.transcription.mean_wer).toBeCloseTo(1 / 15);
    } finally {
      env.AI = saved;
    }
  });

  test("a failed transcription keeps the recording and can be retried", async () => {
    const saved = env.AI;
    const t = client();
    await t("POST", "/api/auth/signup", { email: "retry@school.test", password: "long enough pw", display_name: "R" });
    await t("PUT", "/api/settings", { provider: "demo", model: null });
    const id = (await t("POST", "/api/assignments", { title: "Speak", task: "Talk about your weekend please.", cefr_level: "A2", skill: "speaking" })).body.id;
    const code = (await t("GET", `/api/assignments/${id}`)).body.join_code;
    env.AI = undefined; // recogniser unavailable
    try {
      expect((await upload(code, "Bo", new Uint8Array(3000).fill(1))).status).toBe(201);
      const sub = (await t("GET", `/api/assignments/${id}`)).body.submissions[0];
      expect(sub.transcription_error).toMatch(/free AI tier/);
      env.AI = fakeAI as any;
      const d = await t("POST", `/api/submissions/${sub.id}/draft`, {}); // retries transcription first
      expect(d.status).toBe(201);
      expect((await t("GET", `/api/submissions/${sub.id}`)).body.submission.body).toBe(WHISPER.text);
    } finally {
      env.AI = saved;
    }
  });

  test("sample speaking class and skill-specific rubrics", async () => {
    const t = client();
    await t("POST", "/api/auth/signup", { email: "sample-speak@school.test", password: "long enough pw", display_name: "S" });
    const id = (await t("POST", "/api/onboarding/sample", { skill: "speaking" })).body.id;
    const a = (await t("GET", `/api/assignments/${id}`)).body;
    expect(a.skill).toBe("speaking");
    expect(a.submissions).toHaveLength(3);
    expect(a.submissions.every((x: any) => x.kind === "audio" && x.duration_ms > 10_000)).toBe(true);
    await t("POST", "/api/onboarding/sample", {}); // writing
    const rubrics = (await t("GET", "/api/rubrics")).body;
    expect(rubrics.map((r: any) => r.skill).sort()).toEqual(["speaking", "writing"]);
    const writingRubric = rubrics.find((r: any) => r.skill === "writing").id;
    const bad = await t("POST", "/api/assignments", { title: "x", task: "Talk about anything you like.", cefr_level: "B1", skill: "speaking", rubric_id: writingRubric });
    expect(bad.status).toBe(400);
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

  test("saving a key without the encryption secret gives a clear error", async () => {
    const c = client();
    await c("POST", "/api/auth/signup", { email: "nosecret@school.test", password: "long enough pw", display_name: "N" });
    const saved = env.KEY_ENCRYPTION_SECRET;
    env.KEY_ENCRYPTION_SECRET = undefined;
    try {
      const r = await c("PUT", "/api/keys/gemini", { key: "AIza-test-key-123456" });
      expect(r.status).toBe(503);
      expect(r.body.error).toMatch(/KEY_ENCRYPTION_SECRET/);
    } finally {
      env.KEY_ENCRYPTION_SECRET = saved;
    }
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
