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
 * TWO FIELDS ARE KEPT UNPARSED ON PURPOSE — `rawStatus` and `rawQuestion`.
 * They are the server's own objects, held byte-for-byte so that a steering
 * request can hand them straight back. See their comments on `FleetRow`; it is
 * the one rule in this client that is not negotiable.
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
import type { Pause, PauseUnknownCause } from "../../wire.js";

export type { Pause, PauseUnknownCause };

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
 * **This parse is for RENDERING ONLY.** The client can now answer a dialog, and
 * when it does it sends `rawQuestion` — the server's own object — rather than
 * anything rebuilt from this. An `unrecognised` arm here is therefore a
 * keystroke this build cannot describe, NOT one that cannot be answered: the
 * server may well know it. Nothing on the page may disable a button on the
 * strength of this union.
 */
export type FleetOptionKey =
  | { via: "digit"; digit: string }
  | { via: "arrows"; key: string; presses: number }
  | { via: "selected" }
  | { via: "unrecognised" };

/**
 * How far an option reaches — `OptionConsequence` in tools/fleet/pane.ts.
 *
 * **`unknown` is not the mild one, and rendering it as if it were inverts the
 * guarantee.** It means the label said nothing this build recognises, and the
 * parser is deliberately written to be wrong in one direction only: nothing
 * falls through to `once`. So a new Claude Code label — "Yes, and remember
 * this" — arrives here as `unknown`, and a page that drew `persistent` in red
 * and `unknown` in neutral grey would make the conservative default the
 * least alarming badge on screen. `consequenceRank` in view.ts is where that is
 * enforced rather than remembered, and a test holds it.
 */
export type FleetConsequence = "once" | "persistent" | "decline" | "unknown";

export type FleetOption = { label: string; key: FleetOptionKey; consequence: FleetConsequence };

/**
 * **WHAT IS ACTUALLY BEING APPROVED** — the diff, the command, the path — as
 * opposed to the sentence that asks about it. `PaneMaterial` in
 * tools/fleet/pane.ts.
 *
 * Three arms and not a nullable string, because the page does something
 * different with each. `read` has a body to show. `no-material` is a positive
 * claim that this dialog proposes nothing — a `/loop` menu, where the options
 * are the whole question — and is safe to draw with no body. `unreadable` is
 * *there is a dialog here and we could not see what it is about*, which must
 * make this page REFUSE rather than draw a confident empty box.
 *
 * Collapse the last two into `null` and they are the same pixels, which is
 * exactly how somebody approves a write they never saw.
 */
export type FleetMaterial =
  | { kind: "read"; text: string; fingerprint: string }
  | { kind: "no-material" }
  | { kind: "unreadable"; why: string };

/**
 * A question a session is parked on.
 *
 * `options` IS WHAT WAS ON THE SCREEN, WHICH IS NOT ALWAYS ALL OF THEM — a long
 * menu scrolls and a pane capture cannot see past the bottom (pane.ts says so
 * at length). So the panel reads "here are the options" rather than counting
 * them.
 *
 * **`prompt` is the headline and `material` is the evidence.** The prompt is
 * one sentence and is the right thing to put in a list of blocked sessions; it
 * is not enough to decide on. Anything that offers a way to ANSWER must show
 * the material beside it, or it is asking a person to approve something they
 * cannot see.
 */
/**
 * **What answering this dialog would DO**, which is what decides whether the
 * page offers it as a button at all.
 *
 * Fable's line, and the server enforces it independently on a fresh capture:
 * pane text as executable UI is acceptable when execution means *a user turn*,
 * and not acceptable when it means *grant a permission*. So an agent's own
 * `AskUserQuestion` is tappable and a tool-permission prompt is not.
 *
 * `unknown` covers three different situations and treats them identically,
 * which is the point: the server said "I could not tell", the server is older
 * than this field and said nothing at all, or this build does not recognise the
 * arm it sent. All three mean **do not offer the buttons** — a client that read
 * an absent `gate` as permissive would offer taps that the server refuses, on
 * exactly the dialogs where being refused matters.
 */
export type FleetGate = { kind: "permission" | "unknown"; why: string } | { kind: "conversation" };

export type FleetQuestion = { prompt: string; options: FleetOption[]; material: FleetMaterial; gate: FleetGate };

