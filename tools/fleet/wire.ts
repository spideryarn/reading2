/**
 * THE SHAPES THAT CROSS THE HTTP BOUNDARY, AND NOTHING ELSE.
 *
 * **This file has no imports and must never acquire one.** That is forced
 * rather than stylistic: `tools/fleet/web/tsconfig.json` is a separate project
 * with `types: ["vite/client"]` and no node types, so anything reachable from
 * here is compiled a second time under DOM-only libs. Every other home these
 * types could have reaches `node:child_process` transitively — `queue.ts` →
 * `steer.ts`, `status.ts` → `scripts/gjd-remote-tmux.ts`, `routes-actions.ts`
 * directly — and a client `import type` against any of them produces ~33
 * "Cannot find name 'node:child_process'" errors on sight. Measured, not
 * assumed; see docs/postmortems/260908b.
 *
 * That is *why* the twins existed: `QueueView` was declared once here and once
 * in `web/src/actions-client.ts`, related by nothing but hope, and four fields
 * (`stale`, `stuck`, `deliverable`, `invalidated`) reached the browser and were
 * dropped by the client on four separate occasions in one night. The compiler
 * could not have said so, because nothing related the two declarations.
 *
 * So: **types only, no runtime values, no imports.** A `const` here would be
 * bundled into the browser; an import here would take the client's project with
 * it.
 */

/* ------------------------------------------------------------------ *
 * Who is speaking.
 * ------------------------------------------------------------------ */

/**
 * Who is speaking, which the receiving agent must be able to tell.
 *
 * From the wide review (A12): "An Overseer message must not acquire Greg's
 * authority by arriving as a user turn." Every message reaches an agent as an
 * ordinary user turn, which is the most authoritative thing in its context, so
 * a coordinator's proposal and Greg's instruction are indistinguishable unless
 * the text says which it is. A model's recommendation must not mint its own
 * approval.
 */
export type Speaker = "greg" | "overseer";

/* ------------------------------------------------------------------ *
 * The spoken half of the vocabulary.
 * ------------------------------------------------------------------ */

export type SpokenActionId =
  | "continue"
  | "compact"
  | "pull"
  | "push"
  | "run-checks"
  | "report-status"
  | "ease-off"
  | "sleep-1h"
  | "sleep-3h"
  | "sleep-5h"
  | "sleep-10h"
  | "ask-fable"
  | "ask-sol"
  | "wrap-up"
  | "stop-and-ask";

/**
 * A sentence delivered to one session's input box.
 *
 * `text` is ONE LINE, always, and that is a hard constraint rather than a house
 * style: `checkText` in steer.ts refuses a message containing a newline,
 * because Claude Code's input box submits on Enter and a two-line message is
 * two messages, the first of them half a sentence. So these read as dense
 * paragraphs. tests/fleet-actions.test.ts asserts every one of them survives
 * `checkText`, which is the check that would otherwise be made at the moment
 * somebody presses the button.
 */
export type SpokenAction = {
  effect: "spoken";
  id: SpokenActionId;
  scope: "session";
  /** What the button says. */
  label: string;
  /** One line, for a tooltip or a coordinator's log. */
  summary: string;
  /**
   * The exact words. **This is a prompt a real agent will act on**, not a
   * label, so it is written to be acted on: it says what to do, names the
   * mechanism where the mechanism is the part that goes wrong on this box, and
   * asks for an answer back where the answer is the point.
   */
  text: string;
  /**
   * `slash-command` means Claude Code EXECUTES it rather than the agent
   * judging it, so it happens even to an agent that would have pushed back.
   * `/compact` is the only one today. Kept as a field rather than a comment
   * because the confirmation a UI should show is different: an agent can
   * decline a sentence, and cannot decline a slash command.
   */
  form: "prose" | "slash-command";
  /** Should the UI ask twice? True where the effect is hard to undo. */
  needsConfirm: boolean;
};

