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
import { readAttemptClock, type AttemptClock } from "../../attempt-clock.js";
import { overseerClaim, parseRole, type SessionRole } from "../../overseer-claim.js";
import { absenceGapReason } from "../../usage-absence.js";
import type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionFeed,
  AttentionItem,
  AttentionKind,
  AttentionList,
  FleetState as FleetStateWire,
  OverseerHeartbeat,
  OverseerRegister,
  OverseerScheduler,
  OverseerSessionHistory,
  OverseerStatus,
  OverseerStatusFeed,
  Pause,
  PauseUnknownCause,
  ScanCoverage,
  UsageAccount,
  UsageFeed,
  UsageIncident,
  UsageLevel,
  UsageSummary,
  UsageWindowCard,
} from "../../wire.js";

export type { AttemptClock };

export type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionFeed,
  AttentionItem,
  AttentionKind,
  AttentionList,
  OverseerHeartbeat,
  OverseerRegister,
  OverseerScheduler,
  OverseerSessionHistory,
  OverseerStatus,
  OverseerStatusFeed,
  Pause,
  PauseUnknownCause,
  ScanCoverage,
  UsageAccount,
  UsageFeed,
  UsageIncident,
  UsageLevel,
  UsageSummary,
  UsageWindowCard,
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

/**
 * Whether a session is the Overseer — the box's one supervising session
 * (docs/project/overseer.md).
 *
 * **NOT RESTATED HERE.** `tools/fleet/overseer-claim.ts` is a leaf module with
 * no imports, so this project can compile it — the same escape `attempt-clock.ts`
 * takes, and it means the parse and the *who holds it* rule are one
 * implementation rather than a twin the compiler could not relate. Re-exported
 * so that a component reads its types from one place.
 */
export type { OverseerClaim, SessionRole } from "../../overseer-claim.js";
export { overseerClaim, parseRole };

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
  /** Whether this session is the Overseer. See `SessionRole`. */
  role: SessionRole;
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

/**
 * The whole payload, and enough about it to know whether to believe it.
 *
 * **DERIVED FROM THE WIRE TYPE, NOT WRITTEN BESIDE IT** — the same repair
 * `QueueItemView` in actions-client.ts got, for the same reason and against the
 * same measurement. This was a hand-written twin of `FleetState` in
 * `tools/fleet/state.ts` until 2026-09-08, and by then it had silently dropped
 * two fields the server had been sending for a day: `grep -c answeringEnabled`
 * and `grep -c tmuxServerPid` in this file both returned **zero**. Neither end
 * could go red, because each was internally consistent.
 *
 * So every REQUIRED field the server sends is in this type unless it is NAMED
 * in the `Omit<>` below, and `parseFleetState`'s object literal does not compile
 * until each one is either parsed or named. Dropping a field is now a line
 * somebody has to write and a reviewer can see.
 *
 * **"Required" is doing real work in that sentence** and it was missing from it
 * for a day (GPT Sol's M2). An OPTIONAL key on the wire type slips through
 * untouched: this `Omit<>` carries the `?` across with it, the parse's object
 * literal is free to omit it, and the field ships to a browser that never reads
 * it — the exact drop this derivation exists to prevent, through the one door it
 * does not cover. Which is why the wire type may not have one:
 * `tests/fleet-compile-guards.test.ts` refuses an optional top-level key on it,
 * and `npm run typecheck` is the gate. Nothing here has to defend against it,
 * but nobody should believe this paragraph promises more than it does.
 *
 * **This is a derivation and not an adoption, and the difference is the whole
 * design.** Several fields are deliberately WEAKER here than on the wire,
 * because **a server too old to send a field has made no claim** and a parse
 * that invented `false` or `0` for it would be the exact defect this removes.
 * The `Omit<>` list is in two halves, and the comment on each is the decision:
 *
 *  - **re-typed** — parsed into something this page can honestly draw;
 *  - **declined** — read at the boundary and not carried, or not read at all,
 *    with the reason beside it.
 *
 * `Row` is filled with this file's own `FleetRow` and `Health` with `unknown`;
 * wire.ts § `FleetState` says why those two are holes rather than shared
 * declarations, and why sharing `FleetRow` verbatim would be wrong rather than
 * merely impossible.
 *
 * TWO FIELDS ARE KEPT UNPARSED ON PURPOSE — `rawStatus` and `rawQuestion` on
 * the rows. See their comments on `FleetRow`.
 */
export type FleetState = Omit<
  FleetStateWire<FleetRow, unknown>,
  /* Re-typed below, each because this page must be able to say "the server did
     not tell me" without inventing an answer on its behalf. */
  | "answeringEnabled"
  | "refreshMs"
  | "attention"
  /* Re-typed: widened by one arm for the same reason `attention` is — a field
     that is PRESENT and unreadable is a fact about the payload, which the server
     cannot report about itself. See `OverseerView`. */
  | "overseer"
  /* Re-typed: the same widening a third time, and see `parseUsage` for the one
     way this feed differs from the two above it — none of its timestamps is
     shifted onto the browser's clock, because they are rendered as wall-clock
     times in three zones rather than as ages. */
  | "usage"
  /* Re-typed too, and it was DECLINED for a day on reasoning that did not hold.
     The entry here used to say that `readAttemptClock` is a runtime value, so it
     could not live in wire.ts, so both sides could not share one — and therefore
     the client would not read `attemptedAt` at all. The middle step is the wrong
     one: what the browser project cannot tolerate is a NODE dependency, and "no
     runtime values" is wire.ts's own rule about its own file. A leaf module with
     no imports has neither problem, so `attempt-clock.ts` exists and both sides
     import it. GPT Sol's M5. */
  | "attemptedAt"
  /* Declined: READ AT THE BOUNDARY AND NOT CARRIED. `schema` decides whether to
     believe the payload at all (`parseFleetState` refuses anything else), and
     `servedAt` is consumed into `clockSkew` below — carrying either would be a
     second copy of a decision already made. */
  | "schema"
  | "servedAt"
> & {
  rows: FleetRow[];
  /**
   * **How often the server actually collects**, in milliseconds, when it says.
   *
   * `null` when absent, and `Header.freshness` then falls back to the cadence
   * it has watched happen (useFleetState). "The server did not say" and "the
   * server says 60s" are different facts, and only the first should let the
   * observed cadence win — a hardcoded threshold is what had the masthead
   * crying STALE for most of every cycle.
   */
  refreshMs: number | null;
  /**
   * **Whether tapping an option would do anything** — see `AnsweringReading`,
   * which is four arms rather than a boolean and fails CLOSED.
   */
  answeringEnabled: AnsweringReading;
  /**
   * **WHEN A COLLECTION WAS LAST STARTED**, as the three-arm reading rather than
   * the raw string — `readAttemptClock` in tools/fleet/attempt-clock.ts, the one
   * the server and the Overseer daemon also call.
   *
   * `collectedAt` says when data last ARRIVED and cannot tell a stopped
   * collector from a quiet box; this is what separates them. The fault it exists
   * for is a collection that never settles: it throws nothing, so `error` stays
   * null and the masthead says calm while the snapshot goes half an hour stale.
   * `Header.freshness` is the consumer — it says which of the two a STALE
   * snapshot is.
   *
   * Shifted onto this browser's clock like every other server timestamp here.
   * See `ClockSkew`.
   */
  attemptedAt: AttemptClock;
  /**
   * **The attention inbox** — what the Overseer says needs Greg, or the reason
   * there is no such list.
   *
   * Widened from the wire's `AttentionFeed` by one arm: a field that is PRESENT
   * and unreadable is a fact about a payload rather than about the box, so the
   * server cannot report it and this page must. See `AttentionView`.
   */
  attention: AttentionView;
  /**
   * **IS SUPERVISION STILL WORKING?** — the Overseer's two clocks, its
   * heartbeat, its scheduler line and the history it holds, or the reason there
   * is no reading.
   *
   * Widened from the wire's `OverseerStatusFeed` by the same one arm
   * `attention` is: a field that is present and will not parse is a fact about
   * the payload rather than about the box. See `OverseerView`.
   */
  overseer: OverseerView;
  /**
   * **CAN THIS ACCOUNT AFFORD MORE WORK?** — the last usage pass's reading of
   * the logged-in account, or the reason there is nothing to say.
   *
   * Widened by the same one arm as the two above it, and carrying its
   * timestamps UNSHIFTED, which no other field here does — `parseUsage` says
   * why, and `UsageCard` is the one component that applies the skew itself.
   */
  usage: UsageView;
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
   *
   * Not on the wire at all: the server has no unreadable rows, only this
   * parser does.
   */
  unreadableRows: number;
  /**
   * **What was done to every server timestamp above, and whether it could be.**
   *
   * Carried rather than discarded for two reasons. The page says it out loud
   * when it is large (`clockNote` in view.ts), because a phone minutes off is a
   * fact about the reader's device that nothing else will ever tell them — and
   * without that line a corrected page and a broken clock look identical. And
   * `/api/messages` is a second boundary with no clock of its own, so its
   * `lastModified` is corrected with this one (`withClockSkew` in
   * messages-client.ts).
   */
  clockSkew: ClockSkew;
};

