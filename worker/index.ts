import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { sameOrigin } from "./auth";
import type { AppEnv } from "./env";
import { account } from "./routes/account";
import { assignments } from "./routes/assignments";
import { metrics } from "./routes/metrics";
import { onboarding } from "./routes/onboarding";
import { publicRoutes } from "./routes/public";
import { rubrics } from "./routes/rubrics";
import { submissions } from "./routes/submissions";

export const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders(), sameOrigin);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", account);
app.route("/api/rubrics", rubrics);
app.route("/api/assignments", assignments);
app.route("/api/submissions", submissions);
app.route("/api/metrics", metrics);
app.route("/api/onboarding", onboarding);
app.route("/api/public", publicRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong on our side." }, 500);
});

export default app;
