// Restore the TanStack Start `server` route option on file-based routes.
//
// @tanstack/start-client-core declares `server?: RouteServerOptions<...>` on
// router-core's FilebaseRouteOptionsInterface via `declare module` inside
// its serverRoute.d.ts. The package barrel re-exports that file with
// `export type * from './serverRoute.js'`, which strips the ambient module
// augmentation, so the app's import graph never actually pulls it in and
// `createFileRoute(...)({ server: {...} })` reports TS2353 in every MCP
// route file emitted by @lovable.dev/mcp-js.
//
// Re-declare the field here (loose type — the runtime shape is owned by the
// mcp-js handlers) so the augmentation lives inside the app's own type
// graph and doesn't depend on internal package paths.
import type { RouteServerOptions } from "@tanstack/start-client-core";

declare module "@tanstack/router-core" {
  interface FilebaseRouteOptionsInterface {
    server?: RouteServerOptions<any, any, any, any, any, any, any, any, any, any, any>;
  }
}

export {};