/* ------------------------------------------------- can we answer at all -- */

/**
 * **WHETHER `POST /api/steer/answer` WILL DO ANYTHING, AS FOUR ANSWERS.**
 *
 * A boolean-ish read of the raw field is what this was until 2026-09-08, and it
 * FAILED OPEN twice over: an absent field became `null` and `null` still offered
 * the buttons, and a malformed `"yes"` landed in the same `null` and therefore
 * also became permission to offer a control.
 *
 * The argument for offering them on silence was mine and it was wrong. It ran:
 * refusing on an older server's silence would invent a hold nobody declared.
 * GPT Sol's correction is factual and beats it — **the kill switch predates the
 * state field in history**, so a server old enough not to send this is a server
 * that can have answering switched off with no way to say so. Silence is
 * therefore not evidence that answering works; it is the absence of evidence
 * either way, and this is the one control where acting on that costs a person a
 * 503 and the hold its entire purpose.
 *
 * **So only a positive `enabled` offers the buttons.** The other three say that
 * availability could not be established, which is a different sentence from
 * *a hold was declared* — and `not-reported` and `unreadable` stay apart so the
 * page can be accurate about which happened rather than lumping them into one
 * shrug. Same discipline as `parseGate`'s `unknown` and `AttentionFeed`'s
 * `not-asked`: "I could not tell" must never become the way through.
 *
 * **Failing closed costs nothing real here, and that is worth knowing before
 * somebody re-opens it.** `not-reported` is close to unreachable in practice:
 * this server serves the bundle that talks to it, so the two always ship
 * together and a browser reading a payload from a server older than its own code
 * is not a state the deployment produces. The arm exists because the type must
 * be able to say it, not because it is expected.
 */
export type AnsweringReading =
  /** The server said yes. The ONLY arm that offers a control. */
  | { kind: "enabled" }
  /** The server said no. A hold was declared, and the page says so in those words. */
  | { kind: "disabled" }
  /** No such field. A server that predates it — and it may still be switched off. */
  | { kind: "not-reported" }
  /** The field is there and is not a boolean. A payload we cannot read, not a claim. */
  | { kind: "unreadable"; why: string };

/**
 * Read the flag without letting silence or nonsense become a yes.
 *
 * `=== true` / `=== false` rather than truthiness, for the reason the whole
 * union exists. Absence is `undefined` because this is JSON — a key that is not
 * there reads as `undefined` and nothing else does — so an explicit `null`, a
 * `"yes"` and a `0` are all *present and unreadable* rather than *not reported*,
 * which is the honest split: one is a server that never heard of the field, the
 * other is a server whose answer this build cannot interpret.
 */
/**
 * **NOBODY HAS SAID ANYTHING YET**, which is what the page holds before its
 * first payload arrives.
 *
 * A named value for the same reason `CLOCK_SKEW_UNMEASURED` is one, and with the
 * same rule attached: it is not a claim that answering is off, and it must never
 * be the value a real payload rounds to. It is `not-reported` because that is
 * literally what has happened — no server has reported anything — and it
 * withholds the buttons, which before the first payload is free, since there are
 * no rows to open.
 */
export const ANSWERING_NOT_REPORTED: AnsweringReading = { kind: "not-reported" };

export function readAnswering(raw: unknown): AnsweringReading {
  if (!isRecord(raw)) return { kind: "unreadable", why: "the payload is not an object" };
  const value = raw["answeringEnabled"];
  if (value === true) return { kind: "enabled" };
  if (value === false) return { kind: "disabled" };
  if (value === undefined) return { kind: "not-reported" };
  return {
    kind: "unreadable",
    why: `the server sent ${JSON.stringify(value)} where this page reads true or false`,
  };
}

/* --------------------------------------------------------- the clocks -- */

/**
 * **HOW FAR AHEAD OF THIS BROWSER THE SERVER'S CLOCK IS**, or the fact that we
 * cannot say.
 *
 * Greg reads this page on a phone over Tailscale and the phone's clock is not
 * the box's. Every age here was `browserNow − Date.parse(aServerTimestamp)`,
 * which mixes two clocks and lets a fast phone manufacture alarms: a
 * permanently-on STALE banner past ~2m 30s of skew, and *"this may not be this
 * session's conversation"* on every working row past 30 minutes. v0.4j in
 * docs/plans/260907e-agent-fleet-dashboard.md has the table.
 *
 * **THE CORRECTION BELONGS AT THE BOUNDARY, NOT AT THE CLOCK, and subtracting
 * this from `useNow()` would be a bug rather than a shortcut.** `freshness`
 * computes `heardAge = now − receivedAt` from two BROWSER-clock values — an
 * honest measurement of how long since this page heard anything, which needs no
 * correction — and shifting the page's clock would corrupt exactly that by
 * exactly this. So a server timestamp is converted once, where it is parsed,
 * and everything downstream compares in one clock.
 *
 * The `unknown` arm is the same discipline as `AttentionFeed`'s `not-asked` and
 * `Pause`'s `cannot-tell`: a server built before `servedAt` has made no claim
 * about its clock, and **the correction is then zero rather than a guess**. An
 * unknown skew is not a small skew; it is one nobody measured, and the page says
 * so at the type rather than defaulting silently.
 */
export type ClockSkew =
  /** Milliseconds. Positive means the server's clock is ahead of this browser's. */
  | { kind: "known"; ms: number }
  /** The payload carried no readable `servedAt`. Nothing is shifted. */
  | { kind: "unknown"; why: string };

/**
 * **NOTHING HAS BEEN MEASURED YET**, which is what the page holds before its
 * first payload and what it falls back to between one and the next.
 *
 * A named value rather than an inline object at each site, so that "we have not
 * measured this" is one fact with one sentence — and so that a reader who greps
 * for it finds every place the page is correcting by zero on purpose.
 */
export const CLOCK_SKEW_UNMEASURED: ClockSkew = {
  kind: "unknown",
  why: "no payload has arrived yet, so the difference between this device's clock and the box's has not been measured",
};

/**
 * The skew a payload implies, given when this browser received it.
 *
 * `servedAt − receivedAt` is not the skew alone. With a one-way latency `L`
 * (box → browser) it is `serverOffset − browserOffset − L`, so the measurement
 * UNDERSTATES the skew by `L` and the conversion maps server-send onto
 * browser-receipt — which means every age computed off a shifted timestamp is
 * short by `L` rather than long. That is fine here and the sign is the reason:
 * `L` is milliseconds on a tailnet against thresholds of minutes, and it errs
 * towards calling things fresher, never towards a manufactured alarm.
 *
 * It is `servedAt` that is read, and not `collectedAt` or `attemptedAt`, because
 * either of those is up to a full cadence older than the answer — and that
 * genuine snapshot age cannot be told apart from skew. state.ts § `servedAt`.
 */
export function readClockSkew(raw: unknown, receivedAt: number): ClockSkew {
  if (!isRecord(raw) || typeof raw["servedAt"] !== "string") {
    return {
      kind: "unknown",
      why: "this server does not say what time it answered, so the difference between its clock and this device's cannot be measured",
    };
  }
  /* **`iso`, NOT `Date.parse`.** `Date.parse` reads `"0"` as the year 2000,
     accepts date-only strings, and is allowed to accept anything else an
     implementation fancies — and each of those would arrive as a `known` skew
     and shift every timestamp on the page by years, in the direction of "the
     box's clock is broken". The producer writes `toISOString()` (state.ts §
     `servedAt`), so that is what this reads, and the same predicate the inbox
     already refuses its timestamps with. GPT Sol's K6, 2026-09-08. */
  const servedAt = iso(raw["servedAt"]);
  if (servedAt === null) {
    return { kind: "unknown", why: "the server sent a time of answering this page could not read" };
  }
  return { kind: "known", ms: Date.parse(servedAt) - receivedAt };
}

