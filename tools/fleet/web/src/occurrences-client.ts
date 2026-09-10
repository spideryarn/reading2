/**
 * What the Overseer's scheduler has launched — `GET /api/overseer/occurrences`.
 * Plan 260910f-scheduled-dispatch § D7.
 *
 * `schedule-client.ts`'s shape, for its reasons: the route forwards the
 * daemon's file as it found it, and this client runs the one parser
 * (`occurrences-parse.ts`, a browser-safe leaf) over it again, so where the
 * dashboard server and this page are different builds, the answer is this
 * page's and says so (`source: "page"`). `no-answer` is this page never getting
 * an answer it could read, **in our voice, never the server's**.
 *
 * The payload's type is the server's (`routes-occurrences.ts`), a node module
 * this project cannot import, so the envelope is read here by name, and
 * `tests/fleet-occurrences-route.test.ts` feeds this function the route's real
 * bytes.
 */
import { OCCURRENCES_SCHEMA, parseOccurrencesFile, type ParsedOccurrencesFile } from "../../occurrences-parse";

export const OCCURRENCES_URL = "api/overseer/occurrences";

/** How often the section asks again while it is on screen. The daemon rewrites the file every checkpoint. */
export const OCCURRENCES_POLL_MS = 60_000;

/** The durable link to one occurrence's answer, relative like `OCCURRENCES_URL`. */
export function answerUrlOf(launchOccurrenceId: string): string {
  return `${OCCURRENCES_URL}/${encodeURIComponent(launchOccurrenceId)}/answer`;
}

const INSTANT_RANGE_MS = 8.64e15;

export type OccurrencesView =
  | {
      kind: "occurrences";
      file: ParsedOccurrencesFile;
      /** When the server read the file, by the box's clock. */
      servedAt: string;
      /** When this page received it, by this browser's clock. */
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

const NOT_THIS_API = "the dashboard server answered something that is not the scheduler's occurrences";

/** The reply, whatever it is. Never throws. */
export function parseOccurrencesPayload(raw: unknown, receivedAtMs: number): OccurrencesView {
  if (!isRecord(raw)) return { kind: "no-answer", why: NOT_THIS_API };
  if (raw["schema"] !== 1) {
    return {
      kind: "no-answer",
      why: `this page reads version 1 of the occurrences payload and the server sent ${JSON.stringify(raw["schema"])} — reload, or rebuild the client`,
    };
  }
  const servedAt = instant(raw["servedAt"]);
  if (servedAt === null) return { kind: "no-answer", why: "the occurrences payload carried no time this page can read for when it was served" };
  const file = raw["file"];
  if (!isRecord(file)) return { kind: "no-answer", why: NOT_THIS_API };
  switch (file["kind"]) {
    case "absent":
      return { kind: "absent", why: sentence(file["why"]) ?? "the server found no record of launches and did not say why", servedAt };
    case "unreadable":
      return { kind: "unreadable", source: "server", why: sentence(file["why"]) ?? "the server could not read the record of launches and did not say why", servedAt };
    case "unsupported-schema": {
      const schema = file["schema"];
      const known = file["known"];
      if (typeof schema !== "number" || typeof known !== "number") return { kind: "no-answer", why: NOT_THIS_API };
      return { kind: "unsupported-schema", source: "server", schema, known, servedAt };
    }
    case "occurrences": {
      const parsed = parseOccurrencesFile(file["occurrences"]);
      switch (parsed.kind) {
        case "parsed":
          return { kind: "occurrences", file: parsed.file, servedAt, receivedAtMs };
        case "unsupported-schema":
          return { kind: "unsupported-schema", source: "page", schema: parsed.saw, known: OCCURRENCES_SCHEMA, servedAt };
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

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/** The injection point, the shape `ScheduleApi` has. */
export type OccurrencesApi = { read: () => Promise<OccurrencesView> };

export function makeOccurrencesApi(fetchImpl: typeof fetch = fetch, nowMs: () => number = () => Date.now()): OccurrencesApi {
  return {
    async read(): Promise<OccurrencesView> {
      let response: Response;
      try {
        response = await fetchImpl(OCCURRENCES_URL, { cache: "no-store" });
      } catch (cause) {
        return { kind: "no-answer", why: `this page could not reach the dashboard's occurrences route: ${describe(cause)}` };
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
      return parseOccurrencesPayload(parsed, nowMs());
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason in steer-client.ts. */
export const httpOccurrencesApi: OccurrencesApi = {
  read: () => makeOccurrencesApi().read(),
};
