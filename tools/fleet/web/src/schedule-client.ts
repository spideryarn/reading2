/**
 * What the Overseer's scheduler would run next — `GET /api/overseer/schedule`.
 * Plan 260910e § D7.
 *
 * ## One parser, run again here
 *
 * The route forwards the daemon's file as it found it, and this client runs
 * `parseSchedulePreview` — the one parser, a browser-safe leaf — over it again.
 * The wire is a version boundary as well as a network one: the dashboard server
 * and this page can be different builds, and the page must draw only what its
 * own build can read. So where the two builds disagree, the answer is this
 * page's, and it says so (`source: "page"`).
 *
 * ## Every arm a different kind of nothing
 *
 *  - **`preview`** — the daemon's file, read.
 *  - **`absent`** — the server looked and there is no file. Its sentence.
 *  - **`unreadable`** / **`unsupported-schema`** — there is a file, and either
 *    the server (`source: "server"`) or this page (`source: "page"`) could not
 *    read it.
 *  - **`no-answer`** — THIS PAGE never got an answer it could read: a network
 *    failure, a non-200, a body that is not this API. **Our sentence, never the
 *    server's** — the phone's own network trouble must not appear on screen in
 *    the server's voice (`health-history-client.ts` states the same rule).
 *
 * The payload's type is the server's (`routes-schedule.ts` § `SchedulePayload`),
 * a node module this project cannot import, so the envelope is read here by
 * name, and `tests/fleet-schedule-route.test.ts` feeds this function the
 * route's real bytes.
 */
import { parseSchedulePreview, SCHEDULE_PREVIEW_SCHEMA } from "../../schedule-parse";
import type { ParsedSchedulePreview } from "../../wire";

export const SCHEDULE_URL = "api/overseer/schedule";

/** How often the section asks again while it is on screen. The daemon rewrites the file every 30 s. */
export const SCHEDULE_POLL_MS = 60_000;

/** `Date`'s own range. An instant outside it throws in `toISOString`, and thrown during render it blanks the panel. */
const INSTANT_RANGE_MS = 8.64e15;

export type ScheduleView =
  | {
      kind: "preview";
      preview: ParsedSchedulePreview;
      /** When the server read the file, by the box's clock. */
      servedAt: string;
      /** When this page received it, by this browser's clock — so ages keep moving between reads without mixing the two clocks. */
      receivedAtMs: number;
    }
  | { kind: "absent"; why: string; servedAt: string }
  | { kind: "unreadable"; source: "server" | "page"; why: string; servedAt: string }
  | { kind: "unsupported-schema"; source: "server" | "page"; schema: number; known: number; servedAt: string }
  /** This page never got an answer it could read. **Our sentence, not the server's.** */
  | { kind: "no-answer"; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sentence(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function instant(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && Math.abs(ms) <= INSTANT_RANGE_MS ? v : null;
}

const NOT_THIS_API = "the dashboard server answered something that is not the schedule preview";

/** The reply, whatever it is. Never throws. */
export function parseSchedulePayload(raw: unknown, receivedAtMs: number): ScheduleView {
  if (!isRecord(raw)) return { kind: "no-answer", why: NOT_THIS_API };
  /* THE VERSION BEFORE ANY ARM, for the reason health-history-client.ts §
     refuseEnvelope gives: an arm read before the version is read without it. */
  if (raw["schema"] !== 1) {
    return {
      kind: "no-answer",
      why: `this page reads version 1 of the schedule payload and the server sent ${JSON.stringify(raw["schema"])} — reload, or rebuild the client`,
    };
  }
  const servedAt = instant(raw["servedAt"]);
  if (servedAt === null) return { kind: "no-answer", why: "the schedule payload carried no time this page can read for when it was served" };
  const file = raw["file"];
  if (!isRecord(file)) return { kind: "no-answer", why: NOT_THIS_API };
  switch (file["kind"]) {
    case "absent":
      return { kind: "absent", why: sentence(file["why"]) ?? "the server found no preview and did not say why", servedAt };
    case "unreadable":
      return { kind: "unreadable", source: "server", why: sentence(file["why"]) ?? "the server could not read the preview and did not say why", servedAt };
    case "unsupported-schema": {
      const schema = file["schema"];
      const known = file["known"];
      if (typeof schema !== "number" || typeof known !== "number") return { kind: "no-answer", why: NOT_THIS_API };
      return { kind: "unsupported-schema", source: "server", schema, known, servedAt };
    }
    case "preview": {
      const parsed = parseSchedulePreview(file["preview"]);
      switch (parsed.kind) {
        case "preview":
          return { kind: "preview", preview: parsed.preview, servedAt, receivedAtMs };
        case "unsupported-schema":
          return { kind: "unsupported-schema", source: "page", schema: parsed.schema, known: SCHEDULE_PREVIEW_SCHEMA, servedAt };
        case "unreadable":
          return { kind: "unreadable", source: "page", why: parsed.why, servedAt };
        default: {
          const never: never = parsed;
          return { kind: "no-answer", why: `${NOT_THIS_API} (${JSON.stringify(never)})` };
        }
      }
    }
    default:
      return { kind: "no-answer", why: `${NOT_THIS_API} (an answer of kind ${JSON.stringify(file["kind"])})` };
  }
}

/** A thrown thing, as a sentence. Never "[object Object]". */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/** The injection point, the shape `HistoryApi` has. */
export type ScheduleApi = { read: () => Promise<ScheduleView> };

export function makeScheduleApi(fetchImpl: typeof fetch = fetch, nowMs: () => number = () => Date.now()): ScheduleApi {
  return {
    async read(): Promise<ScheduleView> {
      let response: Response;
      try {
        response = await fetchImpl(SCHEDULE_URL, { cache: "no-store" });
      } catch (cause) {
        return { kind: "no-answer", why: `this page could not reach the dashboard's schedule route: ${describe(cause)}` };
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (cause) {
        return { kind: "no-answer", why: `the dashboard answered ${response.status} and the body was not JSON: ${describe(cause)}` };
      }
      if (!response.ok) {
        const why = isRecord(parsed) ? sentence(parsed["why"]) : null;
        return { kind: "no-answer", why: `the dashboard answered ${response.status}${why === null ? "" : `: ${why}`}` };
      }
      return parseSchedulePayload(parsed, nowMs());
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason in steer-client.ts. */
export const httpScheduleApi: ScheduleApi = {
  read: () => makeScheduleApi().read(),
};