/**
 * One server timestamp, in this browser's terms. **The whole of the fix.**
 *
 * **SHIFT A VALUE THAT REACHES THE SCREEN THROUGH A LOCAL WALL-CLOCK FORMATTER
 * OR AS AN AGE. NEVER SHIFT ONE THAT IS PRINTED AS AN ABSOLUTE INSTANT** — that
 * manufactures a UTC time nothing happened at, and it is still wrong about the
 * reader's timezone anyway.
 *
 * **The rule shipped one round too broad, and this is the corrected version.**
 * It used to argue only the first half — that a phone five minutes fast should
 * show a 06:30 reset as 06:35 — which is true of `pause.resetsAt`, because
 * `PauseLine` renders it through `clockTime()` and the reader is comparing it
 * against the watch on their wrist. It is false of anything printed as the ISO
 * string it is: a transcript turn's `at` went to the screen verbatim, so the
 * shift turned `12:00:00Z` into `12:05:00Z` — not *the phone's wall clock*, but
 * an assertion about a different absolute instant that nothing happened at.
 * GPT Sol's K4, 2026-09-08; messages-client.ts § `withClockSkew` holds the
 * other end, and carries a corrected NUMBER beside the untouched string rather
 * than moving it.
 *
 * Shifts the STRING rather than returning a number, because the values this is
 * still right for stay strings all the way to their formatter, and one of them
 * has to stay in the shape `iso` accepts: `parseAttention`'s shifted `writtenAt`
 * becomes a degraded list's `scannedAt`, which the type promises came out of
 * `toISOString()`. `shiftMsToBrowserClock` below is the same conversion for the
 * callers that never had a string.
 *
 * Anything unparseable is returned untouched, for the same reason `startedAt`
 * survives as `""` — this function's job is to move a time, not to decide
 * whether a field is a time. The callers already refuse what they cannot read.
 */
export function shiftToBrowserClock(value: string | null, skew: ClockSkew): string | null {
  if (value === null || skew.kind === "unknown" || skew.ms === 0) return value;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return value;
  const shifted = shiftMsToBrowserClock(at, skew);
  /* **THE SHIFT CAN LEAVE THE RANGE `Date` CAN EXPRESS, AND THEN
     `toISOString()` THROWS.** Both inputs are individually valid — a canonical
     ISO instant near the ±8.64e15 boundary, and a skew measured from a
     `servedAt` the server chose — and their difference is not. This function is
     called from `parseFleetState`, so the throw takes down the parse of the
     WHOLE payload: no rows, no inbox, no status, from one field at the edge of
     the calendar. Reproduced by GPT Sol in round two, 2026-09-09.

     Returning the value untouched is the behaviour this function already has
     for anything it cannot move — see the paragraph above — so an unshiftable
     instant degrades to an unshifted one rather than to nothing. That is the
     safe direction: the reader sees a time that is a few milliseconds of skew
     wrong at the far end of history, instead of an empty page. */
  if (!Number.isFinite(shifted) || Math.abs(shifted) > 8.64e15) return value;
  return new Date(shifted).toISOString();
}

/**
 * The same conversion on a number, for the callers that never had a string.
 *
 * **The arithmetic lives here once.** Three places need it — the string form
 * above, `browserMsOf` in messages-client.ts, and the chart's axis labels in
 * HealthHistory.tsx, whose samples arrive as epoch milliseconds — and a second
 * copy of `at - skew.ms` is a second chance to get the sign the wrong way
 * round. It is the sign, specifically: `skew.ms` is the SERVER's clock minus
 * this browser's, so a server ahead of us means subtracting to come back.
 *
 * An `unknown` skew shifts by zero, which is the whole discipline of the type:
 * nobody measured it, so nothing is invented.
 */
export function shiftMsToBrowserClock(at: number, skew: ClockSkew): number {
  return skew.kind === "unknown" ? at : at - skew.ms;
}

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
 * A timestamp spelled the one way this fleet spells one.
 *
 * The same check `isIsoTimestamp` makes in tools/overseer/store.ts, and
 * deliberately as strict: every timestamp in the inbox was written by
 * `toISOString()` and was refused by that function on the way into the
 * checkpoint, so anything else arriving here did not come from the producer. A
 * lenient version would accept a string `Date.parse` can read and the age
 * arithmetic cannot reason about, which is how a duration on screen becomes
 * confidently wrong rather than absent.
 *
 * **It sits up here, with the general helpers, because it now guards two things
 * and not one.** It was written for the attention inbox and `readClockSkew`
 * borrowed it (GPT Sol's K6): the two are the same requirement, that a
 * timestamp came out of `toISOString()` and not out of whatever `Date.parse`
 * happens to tolerate this month.
 */
function iso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) || at.toISOString() !== v ? null : v;
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
 *
 * `skew` is required rather than defaulted, so a new caller has to say which
 * clock it is holding — see `ClockSkew`. Both times here are the server's:
 * `resetsAt` is READ AS A WALL CLOCK and `at` is read as both, so both are
 * shifted.
 */
export function parsePause(v: unknown, skew: ClockSkew): Pause {
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
    /* SHIFTED, and the printed time changes with it. A phone five minutes fast
       should read a 06:30 reset as 06:35, because that is when it happens by
       the clock in the reader's hand. `overdue` is untouched — it is the
       server's own decision, made on one clock, and this page never recomputes
       it. */
    return { kind: "rate-limited", window, resetsAt: shiftToBrowserClock(resetsAt, skew) ?? resetsAt, overdue: v["overdue"] === true };
  }

  if (kind === "scheduled-wakeup") {
    const at = str(v["at"]);
    if (at === null) {
      return unreadable("the server said this session has a wake-up scheduled but did not say when");
    }
    return { kind: "scheduled-wakeup", at: shiftToBrowserClock(at, skew) ?? at, overdue: v["overdue"] === true, source: "cron" };
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

/**
 * One row off the wire. Null when it carries no id, since an id is its address.
 *
 * `skew` converts the row's two server timestamps — `startedAt`, and whatever
 * `pause` carries — into this browser's terms, so that `uptime` and the pause
 * countdown are subtractions between two readings of one clock. See `ClockSkew`.
 */
export function parseRow(v: unknown, skew: ClockSkew): FleetRow | null {
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
    startedAt: shiftToBrowserClock(str(v["startedAt"]), skew) ?? "",
    status: parseStatus(v["status"]),
    question: parseQuestion(v["question"]),
    permissionMode: parsePermissionMode(v["permissionMode"]),
    pause: parsePause(v["pause"], skew),
    meta: parseMeta(v["meta"]),
    role: parseRole(v["role"]),
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
 *
 * **EVERY CLOCK IN HERE IS SHIFTED** (`ClockSkew`), and this is the arm where
 * getting it wrong costs most: the panel decides whether to say *nothing is
 * waiting on you* by asking how old the scan is, so a phone a few minutes ahead
 * could make a live inbox read as a dead one on the panel the page exists for.
 */
export function parseAttention(raw: unknown, skew: ClockSkew): AttentionView {
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
      const written = iso(raw["coordinatorWrittenAt"]);
      if (written === null) return unreadable("the server published an inbox with no readable clock on it");
      /* Shifted BEFORE it is used as the degraded list's fallback `scannedAt`,
         so the two cannot end up on different clocks. `shiftToBrowserClock`
         re-emits `toISOString()`, which is what `iso` demands. */
      const writtenAt = shiftToBrowserClock(written, skew) ?? written;
      return {
        kind: "published",
        list: parseAttentionList(raw["list"], writtenAt, skew),
        coordinatorWrittenAt: writtenAt,
      };
    }
    default:
      return unreadable(
        `this page does not know the inbox ${JSON.stringify(str(raw["kind"]) ?? raw["kind"] ?? null)}`,
      );
  }
}

/**
 * The list itself. Never an empty `list` on failure — see `parseAttention`.
 *
 * `writtenAt` arrives ALREADY SHIFTED and `skew` is for everything below it, so
 * no timestamp on this arm is left on the server's clock while its neighbour
 * moves.
 */
