/**
 * The deploy record — `GET /api/deploys`.
 *
 * ## FOUR ARMS, BECAUSE THE SERVER HAS TWO AND THE WIRE CAN FAIL TOO
 *
 * The discipline `health-history-client.ts` states at length, and it applies
 * here for the same reason: every arm is a different kind of *nothing*, and
 * collapsing any two of them produces an empty list, which reads as **"nothing
 * has ever been deployed"** — a confident, false, and rather alarming sentence
 * about production.
 *
 *  - **`deploys`** — we read the record. `versions` may be empty, and that is a
 *    claim about the record rather than a failure.
 *  - **`unreadable`** — the SERVER could not read it. Its `why`, in its voice.
 *  - **`no-answer`** — THIS BROWSER never got an answer it could read. Our
 *    sentence, and it says so, because the phone's own network trouble must not
 *    appear on screen wearing the server's voice.
 *  - **`loading`** — the panel's, and not a claim about anything.
 *
 * ## The seam
 *
 * `DeploysApi` is injectable so `DeploysPanel` can be driven by a test without
 * stubbing `fetch` — the rule docs/project/fleet-dashboard-modes.md § Writing
 * back states: bind `fetch` at import time and it is unstubbable in any suite
 * that imports the module first, and the failure looks like a real network call
 * in a test that has none.
 */
import type { DeploysPayload, DeployVersion } from "../../wire";

export const DEPLOYS_URL = "api/deploys";

/** How many the tab asks for first. The server's own default, restated so a caller can widen it. */
export const FIRST_PAGE = 10;

/** What "show more" asks for. The server clamps at 200. */
export const MORE_PAGE = 60;

/** How long before deciding an answer is not coming. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * What the panel renders. The server's two arms, plus the one only a browser can
 * have.
 */
export type DeploysView =
  | (Extract<DeploysPayload, { kind: "deploys" }> & { kind: "deploys" })
  | { kind: "unreadable"; why: string }
  | { kind: "no-answer"; why: string };

/** The seam. One method, because this tab only reads. */
export type DeploysApi = {
  fetch(limit: number, signal?: AbortSignal): Promise<DeploysView>;
};

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/**
 * Is this the shape this build can read?
 *
 * **Checked rather than cast.** A payload from a schema this build does not
 * know looks exactly like a healthy one to `await response.json()`, and the
 * failure would be a panel drawing `undefined` where a count belongs. The
 * fields checked are the ones the panel would silently render wrong, not every
 * field on the type.
 */
function readPayload(body: unknown): DeploysView {
  if (typeof body !== "object" || body === null) {
    return { kind: "no-answer", why: "the server's answer was not an object" };
  }
  const raw = body as Record<string, unknown>;
  /* **The schema first, before either arm is read.** A payload from a build
     this page does not know looks exactly like a healthy one to `.json()`, and
     the failure would be a panel drawing `undefined` where a count belongs —
     the same call `health-history-client.ts` makes. GPT Sol's P2 finding 5. */
  if (raw.schema !== 1) {
    return {
      kind: "no-answer",
      why: `this page cannot read schema ${JSON.stringify(raw.schema)} from the box — one of the two is out of date`,
    };
  }
  if (raw.kind === "unreadable") {
    return {
      kind: "unreadable",
      why: typeof raw.why === "string" ? raw.why : "the server did not say why",
    };
  }
  if (raw.kind !== "deploys" || !Array.isArray(raw.versions)) {
    return {
      kind: "no-answer",
      why: `this build cannot read the server's answer (kind ${JSON.stringify(raw.kind)})`,
    };
  }
  return body as DeploysView;
}

/** The real one. Relative URL, so the tool works behind any host. */
export function httpDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
  return {
    async fetch(limit, signal): Promise<DeploysView> {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      /* The caller's signal and ours both have to reach the fetch: the caller's
         is React unmounting, ours is the timeout. Without the first, a panel
         that goes away mid-request sets state on a dead component; without the
         second, a hung request is indistinguishable from a slow one for ever. */
      const onAbort = (): void => controller.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const response = await fetch(`${url}?limit=${limit}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            kind: "no-answer",
            why: `the server answered ${response.status} ${response.statusText}`.trimEnd(),
          };
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch (cause) {
          return { kind: "no-answer", why: `the server's answer was not JSON: ${describe(cause)}` };
        }
        return readPayload(body);
      } catch (cause) {
        return {
          kind: "no-answer",
          why: controller.signal.aborted
            ? `no answer in ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s — the box may be busy, or gone`
            : describe(cause),
        };
      } finally {
        clearTimeout(abort);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Saying when, and how long ago.
 * ------------------------------------------------------------------ */

/**
 * **The seam for `tools/fleet/zones.ts`.**
 *
 * `zonedLine(iso)` — landing from docs/plans/260908f-roadmap-usage — spells a
 * time in UTC, London and Athens at once, with a `(+1d)` where the calendar
 * dates differ. That last part is the bit worth not reinventing: a deploy at
 * 23:40 UTC is 02:40 Athens *the next day*, and printed bare beside the UTC time
 * it reads as three hours in the past.
 *
 * Until that module is on `dev` this spells the UTC time only, which is true and
 * not yet useful to somebody in Athens. **When it lands, this function's body
 * becomes `return zonedLine(iso) ?? …` and nothing else in this tab changes** —
 * which is the whole reason it is a function here rather than four lines inside
 * the panel's JSX.
 */
export function deployWhen(iso: string): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return `${iso.replace("T", " ").replace("Z", "")} UTC`;
}

/**
 * How long ago, in the coarsest unit that is still informative.
 *
 * Returns null for an unreadable stamp rather than "NaN ago" or, worse, "just
 * now" — a fabricated freshness is the single most misleading thing this panel
 * could say, since the whole header is about how stale the record is.
 */
export function ago(iso: string | null, nowMs: number): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const seconds = Math.round((nowMs - at) / 1000);
  /* A future stamp is a clock disagreement, not a negative age. The box and the
     phone need not agree, and "in 3 minutes" beside a deploy is a puzzle
     nobody should have to solve on a phone. */
  if (seconds < 0) return "just now";
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A sha as the seven characters a person reads. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** The repository the commit links point into. Public since 2026-09-06. */
export const REPO_URL = "https://github.com/spideryarn/reading2";

export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}

/** The entries of one deploy, grouped under the three headings, in order. */
export function groupedEntries(
  version: DeployVersion,
): { section: "headline" | "enhancement" | "fix"; label: string; entries: DeployVersion["entries"] }[] {
  const labels = {
    headline: "Headline changes",
    enhancement: "Minor enhancements",
    fix: "Bug fixes",
  } as const;
  return (["headline", "enhancement", "fix"] as const)
    .map((section) => ({
      section,
      label: labels[section],
      entries: version.entries.filter((e) => e.section === section),
    }))
    .filter((group) => group.entries.length > 0);
}
