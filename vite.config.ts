import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    // The free tier (Workers AI) only runs on Cloudflare. Locally it is used when
    // you are logged in to Cloudflare (`npx wrangler login`) or MARGIN_REMOTE_AI=1;
    // otherwise everything else works offline and "Demo mode" stands in for the AI.
    cloudflare({ remoteBindings: process.env.MARGIN_REMOTE_AI === "1" }),
  ],
});