function parseAttentionList(raw: unknown, writtenAt: string, skew: ClockSkew): AttentionList {
  const bad = (why: string): AttentionList => ({
    kind: "unknown",
    why: `the published list was unusable: ${why}`,
    scannedAt: writtenAt,
  });
  if (!isRecord(raw)) return bad("it is not an object");
  const scanned = iso(raw["scannedAt"]);
  if (scanned === null) return bad("scannedAt is not a timestamp this page can read");
  const scannedAt = shiftToBrowserClock(scanned, skew) ?? scanned;
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
    const item = parseAttentionItem(rawItem, skew);
    if (item === null) return bad("an item is not one this page can read");
    items.push(item);
  }
  /* IN THE ORDER IT ARRIVED. The producer sorts — by consequence, then by how
     long it has waited — and nothing on this side may re-sort, or the two halves
     disagree about what is at the top. Agreed with `w2-attention-inbox`;
     AttentionPanel.tsx holds the other end of it. */
  return { kind: "list", items, sessionsScanned, sessionsUnreadable, scannedAt };
}

/**
 * Every field, every arm. `null` on the first mismatch — the list then degrades
 * whole.
 *
 * Both `waitingSince` and each duplicate's are shifted (`ClockSkew`): the card
 * prints *waiting 40m* off them, and that is the number a reader triages on.
 */
