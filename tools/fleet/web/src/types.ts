/**
 * The shape of `GET /api/state`, and a parser that refuses to trust it.
 *
 * THIS IS A COPY OF THE SERVER'S CONTRACT, NOT AN IMPORT OF IT, and that is
 * deliberate twice over. `tools/fleet/collect.ts` is a node module — it opens
 * with `import { execFileSync } from "node:child_process"` — so a type-only
 * import of its `FleetRow` still makes TypeScript walk a module this browser
 * project has no `node` types for. And the payload carries a `health` field
 * that no collector on the node side owns yet. So the client states the wire
 * format it renders, and `parseFleetState` below is what reconciles the two.
 *
 * EVERYTHING HERE IS AGENT-AUTHORED TEXT — a title, a repo name, a question
 * scraped off somebody's terminal. React escapes it on the way into the DOM,
 * which is most of why this client replaced a hand-built HTML string. Nothing
 * in this directory may use React's escape hatch for raw markup, and
 * tests/fleet-web.test.tsx greps the source for it — which is why this
 * paragraph describes the prop rather than naming it. (That guard caught this
 * very comment on its first run: the same shape as the Tailwind class written
 * in a docstring and silently compiled into the product's bundle.)
 */

/**
 * What a session is doing. The same seven arms as `SessionState` in
 * scripts/gjd-remote-tmux.ts, restated rather than imported for the reason
 * above — and `parseStatus` maps an EIGHTH arm, one this client has never heard
 * of, onto `unknown` with the arm's own name in the reason. A client that
 * silently rounded a new state to "idle" would be the exact lie the status
 * module exists to prevent.
 */
export type FleetStatus =
  | { kind: "needs-you" }
  | { kind: "working" }
  | { kind: "idle" }
  | { kind: "waiting"; secondsLeft: number }
  | { kind: "no-claude" }
  | { kind: "shell"; busy: boolean | null }
  | { kind: "unknown"; why: string };

/**
 * What to press to choose an option — `OptionKey` in tools/fleet/pane.ts, plus
 * an `unrecognised` arm for anything this client does not know how to draw.
 *
 * The client is READ-ONLY: it renders these so a person can read the menu, and
 * it sends nothing. Steering is tools/fleet/steer.ts, and is somebody else's.
 */
export type FleetOptionKey =
  | { via: "digit"; digit: string }
  | { via: "arrows"; key: string; presses: number }
  | { via: "selected" }
  | { via: "unrecognised" };

export type FleetOption = { label: string; key: FleetOptionKey };

/**
 * A question a session is parked on.
 *
 * `options` IS WHAT WAS ON THE SCREEN, WHICH IS NOT ALWAYS ALL OF THEM — a long
 * menu scrolls and a pane capture cannot see past the bottom (pane.ts says so
 * at length). So the panel reads "here are the options" rather than counting
 * them.
 */
export type FleetQuestion = { prompt: string; options: FleetOption[] };

/**
 * What the session recorded about itself when it was created — `SessionMeta`
 * on the node side, restated here for the reason at the top of this file.
 *
 * **`dir` is the only place the full working directory exists.** `row.worktree`
 * is the last segment of it, and several worktrees have names that differ by a
 * word, so on the page the path is what tells two of them apart.
 *
 * `legacy` is a session created before any of this was recorded, and it is a
 * real arm rather than a missing value: there is nothing to show, and saying so
 * beats drawing an empty field. Anything this build does not recognise parses
 * to `legacy` for the same reason a strange status parses to `unknown` — except
 * that here there is nothing to warn about, only nothing to say.
 */
export type SessionMeta = { version: "legacy" } | { version: 1; kind: string | null; repo: string | null; dir: string | null };

/** One session. Flat, because it is rendered and it is JSON. */
export type FleetRow = {
  /** tmux's SESSION handle, `$1643` — the address, and stable across renames. */
  id: string;
  /** tmux's PANE handle, `%2108`. A different thing from `id`; null when unresolved. */
  paneId: string | null;
  name: string;
  title: string | null;
  repo: string | null;
  worktree: string | null;
  startedAt: string;
  status: FleetStatus;
  /** Present only when the session is blocked on a dialog. */
  question: FleetQuestion | null;
  /** What the session recorded about itself. See `SessionMeta`. */
  meta: SessionMeta;
};

/** The whole payload, and enough about it to know whether to believe it. */
export type FleetState = {
  /** ISO, or null when nothing has ever been collected. */
  collectedAt: string | null;
  tookMs: number;
  /** The last refresh failure. The rows beside it may still be good. */
  error: string | null;
  rows: FleetRow[];
  /**
   * Box health. Shape owned by tools/fleet/health.ts, which is being written by
   * somebody else as this lands — so it is `unknown` here on purpose and
   * HealthPanel renders whatever arrives without a schema. `null` means the
   * server had nothing to give, which the panel says out loud rather than
   * drawing an empty page.
   */
  health: unknown;
  /**
   * **How often the server actually collects**, in milliseconds, when it says.
   *
   * Optional because the server does not send it today. It is read here rather
   * than waited for because the alternative — a hardcoded staleness threshold —
   * is what had the masthead crying STALE for most of every cycle: the page
   * gave up after 30s against a collector that runs every 55–60s, deliberately,
   * since one collection costs the box about ten seconds of work. A banner that
   * is on most of the time is a banner nobody reads, which costs this tool the
   * one signal it is built around.
   *
   * `null` when absent, and `Header.freshness` then falls back to the cadence
   * it has watched happen (useFleetState). Whichever it gets, the threshold is
   * derived from it rather than written down beside it.
   */
  refreshMs: number | null;
};

