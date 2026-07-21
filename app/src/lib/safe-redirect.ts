// Sanitize a post-login redirect target. Only same-origin RELATIVE paths are
// allowed; everything else (absolute URLs, protocol-relative //host, backslash
// tricks, embedded schemes, userinfo tricks) is rejected to prevent open
// redirects — both in the client-side navigate() and in the OAuth redirectTo
// built as `${origin}${redirect}`.
export function safeRedirectPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("/")) return undefined; // must be relative
  if (raw.startsWith("//") || raw.startsWith("/\\")) return undefined; // protocol-relative
  if (raw.includes("\\")) return undefined; // browsers fold \ into /
  if (raw.includes("://")) return undefined; // embedded scheme
  if (raw.includes("@")) return undefined; // userinfo host trick
  return raw;
}