/* ------------------------------------------------------------------ *
 * What can be queued.
 * ------------------------------------------------------------------ */

/**
 * An action or a free-text message, in ONE queue.
 *
 * Greg asked for them combined — "one could press more than one, in
 * combination with messages" — and combining them is not a convenience: a
 * message that says "actually do X instead" must land after the button that
 * says "do X" and before the one that says "push", and two queues cannot
 * promise that.
 *
 * **`SpokenAction`, not `Action`, and that is a boundary rather than a
 * convenience.** An enacted action — `remove-worktree`, `kill-session` — cannot
 * be REPRESENTED as a queued item, so nothing downstream needs a defensive
 * branch for one and nobody can add a second way in. See `enqueueAction` for
 * why the retreat was made and what to delete first when it is reversed.
 */
export type QueuedPayload = { kind: "action"; action: SpokenAction } | { kind: "message"; text: string };

export type QueuedItem = {
  /** Stable for the life of the item, and what `cancel` and `settle` name. */
  id: string;
  /** tmux's session handle (`$1643`) — which queue this is in. */
  sessionId: string;
  /**
   * The CONVERSATION this was queued against, and the field that stops the
   * commonest wrong delivery.
   *
   * A pane can be resumed into a different Claude conversation while an item
   * waits (`gjd-remote resume` keeps the pane and the tmux session and starts a
   * new conversation), and then everything else about the target still matches.
   * steer.ts refuses that at send time because `SteerTarget` carries the uuid;
   * this field is what lets the QUEUE refuse it first, and say why on the page,
   * instead of the person seeing a send fail for an obscure reason.
   */
  claudeSessionId: string;
  payload: QueuedPayload;
  /**
   * WHO ASKED FOR THIS, and it travels with the item because the words are
   * rendered at DELIVERY rather than here.
   *
   * `renderBroadcast` already says why nothing is rendered at enqueue: a
   * sentence written twenty minutes before it is typed has decayed by the time
   * anybody reads it. The same argument makes the speaker a FIELD rather than a
   * prefix baked into `payload.text` — and it is the field that stops an
   * automated coordinator's instruction reaching an agent as an ordinary user
   * turn indistinguishable from Greg's. See actions.ts § `Speaker` (A12).
   *
   * Not optional, and there is no default here on purpose: "who is speaking" is
   * the one thing a caller of this queue may not decline to say. The place that
   * decides what an absent claim means is `parseSpeaker`, at the HTTP boundary,
   * where the claim actually arrives.
   */
  speaker: Speaker;
  enqueuedAt: number;
  /** When `next()` handed it out. Null while it is waiting. */
  leasedAt: number | null;
  /**
   * Why this can never be delivered, or null. Set by `noteGeneration`.
   *
   * A tmux server restart takes every session with it and RE-ISSUES the same
   * `$…` and `%…` handles to whatever comes next, so an item queued against the
   * old server names a session that no longer exists — and names it with digits
   * that now belong to somebody else. There is no per-item field that could
   * catch that (`claudeSessionId` survives a resume, `panePid` is optional), so
   * it is caught for the whole queue at once, when the generation changes.
   *
   * A SENTENCE RATHER THAN A BOOLEAN, and the item stays in the snapshot
   * carrying it: the page shows why it will not happen. Deleting the items
   * would be the quiet loss this file's header is about.
   */
  invalidated: string | null;
};

/* ------------------------------------------------------------------ *
 * The queue, as GET /api/actions sends it.
 * ------------------------------------------------------------------ */

/**
 * One item as the page reads it, with the two judgments only the queue can make.
 *
 * `stale` and `stuck` are both the QUEUE's rules asked rather than recomputed
 * (`isStale`, `isStuck`), because both are comparisons against limits the page
 * has never been told, and a page that guessed either would draw a recovery
 * button a moment before or after the server would honour it.
 */
export type QueuedItemView = QueuedItem & { stale: boolean; stuck: boolean };