/**
 * **WHICH PERMISSION MODE THE SESSION LAUNCHED IN** — `PaneAutoMode` in
 * tools/fleet/pane.ts, restated for the reason at the top of this file.
 *
 * A session that came up in default rather than auto mode stops at the first
 * command it cannot approve — `git fetch`, `git log`, an MCP read, i.e. within
 * the first minute of almost any brief written here — and waits for somebody
 * who is asleep. **34.9 agent-hours since 2026-09-06, 20% of launches, longest
 * single stall 7.38 hours.** Nothing else on this box notices: `gjd-remote log`
 * lists it as `running`.
 *
 * **THE FOUR ARMS ARE FOUR DIFFERENT PIXELS AND COLLAPSING ANY TWO IS THE
 * BUG.** `not-auto` is something to go and fix now. `not-applicable` is a
 * shell, which has no permission mode and must never wear a warning.
 * `cannot-tell` is neither — it must not read as "fine", which would hide the
 * defect, and it must not read as "broken", which on twenty rows teaches the
 * reader to ignore the badge and costs more than the defect does.
 */
export type FleetPermissionMode =
  | { kind: "auto" }
  | { kind: "not-auto"; mode: string }
  | { kind: "cannot-tell"; why: string }
  | { kind: "not-applicable"; why: string };

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
  /** Present only when the session is blocked on a dialog. FOR RENDERING. */
  question: FleetQuestion | null;
  /** Which permission mode it launched in. See `FleetPermissionMode`. */
  permissionMode: FleetPermissionMode;
  /**
   * Why this session is not doing anything — *beside* the status, not instead
   * of it. A cron-parked session and a rate-limited one are both genuinely
   * `idle`; see `Pause` in `wire.ts` for why this is an added fact rather than
   * an eighth `FleetStatus` arm.
   */
  pause: Pause;
  /** What the session recorded about itself. See `SessionMeta`. */
  meta: SessionMeta;
  /**
   * The pane's own pid, when tmux told us — `#{pane_pid}`.
   *
   * Not an address: it is the thing that CHANGES when a pane is respawned under
   * the same handle, which is the one way a pane's contents change identity
   * without its `%…` changing. `steer.ts` compares it before typing. Null
   * degrades to "no respawn check" rather than making the row unsteerable, so
   * it is sent as-is and never invented.
   */
  panePid: number | null;
  /**
   * The CONVERSATION's uuid — Claude's own `--session-id`, not tmux's `$1643`.
   *
   * The only one of the three identifiers that survives a `gjd-remote resume`,
   * so it is what distinguishes this agent from the one that replaced it in the
   * same pane. Null for a shell, and for a legacy session that never pinned
   * one — and a null is what makes the steer route refuse rather than guess, so
   * a null here means the row cannot be steered at all.
   */
  claudeSessionId: string | null;
  /**
   * **THE SERVER'S OWN `status` OBJECT, UNTOUCHED**, to be handed back verbatim
   * on a steering request. `status` above is the parse, and it is for drawing.
   *
   * Two different jobs, and collapsing them loses one of them. `parseStatus`
   * rounds an arm this build has never heard of onto `unknown`, which is right
   * on the page and wrong on the wire: declaring `unknown` about a row the
   * server called something else is a claim the person never made, and the
   * route's whole safety model is that these claims are the person's. Sending
   * the original lets a newer server decide, and lets it answer 400 when the
   * shape really is wrong — which is the honest outcome, not a silent one.
   */
  rawStatus: unknown;
  /**
   * **THE SERVER'S OWN `question` OBJECT, UNTOUCHED**, for the same reason and
   * more urgently.
   *
   * `POST /api/steer/answer` checks this against what the pane is showing
   * *right now*; it is a stale-but-honest claim, and it is the guard. A client
   * that rebuilt it from `question` above would silently drop any field the
   * server adds later — and the server is about to add one describing what is
   * actually being approved, since an approval today binds only to the question
   * sentence and can be accepted for different material than was displayed.
   * Rebuild it and that fix lands and does nothing.
   *
   * `unknown` rather than a type, deliberately: there is nothing here to read.
   * Read `question` to render, and pass this along.
   */
  rawQuestion: unknown;
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
  /**
   * **How many rows in the payload could not be read**, which is a fact about
   * the fleet and not a tidiness note.
   *
   * A row that fails to parse is dropped from `rows` — there is nothing else to
   * do with it — and dropping it silently would shorten authoritative state
   * without saying so. The row most likely to be malformed is a blocked one
   * carrying a question scraped off a terminal, which is precisely the row the
   * page is opened to see. So the count is carried and the panel says *3 of 41
   * sessions could not be read* rather than showing 38 and looking complete.
   */
  unreadableRows: number;
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
/**
 * How far an option reaches, off the wire.
 *
 * **Everything unrecognised is `unknown`, including an absent field**, and that
 * is the conservative direction: `unknown` renders at least as loudly as
 * `persistent`. Defaulting a missing `consequence` to `once` would be the whole
 * failure in one line — an old server, or a field that gets renamed, and every
 * option on the page silently becomes "this time only".
 */
