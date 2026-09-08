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
import type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionFeed,
  AttentionItem,
  AttentionKind,
  AttentionList,
  Pause,
  PauseUnknownCause,
} from "../../wire.js";

export type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionFeed,
  AttentionItem,
  AttentionKind,
  AttentionList,
  Pause,
  PauseUnknownCause,
};

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
  /**
   * **The attention inbox** — what the Overseer says needs Greg, or the reason
   * there is no such list.
   *
   * Never null and never absent, because every one of the five things it can
   * say is worth saying and two of them are about us rather than about the box.
   * See `parseAttention`, and `AttentionFeed` in wire.ts.
   */
  attention: AttentionView;
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

  if (kind === "background-work") {
    const sinceMs = v["sinceMs"];
    if (typeof sinceMs !== "number" || !Number.isFinite(sinceMs) || sinceMs < 0) {
      return unreadable("the server said this session is in a shell call but did not say for how long");
    }
    return { kind: "background-work", sinceMs };
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
  "rate-limits-unreadable",
  "schedule-not-parseable",
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

/* ------------------------------------------------- the attention inbox -- */

/**
 * A timestamp spelled the one way this fleet spells one.
 *
 * The same check `isIsoTimestamp` makes in tools/overseer/store.ts, and
 * deliberately as strict: every timestamp in the inbox was written by
 * `toISOString()` and was refused by that function on the way into the
 * checkpoint, so anything else arriving here did not come from the producer. A
 * lenient version would accept a string `Date.parse` can read and the age
 * arithmetic cannot reason about, which is how a duration on screen becomes
 * confidently wrong rather than absent.
 */
function iso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) || at.toISOString() !== v ? null : v;
}

/** A count. Integer and non-negative: `sessionsScanned: 2.5` is not a number of sessions. */
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * A string with something in it. **`""` is not a value, it is a hole.**
 *
 * `str` above is right for the session rows, where a blank field is a field the
 * card simply does not draw. It is wrong for the inbox, where every string is
 * the thing a person reads off a card and acts on:
 * `{kind: "dialog", question: "", options: []}` passes a `typeof` check and
 * arrives under the mechanical, observed heading with nothing in it — the exact
 * crossing `AttentionEvidence` in wire.ts says must not happen. Whitespace is
 * blank too, because on screen it is. GPT Sol's C4, 2026-09-08; the server's
 * copy is `nonBlank` in tools/fleet/attention.ts.
 */
