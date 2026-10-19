export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Cloudflare Workers AI binding: the free, no-key tier. */
  AI?: Ai;
  /** Max free-tier drafts per teacher per 24 hours. Keeps usage inside the free allocation. */
  FREE_DAILY_LIMIT?: string;
  /** 32 random bytes, base64. Encrypts teachers' provider API keys. */
  KEY_ENCRYPTION_SECRET: string;
}

export interface Teacher {
  id: string;
  email: string;
  display_name: string;
  ai_provider: string;
  ai_model: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { teacher: Teacher };
};