export function parseConsequence(v: unknown): FleetConsequence {
  const value = str(v);
  return value === "once" || value === "persistent" || value === "decline" ? value : "unknown";
}

/**
 * The material, off the wire.
 *
 * An absent or unrecognised `material` is `unreadable`, NOT `no-material`. The
 * two are one line apart and mean opposite things: one says *this dialog
 * proposes nothing*, the other says *we could not see what it proposes*. An old
 * server that sends no material at all must produce the second, or a page that
 * shows an empty box would be claiming the first on its behalf.
 */
export function parseMaterial(v: unknown): FleetMaterial {
  if (!isRecord(v)) {
    return { kind: "unreadable", why: "the server sent nothing about what this dialog is asking you to approve" };
  }
  const kind = str(v["kind"]);
  if (kind === "no-material") return { kind: "no-material" };
  if (kind === "read") {
    const text = str(v["text"]);
    const fingerprint = str(v["fingerprint"]);
    if (text === null || fingerprint === null) {
      return { kind: "unreadable", why: "the material came back without its text or its fingerprint" };
    }
    return { kind: "read", text, fingerprint };
  }
  if (kind === "unreadable") {
    return { kind: "unreadable", why: str(v["why"]) ?? "no reason was given" };
  }
  return { kind: "unreadable", why: `this page does not know the material kind ${JSON.stringify(kind)}` };
}

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
    options.push({ label, key: parseOptionKey(raw["key"]), consequence: parseConsequence(raw["consequence"]) });
  }
  return { prompt, options, material: parseMaterial(v["material"]), gate: parseGate(v["gate"]) };
}

/**
 * The gate, off the wire, failing towards "do not offer it".
 *
 * `conversation` is the ONLY input that produces `conversation`, and everything
 * else — absent, unrecognised, malformed — becomes `unknown`, which the page
 * treats exactly as `permission`. That asymmetry is deliberate and mirrors the
 * server's: `classifyGate` reaches `conversation` only by positive evidence.
 *
 * An old server that has never heard of `gate` therefore renders as "I could
 * not tell", and the page explains rather than offering a button. That is also
 * the truthful answer for such a server, since answering is switched off on it.
 */
export function parseGate(v: unknown): FleetGate {
  if (!isRecord(v)) {
    return { kind: "unknown", why: "this server did not say what answering this dialog would do" };
  }
  const kind = v["kind"];
  if (kind === "conversation") return { kind: "conversation" };
  const why = str(v["why"]) ?? "no reason was given";
  if (kind === "permission") return { kind: "permission", why };
  if (kind === "unknown") return { kind: "unknown", why };
  return { kind: "unknown", why: `this page does not know the gate kind ${JSON.stringify(kind)}` };
}

/**
 * Which permission mode the session launched in, off the wire, **failing
 * towards `cannot-tell`**.
 *
 * The safe arm here is not the same as the safe arm anywhere else in this file,
 * so it is worth naming which failure it is chosen against. `not-auto` is the
 * loud arm: it says *go and fix this session now*. A server too old to send the
 * field would, if that parsed as `not-auto`, light up **every row on the page
 * at once** on the first deploy where the client is ahead of the server — and a
 * badge that has cried wolf on forty sessions is worth nothing on the day it is
 * right. That is the specific accident this direction prevents.
 *
 * It is not `auto` either, for the mirror reason: an absent field must not
 * clear a session this build has heard nothing about. `cannot-tell` is the only
 * answer that is true, and the page draws it as neither.
 *
 * `not-auto` WITHOUT A MODE NAME IS STILL `not-auto`. The defect is the fact,
 * not the label, so a missing name gets a generic one rather than downgrading
 * the arm — dropping to `cannot-tell` over a cosmetic field would be losing the
 * finding to tidiness.
 */
