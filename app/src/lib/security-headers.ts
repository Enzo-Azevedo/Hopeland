// Security response headers applied to every worker response (see server.ts).
// CSP is tuned for this app: same-origin assets, Supabase REST + realtime,
// Phaser (wasm), and TanStack Start's inline hydration script.

const SUPABASE_ORIGIN = "https://tekvkpxneckdxhtkcfeo.supabase.co";
const SUPABASE_WS = "wss://tekvkpxneckdxhtkcfeo.supabase.co";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-inline' is required for TanStack Start's inline hydration script
  // (no nonce plumbing); 'wasm-unsafe-eval' lets Phaser run its wasm.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS}`,
  "worker-src 'self' blob:",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
};

/** Returns a new Response with the security headers merged in (never overrides existing). */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
