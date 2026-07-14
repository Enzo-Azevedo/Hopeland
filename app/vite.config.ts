import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig({
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