function parseAttentionItem(raw: unknown, skew: ClockSkew): AttentionItem | null {
  if (!isRecord(raw)) return null;
  const id = nonBlank(raw["id"]);
  const sessionId = nonBlank(raw["sessionId"]);
  const sessionName = nonBlank(raw["sessionName"]);
  if (id === null || sessionId === null || sessionName === null) return null;
  const since = iso(raw["waitingSince"]);
  if (since === null) return null;
  const waitingSince = shiftToBrowserClock(since, skew) ?? since;
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
    duplicates.push({ sessionId: dupId, sessionName: dupName, waitingSince: shiftToBrowserClock(dupSince, skew) ?? dupSince });
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

/* --------------------------------------------- is supervision working? -- */

/**
 * **THE SAME FIFTH STATE, for the same reason** — `AttentionView` above argues
 * it in full. `OverseerStatusFeed`'s arms are all facts about the box; this one
 * is a fact about the payload, so it cannot live on the shared type.
 *
 * It matters more here than it does for the inbox, because this is the card
 * that says whether anything is watching. *This server did not look* draws
 * nothing; *we looked and cannot read the answer* is a page and a server that
 * have come apart, and every session on the box may be waiting with nothing
 * watching while it is true.
 */
export type OverseerView = OverseerStatusFeed | { kind: "feed-unreadable"; why: string };

/**
 * **IS SUPERVISION STILL WORKING?, off the wire** — derived, never adopted.
 *
 * The fourth parser of this file's shapes and the third of this one, and the
 * same argument holds: between `tools/fleet/overseer-status.ts` and here sit
 * `JSON.stringify`, HTTP and a browser tab iOS may have kept alive across a
 * deploy, so a page has to be able to read a payload from a server it is not
 * the same age as.
 *
 * **Every timestamp is shifted onto this browser's clock** (`ClockSkew`), and
 * the stakes are the card's whole claim: it decides whether to warn that the
 * Overseer has stopped writing, or that it is writing but no longer hearing
 * from the dashboard, by asking how old two of these are. A phone a few minutes
 * fast would otherwise turn a healthy pair into an alarm, or — with the sign
 * the other way — a dead daemon into a fresh one.
 *
 * **Absent is `not-asked`; present-but-wrong is `feed-unreadable`.** The field
 * was added without a schema bump, so a server that predates it sends nothing —
 * and unlike the inbox's arm of the same name, this one is drawn: the card is
 * itself the evidence, so its absence would read as a page with nothing to
 * report. `OverseerStatusCard`'s prop comment has the distinction.
 */
/**
 * **THE CHECKPOINT SCHEMA THIS BUILD OF THE PAGE READS**, checked here as well
 * as on the server.
 *
 * The server refuses an unknown version and sends `unsupported-schema`, so this
 * looks redundant — and it is not, for the reason this whole file is a second
 * parser: **the page can be older than the server it is talking to.** An iOS
 * tab kept alive across a deploy holds this build; a newer server that had
 * learned schema 3 would send it inside a `published` arm, and without this
 * check the card would draw ages off fields whose meaning had moved. That is
 * precisely the case where a wrong reading is worst — it looks like a healthy
 * Overseer. GPT Sol's P1, 2026-09-08.
 *
 * The number is written twice, once here and once in `tools/fleet/attention.ts`
 * as `KNOWN_SCHEMA`, because this file may not import a node module. Two
 * declarations are the cost of two independent compatibility policies, which is
 * the thing being bought.
 */
const KNOWN_CHECKPOINT_SCHEMA = 2;

/**
 * **THE LONGEST SOURCE DEADLINE THIS PAGE WILL BELIEVE**, in milliseconds.
 *
 * The daemon publishes the deadline it uses for *the collector has gone quiet*
 * and the card prefers it over a constant, because the two ends drifted once
 * already. But an unbounded number taken on trust is a way to make a dead
 * source look healthy for ever: a `lastGoodSnapshotAt` from 2020 with a
 * deadline of `1e300` renders as *supervision is running*. GPT Sol's P1.
 *
 * An hour is twelve times the daemon's documented normal (five missed 60-second
 * collections), so anything past it is a bug or a hostile file rather than a
 * cadence change. Beyond it the page falls back to its own deadline and says so
 * — it does not fail the card, because the two clocks are still readable and
 * still worth showing.
 */
const MAX_SOURCE_STALE_MS = 60 * 60_000;

export function parseOverseer(raw: unknown, skew: ClockSkew): OverseerView {
  /* Absent, and only absent. `null` is something a server chose to send. */
  if (raw === undefined) return { kind: "not-asked" };
  const unreadable = (why: string): OverseerView => ({ kind: "feed-unreadable", why });
  if (!isRecord(raw)) return unreadable("the server sent an Overseer status that is not an object");
  switch (str(raw["kind"])) {
    case "not-asked":
      return { kind: "not-asked" };
    case "checkpoint-absent":
      return { kind: "checkpoint-absent" };
    case "checkpoint-unreadable":
      return { kind: "checkpoint-unreadable", why: str(raw["why"]) ?? "the server gave no reason" };
    case "unsupported-schema": {
      /* BOTH HALVES OR NEITHER. "This build cannot read the checkpoint" without
         the two version numbers is a shrug; with them it is a thing somebody can
         act on, which is the entire reason this arm is separate from the one
         above it. */
      const saw = nonBlank(raw["saw"]);
      const known = raw["known"];
      if (saw === null || typeof known !== "number" || !Number.isFinite(known)) {
        return unreadable("the server refused the checkpoint's schema but did not say which versions were involved");
      }
      return { kind: "unsupported-schema", saw, known };
    }
    case "published": {
      /* **THE VERSION FIRST, BEFORE ANY FIELD OF THE BODY IS READ.** A newer
         server sending a schema this build has never read is the
         old-tab-after-a-deploy case, and checking it afterwards meant a schema-3
         status whose SHAPE had also changed failed the body parse first and came
         back as a shrug — the diagnostic that names both versions is the one
         thing a reader can act on. Reading the version out of a payload of an
         unknown version is safe in the way reading its fields is not: it is the
         field whose meaning cannot change. GPT Sol's P2 in round two. */
      const body = raw["status"];
      const schema = isRecord(body) ? body["schema"] : undefined;
      if (typeof schema === "number" && schema !== KNOWN_CHECKPOINT_SCHEMA) {
        return unreadable(
          `the server read a checkpoint of schema ${schema} and this page reads schema ${KNOWN_CHECKPOINT_SCHEMA}`,
        );
      }
      const status = parseOverseerStatus(body, skew);
      if (status === null) return unreadable("the server published an Overseer status this page cannot read");
      return { kind: "published", status };
    }
    default:
      return unreadable(
        `this page does not know the Overseer status ${JSON.stringify(str(raw["kind"]) ?? raw["kind"] ?? null)}`,
      );
  }
}

/**
 * The reading itself. `null` fails the arm — see `parseOverseer`.
 *
 * **The two clocks are all-or-nothing and the three parts are not**, which is
 * the same split the server's projection makes and for the same reason: the
 * card exists to put `writtenAt` and `lastGoodSnapshotAt` in one sentence, so a
 * reading missing either is not a degraded card. The parts beside them each
 * carry their own `unreadable` arm and reach it on their own.
 */
function parseOverseerStatus(raw: unknown, skew: ClockSkew): OverseerStatus | null {
  if (!isRecord(raw)) return null;
  const schema = raw["schema"];
  if (typeof schema !== "number" || !Number.isFinite(schema)) return null;
  const written = iso(raw["writtenAt"]);
  if (written === null) return null;
  const writtenAt = shiftToBrowserClock(written, skew) ?? written;
  /* `null` IS A READING — the Overseer has accepted no snapshot at all — and
     absent is not. `raw["lastGoodSnapshotAt"] === undefined` means a payload
     this page cannot read, which fails the arm rather than manufacturing the
     alarming answer. The server's projection makes the same distinction. */
  const rawSource = raw["lastGoodSnapshotAt"];
  let lastGoodSnapshotAt: string | null;
  if (rawSource === null) {
    lastGoodSnapshotAt = null;
  } else {
    const at = iso(rawSource);
    if (at === null) return null;
    lastGoodSnapshotAt = shiftToBrowserClock(at, skew) ?? at;
  }
  /* **A DURATION, NOT A TIMESTAMP** — nothing to skew-correct — and **an invalid
     one is not a missing one.** Absent or null is a server that did not say and
     the card falls back to its own deadline, naming it. A value that is there
     and cannot be a deadline fails the whole reading, because the deadline is
     part of the health judgement: without the ceiling AND this distinction, a
     four-minute-old source with a deadline of `3_600_001` reads as *supervision
     is running*. `MAX_SOURCE_STALE_MS`; GPT Sol's P1 in round two. */
  const stale = raw["sourceStaleAfterMs"];
  let sourceStaleAfterMs: number | null;
  if (stale === undefined || stale === null) {
    sourceStaleAfterMs = null;
  } else if (typeof stale === "number" && Number.isFinite(stale) && stale > 0 && stale <= MAX_SOURCE_STALE_MS) {
    sourceStaleAfterMs = stale;
  } else {
    return null;
  }
  return {
    schema,
    writtenAt,
    lastGoodSnapshotAt,
    sourceStaleAfterMs,
    heartbeat: parseOverseerHeartbeat(raw["heartbeat"], skew),
    scheduler: parseOverseerScheduler(raw["scheduler"], skew),
    register: parseOverseerRegister(raw["register"], skew),
  };
}

/** The daemon's own facts. A `lastTickAt` of `null` is a fresh start, not a stopped one. */
function parseOverseerHeartbeat(raw: unknown, skew: ClockSkew): OverseerHeartbeat {
  const bad = (why: string): OverseerHeartbeat => ({ kind: "unreadable", why });
  if (!isRecord(raw)) return bad("the server sent no heartbeat this page can read");
  if (raw["kind"] === "unreadable") {
    return bad(nonBlank(raw["why"]) ?? "the server could not read the heartbeat and did not say why");
  }
  if (raw["kind"] !== "reading") return bad(`this page does not know the heartbeat ${JSON.stringify(raw["kind"] ?? null)}`);
  const pid = count(raw["pid"]);
  const instanceId = nonBlank(raw["instanceId"]);
  const started = iso(raw["startedAt"]);
  const ticks = count(raw["ticks"]);
  if (pid === null || instanceId === null || started === null || ticks === null) {
    return bad("the heartbeat arrived without a pid, an instance, a start time or a tick count");
  }
  const rawTick = raw["lastTickAt"];
  let lastTickAt: string | null;
  if (rawTick === null) {
    lastTickAt = null;
  } else {
    const at = iso(rawTick);
    if (at === null) return bad("the heartbeat's last tick is neither a timestamp nor null");
    lastTickAt = shiftToBrowserClock(at, skew) ?? at;
  }
  return {
    kind: "reading",
    pid,
    instanceId,
    startedAt: shiftToBrowserClock(started, skew) ?? started,
    lastTickAt,
    ticks,
  };
}

/**
 * The scheduler line.
 *
 * **The default arm is why this is a function**, on this side too: 260908g may
 * widen the discriminant, and a state this build has never seen must read as *I
 * cannot tell* rather than borrow the mildest label on screen. The server
 * already refuses one it does not know — this is the second door.
 */
function parseOverseerScheduler(raw: unknown, skew: ClockSkew): OverseerScheduler {
  const bad = (why: string): OverseerScheduler => ({ kind: "unreadable", why });
  if (!isRecord(raw)) return bad("the server sent no scheduler line this page can read");
  if (raw["kind"] === "unreadable") {
    return bad(nonBlank(raw["why"]) ?? "the server could not read the scheduler line and did not say why");
  }
  const why = nonBlank(raw["why"]);
  const at = iso(raw["at"]);
  if (why === null || at === null) return bad("the scheduler line arrived with no reason or no readable time");
  const shifted = shiftToBrowserClock(at, skew) ?? at;
  switch (raw["kind"]) {
    case "armed":
      return { kind: "armed", why, at: shifted };
    case "off":
      return { kind: "off", why, at: shifted };
    case "not-said":
      return { kind: "not-said", why, at: shifted };
    default:
      return bad(`this page does not know the scheduler state ${JSON.stringify(raw["kind"] ?? null)}`);
  }
}

/**
 * The Overseer's history of what has been running — **and one bad entry
 * degrades the whole register**, for the reason the server's projection gives:
 * the list claims *these are the ones that have waited longest*, which is a
 * negative claim about everything not in it.
 */
function parseOverseerRegister(raw: unknown, skew: ClockSkew): OverseerRegister {
  const bad = (why: string): OverseerRegister => ({ kind: "unreadable", why });
  if (!isRecord(raw)) return bad("the server sent no register this page can read");
  if (raw["kind"] === "unreadable") {
    return bad(nonBlank(raw["why"]) ?? "the server could not read the register and did not say why");
  }
  if (raw["kind"] !== "read") return bad(`this page does not know the register ${JSON.stringify(raw["kind"] ?? null)}`);
  const total = count(raw["total"]);
  if (total === null) return bad("the register arrived without a count of what it holds");
  const rawSessions = raw["sessions"];
  if (!Array.isArray(rawSessions)) return bad("the register's sessions are not a list");
  const sessions: OverseerSessionHistory[] = [];
  for (const entry of rawSessions) {
    const parsed = parseOverseerHistory(entry, skew);
    if (parsed === null) return bad("an entry in the register is not one this page can read");
    sessions.push(parsed);
  }
  /* MORE SHOWN THAN HELD IS CORRUPTION, not a reading: `sessions` is a capped
     projection OF `total`, so it cannot be longer than it, and the card
     subtracts one from the other to say how many are not shown. */
  if (sessions.length > total) {
    return bad(`the register shows ${sessions.length} sessions out of a register it says holds ${total}`);
  }
  return { kind: "read", total, sessions };
}

/** One remembered session. `≥` lives in the rendering; the arm lives here. */
function parseOverseerHistory(raw: unknown, skew: ClockSkew): OverseerSessionHistory | null {
  if (!isRecord(raw)) return null;
  const name = nonBlank(raw["name"]);
  const tmuxId = nonBlank(raw["tmuxId"]);
  const status = nonBlank(raw["status"]);
  if (name === null || tmuxId === null || status === null) return null;
  const since = raw["since"];
  if (!isRecord(since)) return null;
  const at = iso(since["at"]);
  if (at === null) return null;
  if (since["kind"] !== "observed" && since["kind"] !== "lower-bound") return null;
  return { name, tmuxId, status, since: { kind: since["kind"], at: shiftToBrowserClock(at, skew) ?? at } };
}

/* ------------------------------------ can this account afford more work? -- */

/**
 * **THE SAME FIFTH STATE ONE MORE TIME.** `AttentionView` argues it in full:
 * the server's arms are all facts about the box, and *the server sent a usage
 * reading this page cannot make sense of* is a fact about the payload, which
 * the server cannot report about itself.
 */
export type UsageView = UsageFeed | { kind: "feed-unreadable"; why: string };

/**
 * **CAN THIS ACCOUNT AFFORD MORE WORK?, off the wire** — derived, never
 * adopted, and the fifth parser of this file's shapes.
 *
 * ## NOTHING HERE IS SHIFTED ONTO THE BROWSER'S CLOCK, AND THAT IS THE ONE
 * PLACE THIS FEED PARTS COMPANY WITH THE FOUR ABOVE IT
 *
 * Every other timestamp on this page exists to be turned into an AGE, and an
 * age computed across two clocks is what had a phone three minutes fast holding
 * the STALE banner on permanently — so `ClockSkew` is applied at this boundary
 * and everything downstream is in browser terms.
 *
 * A reset instant is not an age. It is rendered as a WALL-CLOCK TIME, in UTC,
 * London and Athens (`tools/fleet/zones.ts`, and Greg's *"I'm bouncing between
 * London/Athens"*), and shifting it would print a time that is not the time the
 * window actually resets — a page confidently saying *00:40 London* about an
 * instant that is 00:43. The instant is the instant; only durations are
 * relative to a clock.
 *
 * So these fields cross verbatim and **`UsageCard` applies the skew itself, at
 * the point it computes a duration**, which is why that component takes the
 * skew as a prop. The rule for this feed is one sentence: *the wire carries the
 * box's own instants; the card converts when, and only when, it needs a
 * length of time.*
 *
 * ## Otherwise the ordinary discipline
 *
 * **Absent is `not-asked`; present-but-wrong is `feed-unreadable`.** The field
 * was added without a schema bump, so a server that predates it sends nothing,
 * and drawing that as *nothing is limited* would be the most reassuring
 * possible lie. Every arm the server can send is passed through with its own
 * sentence intact — `no-report` above all, which is what a daemon started with
 * `--no-usage` produces and which must not read as a broken file.
 */
export function parseUsage(raw: unknown): UsageView {
  /* Absent, and only absent. `null` is something a server chose to send. */
  if (raw === undefined) return { kind: "not-asked" };
  const unreadable = (why: string): UsageView => ({ kind: "feed-unreadable", why });
  if (!isRecord(raw)) return unreadable("the server sent a usage reading that is not an object");
  switch (str(raw["kind"])) {
    case "not-asked":
      return { kind: "not-asked" };
    case "checkpoint-absent":
      return { kind: "checkpoint-absent" };
    case "checkpoint-unreadable":
      return { kind: "checkpoint-unreadable", why: str(raw["why"]) ?? "the server gave no reason" };
    case "unsupported-schema": {
      /* BOTH HALVES OR NEITHER, for the reason `parseOverseer` gives: the two
         version numbers are the only part of this arm anybody can act on. */
      const saw = nonBlank(raw["saw"]);
      const known = raw["known"];
      if (saw === null || typeof known !== "number" || !Number.isFinite(known)) {
        return unreadable("the server refused the checkpoint's schema but did not say which versions were involved");
      }
      return { kind: "unsupported-schema", saw, known };
    }
    case "no-report":
    case "report-unreadable": {
      /* TWO ARMS, ONE PARSE, AND THE DISTINCTION KEPT. *No pass has run* is
         ordinary and *a report is there and cannot be read* is not, and the
         card says different things about them — see `UsageFeed` in wire.ts.
         The shapes are identical, which is why they share these six lines and
         nothing else. */
      const why = nonBlank(raw["why"]);
      const at = iso(raw["at"]);
      if (why === null || at === null) {
        return unreadable("the server said there is no usable usage report but did not say why, or when it looked");
      }
      return raw["kind"] === "no-report" ? { kind: "no-report", why, at } : { kind: "report-unreadable", why, at };
    }
    case "published": {
      const coordinatorWrittenAt = iso(raw["coordinatorWrittenAt"]);
      if (coordinatorWrittenAt === null) {
        return unreadable("the server published a usage reading with no readable checkpoint time");
      }
      const summary = parseUsageSummary(raw["summary"]);
      if (summary === null) return unreadable("the server published a usage reading this page cannot read");
      return { kind: "published", summary, coordinatorWrittenAt };
    }
    default:
      return unreadable(
        `this page does not know the usage reading ${JSON.stringify(str(raw["kind"]) ?? raw["kind"] ?? null)}`,
      );
  }
}

/**
 * The reading itself. `null` fails the arm — see `parseUsage`.
 *
 * **All or nothing, matching the server's own narrowing.** Half a usage card —
 * windows with no verdict behind them, a verdict with no coverage under it — is
 * a page making a claim it cannot support, and the sessions below are unaffected
 * either way. The server's `parseSummary` degrades the same way and says so.
 */
function parseUsageSummary(raw: unknown): UsageSummary | null {
  if (!isRecord(raw)) return null;
  const collectedAt = iso(raw["collectedAt"]);
  /* THE FIELD THAT MAKES THE REST HONEST — see wire.ts § `UsageSummary`. A
     headroom number with no clock on it is the whole failure this subsystem
     exists to refuse, so its absence fails the reading rather than borrowing
     the checkpoint's clock, which is a different and much newer instant. */
  if (collectedAt === null) return null;
  const account = parseUsageAccount(raw["account"]);
  if (account === null) return null;
  const level = parseUsageLevel(raw["level"]);
  if (level === null) return null;
  const reasons = parseSentences(raw["reasons"]);
  if (reasons === null) return null;
  /* THE ACCOUNT IS PASSED IN, and it was not for a round: this parser required
     the cache to name AN account and never checked it was THIS one, so a
     payload pairing account B with an `attributed` cache belonging to account A
     was accepted and drawn. The server cannot emit that today, which is exactly
     why the header's claim to be a "second, independent" refusal has to be
     true — an independent check that trusts the first one is not one.
     GPT Sol's P1(1) in round two, 2026-09-09. */
  const cache = parseUsageCache(raw["cache"], account);
  if (cache === null) return null;
  const limits = parseUsageLimits(raw["limits"]);
  if (limits === null) return null;
  /* `null` is the ordinary case: nothing is blocking. A value that is present
     and is not a timestamp fails the reading — it is the field that says when
     work can resume, and there is no safe way to read it as "never". */
  const rawDueBack = raw["dueBackAt"];
  const dueBackAt = rawDueBack === null || rawDueBack === undefined ? null : iso(rawDueBack);
  if (rawDueBack !== null && rawDueBack !== undefined && dueBackAt === null) return null;
  /* **BOTH HALVES OR NEITHER**, because they are two halves of one incident key
     — wire.ts § `dueBackWindow`. An instant with no window matches every window
     resetting at that instant, which is how one attributed limit puts an
     attributed badge on a cluster the daemon could not attribute. */
  const dueBackWindow = nonBlank(raw["dueBackWindow"]);
  if ((dueBackAt === null) !== (dueBackWindow === null)) return null;
  return { collectedAt, account, level, reasons, cache, limits, dueBackAt, dueBackWindow };
}

function parseUsageAccount(raw: unknown): UsageAccount | null {
  if (!isRecord(raw)) return null;
  switch (str(raw["kind"])) {
    case "value":
      return {
        kind: "value",
        email: nonBlank(raw["email"]),
        orgId: nonBlank(raw["orgId"]),
        orgName: nonBlank(raw["orgName"]),
        subscriptionType: nonBlank(raw["subscriptionType"]),
        accountUuid: nonBlank(raw["accountUuid"]),
        rateLimitTier: nonBlank(raw["rateLimitTier"]),
      };
    case "logged-out":
      /* NOT A FAILURE. `claude auth status` answered and the answer was that
         nobody is logged in — the one thing on this card a person can fix. */
      return { kind: "logged-out", projectsDirectory: nonBlank(raw["projectsDirectory"]) };
    case "unknown": {
      const why = nonBlank(raw["why"]);
      return why === null ? null : { kind: "unknown", why };
    }
    default:
      return null;
  }
}

/**
 * The four levels, and **an unknown one is not rounded down to `ok`**.
 *
 * The same rule `parseStatus` follows for a session state this build has never
 * heard of: a fifth level added by a newer server must reach the page as *this
 * build cannot read it*, because the reading a stale client is most likely to
 * get wrong here is the reassuring one.
 */
function parseUsageLevel(raw: unknown): UsageLevel | null {
  return raw === "ok" || raw === "approaching" || raw === "limited" || raw === "unknown" ? raw : null;
}

/** Sentences a person reads. A blank one is a hole under a heading — `nonBlank`'s own argument. */
function parseSentences(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    const line = nonBlank(entry);
    if (line === null) return null;
    out.push(line);
  }
  return out;
}

