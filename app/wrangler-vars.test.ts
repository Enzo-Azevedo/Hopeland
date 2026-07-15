import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { viteVarsFromWranglerConfig } from "./wrangler-vars";

describe("viteVarsFromWranglerConfig", () => {
  test("extracts only VITE_-prefixed vars", () => {
    const jsonc = `{
      "vars": {
        "SUPABASE_URL": "https://x.supabase.co",
        "VITE_SUPABASE_URL": "https://x.supabase.co",
        "VITE_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_abc"
      }
    }`;
    expect(viteVarsFromWranglerConfig(jsonc)).toEqual({
      VITE_SUPABASE_URL: "https://x.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
    });
  });

  test("strips // and /* */ comments without corrupting URLs in strings", () => {
    const jsonc = `{
      // line comment with "quotes" and https://url.example
      /* block
         comment */
      "vars": {
        "VITE_SUPABASE_URL": "https://tek.supabase.co" // trailing comment
      }
    }`;
    expect(viteVarsFromWranglerConfig(jsonc)).toEqual({
      VITE_SUPABASE_URL: "https://tek.supabase.co",
    });
  });

  test("returns empty object when vars section is absent", () => {
    expect(viteVarsFromWranglerConfig(`{ "name": "hopeland" }`)).toEqual({});
  });

  test("parses the real wrangler.jsonc with the URL intact", () => {
    const real = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
    const vars = viteVarsFromWranglerConfig(real);
    expect(vars.VITE_SUPABASE_URL).toMatch(/^https:\/\/.+\.supabase\.co$/);
    expect(vars.VITE_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/);
  });
});
