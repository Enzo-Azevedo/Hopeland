import { describe, expect, test } from "bun:test";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  test("allows same-origin relative paths", () => {
    expect(safeRedirectPath("/character-creation")).toBe("/character-creation");
    expect(safeRedirectPath("/game")).toBe("/game");
    expect(safeRedirectPath("/a/b?x=1&y=2")).toBe("/a/b?x=1&y=2");
    expect(safeRedirectPath("/")).toBe("/");
  });

  test("blocks open-redirect vectors", () => {
    const bad = [
      "https://evil.com",
      "http://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\/evil.com",
      "https://hopeland.enzoteste3-g.workers.dev@evil.com",
      "/@evil.com",
      "javascript:alert(1)",
      "evil.com",
      "  /game",
      "ftp://evil.com",
    ];
    for (const b of bad) {
      expect(safeRedirectPath(b)).toBeUndefined();
    }
  });

  test("empty / undefined -> undefined", () => {
    expect(safeRedirectPath(undefined)).toBeUndefined();
    expect(safeRedirectPath("")).toBeUndefined();
  });
});
