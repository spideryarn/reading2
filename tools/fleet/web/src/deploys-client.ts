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
import { DISPLAY_ZONES, zonedLine, zonedReadings } from "../../zones";

export const DEPLOYS_URL = "api/deploys";

/** How many the tab asks for first. The server's own default, restated so a caller can widen it. */
export const FIRST_PAGE = 10;

/** How many more rows each "show more" press asks for. */
export const MORE_PAGE = 60;

/**
 * The ceiling, restated from the route's own `MAX_LIMIT`.
 *
 * Two copies of a number is how they come to disagree, and normally this would
 * be imported — but `routes-deploys.ts` reaches `node:fs`, so the browser
 * project cannot see it (wire.ts's header has the measurement). It is a `const`
 * rather than a magic number so the next person finds this note; the route
 * clamps regardless, so a disagreement costs a wasted press rather than a bug.
 */
export const MAX_LIMIT = 200;

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
export function readPayload(body: unknown): DeploysView {
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

  /* **Everything below was a cast until GPT Sol's F8**, and each of the three
     had its own way of going wrong on screen rather than in a check:

       - a missing `git` CRASHES the render, because `view.git.main` throws;
       - a missing `servedAtMs` makes every age `NaNd ago`;
       - a missing `newestLineRead` — which is what an OLDER schema-1 server
         sends, since the field arrived after the schema number did — is falsy,
         so the page would announce that the record's newest line is corrupt
         when nothing is wrong at all. **A false alarm invented by a version
         skew** is the worst of the three, and it is the one a cast guarantees.

     So `git` is required (its absence is a wire we cannot read), and the two
     scalars are defaulted to the reading that claims LEAST: a `servedAtMs` we
     cannot trust falls back to this browser's clock, and an absent
     `newestLineRead` is treated as `true` — no alarm — because absence here
     means "an older server that never looked", not "the newest line is bad". */
  const git = raw.git;
  if (typeof git !== "object" || git === null || !("main" in git) || !("ancestry" in git) || !("commitsSince" in git)) {
    return { kind: "no-answer", why: "the server's answer carried no git readings this page could use" };
  }

  return {
    ...(body as Extract<DeploysView, { kind: "deploys" }>),
    servedAtMs: typeof raw.servedAtMs === "number" && Number.isFinite(raw.servedAtMs) ? raw.servedAtMs : Date.now(),
    newestLineRead: raw.newestLineRead !== false,
    unreadable: Array.isArray(raw.unreadable) ? raw.unreadable.filter((u): u is string => typeof u === "string") : [],
    total: typeof raw.total === "number" && Number.isFinite(raw.total) ? raw.total : (raw.versions as unknown[]).length,
    recordLines: typeof raw.recordLines === "number" && Number.isFinite(raw.recordLines) ? raw.recordLines : 0,
  };
}