export type QueueView = {
  sessionId: string;
  items: QueuedItemView[];
  /**
   * How many of `items` could still reach a pane — `SteeringQueue.isDeliverable`
   * counted, which is neither `items.length` nor `items.length` minus the
   * obvious ones. The page uses it to decide whether anything is genuinely
   * ahead of a new message; see the comment on the field's producer.
   */
  deliverable: number;
  volatile: true;
  warning: string;
  since: number;
};

/* ------------------------------------------------------------------ *
 * Claude usage limits, as tools/overseer/usage.ts measures them.
 *
 * Produced by `collectUsage` there; rendered by the fleet dashboard. Declared
 * here rather than in usage.ts because usage.ts reaches `node:child_process`
 * and `node:fs` — the exact transitive closure this file's header says must
 * never become reachable from the client project.
 *
 * The measurements behind these shapes are in
 * docs/project/orchestrator-direction.md § "What is actually observable about
 * usage limits". Two facts drive every design choice below, and neither is
 * obvious from the field names alone:
 *
 *  - `~/.claude.json`'s cached utilisation IS A CACHE, and a stale entry reads
 *    exactly like a current one. Measured: a file 48 minutes old whose
 *    `five_hour` window had reset 27 minutes earlier still read
 *    `utilization: 70`.
 *  - A 429 written into a session's own transcript cannot be stale, so it is
 *    the ground truth and the cache is only a hint.
 * ------------------------------------------------------------------ */

/**
 * A usage window's name, VERBATIM from the source — `five_hour`, `seven_day`,
 * and, in the cache, a rotating set of per-model codenames (`nimbus_quill`,
 * `iguana_necktie`, `seven_day_opus`, …) that Anthropic adds and removes
 * without notice.
 *
 * Deliberately open, and not a closed union. A closed union would be a lie the
 * first time a codename appears, and — worse — the kind of lie that lets an
 * exhaustive `switch` compile while silently dropping a real window. The two
 * stable names are `KnownUsageWindow`; render anything else by its raw name.
 */
export type UsageWindowName = string;

/**
 * The two windows stable enough to branch on.
 *
 * A literal union rather than a `const` array, because this file may hold no
 * runtime values — a `const` here would be bundled into the browser. The array
 * lives in tools/overseer/usage.ts and is typed against this.
 */
export type KnownUsageWindow = "five_hour" | "seven_day";

/**
 * One window's cached utilisation.
 *
 * `expired` CARRIES NO PERCENTAGE, and not by omission — not even under a name
 * like `stalePercent`. The measured failure is that a void number reads exactly
 * like a live one, and a renderer handed a numeric field will eventually render
 * it, which is how the void number gets back on screen with a different label.
 * The stale number survives as prose inside `why`, where it cannot be mistaken
 * for a reading. Same repair as this file's own reason for existing: the
 * consumer is not given the option.
 */
export type UsageWindowReading =
  | {
      kind: "value";
      window: UsageWindowName;
      /** 0-100, as the file gives it. */
      utilizationPercent: number;
      /** ISO 8601, verbatim from `resets_at`. */
      resetsAt: string;
      resetsAtMs: number;
      /** How long until this window resets, from the `now` the producer was given. Always > 0 here. */
      msUntilReset: number;
    }
  | {
      kind: "expired";
      window: UsageWindowName;
      resetsAt: string;
      resetsAtMs: number;
      /** How long ago it reset. */
      msSinceReset: number;
      /** Including the stale percentage, in words. */
      why: string;
    }
  | { kind: "unknown"; window: UsageWindowName; why: string };

/**
 * The whole `.cachedUsageUtilization` blob.
 *
 * `accountUuid` is not decoration: after a `/login` swap the cache can still
 * hold the PREVIOUS account's numbers, so a reading has to say whose it is.
 * The verdict refuses to let a cache from another account influence its level.
 */