export function parsePermissionMode(v: unknown): FleetPermissionMode {
  if (!isRecord(v)) {
    return { kind: "cannot-tell", why: "this server did not say which permission mode this session is in" };
  }
  const kind = str(v["kind"]);
  if (kind === "auto") return { kind: "auto" };
  if (kind === "not-auto") return { kind: "not-auto", mode: str(v["mode"]) ?? "a mode that is not auto" };
  const why = str(v["why"]) ?? "no reason was given";
  if (kind === "cannot-tell") return { kind: "cannot-tell", why };
  if (kind === "not-applicable") return { kind: "not-applicable", why };
  return {
    kind: "cannot-tell",
    why:
      kind === null
        ? "the server sent a permission mode with no kind"
        : `this page does not know the permission mode ${JSON.stringify(kind)}`,
  };
}

/**
 * Why a session is paused, off the wire.
 *
 * **AN ABSENT FIELD IS `cannot-tell`, NEVER `none`**, and that is the whole
 * reason this function exists rather than a cast. A server too old to send
 * `pause` has made no claim about whether anything is waiting; rendering that
 * as *not waiting for anything* would be the most reassuring possible lie, and
 * it is the exact shape of instance 16 in
 * docs/postmortems/260908b — a consumer inventing a value the producer never
 * offered. `none` is a positive statement that every source was consulted, and
 * only the server is in a position to make it.
 *
 * Every arm is checked field by field for the same reason `parsePermissionMode`
 * is: a `rate-limited` with no `resetsAt` is not a rate limit we can act on, it
 * is a shape this page does not understand, and saying so beats drawing a
 * badge over a missing time.
 */
export function parsePause(v: unknown): Pause {
  if (v === undefined || v === null) {
    return {
      kind: "cannot-tell",
      why: "this server did not say whether this session is waiting for anything",
      cause: "rate-limits-not-collected",
    };
  }
  if (!isRecord(v)) {
    return { kind: "cannot-tell", why: "the server sent a pause that is not an object", cause: "rate-limits-not-collected" };
  }
  const kind = str(v["kind"]);
  const unreadable = (why: string): Pause => ({ kind: "cannot-tell", why, cause: "rate-limits-not-collected" });

  if (kind === "none") return { kind: "none" };

  if (kind === "rate-limited") {
    const window = str(v["window"]);
    const resetsAt = str(v["resetsAt"]);
    if (window === null || resetsAt === null) {
      return unreadable("the server said this session is rate limited but did not say which window or when it resets");
    }
    /* `overdue` is only ever the server's. It may be set only when the reset
       time was actually read, and this page has no way to check that — so a
       missing or non-boolean value is false rather than computed here. */
    return { kind: "rate-limited", window, resetsAt, overdue: v["overdue"] === true };
  }

  if (kind === "scheduled-wakeup") {
    const at = str(v["at"]);
    if (at === null) {
      return unreadable("the server said this session has a wake-up scheduled but did not say when");
    }
    return { kind: "scheduled-wakeup", at, overdue: v["overdue"] === true, source: "cron" };
  }

  if (kind === "in-a-shell-call") {
    const sinceMs = v["sinceMs"];
    if (typeof sinceMs !== "number" || !Number.isFinite(sinceMs) || sinceMs < 0) {
      return unreadable("the server said this session is in a shell call but did not say for how long");
    }
    return { kind: "in-a-shell-call", sinceMs };
  }

  if (kind === "cannot-tell") {
    return {
      kind: "cannot-tell",
      why: str(v["why"]) ?? "no reason was given",
      cause: parsePauseCause(v["cause"]),
    };
  }

  return unreadable(
    kind === null
      ? "the server sent a pause with no kind"
      : `this page does not know the pause ${JSON.stringify(kind)}`,
  );
}

/**
 * The named cause, or the one that says we were never told.
 *
 * A cause this build has not heard of falls back rather than throwing: the
 * `why` beside it is the server's own sentence and is what a person reads, so
 * an unfamiliar name costs nothing on screen.
 */