/**
 * The cache, in three arms — **and the browser will not manufacture the
 * attributed one.**
 *
 * `attributed` is the only arm carrying percentages, and this parser can reach
 * it only from a payload that already says `attributed` and names an account.
 * A server that sent windows on any other arm has them dropped here rather than
 * shown: after a `/login` swap `~/.claude.json` can hold the previous
 * subscription's numbers, and a card naming account B over account A's *96%
 * used* is somebody else's headroom reported as this one's. The server's
 * `parseCache` makes the same refusal against the same rule
 * (`attributeCache` in tools/overseer/usage.ts); this is the second, independent
 * one, which is the whole point of there being two parsers.
 */
function parseUsageCache(raw: unknown, account: UsageAccount): UsageSummary["cache"] | null {
  if (!isRecord(raw)) return null;
  switch (str(raw["kind"])) {
    case "unknown": {
      const why = nonBlank(raw["why"]);
      return why === null ? null : { kind: "unknown", why };
    }
    case "unattributed": {
      const why = nonBlank(raw["why"]);
      if (why === null) return null;
      /* Both may be genuinely absent: an unreadable account has no uuid to
         name, and a cache with no fetch time is exactly why it is unattributed. */
      const rawFetched = raw["fetchedAt"];
      const fetchedAt = rawFetched === null || rawFetched === undefined ? null : iso(rawFetched);
      if (rawFetched !== null && rawFetched !== undefined && fetchedAt === null) return null;
      return { kind: "unattributed", why, fetchedAt, accountUuid: nonBlank(raw["accountUuid"]) };
    }
    case "attributed": {
      const fetchedAt = iso(raw["fetchedAt"]);
      /* NON-NULL BY CONSTRUCTION on this arm: attribution means both sides named
         the same account, so a payload that claims it without naming one has
         not been through that check and is not believed. */
      const accountUuid = nonBlank(raw["accountUuid"]);
      if (fetchedAt === null || accountUuid === null) return null;
      /* **AND IT MUST BE THIS SUMMARY'S ACCOUNT.** The clause the server checks
         and this side merely assumed. A percentage under the wrong name is the
         P0 of this stage; a parser that takes the server's word for it has
         moved the refusal rather than duplicated it. */
      if (account.kind !== "value" || account.accountUuid === null || account.accountUuid !== accountUuid) return null;
      const rawWindows = raw["windows"];
      if (!Array.isArray(rawWindows)) return null;
      const windows: UsageWindowCard[] = [];
      for (const entry of rawWindows) {
        const window = parseUsageWindowCard(entry);
        /* ONE BAD WINDOW FAILS THE LIST. A card missing the one window that is
           at 96% is worse than a card that says it cannot read the cache. */
        if (window === null) return null;
        windows.push(window);
      }
      return { kind: "attributed", fetchedAt, accountUuid, windows };
    }
    default:
      return null;
  }
}

