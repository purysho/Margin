import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { randomToken, sha256 } from "./crypto";
import type { AppEnv, Teacher } from "./env";

const COOKIE = "margin_session";
const SESSION_DAYS = 30;

export async function startSession(c: Context<AppEnv>, teacherId: string) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, teacher_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), teacherId, expires)
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function currentTeacher(c: Context<AppEnv>): Promise<Teacher | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT t.id, t.email, t.display_name, t.ai_provider, t.ai_model, s.expires_at
       FROM sessions s JOIN teachers t ON t.id = s.teacher_id
      WHERE s.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<Teacher & { expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  const { expires_at: _, ...teacher } = row;
  return teacher;
}

export const requireTeacher: MiddlewareHandler<AppEnv> = async (c, next) => {
  const teacher = await currentTeacher(c);
  if (!teacher) throw new HTTPException(401, { message: "Please log in." });
  c.set("teacher", teacher);
  await next();
};

/**
 * Blocks cross-site form posts: state-changing requests must be JSON and,
 * when the browser sends an Origin, it must match this site.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin)
      throw new HTTPException(403, { message: "Cross-origin request blocked." });
    const type = c.req.header("content-type") ?? "";
    // Audio uploads are multipart. Plain forms can send multipart cross-site, so
    // for those the Origin header is required, not just checked when present.
    const upload = type.startsWith("multipart/form-data") && origin === new URL(c.req.url).origin;
    if (c.req.method !== "DELETE" && !type.startsWith("application/json") && !upload)
      throw new HTTPException(415, { message: "Expected JSON." });
  }
  await next();
};