const PAUSE_CAUSES: readonly PauseUnknownCause[] = [
  "tail-window-exhausted",
  "no-transcript",
  "transcript-unreadable",
  "no-conversation-id",
  "session-store-unreadable",
  "rate-limits-not-collected",
];

function parsePauseCause(v: unknown): PauseUnknownCause {
  const found = PAUSE_CAUSES.find((c) => c === v);
  return found ?? "rate-limits-not-collected";
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
    permissionMode: parsePermissionMode(v["permissionMode"]),
    pause: parsePause(v["pause"]),
    meta: parseMeta(v["meta"]),
    panePid:
      typeof v["panePid"] === "number" && Number.isSafeInteger(v["panePid"]) && v["panePid"] > 0
        ? v["panePid"]
        : null,
    claudeSessionId: str(v["claudeSessionId"]),
    /* NOT `parseStatus(...)` and NOT a clone. The reference the server sent,
       kept so it can be serialised back exactly as it arrived. */
    rawStatus: v["status"] ?? null,
    rawQuestion: v["question"] ?? null,
  };
}

/**
 * Whether the payload could be read, and what to say if it could not.
 *
 * A result rather than a nullable state, because "this is not the fleet API" is
 * something the page has to SAY. The three refusals below each name themselves,
 * so a banner reads *the payload says schema 2 and this build reads schema 1*
 * rather than a shrug.
 */
export type FleetStateRead = { ok: true; state: FleetState } | { ok: false; why: string };

/** The schema this build knows how to read. See `FleetState` on the node side. */
export const SCHEMA = 1;

/**
 * The payload off the wire. **Never throws**, because a page that goes blank on
 * a field it did not expect is a page that has stopped telling you about the
 * fleet — and the fleet is still there.
 *
 * **THREE THINGS ARE REFUSED OUTRIGHT, AND EACH OF THEM USED TO RENDER AS A
 * QUIET BOX.** Found by GPT Sol, 2026-09-08 (F15), against a version of this
 * function that accepted `{}`:
 *
 *  - **Not an object at all.** The address answered with something that is not
 *    this API — a proxy error page, an HTML 404 — and rendering "0 sessions"
 *    over that would be a lie with a green tick on it.
 *  - **A `schema` that is not this one.** A payload whose meaning has changed
 *    must not be read by a build that has not changed with it. Absent counts:
 *    the server sends it on every payload, so its absence means this is not the
 *    payload. **Adding a FIELD is not a schema bump** (the node side says so),
 *    which is why an unknown field is ignored while an unknown schema is fatal.
 *  - **`rows` missing or not an array.** "The server did not send a list of
 *    sessions" and "the server sent an empty list of sessions" are opposite
 *    claims, and only the second one is news about the box.
 *
 * A row that fails to parse is counted rather than merely dropped — see
 * `unreadableRows`.
 */
export function parseFleetState(raw: unknown): FleetStateRead {
  if (!isRecord(raw)) return { ok: false, why: "the server answered something that is not the fleet API" };
  if (raw["schema"] !== SCHEMA) {
    return {
      ok: false,
      why:
        raw["schema"] === undefined
          ? `the payload has no schema, and this page reads schema ${SCHEMA}`
          : `the payload says schema ${JSON.stringify(raw["schema"])} and this page reads schema ${SCHEMA}`,
    };
  }
  if (!Array.isArray(raw["rows"])) {
    return { ok: false, why: "the payload has no list of sessions in it, which is not the same as having none" };
  }
  const rows: FleetRow[] = [];
  let unreadableRows = 0;
  for (const item of raw["rows"]) {
    const row = parseRow(item);
    if (row === null) unreadableRows += 1;
    else rows.push(row);
  }
  return {
    ok: true,
    state: {
      collectedAt: str(raw["collectedAt"]),
      tookMs: num(raw["tookMs"], 0),
      error: str(raw["error"]),
      rows,
      unreadableRows,
      health: raw["health"] ?? null,
      /* `null` rather than a default: "the server did not say" and "the server
         says 60s" are different facts, and only the first should let the observed
         cadence win. */
      refreshMs:
        typeof raw["refreshMs"] === "number" && Number.isFinite(raw["refreshMs"]) && raw["refreshMs"] > 0
          ? raw["refreshMs"]
          : null,
    },
  };
}