/** A client against a given URL. Relative, so the tool works behind any host. */
export function makeDeploysApi(url: string = DEPLOYS_URL): DeploysApi {
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

/**
 * The real one, built once.
 *
 * **A FACTORY CALLED IN A DEFAULT ARGUMENT IS A NEW OBJECT EVERY RENDER**, and
 * this page re-renders once a second because `useNow` ticks. `DeploysPanel`'s
 * effect depends on the api's identity, so `api = makeDeploysApi()` as a default
 * meant: abort the in-flight request and start another, once a second, for as
 * long as the tab is open — while the box kept working on every abandoned one.
 * A response slower than a second would never have been accepted at all.
 *
 * The tests could not see it because they inject a stable fake, which is exactly
 * the shape of hole GPT Sol was looking for. Found in review, 2026-09-09.
 *
 * So this is a `const`, like `httpHistoryApi` and `httpActionsApi` beside it —
 * the house pattern, and now for a reason that is written down. `makeDeploysApi`
 * remains for a caller that needs a different URL; **do not call it in a default
 * argument.**
 */
export const httpDeploysApi: DeploysApi = makeDeploysApi();

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
 * **Landed 2026-09-09** (`af1ec002`), and the swap was one line, which is the
 * whole reason this was a function rather than four lines inside the panel's
 * JSX. It returns `null` rather than throwing on anything unreadable, and the
 * panel already draws `null` as "at a time this page cannot read".
 */
export function deployWhen(iso: string): string | null {
  /* No `zones` argument, so this gets `DISPLAY_ZONES` — UTC, London, Athens.
     **Pass a set rather than editing that constant** if a caller ever wants a
     different one: it is Greg's "I'm bouncing between London/Athens" and it is
     read by the usage card and `scripts/overseer.ts` too. zones.ts says so. */
  return zonedLine(iso);
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
  return agoFrom(at, nowMs);
}

/**
 * The same, from epoch milliseconds — **and it exists to avoid a `Date` that can
 * throw.**
 *
 * `lastFetchAtMs` is a filesystem mtime, and the panel used to render it as
 * `ago(new Date(ms).toISOString(), now)`. `new Date(x).toISOString()` raises
 * `RangeError` for an `x` outside ±8.64e15 rather than returning anything odd,
 * and a `RangeError` thrown during render takes the **whole panel** down, not
 * one line of it — so a corrupt or absurd mtime on one file would blank the
 * deploy list and say nothing about why.
 *
 * Flagged by session `260908f-roadmap-usage`, which hit the same class twice in
 * the usage card: an out-of-range instant, and a difference of two individually
 * valid instants that left the range. **A finiteness check is not enough** —
 * `1e300` is perfectly finite and still out of range — so this checks the range
 * itself, and then never builds a `Date` at all.
 */
export function agoFrom(atMs: number | null, nowMs: number): string | null {
  if (atMs === null || !Number.isFinite(atMs) || Math.abs(atMs) > 8.64e15) return null;
  const seconds = Math.round((nowMs - atMs) / 1000);
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

/* ------------------------------------------------------------------ *
 * The collapsed row: which zone, what it shipped, and which day it was.
 * ------------------------------------------------------------------ */

/**
 * **The one zone a closed row and a day heading are drawn in: UTC.**
 *
 * This was the device's own zone for about an hour, on the argument that
 * `zones.ts` only forbids an *unlabelled* local time and every rendering here
 * carries its zone's name. GPT Sol's P1, and it is right: that is not what
 * `zones.ts` says. It rejects **detection** —
 *
 * > There is no setting, no detection of where he is, and no "local time": a
 * > page rendered on the box and a page rendered on a phone in Athens would
 * > disagree about what "local" means, and the one thing a reset time may not
 * > be is ambiguous.
 *
 * — and a detected zone does not merely risk an unlabelled clock. It makes the
 * page **disagree with itself across devices**: the box would file a 23:19 UTC
 * deploy under the 8th and the phone in Athens under the 9th, for the same
 * release, and neither is wrong. A day heading is not a thing to be
 * device-dependent about.
 *
 * UTC is the zone the record's own timestamps are in, so a reader comparing
 * this page against the file or a log line has the identical string in front of
 * them. No detection, no ambiguity, nothing to configure, and the tests stop
 * depending on where they happen to run.
 *
 * **What is still an open question for Greg** is that a closed row shows one of
 * the three clocks rather than all three — the brief for this pass said to tuck
 * the three-zone line behind the expand, and `zones.ts` says all three are
 * always shown. Tucked, not lost: opening a deploy gives the canonical line.
 */
export const ROW_ZONE: { zone: string; label: string } = { zone: "UTC", label: "UTC" };

/** The zones a deploy shows once it is open, so the page can say so in words rather than repeat the list. */
export const OPEN_ZONE_LABELS: readonly string[] = DISPLAY_ZONES.map((z) => z.label);

/**
 * One instant, in one zone, as the collapsed row draws it.
 *
 * **Through `zonedReadings`, not through a second `Intl` call**, so the row's
 * time and the three-zone line beneath it are produced by the same code and
 * cannot come to disagree about a DST boundary. `null` for an instant that
 * cannot be read — the row says so rather than printing `Invalid Date`.
 *
 * **`zone` is a parameter with the product's answer as its default**, which is
 * `zones.ts`'s own shape and its own reason: it keeps this a formatter rather
 * than a formatter with a product decision welded into it, and it keeps the
 * `(+1d)` case — a deploy that falls on a different calendar day in another
 * zone — reachable from a test. Production passes nothing.
 */
export function deployWhenIn(
  iso: string,
  zone: { zone: string; label: string } = ROW_ZONE,
): { date: string; time: string; label: string } | null {
  const readings =
    zonedReadings(iso, [{ zone: zone.zone, label: zone.label }]) ??
    /* An ICU that does not know this zone. UTC is the record's own zone, so it
       is the honest retreat rather than a guess at another civil one. */
    zonedReadings(iso, [{ zone: "UTC", label: "UTC" }]);
  const only = readings?.[0];
  if (only === undefined) return null;
  return { date: only.date, time: only.time, label: only.label };
}

/**
 * What one deploy shipped, in as much as fits on a closed row.
 *
 * **The three kinds of nothing stay apart here too**, which is the whole risk a
 * collapsed view introduces: the expanded card fought this out entry by entry
 * in 260909b, and a summary saying *nothing changed* over a deploy whose
 * changelog could not be READ would undo it in one line. `kind` is what the
 * panel branches on, so it never has to re-derive the distinction.
 *
 * `unreadable` rides on every arm because a partly-read deploy is understated
 * by its own gist: "Hover cards on links +2 more" is a short list presented as
 * a whole one unless the row says how much it is missing.
 */
export type DeployGist = {
  kind: "unreadable" | "quiet" | "entries";
  /** The entry this row leads with — a headline one when there is one. Null on the other arms. */
  title: string | null;
  /** Further entries that were read and are not on the row. */
  more: number;
  /** Entries on this deploy that would not parse at all. */
  unreadable: number;
};

export function deployGist(version: DeployVersion): DeployGist {
  const unreadable = version.unreadableEntries;
  if (!version.changelogReadable) return { kind: "unreadable", title: null, more: 0, unreadable };
  /* `groupedEntries` already orders headline, then enhancement, then fix — so
     the first entry of the first group IS the most newsworthy one, and picking
     it here needs no second opinion about which section outranks which. */
  const first = groupedEntries(version)[0]?.entries[0];
  if (first === undefined) return { kind: "quiet", title: null, more: 0, unreadable };
  return { kind: "entries", title: first.title, more: Math.max(0, version.entries.length - 1), unreadable };
}

/** The deploys of one calendar day, in the zone the rows are drawn in. */
export type DeployDay = {
  /** `YYYY-MM-DD` in that zone, or `""` for deploys whose instant could not be read. */
  key: string;
  /** `Tue 8 Sep 2026`, or the sentence that says the instant was unreadable. */
  label: string;
  versions: DeployVersion[];
};

/**
 * The window, grouped into days.
 *
 * **In the same zone the rows are drawn in, whatever that is.** A deploy at
 * 23:19 UTC is 02:19 Athens the next day, so a heading measured in one zone
 * over a time measured in another files it under a day it did not happen on —
 * the case the `(+1d)` suffix exists to warn about, arriving as a wrong
 * heading instead. The default is `ROW_ZONE` for exactly that reason: one
 * constant, so the two cannot drift apart.
 *
 * Order is preserved: the record is time-ordered, so equal keys are contiguous,
 * and a `Map` keeps the first appearance of each. Unreadable instants collect
 * under one honest heading rather than each inventing a day of its own.
 */
export function deployDays(
  versions: DeployVersion[],
  zone: { zone: string; label: string } = ROW_ZONE,
): DeployDay[] {
  const days = new Map<string, DeployVersion[]>();
  for (const version of versions) {
    const key = deployWhenIn(version.version, zone)?.date ?? "";
    const bucket = days.get(key);
    if (bucket === undefined) days.set(key, [version]);
    else bucket.push(version);
  }
  return [...days].map(([key, group]) => ({ key, label: dayLabel(key), versions: group }));
}

/** `2026-09-08` as a person reads it. The key itself if the host's `Intl` will not say. */
export function dayLabel(key: string): string {
  if (key === "") return "at a time this page cannot read";
  /* Noon, so the formatter cannot be nudged onto the neighbouring day by an
     offset — and formatted IN UTC, because the key is already a calendar date
     in the reader's zone and re-projecting it into a zone would move it again. */
  const at = new Date(`${key}T12:00:00Z`);
  if (!Number.isFinite(at.getTime())) return key;
  try {
    /* **`timeZone: "UTC"` is what stops the label moving**, and that is worth
       stating correctly: the key is already a calendar date, and formatting it
       in any other zone would re-project it onto a neighbouring day. Noon
       rather than midnight is belt to that braces — it costs nothing and it
       makes a later edit that changes the zone produce a wrong label rather
       than a wrong day. The comment here claimed noon was the mechanism until
       GPT Sol pointed out it is not. */
    /* **Parts rather than a formatted string**, which is zones.ts's rule and
       its reason: the order and the separators of a formatted date are the
       locale's business, and `en-GB` spells this one `Tue, 8 Sept 2026`. The
       numbers and the names are what is wanted; the shape is ours. `en-US`
       because its short month is the three letters everything else on this page
       uses. */
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).formatToParts(at);
    const found = new Map(parts.map((p) => [p.type, p.value]));
    const weekday = found.get("weekday");
    const day = found.get("day");
    const month = found.get("month");
    const year = found.get("year");
    if (weekday === undefined || day === undefined || month === undefined || year === undefined) return key;
    return `${weekday} ${day} ${month} ${year}`;
  } catch {
    return key;
  }
}