export type UsageCacheReading =
  | {
      kind: "value";
      accountUuid: string | null;
      fetchedAtMs: number;
      /** now - fetchedAtMs. Age alone does NOT invalidate a window; `resets_at` does. */
      ageMs: number;
      /** One entry per window present in the file. Windows the file says are null are absent, not zero. */
      windows: UsageWindowReading[];
    }
  | { kind: "unknown"; why: string };

/**
 * Which account a reading belongs to.
 *
 * Recorded, never rotated: multiple Max subscriptions is medium-term by Greg's
 * explicit call, so this stage records which account and builds no rotation.
 */
export type UsageAccount =
  | {
      kind: "value";
      email: string | null;
      orgId: string | null;
      orgName: string | null;
      /** `max`, `pro`, … from `claude auth status`. */
      subscriptionType: string | null;
      /** From `.oauthAccount`; the key the cache's own `accountUuid` is compared against. */
      accountUuid: string | null;
      /** e.g. `default_claude_max_20x`. */
      rateLimitTier: string | null;
    }
  /** `claude auth status` answered, and the answer was "nobody is logged in". Not a failure. */
  | { kind: "logged-out"; projectsDirectory: string | null }
  | { kind: "unknown"; why: string };

/** One real 429, as written into a session's transcript. Ground truth; cannot be stale. */
export type RateLimitHit = {
  /**
   * STABLE ACROSS SCANS, and that is the whole point of the field.
   *
   * Derived from the transcript path, the rejection's own timestamp and its
   * window — never random, never minted per pass. A store carrying a rejection
   * forward between scans has to recognise the same rejection when it sees it
   * again, and an id that changed every pass would make every rejection look
   * new: nothing would ever be matched, nothing would throw, and the count would
   * quietly drift. `tests/overseer-usage.test.ts` scans one transcript twice and
   * asserts the ids are identical, because "stable" is a property an
   * innocent-looking change can break with nothing failing.
   *
   * It exists because the alternative was the consumer composing a key by hand,
   * and the parts that make such a key correct are facts only the producer can
   * see: `claudeSessionId` is NOT unique (a subagent's rejection carries the
   * parent conversation's id) and neither is `resetsAtMs` (27 rejections on this
   * box share one). A derivation rule in the consumer is a second hand-written
   * declaration of one contract, and this one would fail silently — two
   * rejections collapsing into one does not throw, it under-reports.
   *
   * Stable for a given projects directory. Moving that directory changes every
   * id, which is right in the case that matters (a different `CLAUDE_CONFIG_DIR`
   * holds a different account's transcripts) and merely wasteful otherwise.
   */
  id: string;
  /** `quotaLimits.rateLimitType` verbatim — `five_hour` or `seven_day` in every record seen. */
  window: UsageWindowName;
  /** `quotaLimits.resetsAt`, normalised to ms. */
  resetsAtMs: number;
  /** The transcript record's own `timestamp`, normalised to ms, or null if it had none. */
  hitAtMs: number | null;
  /** ISO, verbatim from the record. */
  hitAt: string | null;
  /** `quotaLimits.status`, e.g. `rejected`. */
  status: string | null;
  /**
   * THE CONVERSATION UUID — the same id `QueuedItem.claudeSessionId` carries,
   * and NOT tmux's session handle (`$1643`) or a pane id (`%2108`).
   *
   * Named in full because all three are in play on the dashboard's rows and
   * they are not interchangeable: joining a rate limit against the wrong one
   * puts a red badge on an agent that is working fine. It comes from the
   * transcript record's own `sessionId` field, which is also the transcript's
   * filename, so it is the id of the conversation that was rejected.
   */
  claudeSessionId: string | null;
  /** Absolute path of the transcript the record was found in. */
  transcriptPath: string;
  /** The synthetic assistant message, e.g. "You've hit your session limit · resets 7:50am (Europe/London)". */
  message: string | null;
};

