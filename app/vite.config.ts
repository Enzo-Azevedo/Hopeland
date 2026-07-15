import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { viteVarsFromWranglerConfig } from "./wrangler-vars";

// Inject VITE_* vars from wrangler.jsonc into the client bundle. Without
// this the browser has no Supabase URL/key (wrangler vars only exist in
// the worker runtime) and auth hangs on every page. A real env var with
// the same name still wins, so CI/dev can override.
const wranglerVars = viteVarsFromWranglerConfig(
  readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"),
);
const define = Object.fromEntries(
  Object.entries(wranglerVars).map(([key, value]) => [
    `import.meta.env.${key}`,
    JSON.stringify(process.env[key] ?? value),
  ]),
);

export default defineConfig({
  define,
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    // Server entry auto-detected at src/server.ts (TanStack Start convention).
    tanstackStart(),
    // cloudflare_module emits .output/server/index.mjs + .output/public,
    // which wrangler.jsonc points at.
    nitro({ preset: "cloudflare_module" }),
    viteReact(),
  ],
});
