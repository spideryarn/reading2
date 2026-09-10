/**
 * The dashboard's diagnostics — `GET /api/diagnostics` — and this tab's own
 * build stamp. docs/plans/260910f Stage 3.
 *
 * The server's answer has one shape; this client adds `no-answer`: this
 * browser timed out, could not reach the box, got a non-2xx, or received bytes
 * the parser refuses. That is kept apart from anything the server said, so a
 * phone's own network trouble never appears in the server's voice (the rule
 * recovery-client.ts follows).
 *
 * **The parser is not here.** It is `tools/fleet/diagnostics-parse.ts`, shared
 * with `overseer diagnose`, which reads the same route over HTTP — one parser,
 * so the page and the CLI cannot disagree about what a valid answer is. It is
 * strict and fails whole: a field that does not parse makes the whole answer
 * `no-answer`, never a page with a hole in it.
 *
 * The factory takes its request leaf, so the tests drive the real timeout,
 * JSON and parser path without stubbing global `fetch`.
 */
/// <reference path="./build-stamp.d.ts" />
// The reference, because tests/tsconfig.json compiles this file without the web project's ambient declarations.
import { parseBuildStamp, parseDiagnosticsSummary } from "../../diagnostics-parse.js";
import type { BuildStampReading, DiagnosticsSummary } from "../../wire.js";

export { parseDiagnosticsSummary };

export const DIAGNOSTICS_URL = "api/diagnostics";
export const DIAGNOSTICS_FETCH_TIMEOUT_MS = 10_000;

export type DiagnosticsView = { kind: "summary"; summary: DiagnosticsSummary } | { kind: "no-answer"; why: string };
export type DiagnosticsApi = { fetch(signal?: AbortSignal): Promise<DiagnosticsView> };
export type DiagnosticsRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const noAnswer = (why: string): DiagnosticsView => ({ kind: "no-answer", why });

/** Build the seam against an injectable request leaf. */
export function makeDiagnosticsApi(request: DiagnosticsRequest = (input, init) => fetch(input, init)): DiagnosticsApi {
  return {
    async fetch(signal): Promise<DiagnosticsView> {
      const controller = new AbortController();
      let abortReason: "caller" | "timeout" | null = signal?.aborted === true ? "caller" : null;
      const timer = setTimeout(() => {
        abortReason ??= "timeout";
        controller.abort();
      }, DIAGNOSTICS_FETCH_TIMEOUT_MS);
      const onAbort = (): void => {
        abortReason ??= "caller";
        controller.abort();
      };
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) controller.abort();
      try {
        const response = await request(DIAGNOSTICS_URL, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return noAnswer(`this browser received ${response.status} from the dashboard, but its answer was not JSON`);
        }
        const parsed = parseDiagnosticsSummary(body);
        if (!response.ok) {
          return noAnswer(`the dashboard answered ${response.status}${parsed.kind === "unreadable" ? `: ${parsed.why}` : ""}`);
        }
        if (parsed.kind === "unreadable") return noAnswer(`this browser could not read the dashboard's answer: ${parsed.why}`);
        return { kind: "summary", summary: parsed.summary };
      } catch (cause) {
        return noAnswer(
          abortReason === "caller"
            ? "this browser cancelled the diagnostics request before it answered"
            : abortReason === "timeout"
              ? `this browser got no answer within ${DIAGNOSTICS_FETCH_TIMEOUT_MS / 1000}s`
              : `this browser could not reach the dashboard: ${String(cause)}`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Stable default object for a React effect dependency. */
export const httpDiagnosticsApi: DiagnosticsApi = makeDiagnosticsApi();

/**
 * The bundle THIS TAB is running: `__FLEET_BUILD__`, compiled in by
 * `vite.fleet.config.ts`. Absent (a test, a bundle built another way) or
 * malformed is `unknown` — never a stamp, and so never "the same".
 */
export function tabBuild(): BuildStampReading {
  if (typeof __FLEET_BUILD__ === "undefined") return { kind: "unknown", why: "this bundle carries no compiled-in build stamp" };
  const stamp = parseBuildStamp(__FLEET_BUILD__);
  return stamp === null ? { kind: "unknown", why: "this bundle's compiled-in stamp does not have the shape vite.fleet.config.ts writes" } : { kind: "stamp", stamp };
}
