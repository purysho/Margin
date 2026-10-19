import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { PROVIDERS, isProviderId } from "../ai/draft";
import { endSession, requireTeacher, startSession } from "../auth";
import { encryptSecret, hashPassword, newId, verifyPassword } from "../crypto";
import type { AppEnv } from "../env";
import { readJson } from "../util";

const Credentials = z.object({
  email: z.email().max(200),
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
});

export const account = new Hono<AppEnv>();

account.post("/auth/signup", async (c) => {
  const body = await readJson(c, Credentials.extend({ display_name: z.string().trim().min(1).max(80) }));
  const exists = await c.env.DB.prepare("SELECT 1 FROM teachers WHERE email = ?").bind(body.email).first();
  if (exists) throw new HTTPException(409, { message: "An account with this email already exists." });
  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO teachers (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, body.email, body.display_name, await hashPassword(body.password), Date.now())
    .run();
  await startSession(c, id);
  return c.json({ id }, 201);
});

account.post("/auth/login", async (c) => {
  const body = await readJson(c, Credentials.extend({ password: z.string().min(1).max(200) }));
  const row = await c.env.DB.prepare("SELECT id, password_hash FROM teachers WHERE email = ?")
    .bind(body.email)
    .first<{ id: string; password_hash: string }>();
  // Same message either way, so emails cannot be enumerated.
  if (!row || !(await verifyPassword(body.password, row.password_hash)))
    throw new HTTPException(401, { message: "Wrong email or password." });
  await startSession(c, row.id);
  return c.json({ id: row.id });
});

account.post("/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

account.use("/me", requireTeacher);
account.get("/me", (c) => {
  const t = c.get("teacher");
  return c.json({ id: t.id, email: t.email, display_name: t.display_name });
});

account.use("/settings", requireTeacher);
account.use("/keys/*", requireTeacher);

account.get("/settings", async (c) => {
  const t = c.get("teacher");
  const { results } = await c.env.DB.prepare("SELECT provider, hint FROM provider_keys WHERE teacher_id = ?")
    .bind(t.id)
    .all<{ provider: string; hint: string }>();
  const hints = new Map(results.map((r) => [r.provider, r.hint]));
  return c.json({
    provider: t.ai_provider,
    model: t.ai_model,
    providers: Object.values(PROVIDERS).map((p) => ({
      ...p.info,
      key_hint: hints.get(p.info.id) ?? null,
    })),
  });
});

account.put("/settings", async (c) => {
  const body = await readJson(
    c,
    z.object({
      provider: z.string().refine(isProviderId, "Unknown provider."),
      model: z.string().trim().max(100).regex(/^[\w.:-]*$/, "Invalid model name.").nullable(),
    }),
  );
  await c.env.DB.prepare("UPDATE teachers SET ai_provider = ?, ai_model = ? WHERE id = ?")
    .bind(body.provider, body.model || null, c.get("teacher").id)
    .run();
  return c.json({ ok: true });
});

account.put("/keys/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProviderId(provider) || !PROVIDERS[provider].info.needsKey)
    throw new HTTPException(400, { message: "This provider does not take a key." });
  const { key } = await readJson(c, z.object({ key: z.string().trim().min(10).max(500) }));
  if (!c.env.KEY_ENCRYPTION_SECRET)
    throw new HTTPException(503, {
      message: "This server can't store API keys yet: the KEY_ENCRYPTION_SECRET secret is not set. The free AI tier still works.",
    });
  const t = c.get("teacher");
  const { ciphertext, iv } = await encryptSecret(c.env.KEY_ENCRYPTION_SECRET, key, `${t.id}:${provider}`);
  await c.env.DB.prepare(
    `INSERT INTO provider_keys (teacher_id, provider, ciphertext, iv, hint, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (teacher_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv,
       hint = excluded.hint, created_at = excluded.created_at`,
  )
    .bind(t.id, provider, ciphertext, iv, key.slice(-4), Date.now())
    .run();
  return c.json({ ok: true, key_hint: key.slice(-4) });
});

account.delete("/keys/:provider", async (c) => {
  await c.env.DB.prepare("DELETE FROM provider_keys WHERE teacher_id = ? AND provider = ?")
    .bind(c.get("teacher").id, c.req.param("provider"))
    .run();
  return c.json({ ok: true });
});