/**
 * THE POSITIVE CONTROL. A probe that finds nothing must prove it looked.
 *
 * Every number here is counted by the scan itself, so "no 429s" reads as
 * "opened 235 transcripts, scanned 232,961 lines, found none" rather than as an
 * unfalsifiable zero. The producer will not return `none` unless
 * `transcriptsOpened` and `linesScanned` are both above zero and nothing
 * rate-limit-shaped went unread. A renderer showing "no limits hit" should show
 * these alongside it — and must respect `truncatedByLimit`, which means the
 * absence covers less ground than it looks like.
 */
export type ScanCoverage = {
  /** Transcripts the directory walk listed. */
  transcriptsFound: number;
  /** Those inside the mtime window and the transcript bound — the ones the scan meant to read. */
  transcriptsSelected: number;
  /** Transcripts actually opened and read to the end. THE number that makes a zero believable. */
  transcriptsOpened: number;
  /**
   * Transcripts that vanished or errored between listing and reading. Real: on
   * a box with live sessions a transcript can disappear between `readdir` and
   * `open`, which killed a first pass of this scan outright.
   */
  transcriptsUnreadable: number;
  /** Up to five of the unreadable ones, in the tool's own words. */
  unreadableWhy: string[];
  linesScanned: number;
  /** Lines carrying the rate-limit marker, and so parsed as JSON. */
  candidateLines: number;
  /** Candidates that parsed. `candidateLines - linesParsed` did not, which a live file makes normal. */
  linesParsed: number;
  /**
   * Candidates carrying a quota object the parser could not read — a rename or a
   * shape change, not an absence. Non-zero with no hits forces `unknown`.
   */
  malformedCandidates: number;
  /** Candidates carrying a readable quota object but no rejection signal. Drift made visible; not fatal. */
  quotaLimitsWithoutErrorSignal: number;
  /** The transcript bound cut the selection short: an absence covers less than the window claims. */
  truncatedByLimit: boolean;
  /** The mtime window applied, in ms, or null for "everything". */
  sinceMs: number | null;
  /** Wall-clock cost, so a caller can see what a poll is buying. */
  tookMs: number;
};

export type RateLimitScan =
  | { kind: "hits"; hits: RateLimitHit[]; coverage: ScanCoverage }
  | { kind: "none"; coverage: ScanCoverage }
  | { kind: "unknown"; why: string; coverage: ScanCoverage };

/**
 * One conversation's answer, for a dashboard row.
 *
 * `cannot-tell` exists for the same reason `UsageWindowReading` has no
 * percentage on its expired arm, one level up: a bare `null` would collapse
 * "this conversation has no limit in force" with "the scan could not tell",
 * and the second has to reach the page as a sentence rather than as silence.
 */
export type ConversationRateLimit =
  | { kind: "hit"; hit: RateLimitHit }
  | { kind: "none" }
  | { kind: "cannot-tell"; why: string };

export type UsageLevel = "ok" | "approaching" | "limited" | "unknown";

/**
 * The verdict.
 *
 * `limited` means a 429 whose window has not yet reset — ground truth, and the
 * arm a "Hit usage limits" status should read. `approaching` is derived from
 * the cache and is therefore a hint; it is never reported from an expired
 * window, nor from a cache belonging to a different account. `unknown` is a
 * fourth arm rather than a fallback to `ok`, for the reason health.ts has one:
 * a level computed while every source failed would say "fine" and mean nothing.
 */
export type UsageVerdict = {
  level: UsageLevel;
  reasons: string[];
  /**
   * The unexpired hit driving `limited`, or null.
   *
   * When several are in force this is the one that frees up LAST, because "due
   * back at" has to be the moment work can actually resume — not the moment the
   * first window clears.
   */
  activeLimit: RateLimitHit | null;
};

export type UsageReport = {
  account: UsageAccount;
  cache: UsageCacheReading;
  rateLimits: RateLimitScan;
  verdict: UsageVerdict;
  collectedAt: string;
  tookMs: number;
};