/**
 * One window. **The `expired` arm has no percentage and this parser will not
 * grow one** — wire.ts § `UsageWindowCard` is the argument, and a second parser
 * is exactly where a helpful `stalePercent` would reappear.
 */
function parseUsageWindowCard(raw: unknown): UsageWindowCard | null {
  if (!isRecord(raw)) return null;
  const window = nonBlank(raw["window"]);
  if (window === null) return null;
  switch (str(raw["kind"])) {
    case "value": {
      const utilizationPercent = raw["utilizationPercent"];
      const resetsAt = iso(raw["resetsAt"]);
      /* 0–100, the wire's own contract, checked on this side too — see the
         server's `parseWindow`. A percentage outside it is a window this page
         says it cannot read, not one it draws. */
      if (typeof utilizationPercent !== "number" || !Number.isFinite(utilizationPercent) || resetsAt === null) {
        return null;
      }
      if (utilizationPercent < 0 || utilizationPercent > 100) return null;
      return { kind: "value", window, utilizationPercent, resetsAt };
    }
    case "expired": {
      const resetsAt = iso(raw["resetsAt"]);
      const why = nonBlank(raw["why"]);
      return resetsAt === null || why === null ? null : { kind: "expired", window, resetsAt, why };
    }
    case "unknown": {
      const why = nonBlank(raw["why"]);
      return why === null ? null : { kind: "unknown", window, why };
    }
    default:
      return null;
  }
}

/**
 * The incidents, and the coverage that is the only reason a zero means
 * anything.
 *
 * **Every arm carries coverage, `unknown` included.** *No limits hit* and *the
 * probe opened nothing* are the same sentence without it —
 * docs/reusable/silent-success.md — and this parser refuses an arm that has
 * lost it rather than drawing a calm account off a scan nobody can size.
 */
function parseUsageLimits(raw: unknown): UsageSummary["limits"] | null {
  if (!isRecord(raw)) return null;
  const coverage = parseScanCoverage(raw["coverage"]);
  if (coverage === null) return null;
  switch (str(raw["kind"])) {
    case "none": {
      /* **THE SECOND, INDEPENDENT REFUSAL.** A `none` whose own coverage cannot
         support an absence renders as *nothing is blocking this account* over
         *scanned 0 of 0 transcripts, 0 lines*. The server refuses it too; this
         is the copy that protects a browser talking to a server it is not the
         same age as. `absenceGapReason` is a leaf both import — one rule, two
         call sites, and no third declaration of it. */
      const gap = absenceGapReason(coverage);
      if (gap !== null) {
        return { kind: "unknown", why: `the scan reported no rejection, and its own coverage cannot support that: ${gap}`, coverage };
      }
      return { kind: "none", coverage };
    }
    case "unknown": {
      const why = nonBlank(raw["why"]);
      return why === null ? null : { kind: "unknown", why, coverage };
    }
    case "incidents": {
      const rawIncidents = raw["incidents"];
      if (!Array.isArray(rawIncidents)) return null;
      const incidents: UsageIncident[] = [];
      const ids = new Set<string>();
      for (const entry of rawIncidents) {
        const incident = parseUsageIncident(entry);
        if (incident === null) return null;
        /* **IDS ARE REACT KEYS**, and two rows sharing one make React reconcile
           them into each other — a row that silently takes another's content.
           The grouper cannot emit a duplicate (one map entry, one id); a
           payload that does is one this page says it cannot read. */
        if (ids.has(incident.id)) return null;
        ids.add(incident.id);
        incidents.push(incident);
      }
      /* An `incidents` arm with nothing in it is a producer contradicting
         itself, and the reading it produces on screen — a red heading over an
         empty list — is the least actionable thing this card could draw. */
      if (incidents.length === 0) return null;
      return { kind: "incidents", incidents, coverage };
    }
    default:
      return null;
  }
}

function parseUsageIncident(raw: unknown): UsageIncident | null {
  if (!isRecord(raw)) return null;
  const id = nonBlank(raw["id"]);
  const window = nonBlank(raw["window"]);
  const resetsAt = iso(raw["resetsAt"]);
  const rejections = counted(raw["rejections"]);
  const unidentifiedRejections = counted(raw["unidentifiedRejections"]);
  if (id === null || window === null || resetsAt === null || rejections === null || unidentifiedRejections === null) {
    return null;
  }
  const rawConversations = raw["conversations"];
  if (!Array.isArray(rawConversations)) return null;
  const conversations: string[] = [];
  const seen = new Set<string>();
  for (const entry of rawConversations) {
    const uuid = nonBlank(entry);
    /* **DUPLICATES ARE REFUSED, NOT DEDUPLICATED.** The server's grouper emits a
       deduplicated list, so a repeat means the payload did not come from it —
       and silently collapsing one would make the row's own counts stop adding
       up while it went on reading fine. */
    if (uuid === null || seen.has(uuid)) return null;
    seen.add(uuid);
    conversations.push(uuid);
  }
  /* **THE COUNTS MUST BE ABLE TO ADD UP.** Every rejection is either attributed
     to a conversation or counted as unattributed, so neither part may exceed the
     whole and the named conversations cannot outnumber the rejections that named
     them. The server's grouper cannot produce these states; a payload that does
     is one this page should say it cannot read, not one it should draw
     contradictory prose from. GPT Sol's P2(2), 2026-09-09. */
  if (!Number.isInteger(rejections) || !Number.isInteger(unidentifiedRejections)) return null;
  if (unidentifiedRejections > rejections) return null;
  if (conversations.length > rejections - unidentifiedRejections) return null;
  /* AN INCIDENT WITH NO REJECTIONS IS NOT AN INCIDENT. The grouper mints one
     only from at least one hit, so a zero here is a payload that did not come
     from it — and it renders as a window heading over "0 rejections", which is
     prose that contradicts its own presence. */
  if (rejections === 0) return null;
  /* Both may be genuinely absent: a rejection whose transcript record carried
     no timestamp of its own is real, and the incident is still worth drawing
     without a window of time on it. */
  const rawFirst = raw["firstHitAt"];
  const rawLast = raw["lastHitAt"];
  const firstHitAt = rawFirst === null || rawFirst === undefined ? null : iso(rawFirst);
  const lastHitAt = rawLast === null || rawLast === undefined ? null : iso(rawLast);
  if (rawFirst !== null && rawFirst !== undefined && firstHitAt === null) return null;
  if (rawLast !== null && rawLast !== undefined && lastHitAt === null) return null;
  return { id, window, resetsAt, conversations, rejections, unidentifiedRejections, firstHitAt, lastHitAt };
}

