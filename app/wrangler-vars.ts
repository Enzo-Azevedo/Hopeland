// Extracts VITE_-prefixed vars from wrangler.jsonc so vite.config can
// inject them into the client bundle at build time (import.meta.env.*).
// wrangler.jsonc is the single source of truth for these public values;
// the Lovable vite config used to do this injection before it was removed.

/** Strips // and /* *​/ comments from JSONC without touching string contents. */
function stripJsoncComments(text: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function viteVarsFromWranglerConfig(jsoncText: string): Record<string, string> {
  const parsed = JSON.parse(stripJsoncComments(jsoncText)) as {
    vars?: Record<string, unknown>;
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.vars ?? {})) {
    if (key.startsWith("VITE_") && typeof value === "string") out[key] = value;
  }
  return out;
}