function nonBlank(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

const ATTENTION_KINDS: readonly AttentionKind[] = ["irreversible", "product", "technical", "other"];

/**
 * **THE FIFTH STATE, and it belongs to this side of the wire only.**
 *
 * `AttentionFeed`'s four arms are all facts about the BOX: a list was
 * published, no checkpoint was there, one was and could not be read, or this
 * server did not look. `feed-unreadable` is a fact about the PAYLOAD — the
 * server sent something under `attention` and this build cannot make sense of
 * it — so it has no business on the shared type, and it is not `not-asked`.
 *
 * The distinction is exactly the one this whole panel exists to keep. **Absent
 * means the server did not look**, which is what a build older than the field
 * sends and which draws nothing. **Present-but-wrong means somebody looked and
 * we cannot read the answer**, which is worth a line: it is a page and a server
 * that have come apart, and every session on the list below may be waiting with
 * nothing watching. Collapsing the second into the first would say *nobody
 * asked* about a server that did.
 */
export type AttentionView = AttentionFeed | { kind: "feed-unreadable"; why: string };

/**
 * **THE INBOX OFF THE WIRE**, derived rather than adopted.
 *
 * **This is the THIRD parser for this shape, and each one crosses a boundary
 * the last one did not.** `parseAttentionList` in tools/overseer/store.ts reads
 * the checkpoint the Overseer wrote; `tools/fleet/attention.ts` reads that same
 * file as a FILE, because the file is the contract and importing the Overseer's
 * parser would close a cycle between the two tools (overseer-direction.md says
 * so, and attention.ts's header has the rest). Between that one and this one sit
 * `JSON.stringify`, HTTP, and a browser tab that iOS may have kept alive across
 * a deploy. **A page must be able to read a payload from a server it is not the
 * same age as**, and the only way to know it can is to check.
 *
 * Three parsers is a cost, and it buys three independent compatibility
 * policies — which is the point rather than the price. This one refuses things
 * the reader accepts (a `kind` from a newer server) and the reader refuses
 * things the store accepts (a checkpoint whose schema it does not know).
 *
 * The DECISIONS below are the same as the other two make, deliberately:
 *
 *  - **A malformed list degrades to `unknown`; it does not empty.** Absent,
 *    malformed and *nothing needs you* are three different facts and only the
 *    third is a claim. The `unknown` arm carries the reason, and the panel draws
 *    it as "no list" rather than as a calm fleet.
 *  - **The first bad item degrades the whole list.** Not "drop it and count",
 *    which is what `rows` gets — a session list of 38 out of 41 is still a list
 *    of what is running, whereas an inbox of 4 out of 5 says *these are the ones
 *    that need you* and is then wrong about the fifth. A short inbox is a
 *    negative claim about everything not in it.
 *  - **Every field and every arm, never a cast.** GPT Sol found four ways past
 *    the first version of the store's parser, and the expensive one was a
 *    `dialog` with no question and no options crossing the evidence boundary —
 *    arriving at a renderer as something observed and enumerable. That boundary
 *    is the whole design, and this is the side of it that draws the pixels.
 *
 * **ABSENT IS `not-asked`; PRESENT-BUT-WRONG IS `feed-unreadable`.** The field
 * was added without a schema bump (state.ts's rule), so a server that predates
 * it sends no `attention` at all, and reading that silence as *we looked and
 * there was no checkpoint* would be a positive claim nobody made — the same
 * ambiguous-negative mistake `parsePause` refuses above and `readAttemptClock`
 * exists to unpick. But a field that IS there and will not parse is not silence
 * either, and calling it `not-asked` would say *nobody asked* about a server
 * that did. See `AttentionView`.
 */
export function parseAttention(raw: unknown): AttentionView {
  /* Absent, and only absent. `null` is something a server chose to send. */
  if (raw === undefined) return { kind: "not-asked" };
  const unreadable = (why: string): AttentionView => ({ kind: "feed-unreadable", why });
  if (!isRecord(raw)) return unreadable("the server sent an inbox that is not an object");
  switch (str(raw["kind"])) {
    case "not-asked":
      return { kind: "not-asked" };
    case "checkpoint-absent":
      return { kind: "checkpoint-absent" };
    case "checkpoint-unreadable":
      return { kind: "checkpoint-unreadable", why: str(raw["why"]) ?? "the server gave no reason" };
    case "published": {
      /* The checkpoint's own clock, and a degraded list falls back to it for a
         `scannedAt`. Without it there is no honest timestamp to build the arm
         around, and inventing one is the mistake `fleetState` refuses to make
         about `collectedAt`. */
      const writtenAt = iso(raw["coordinatorWrittenAt"]);
      if (writtenAt === null) return unreadable("the server published an inbox with no readable clock on it");
      return {
        kind: "published",
        list: parseAttentionList(raw["list"], writtenAt),
        coordinatorWrittenAt: writtenAt,
      };
    }
    default:
      return unreadable(
        `this page does not know the inbox ${JSON.stringify(str(raw["kind"]) ?? raw["kind"] ?? null)}`,
      );
  }
}

/** The list itself. Never an empty `list` on failure — see `parseAttention`. */
function parseAttentionList(raw: unknown, writtenAt: string): AttentionList {
  const bad = (why: string): AttentionList => ({
    kind: "unknown",
    why: `the published list was unusable: ${why}`,
    scannedAt: writtenAt,
  });
  if (!isRecord(raw)) return bad("it is not an object");
  const scannedAt = iso(raw["scannedAt"]);
  if (scannedAt === null) return bad("scannedAt is not a timestamp this page can read");
  if (raw["kind"] === "unknown") {
    /* `nonBlank` rather than `str`: the `why` is the whole of what this arm
       draws — "no ranked list: {why}" — so a blank one renders a sentence that
       stops at its colon. The server refuses it too; this is the boundary
       parse, and it does not get to assume the server is this build. */
    const why = nonBlank(raw["why"]);
    return why === null ? bad("an unknown list with no reason") : { kind: "unknown", why, scannedAt };
  }
  if (raw["kind"] !== "list") {
    return bad(`kind ${JSON.stringify(raw["kind"])} is neither "list" nor "unknown"`);
  }
  const sessionsScanned = count(raw["sessionsScanned"]);
  if (sessionsScanned === null) return bad("sessionsScanned is not a count");
  /* **A MISSING `sessionsUnreadable` IS NOT A ZERO**, and the same refusal lives
     in tools/fleet/attention.ts. Zero is the strongest claim the field can make
     — that every judgement the pass attempted succeeded — and a producer that
     never had the field made no claim at all. The whole point of it is that an
     incomplete observation may not be read as a negative one, which is the
     mistake it would be repeating. Self-clearing: the pass runs every two
     minutes and the next list carries it. */
  const sessionsUnreadable = count(raw["sessionsUnreadable"]);
  if (sessionsUnreadable === null) {
    return {
      kind: "unknown",
      why:
        "the published list predates the field that says how much of the fleet could not be judged, " +
        "so its completeness cannot be established",
      scannedAt,
    };
  }
  /* **MORE FAILURES THAN ATTEMPTS IS CORRUPTION, NOT A READING.**
     `sessionsUnreadable` counts sessions the pass TRIED to judge and could not,
     so it is a subset of `sessionsScanned` and a producer reporting otherwise is
     not reporting. Refused rather than clamped: AttentionPanel subtracts one
     from the other to say how many WERE judged, and a negative there would be
     printed on the page. The same check is in tools/fleet/attention.ts, and
     both are needed — this page may be reading a server older than itself.
     GPT Sol's C1, 2026-09-08. */
  if (sessionsUnreadable > sessionsScanned) {
    return bad(
      `it says ${sessionsUnreadable} of ${sessionsScanned} sessions could not be judged, which is more than it scanned`,
    );
  }
  const rawItems = raw["items"];
  if (!Array.isArray(rawItems)) return bad("items is not an array");
  const items: AttentionItem[] = [];
  for (const rawItem of rawItems) {
    const item = parseAttentionItem(rawItem);
    if (item === null) return bad("an item is not one this page can read");
    items.push(item);
  }
  /* IN THE ORDER IT ARRIVED. The producer sorts — by consequence, then by how
     long it has waited — and nothing on this side may re-sort, or the two halves
     disagree about what is at the top. Agreed with `w2-attention-inbox`;
     AttentionPanel.tsx holds the other end of it. */
  return { kind: "list", items, sessionsScanned, sessionsUnreadable, scannedAt };
}

/** Every field, every arm. `null` on the first mismatch — the list then degrades whole. */
function parseAttentionItem(raw: unknown): AttentionItem | null {
  if (!isRecord(raw)) return null;
  const id = nonBlank(raw["id"]);
  const sessionId = nonBlank(raw["sessionId"]);
  const sessionName = nonBlank(raw["sessionName"]);
  if (id === null || sessionId === null || sessionName === null) return null;
  const waitingSince = iso(raw["waitingSince"]);
  if (waitingSince === null) return null;
  const kind = ATTENTION_KINDS.find((k) => k === raw["kind"]);
  if (kind === undefined) return null;
  const evidence = parseAttentionEvidence(raw["evidence"]);
  if (evidence === null) return null;
  const answerability = parseAnswerability(raw["answerability"]);
  if (answerability === null) return null;
  const rawDuplicates = raw["duplicates"];
  if (!Array.isArray(rawDuplicates)) return null;
  const duplicates: { sessionId: string; sessionName: string; waitingSince: string }[] = [];
  for (const d of rawDuplicates) {
    if (!isRecord(d)) return null;
    const dupId = nonBlank(d["sessionId"]);
    const dupName = nonBlank(d["sessionName"]);
    const dupSince = iso(d["waitingSince"]);
    if (dupId === null || dupName === null || dupSince === null) return null;
    duplicates.push({ sessionId: dupId, sessionName: dupName, waitingSince: dupSince });
  }
  return { id, sessionId, sessionName, waitingSince, kind, evidence, answerability, duplicates };
}

/**
 * The evidence union, both arms in full.
 *
 * **This is the boundary the whole inbox is built to hold.** `dialog` means the
 * harness says a dialog is open and here are its options — mechanical, observed,
 * enumerable. `prose` means we INFERRED from the tail of a turn that somebody is
 * being asked something, and it may be wrong: the producer's own `readTurnTail`
 * bug quoted Greg's last message back as an agent's question. A `dialog` with no
 * question and no options must not cross into the renderer wearing the first
 * arm's authority, so it is refused here rather than half-drawn there.
 */
function parseAttentionEvidence(raw: unknown): AttentionEvidence | null {
  if (!isRecord(raw)) return null;
  if (raw["kind"] === "dialog") {
    /* **NON-BLANK, not merely a string.** An option labelled `""` is a button
       with no words on it and a question of `""` is a heading with nothing
       under it, both drawn as something the harness SAW and enumerated. See
       `nonBlank`. */
    const question = nonBlank(raw["question"]);
    const options = raw["options"];
    if (question === null || !Array.isArray(options)) return null;
    if (!options.every((o) => nonBlank(o) !== null)) return null;
    return { kind: "dialog", question, options: options as string[] };
  }
  if (raw["kind"] === "prose") {
    const excerpt = nonBlank(raw["excerpt"]);
    const why = nonBlank(raw["why"]);
    if (excerpt === null || why === null) return null;
    return { kind: "prose", excerpt, why };
  }
  return null;
}

/**
 * Whether answering from a phone is a real option.
 *
 * A copy of `parseAnswerability` in tools/overseer/attention-memory.ts rather
 * than an import of it: that module reaches `node:fs`, and this is a runtime
 * parse at the browser's end of the wire, so there is nothing to import
 * type-only. The rule is the one at the top of this file — the client restates
 * the contract it renders — and the shape both sides validate against is the one
 * in wire.ts, which both of them do import.
 */
function parseAnswerability(raw: unknown): AttentionAnswerability | null {
  if (!isRecord(raw)) return null;
  if (raw["kind"] === "phone") return { kind: "phone" };
  /* Both arms that carry a `why` carry nothing else, so a blank one draws an
     empty explanation on a card — worse for a reader than the arm being absent.
     `nonBlank` rather than `str`, matching the server. */
  const why = nonBlank(raw["why"]);
  if (why === null) return null;
  if (raw["kind"] === "needs-a-screen") return { kind: "needs-a-screen", why };
  if (raw["kind"] === "unknown") return { kind: "unknown", why };
  return null;
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
      /* **THE JOIN THIS STAGE EXISTS TO MAKE.** A producer with no consumer is
         the class of bug this page kept shipping, so the field is read here and
         one test walks a checkpoint on disk all the way to text in the DOM.
         Never throws and never fails the payload over a bad inbox: a page that
         went blank on it would have stopped saying what is running on the box,
         which is the more important half. */
      attention: parseAttention(raw["attention"]),
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
