// Minimal ambient declaration for bun's built-in test runner.
//
// We intentionally do NOT depend on the `@types/bun`/`bun-types` package:
// installing it pulls Bun's global `fetch`/`Response` overrides into the
// whole program (TypeScript resolves ambient module imports like
// "bun:test" by scanning all of node_modules/@types regardless of the
// tsconfig `types` restriction), which conflicts with the Node-style
// fetch typing assumed by src/integrations/supabase/*. This local shim
// covers only what our test files actually use.
declare module "bun:test" {
  interface Matchers<T = unknown> {
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    not: Matchers<T>;
    [matcher: string]: (...args: unknown[]) => void | Matchers<T>;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T = unknown>(actual: T): Matchers<T>;
}