/* ------------------------------------------------------------- parsing -- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * A status off the wire.
 *
 * The default arm is the whole reason this function exists rather than a cast:
 * a `kind` this build has never seen becomes an `unknown` that NAMES ITSELF, so
 * a server that grows an eighth state shows up on the page as a row asking to
 * be looked at instead of as a row that looks calm.
 */
export function parseStatus(v: unknown): FleetStatus {
  if (!isRecord(v)) return { kind: "unknown", why: "the server sent no status for this session" };
  const kind = str(v["kind"]);
  switch (kind) {
    case "needs-you":
    case "working":
    case "idle":
    case "no-claude":
      return { kind };
    case "waiting":
      return { kind: "waiting", secondsLeft: Math.max(0, num(v["secondsLeft"], 0)) };
    case "shell":
      return { kind: "shell", busy: typeof v["busy"] === "boolean" ? v["busy"] : null };
    case "unknown":
      return { kind: "unknown", why: str(v["why"]) ?? "no reason was given" };
    default:
      return {
        kind: "unknown",
        why:
          kind === null
            ? "the server sent a status with no kind"
            : `this page does not know the status ${JSON.stringify(kind)}`,
      };
  }
}

function parseOptionKey(v: unknown): FleetOptionKey {
  if (!isRecord(v)) return { via: "unrecognised" };
  const via = str(v["via"]);
  if (via === "digit") {
    const digit = str(v["digit"]);
    return digit === null ? { via: "unrecognised" } : { via: "digit", digit };
  }
  if (via === "arrows") {
    const key = str(v["key"]);
    return key === null
      ? { via: "unrecognised" }
      : { via: "arrows", key, presses: Math.max(1, Math.round(num(v["presses"], 1))) };
  }
  if (via === "selected") return { via: "selected" };
  return { via: "unrecognised" };
}

/**
 * A question off the wire, or null.
 *
 * Three shapes arrive as "not asking anything" and all three mean it: `null`,
 * an absent field, and pane.ts's own `{ kind: "none" }`. Only `kind: "question"`
 * produces a question, and a question with no prompt is not one — a blank card
 * on the one row Greg opens this page to see would be worse than no card.
 */
export function parseQuestion(v: unknown): FleetQuestion | null {
  if (!isRecord(v)) return null;
  if (v["kind"] !== "question") return null;
  const prompt = str(v["prompt"]);
  if (prompt === null || prompt.trim() === "") return null;
  const rawOptions = Array.isArray(v["options"]) ? v["options"] : [];
  const options: FleetOption[] = [];
  for (const raw of rawOptions) {
    if (!isRecord(raw)) continue;
    const label = str(raw["label"]);
    if (label === null) continue;
    options.push({ label, key: parseOptionKey(raw["key"]) });
  }
  return { prompt, options };
}

/**
 * A session's own record of itself, off the wire.
 *
 * `version` is checked as the number 1 rather than as "not legacy", so a
 * version 2 that renames `dir` parses to `legacy` and the page shows nothing
 * instead of showing a field that has moved. Nothing here is load-bearing
 * enough to be worth a warning: the worst case is a tooltip that does not open.
 */
export function parseMeta(v: unknown): SessionMeta {
  if (!isRecord(v) || v["version"] !== 1) return { version: "legacy" };
  return { version: 1, kind: str(v["kind"]), repo: str(v["repo"]), dir: str(v["dir"]) };
}

/** One row off the wire. Null when it carries no id, since an id is its address. */
export function parseRow(v: unknown): FleetRow | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  if (id === null || id === "") return null;
  return {
    id,
    paneId: str(v["paneId"]),
    name: str(v["name"]) ?? id,
    title: str(v["title"]),
    repo: str(v["repo"]),
    worktree: str(v["worktree"]),
    startedAt: str(v["startedAt"]) ?? "",
    status: parseStatus(v["status"]),
    question: parseQuestion(v["question"]),
    meta: parseMeta(v["meta"]),
  };
}

/**
 * The payload off the wire. **Never throws**, because a page that goes blank on
 * a field it did not expect is a page that has stopped telling you about the
 * fleet — and the fleet is still there.
 *
 * A payload that is not an object at all is the one case worth refusing: it
 * means the address answered with something that is not this API (a proxy error
 * page, an HTML 404), and rendering "0 sessions" over that would be a lie with
 * a green tick on it. The caller turns the null into an error banner.
 */
export function parseFleetState(raw: unknown): FleetState | null {
  if (!isRecord(raw)) return null;
  const rows: FleetRow[] = [];
  if (Array.isArray(raw["rows"])) {
    for (const item of raw["rows"]) {
      const row = parseRow(item);
      if (row !== null) rows.push(row);
    }
  }
  return {
    collectedAt: str(raw["collectedAt"]),
    tookMs: num(raw["tookMs"], 0),
    error: str(raw["error"]),
    rows,
    health: raw["health"] ?? null,
    /* `null` rather than a default: "the server did not say" and "the server
       says 60s" are different facts, and only the first should let the observed
       cadence win. */
    refreshMs: typeof raw["refreshMs"] === "number" && Number.isFinite(raw["refreshMs"]) && raw["refreshMs"] > 0
      ? raw["refreshMs"]
      : null,
  };
}