/**
 * THE POSITIVE CONTROL, and **not one field of it is defaulted.**
 *
 * A `?? 0` on a counted field is how a scan that opened nothing arrives on
 * screen reading as a scan that found nothing — the exact inversion the type
 * exists to prevent. A missing field fails the coverage, which fails the whole
 * reading, which is a card that says so.
 */
function parseScanCoverage(raw: unknown): ScanCoverage | null {
  if (!isRecord(raw)) return null;
  const transcriptsFound = counted(raw["transcriptsFound"]);
  const transcriptsSelected = counted(raw["transcriptsSelected"]);
  const transcriptsOpened = counted(raw["transcriptsOpened"]);
  const transcriptsUnreadable = counted(raw["transcriptsUnreadable"]);
  const linesScanned = counted(raw["linesScanned"]);
  const candidateLines = counted(raw["candidateLines"]);
  const linesParsed = counted(raw["linesParsed"]);
  const malformedCandidates = counted(raw["malformedCandidates"]);
  const quotaLimitsWithoutErrorSignal = counted(raw["quotaLimitsWithoutErrorSignal"]);
  const tookMs = counted(raw["tookMs"]);
  if (
    transcriptsFound === null ||
    transcriptsSelected === null ||
    transcriptsOpened === null ||
    transcriptsUnreadable === null ||
    linesScanned === null ||
    candidateLines === null ||
    linesParsed === null ||
    malformedCandidates === null ||
    quotaLimitsWithoutErrorSignal === null ||
    tookMs === null
  ) {
    return null;
  }
  const truncatedByLimit = raw["truncatedByLimit"];
  if (typeof truncatedByLimit !== "boolean") return null;
  const rawSince = raw["sinceMs"];
  /* `null` is a real value: the scan applied no mtime window at all. */
  if (rawSince !== null && (typeof rawSince !== "number" || !Number.isFinite(rawSince))) return null;
  const rawWhy = raw["unreadableWhy"];
  if (!Array.isArray(rawWhy)) return null;
  const unreadableWhy: string[] = [];
  for (const entry of rawWhy) {
    if (typeof entry !== "string") return null;
    unreadableWhy.push(entry);
  }
  return {
    transcriptsFound,
    transcriptsSelected,
    transcriptsOpened,
    transcriptsUnreadable,
    unreadableWhy,
    linesScanned,
    candidateLines,
    linesParsed,
    malformedCandidates,
    quotaLimitsWithoutErrorSignal,
    truncatedByLimit,
    sinceMs: rawSince === null ? null : rawSince,
    tookMs,
  };
}

/** A counted quantity: finite and non-negative. `-1` transcripts is a bug, not a reading. */
function counted(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
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
 *
 * **`receivedAt` IS THE BROWSER'S CLOCK AT THE MOMENT THE BODY ARRIVED**, and
 * it is required rather than defaulted to `Date.now()` because it is not the
 * same instant: transport.ts stamps it beside the read, and a default here
 * would quietly measure the parse instead. Together with the payload's
 * `servedAt` it gives the one skew every timestamp below is shifted by — see
 * `ClockSkew`, which also says why this is not a correction to `useNow()`.
 */
export function parseFleetState(raw: unknown, receivedAt: number): FleetStateRead {
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
  /* **ONE CONVERSION, HERE, AND EVERYTHING BELOW IS IN BROWSER TERMS.** Read
     before the rows so that every timestamp in this payload is shifted by the
     same measurement — a skew computed twice from the same numbers would still
     be two facts, and the page compares these ages against each other. */
  const clockSkew = readClockSkew(raw, receivedAt);
  const rows: FleetRow[] = [];
  let unreadableRows = 0;
  for (const item of raw["rows"]) {
    const row = parseRow(item, clockSkew);
    if (row === null) unreadableRows += 1;
    else rows.push(row);
  }
  return {
    ok: true,
    state: {
      clockSkew,
      /* SHIFTED. `collectedAge` subtracts this from the browser's clock, and
         before v0.4j that subtraction crossed two clocks — which is how a phone
         three minutes fast held the STALE banner on permanently. */
      collectedAt: shiftToBrowserClock(str(raw["collectedAt"]), clockSkew),
      tookMs: num(raw["tookMs"], 0),
      error: str(raw["error"]),
      /* **WHICH TMUX SERVER THESE HANDLES BELONG TO.** Every `$…` and `%…` in
         `rows` is meaningless without it: two snapshots with different values
         here describe different worlds, however alike `$1643` looks in both.
         Read here and drawn in the detail pane beside the handles themselves.

         Absent and unreadable both land on `null`, deliberately merged: the
         server sends `null` when it could not read the pid, and a server too
         old to send the field at all leaves the same hole — and in both cases
         the only honest sentence is *this page cannot tell you which tmux
         server these are*. There is nothing a reader would do differently. */
      tmuxServerPid: typeof raw["tmuxServerPid"] === "number" && Number.isFinite(raw["tmuxServerPid"]) ? raw["tmuxServerPid"] : null,
      /* **TOLD, NOT INFERRED — and it FAILS CLOSED.** The server had been
         sending this for a day and this parser did not read it, so a person
         tapped an option and got a 503, which is precisely the outcome the field
         exists to prevent (wire.ts § `answeringEnabled`). See
         `AnsweringReading`: four arms, and only a positive `enabled` is
         permission to draw a control. */
      answeringEnabled: readAnswering(raw),
      /* **BOTH CLOCKS SHIFTED BEFORE THE READING IS TAKEN**, not after. The
         helper's whole job is to compare `attemptedAt` against `collectedAt`,
         and the comparison downstream is against this browser's `now` — so they
         have to enter it already in browser terms or the reading would be one
         clock and its consumer another. `ClockSkew` says why the correction
         belongs at the boundary.

         `str()` collapses "the field is absent" and "the server sent null" onto
         the same `null`, which is exactly what `readAttemptClock` says it wants:
         the raw-JSON distinction between the two dies in the first thing that
         normalises one to the other, and a guard that survives only until
         somebody reasonable touches the pipe is not a guard. */
      attemptedAt: readAttemptClock({
        attemptedAt: shiftToBrowserClock(str(raw["attemptedAt"]), clockSkew),
        collectedAt: shiftToBrowserClock(str(raw["collectedAt"]), clockSkew),
      }),
      rows,
      unreadableRows,
      health: raw["health"] ?? null,
      /* **THE JOIN THIS STAGE EXISTS TO MAKE.** A producer with no consumer is
         the class of bug this page kept shipping, so the field is read here and
         one test walks a checkpoint on disk all the way to text in the DOM.
         Never throws and never fails the payload over a bad inbox: a page that
         went blank on it would have stopped saying what is running on the box,
         which is the more important half. */
      attention: parseAttention(raw["attention"], clockSkew),
      /* **IS SUPERVISION STILL WORKING?** — the same join, one field along, and
         it fails the same way: never throws, never fails the payload. A card
         that cannot read the Overseer's status must leave the sessions below it
         drawn, because a page that says nothing about what is running is worse
         than one that says it cannot tell whether anything is watching. */
      overseer: parseOverseer(raw["overseer"], clockSkew),
      /* **THE THIRD PROJECTION OUT OF THE SAME CHECKPOINT READ**, and the one
         that takes no `clockSkew`: its instants are drawn as wall-clock times
         in three zones rather than as ages, so shifting them would print a
         reset time that is not the reset time. `parseUsage` § NOTHING HERE IS
         SHIFTED. Fails the same way as the two above it — never throws, never
         fails the payload. */
      usage: parseUsage(raw["usage"]),
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
