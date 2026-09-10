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
 *
 * ## Adding to this file, when several sessions are doing it at once
 *
 * Six sessions have appended here in two days, so the convention matters more
 * than it looks. **Append a new block at the end; do not reorganise what is
 * above it.** A rename in this file is invisible to a client that re-declares
 * the same shape by hand, which is the whole reason the file exists.
 *
 * **Open your block with a UNIQUELY NAMED banner, not the bare separator.**
 * Measured 2026-09-09: two sessions appended disjoint blocks within minutes of
 * each other and git conflicted them anyway — not on any type, but on the
 * identical decorative separator line both blocks opened with (a slash-star
 * banner rule, which cannot be written out here without ending this comment).
 * The append rule was
 * written to stop somebody reorganising existing types, and accidentally
 * guaranteed a textual conflict between two people following it perfectly. A
 * banner naming the block has nothing in common with anyone else's.
 *
 * **If you do have to resolve a conflict here, verify the result rather than
 * reading it.** Reconstruct as (merge-base + theirs + yours) from the two
 * parents, then assert that every `export type` name from BOTH sides survives,
 * and count them. Hand-resolving a long conflict region is exactly where one
 * declaration goes missing silently, and "keep both blocks" looks so obviously
 * right that nobody re-counts afterwards. The mirror image has bitten this repo
 * too: a merge that DUPLICATED a list entry it did not conflict on, with no
 * markers and every test green.
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
export type Speaker = "greg" | "overseer" | "dashboard";

/*
 * **`dashboard` IS A REPORT, NEVER AN INSTRUCTION, AND THE ARM SPLITS IF THAT
 * STOPS BEING TRUE.** Added 2026-09-09 for the line the web UI sends when a
 * person starts a new session, so the receiving agent is told an event happened
 * rather than asked for anything.
 *
 * It is a third arm rather than a reuse of either existing one, and both
 * alternatives were wrong in the direction this type exists to prevent.
 * `greg` would mint his authority for something nobody instructed — the exact
 * failure A12 names. `overseer` would attribute a notification to a coordinator
 * that did not send it. A person acted and software is reporting it, which is
 * neither.
 *
 * So its prefix says plainly that nothing is being asked, which the other two
 * do not need to say because both of theirs ARE asking something. The wording
 * was reviewed by the session that receives it, which is a better test of it
 * than the judgement of the session that wrote it.
 *
 * **If anything ever goes through this arm that IS an instruction, the prefix
 * becomes a false statement** and this must split into two arms rather than
 * having its wording softened. Do not reach for `dashboard` as a
 * general-purpose "not Greg" speaker; that is what `overseer` is, and it says
 * so.
 */

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
  /**
   * Stable for the life of the item, and what `cancel` and `settle` name.
   *
   * **OPAQUE TO THE CLIENT, AND THAT IS A RULE RATHER THAN AN OBSERVATION.**
   * The browser stores whatever string it was handed and gives it back
   * unexamined; nothing outside `SteeringQueue` may parse it or build one.
   * Since 2026-09-08 it carries the RUN of the server that minted it, because
   * a per-process counter re-issues `q1` after every restart and a phone left
   * open across one was able to cancel a stranger's instruction and be told it
   * had worked. `SteeringQueue.idOrigin` reads the run back; the four routes
   * that accept an id from a client refuse a foreign one as `other-instance`.
   * A client that started splitting on the separator would make that shape
   * impossible to change again.
   */
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
  volatile: boolean;
  warning: string;
  since: number;
  /**
   * The hold stopping this session from being drained, or null.
   *
   * **A QUEUE IS ON THE WIRE WHEN IT HAS ITEMS *OR* THIS**, which is the
   * whole reason the field is here rather than on a feed of its own: the
   * commonest hold has NO items behind it — one message was queued, the send
   * came back `partial`, the item settled `uncertain` and left — so a page
   * that drew a queue only when `items.length > 0` would draw nothing at all
   * over a session nothing may be sent to. See `QuarantineHoldView`, and
   * `SteeringQueue.snapshots`, which is the filter that had to change.
   */
  quarantine: QuarantineHoldView | null;
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
 * docs/project/overseer-direction.md § "What is actually observable about
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

/**
 * What the Overseer's checkpoint knows about usage limits — **and why it might
 * know nothing**, which is three different facts rather than one absence.
 *
 * A bare `UsageReport | null` would put *no pass has ever run*, *the stored
 * report was unreadable* and *this checkpoint predates the field* in one slot.
 * The first is ordinary, the second means something is wrong with the store, and
 * the third means the reader is newer than the writer. They call for different
 * words on a page and only `why` can carry the difference.
 *
 * **There is deliberately no empty-report arm.** A scan that found nothing is a
 * `UsageReport` whose `rateLimits` say so, with its own `collectedAt`; inventing
 * a report to mean *we have not looked* would be the most reassuring possible
 * lie, which is the same trap `attentionNotYetRun` exists to avoid.
 *
 * `at` is when the checkpoint was written, NOT when anything was scanned —
 * nothing was. A report's own `collectedAt` is the only instant that can tell a
 * quiet account from a pass that stopped running.
 */
export type StoredUsage =
  | { kind: "report"; report: UsageReport }
  | { kind: "none"; why: string; at: string };

/* ------------------------------------------------------------------ *
 * Which harness is in a pane, and what may honestly be done to it.
 * ------------------------------------------------------------------ */

/**
 * The harnesses this box can tell apart.
 *
 * From the direction doc's principle: *"One adapter per harness, and honest
 * about what each can do. Claude, Codex and bare shells have genuinely
 * different capabilities; flattening them into one 'message an agent' verb
 * produces a UI that lies."*
 *
 * The KIND is here because the page renders it. The EVIDENCE for it — which
 * pid, how many hops below the pane — is `Harness` in
 * `tools/overseer/harness.ts` and stays on the server, because it is a fact
 * about a process tree rather than anything a button needs.
 *
 * `unknown` is a real arm, not a fallback. A pane we could not identify is a
 * pane nothing may be typed at, and saying so out loud is the point.
 *
 * MEASURED ON THIS BOX, 2026-09-08 at 12:15 UTC, 26 panes: 17 `claude-code`, 6
 * `shell`, 1 `codex-batch`, 2 `codex-interactive`, 0 `claude-headless`, 0
 * `unknown`. Seventeen minutes earlier the same measurement found 22 panes and
 * **no Codex of any kind**, so a Codex column that renders empty is a reading
 * of a moving fleet rather than a bug to chase — and an empty one is not
 * evidence that the arm is dead code.
 */
export type HarnessKind =
  | "claude-code"
  | "claude-headless"
  | "codex-batch"
  | "codex-interactive"
  | "shell"
  | "unknown";

/**
 * May we do this, and if not, what does the reader get told?
 *
 * NOT A BOOLEAN. A greyed-out button with no sentence beside it is a UI saying
 * "no" and meaning "I am not going to tell you", and the reader of that goes
 * and does the thing by hand in the terminal instead. The `why` IS the feature.
 *
 * **THE CLIENT MUST DERIVE A THIRD ARM FROM THIS RATHER THAN CONSUME IT
 * DIRECTLY.** This crosses as JSON, so the field can be absent — an older
 * server, a partial response — and an absence is a claim nobody made. Reading a
 * missing field as `can: false` invents a refusal; reading it as `can: true`
 * invents a grant and offers an action that cannot work. The client's parse
 * needs a `not-told` arm of its own. That is the sixteenth instance in
 * docs/postmortems/260908b, and the one that keeps coming back.
 */
export type Capability = { can: true } | { can: false; why: string };

/**
 * The three questions worth asking of a harness, and why they are three rather
 * than one.
 *
 * `steerWithProse` and `answerDialog` come apart, and not hypothetically: a
 * Claude session sitting on a trust dialog can be sent `Down` then `Enter` at a
 * moment when a sentence would be swallowed by that dialog, and the two were
 * proven on different days by different means. Collapsing them into "can I talk
 * to it" would have to pick one and would be wrong about the other.
 *
 * `watch` is here even though everything on this box can be watched, because a
 * capability set in which nothing is ever true reads as a list of excuses. It
 * is also the first arm a remote or cloud session would refuse.
 */
export type HarnessCapabilities = {
  /** Free prose, delivered to be READ as a message rather than executed. */
  steerWithProse: Capability;
  /** A recognised dialog answered with an arrow key or a digit. */
  answerDialog: Capability;
  /** Reading the pane's screen and its process tree. */
  watch: Capability;
};

/* ------------------------------------------------------------------ *
 * Dictation: POST /api/transcribe.
 * ------------------------------------------------------------------ */

/**
 * A recording, on its way to be turned into words.
 *
 * **`audio` is base64 of somebody talking in Greg's room**, which is a class of
 * payload nothing else on this server handles. Three rules follow it everywhere
 * it goes: it is never logged, its size is never logged either (a running tally
 * of request sizes is a picture of when somebody was talking), and it is held
 * for one request and then dropped.
 *
 * `format` is the container word, not a MIME type — `formatOf` in
 * `src/dictation-limits.ts` maps one to the other in the browser, and the server
 * checks the result against the same closed list. A wrong container is not a
 * rejection, it is a transcript of noise.
 */
export type TranscribeRequest = {
  audio: string;
  format: string;
  /**
   * Which box this came from, so the vocabulary can be built for it.
   *
   * `session` names a tmux handle the snapshot already knows — the server looks
   * it up rather than trusting it, so the worst a crafted value can do is miss.
   * `new-session` is the box that starts an agent, which relates to no session
   * yet and gets the fleet-wide list.
   */
  context: { kind: "session"; sessionId: string } | { kind: "new-session" };
};

/**
 * What came back.
 *
 * **An empty `text` is a success**, not a failure: somebody who pressed the
 * button and said nothing must have their box left exactly as it was rather
 * than be told something went wrong.
 *
 * A failure is `{ error }` with the sentence in it, and the HTTP status carries
 * whether a second identical request could work — read off the number rather
 * than out of the prose, because the prose is freely rewritable and the branch
 * is not.
 */
export type TranscribeResponse = { text: string };

/* ------------------------------------------------------------------ *
 * The attention inbox. Produced by the Overseer, rendered by the page.
 *
 * The premise it corrects was measured on the live fleet 2026-09-08 and is
 * written up in docs/project/overseer-direction.md § `idle` is the bug:
 * `needs-you` means *Claude Code says a dialog is open*, and TEN OF FIFTEEN
 * sessions genuinely waiting on Greg had ended their turn handing him a
 * decision in sentences, with not one of them showing as needing him. A
 * mechanical check found 1 of 23 by grepping for question marks, because the
 * decisions end in full stops. So a list built from `needs-you` alone is a list
 * of the cheapest thing on the box.
 * ------------------------------------------------------------------ */

/** Why we believe this needs Greg. The two arms are answered by DIFFERENT MECHANISMS. */
export type AttentionEvidence =
  | {
      /** The harness says a dialog is open. Mechanical, observed, and it has options. */
      kind: "dialog";
      question: string;
      /** In the order the harness drew them. Answering picks one of these. */
      options: readonly string[];
    }
  | {
      /** The turn ended handing Greg a decision in prose. INFERRED, and it may be wrong. */
      kind: "prose";
      /** The tail of the turn, so a person can check the inference rather than trust it. */
      excerpt: string;
      /** What made us think so, in words. Never a score. */
      why: string;
    };

/** Consequence and reversibility. NOT confidence, and NOT urgency. */
export type AttentionKind = "irreversible" | "product" | "technical" | "other";

/** Whether answering this from a phone is a real option. */
export type AttentionAnswerability =
  | { kind: "phone" }
  | { kind: "needs-a-screen"; why: string }
  | { kind: "unknown"; why: string };

export type AttentionItem = {
  /** Stable across snapshots, so a card cannot move under a finger. */
  id: string;
  /** tmux's own handle — the address, and stable across renames. */
  sessionId: string;
  sessionName: string;
  /** When we FIRST saw this question. Not when we last saw it. */
  waitingSince: string;
  kind: AttentionKind;
  evidence: AttentionEvidence;
  answerability: AttentionAnswerability;
  /** Other sessions asking the same thing. Answer once, apply to all. */
  duplicates: readonly { sessionId: string; sessionName: string; waitingSince: string }[];
};

export type AttentionList =
  | {
      kind: "list";
      /** Already sorted: by `kind` first, then by `waitingSince`. The renderer must not re-sort. */
      items: readonly AttentionItem[];
      /** THE POSITIVE CONTROL. Zero items out of zero scanned is a broken probe. */
      sessionsScanned: number;
      /**
       * Sessions we TRIED to judge and could not — a pane that would not parse, a
       * gateway that returned 429, a tail the budget did not reach.
       *
       * **NEVER a session we correctly declined to judge.** A mid-turn agent is
       * not waiting on anybody and skipping it is right rather than incomplete;
       * so is a Codex pane, a shell, and a permission dialog. If deliberate skips
       * landed here the number would be non-zero on almost every pass, the page
       * would carry a permanent caveat, and Greg would learn to read past it —
       * which is A17 again, healthy operation spending most of its time alarming.
       * **Render a line only when it is non-zero.**
       *
       * It exists because suppressing the claim of ABSENCE leaves the claim of
       * COMPLETENESS standing. A list of two says *these two need you*, which is
       * true, and a reader takes *and only these two*, which may not be — and
       * that inference is a negative claim about the other thirty. An incomplete
       * observation may not be read as a negative one.
       *
       * Added 2026-09-08 after GPT Sol found a 429 publishing an empty list with
       * every count green: `breakdownBalances()` proved the WALK happened and
       * could not prove the JUDGEMENT did. A positive control proves the step it
       * wraps and nothing above it.
       */
      sessionsUnreadable: number;
      scannedAt: string;
    }
  | { kind: "unknown"; why: string; scannedAt: string };

/* ------------------------------------------------------------------ *
 * Why a session is not doing anything, which is three facts wearing one word.
 * ------------------------------------------------------------------ */

/**
 * **A session that is paused, and what it is waiting for.**
 *
 * Greg, 2026-09-08: *"can you try and distinguish between statuses like
 * `Working`, `Hit usage limits`, and `Paused/waiting` (e.g. because it's been
 * asked to run Unix sleep or idle waiting for a CronCreate or similar, i.e.
 * it's kind of idle, but with an intention to reactivate, and ideally make a
 * note of when it should reactivate (and whether it's overdue))"*.
 *
 * ## This is an added fact, NOT an eighth `FleetStatus` arm
 *
 * v0.4d decided the general form of this question — *how `idle` splits is an
 * added fact, not another status* — and the research for this stage looked for
 * an argument against that and did not find one. A cron-parked session is
 * genuinely `idle`: it is at a prompt, and typing at it works. So is a
 * rate-limited one. Making it a status would also mean touching **five**
 * exhaustive switches (`triageRank`, `steerableStatus`, `drainGate`,
 * `deliveryGate`, `modeApplicability`) to say something none of them needs to
 * know.
 *
 * ## Where these states actually hide, measured rather than assumed
 *
 * Under `idle`, not `working`. A pending `CronCreate` wake-up was found on
 * **8 of 11 idle rows** in one pass, and a rate-limited session prints its
 * error, ends its turn and stops — so it reads `idle` too. The stage began
 * from the opposite assumption and the measurement corrected it.
 *
 * ## `none` is a claim, and it is the one that will be got wrong
 *
 * `none` says *we looked, everywhere we can look, and this session is not
 * waiting for anything*. It is not a default and it is not what silence
 * produces. Every source that could not be consulted — a transcript tail that
 * ran out of window before reaching the start of the file, a session store that
 * could not be read, a rate-limit scan nothing has run yet — comes back as
 * `cannot-tell` with the reason. Folding those into `none` is the
 * ambiguous-negative mistake this module made three times in one night, and it
 * costs more here than anywhere else: a rate-limited session never resumes by
 * itself, so one nobody restarts is an hour of nothing. Measured on
 * 2026-09-08: a limit hit at 06:02 with `resetsAt` 06:30, and the next turn was
 * a person typing "Continue" at 08:21 — **111 minutes**.
 */
export type Pause =
  | { kind: "none" }
  | {
      kind: "rate-limited";
      /**
       * The window's own name, verbatim from the record — `five_hour`,
       * `seven_day`, or one of the rotating per-model codenames.
       *
       * **Deliberately not a closed union.** The cache carries names that
       * appear and vanish without notice, and an exhaustive switch over them
       * would silently drop a real one. `isKnownUsageWindow` in
       * `tools/overseer/usage.ts` narrows the two worth naming; the rest render
       * by raw name.
       */
      window: string;
      resetsAt: string;
      /**
       * True only when `resetsAt` is in the past AND the session has taken no
       * turn since. A rate-limited session never resumes by itself (Fable,
       * 2026-09-08), so this is deterministic rather than a guess — and it may
       * be set only when `resetsAt` was actually read.
       */
      overdue: boolean;
    }
  | { kind: "scheduled-wakeup"; at: string; overdue: boolean; source: "cron" }
  /**
   * The agent's turn has ENDED and something it backgrounded is still running.
   *
   * **It is at a prompt and can be messaged.** Named `in-a-shell-call` for four
   * hours on 2026-09-08, which was the field's name read as its meaning:
   * Claude Code emits `status: "shell"` when
   * `baseStatus === "idle" && hasUnfinishedLocalBash`, and a *backgrounded* task
   * counts. So the commonest healthy state on this box — idle at a prompt with a
   * dev server or a test run behind it — was being rendered as *blocked on a
   * command it started*.
   */
  | { kind: "background-work"; sinceMs: number }
  | { kind: "cannot-tell"; why: string; cause: PauseUnknownCause };

/**
 * WHY we could not tell, as a name rather than only a sentence.
 *
 * `tail-window-exhausted` is the one that will bite: the tail read stops at a
 * byte budget without reaching the start of the file, so the evidence may be
 * above it. That is a different fact from having read the whole file and found
 * nothing, and only one of the two is `none`.
 *
 * `rate-limits-not-collected` is the honest state of the world until the
 * Overseer publishes a usage report on a cadence — the scan costs seconds on a
 * loaded box, which is far too much for a 73-second refresh loop, so this
 * module reads a published reading rather than running one.
 */
export type PauseUnknownCause =
  | "tail-window-exhausted"
  | "no-transcript"
  | "transcript-unreadable"
  | "no-conversation-id"
  | "session-store-unreadable"
  | "rate-limits-not-collected"
  /**
   * A rate-limit scan RAN and could not answer for this session.
   *
   * The eighth arm, and it is a different fact from `rate-limits-not-collected`:
   * that one means nobody looked, this one means somebody looked and the
   * evidence did not settle it. On this box in the week of 2026-09-08 that is
   * the ordinary case — 27 rejections belong to a Max account Greg is no longer
   * signed into, they carry no account id, and the only artefact that could
   * attribute them is a cache whose window disagrees. So the collector reports
   * `unknown` rather than naming a limit it cannot attribute, and this is the
   * cause that carries that sentence to the page.
   *
   * Distinct from the other one because the remedies differ: "nobody looked" is
   * fixed by publishing a reading, and "looked and could not tell" is fixed by
   * signing in, or by waiting for the rejections to expire.
   */
  | "rate-limits-unreadable"
  /**
   * A wake-up WAS found and its time could not be worked out — a recurring
   * expression, a step, a range.
   *
   * The seventh arm, and it is a different shape from the other six: those are
   * all about failing to REACH a source. This one is about reaching it and
   * finding something we know is pending and cannot put a clock on. It is not
   * `none`, because something is genuinely waiting; it is not
   * `transcript-unreadable`, because the transcript read perfectly well.
   *
   * Added 2026-09-08 after the reader was built: the module had been mapping
   * this case onto `transcript-unreadable` through a single named constant,
   * with the specifics in `why`, and said so rather than editing this type
   * unilaterally. That was the right way round — the sentence stayed true while
   * the name was wrong, and one constant meant the repair is one line.
   */
  | "schedule-not-parseable";


/* ------------------------------------------------------------------ *
 * What happened to the keystrokes.
 * ------------------------------------------------------------------ */

/**
 * **A steering attempt has three outcomes, not two.**
 *
 * Astra's A11b. `none` means nothing left this box. `partial` means **the text
 * landed and the Enter did not**, so it is sitting in that agent's input box
 * waiting for the next keystroke to submit it — the one case where *"try
 * again"* is the worst available advice, because a retry appends to the
 * half-sent text rather than replacing it. `unknown` means the call timed out
 * or died on a signal and we genuinely cannot say.
 *
 * It lives here because it was declared carefully on the server, sent on the
 * wire, and **thrown away by the browser**, which then rendered every refusal
 * as *"Nothing was sent."* — false in the most expensive direction, and false
 * precisely when it matters. That is instance 5 of
 * docs/postmortems/260908b: the producer said the careful thing and the
 * consumer had a slot for one fact where there were three.
 *
 * The server's own comment beside the field had already named the consumer it
 * needed: *"it is here rather than only in the log because the person who
 * pressed the button is the one who needs it, and they are on a phone."*
 * Nothing related the two declarations, so nothing noticed.
 */
export type Delivery = "none" | "partial" | "unknown";


/* ------------------------------------------------------------------ *
 * Whether this server has an inbox to show, which is a different question
 * from what is in it.
 * ------------------------------------------------------------------ */

/**
 * **WHAT THE FLEET SERVER CAN SAY ABOUT THE ATTENTION INBOX.**
 *
 * `AttentionList` above is the Overseer's judgement. This is the envelope it
 * travels in, and it exists because the dashboard and the Overseer are two
 * processes with two lifetimes: the page is up whenever the box is, and the
 * checkpoint that carries the list may not be there at all. Measured
 * 2026-09-08: the producer had been publishing that file for hours and
 * `grep -rln "Checkpoint" tools/fleet/` found nothing, so the page could not
 * have told the two apart even in principle.
 *
 * **`checkpoint-absent` must never render as an empty inbox.** *Nothing has
 * been published, so nothing has been judged* and *nothing needs you* are
 * opposite facts, and only the second is reassuring. That is the same argument
 * `AttentionList`'s `unknown` arm makes one level down, and `Pause`'s `none`
 * arm makes elsewhere in this file: an absence of observation may not be read
 * as an observation of absence.
 *
 * ## Every arm is named after WHAT WAS SEEN, not after what it implies
 *
 * The first draft called the second arm `no-coordinator`, and GPT Sol was right
 * that this claims more than the evidence supports. **A missing
 * `current.json` proves only that no checkpoint exists at the path we looked
 * at.** The Overseer may be starting, may have failed before its first write,
 * may be running against another `OVERSEER_STORE_DIR`. So the arm says what was
 * observed — no checkpoint here — and the page's copy says the same, rather
 * than *the coordinator is not running*. Same discipline as `Pause`'s `none`.
 *
 * ## Why there is a fourth arm, and why it is the parse default
 *
 * `not-asked` means **this server did not look**. It is what an older server
 * that predates the field sends — the field was added without a schema bump,
 * per state.ts's rule, so a payload from before it carries no `attention` at
 * all — and it is therefore what a client's parser must produce when the field
 * is ABSENT.
 *
 * Defaulting to `checkpoint-absent` instead would be a positive claim nobody
 * made: *we looked at the store and there was nothing there* is a statement
 * about the box, and a server that has never heard of the file is in no
 * position to make it. It is the same ambiguous-negative mistake `Pause`'s
 * `none` arm is built to avoid, and the same one `readAttemptClock` in attempt-clock.ts
 * exists to unpick for `attemptedAt`.
 *
 * A field that is PRESENT and unreadable is a fifth thing, and it is not on
 * this type: it is a fact about a payload rather than about the box, so it
 * belongs to whoever is doing the reading. `web/src/types.ts` declares it.
 *
 * A renderer draws NOTHING for `not-asked` — there is no fact to report — and a
 * quiet line for `checkpoint-absent`, because that one is news.
 */
export type AttentionFeed =
  /** A checkpoint was read. `coordinatorWrittenAt` is the checkpoint's clock, NOT the list's. */
  | { kind: "published"; list: AttentionList; coordinatorWrittenAt: string }
  /** No checkpoint at the path we looked at. Says nothing about whether the Overseer is alive. */
  | { kind: "checkpoint-absent" }
  /** A checkpoint is there and could not be read, parsed, or understood. */
  | { kind: "checkpoint-unreadable"; why: string }
  /** This server did not look. See above — the default, and never a claim about the box. */
  | { kind: "not-asked" };

/* ------------------------------------------------------------------ *
 * The whole of `/api/state`.
 * ------------------------------------------------------------------ */

/** The dashboard run and kept collection which supplied a fleet payload. */
export type ProducerStamp = {
  /** Which run of the dashboard composed this payload: `serverInstanceId()`, INSTANCE_TOKEN-shaped. */
  instance: string;
  /** How many refresh turns this run has kept (success or failure). 0 before the first. */
  publication: number;
  /** How many successful collections this run has kept: the ordinal of the one `rows` came from.
   *  null exactly when `collectedAt` is null — never collected. */
  inventory: number | null;
};

/**
 * **WHAT `/api/state` RETURNS AND `/api/live` PUSHES**, declared once so the
 * three consumers cannot disagree about it.
 *
 * Migrated here on 2026-09-08 (v0.8b), and it is the second of the four
 * endpoints — `QueueView` was the first. The measurement that made it a stage:
 * `answeringEnabled` and `tmuxServerPid` had been on this payload for a day
 * and `grep -c` in `web/src/types.ts` found **zero** of either. Both ends were
 * internally consistent, so nothing could go red; the repair is a type that
 * makes the drop un-writable, not a check that detects it.
 * docs/postmortems/260908b, and § Stage v0.8a of the plan.
 *
 * ## Two type parameters, and they are exactly the two fields that cannot be shared
 *
 * `Row` and `Health` are holes rather than declarations, because **the things
 * that fill them live in node modules this file may not import** — `FleetRow`
 * in `collect.ts` (which opens with `node:child_process`) and `HealthReport` in
 * `health.ts`. The server fills them with its own types; the client fills
 * `Row` with the JSON *projection* it renders and leaves `Health` as `unknown`,
 * which is what `HealthPanel` reads it as.
 *
 * **`Row` is a hole rather than a shared declaration on purpose, and it is not
 * a shortcut.** The plan says why at length: `FleetRow.meta` resolves to
 * `scripts/gjd-remote-tmux.ts`'s `SessionMeta` (all three fields required)
 * while the client's has all three nullable, and `Session.created` is a `Date`,
 * which does not survive `JSON.stringify`. So the wire shape of a row is a
 * projection of the server's type and not the type itself; sharing it verbatim
 * would be *wrong* rather than merely impossible, and it is left for its own
 * stage. Everything OUTSIDE those two fields is shared, and that is where all
 * six dropped fields were.
 *
 * ## Adding a field here is the point — AND THE GUARANTEE IS NARROWER THAN IT LOOKS
 *
 * A field added to this type lands in both twins: the server's `FleetState` in
 * `state.ts` is this type with its holes filled, and the client's in
 * `web/src/types.ts` is `Omit<>` of it — so a new field is not in the `Omit`,
 * it lands in the client type, and the parser's object literal stops compiling
 * until somebody either reads the field or writes its name in the list. Proved
 * by mutation, both ends red.
 *
 * **That holds for a REQUIRED, top-level field and for nothing else**, and the
 * first version of this comment claimed it flatly. GPT Sol's M2, and it is
 * right: add `diagnostic?: string` here and BOTH sides still compile. The
 * server's object literal in `fleetState()` may omit an optional key, and the
 * client's parse is an object literal for a type whose key is optional too, so
 * neither end is forced to notice. A field added optionally is exactly the
 * lossy join this whole file exists to make un-writable, arriving through the
 * one door the mechanism does not cover.
 *
 * So the mechanism is held to its own claim by a compile guard rather than by
 * this paragraph: **`tests/fleet-compile-guards.test.ts` refuses an optional
 * top-level key on this type**, and `npm run typecheck` is what fails. A guard
 * described as stronger than it is, is this repo's most repeated defect of the
 * week; the honest version is *required fields are carried by construction, and
 * optional ones are refused at the door*.
 *
 * Nested optionality is not covered and is not meant to be: a `?` inside `Row`
 * or inside `AttentionFeed` is that type's own business, and the drop this
 * mechanism is about was always a whole field going missing from the payload.
 *
 * Adding a field is still **not a `schema` bump**: that rule is `schema`'s own
 * and it is about consumers that ignore what they do not know.
 *
 * ## No defaults on the two parameters
 *
 * `Row = unknown, Health = unknown` used to be written here, and it meant a
 * caller could name neither and inherit both holes silently — including the
 * caller who did not realise there were holes. They are the two fields that
 * cannot be shared and a consumer has to say what it is putting in them, so
 * every use site now writes both out. `unknown` is still the right answer for
 * `Health` on the client; it is just no longer the answer nobody chose.
 */
export type FleetState<Row, Health> = {
  /**
   * The payload's shape, so a stored snapshot can be read back by code that has
   * moved on. Bump it when a consumer that ignored the change would be WRONG
   * rather than merely poorer — a removed field, or one whose meaning changed.
   * Adding a field is not a bump: every consumer here ignores what it does not
   * know, and a version that changes on every addition is one nobody checks.
   */
  schema: 1;
  producer: ProducerStamp;
  /**
   * The sessions. **Read `collectedAt` first**: an empty `rows` is only ever a
   * claim about the box when `collectedAt` is non-null, and a freshly restarted
   * dashboard that says "no sessions are running" about a box with thirty-six
   * of them is the reading least likely to make anybody look. state.ts § the
   * empty-but-honest case.
   */
  rows: Row[];
  /** ISO, or null for NEVER COLLECTED — which is not "collected and empty". */
  collectedAt: string | null;
  /**
   * Which tmux server the handles in `rows` belong to. Two snapshots with
   * different values here describe different worlds, however alike `$1643`
   * looks in both. Null when it could not be read.
   */
  tmuxServerPid: number | null;
  tookMs: number;
  /** The last collection's failure, or null. A stale payload keeps its old rows. */
  error: string | null;
  health: Health;
  /** How often the server intends to collect, so the page can say when it is genuinely late. */
  refreshMs: number;
  /**
   * Whether `POST /api/steer/answer` will do anything.
   *
   * THE PAGE CANNOT HONESTLY WARN ABOUT A FLAG IT HAS NEVER BEEN TOLD. Without
   * this, the client either hedges ("answering may be held back") or discovers
   * the truth by having somebody tap and get a 503 — and the whole point of the
   * hold is that a person should not tap. Told beats inferred, again.
   *
   * That argument was here, correct, and contradicted by a module one directory
   * away for a day: the client's own `FleetState` did not carry the field, so a
   * reader tapped and got the 503. The `Omit<>` in web/src/types.ts is what
   * stops that recurring.
   */
  answeringEnabled: boolean;
  /**
   * When a collection was last **attempted**, which is a different fact from
   * `collectedAt`: that one says when data last ARRIVED, and neither it nor
   * `error` says whether the collector is still trying. A collection that never
   * settles throws nothing, so `error` stays null and the loop simply stops —
   * measured at ~30 minutes stale with `error: null`, which reads as a calm,
   * slightly-quiet box.
   *
   * **DO NOT READ THIS FIELD DIRECTLY FROM A PAYLOAD — use `readAttemptClock`**
   * in attempt-clock.ts, which the server, the Overseer and the browser client
   * all import. It was added without a schema bump, so a server that predates it
   * sends nothing, and a consumer that read "absent" as "never attempted" would
   * report every old server as permanently wedged.
   */
  attemptedAt: string | null;
  /**
   * **WHAT NEEDS GREG** — the Overseer's ranked inbox, or the reason there is
   * no list. A field rather than a second route: one payload, one clock, one
   * staleness. `not-asked` is what a server that did not look sends, and it
   * must never be read as *nothing is watching*.
   */
  attention: AttentionFeed;
  /**
   * **IS SUPERVISION STILL WORKING?** — the Overseer's two clocks, its
   * heartbeat, its scheduler line and its register, or the reason there is no
   * reading.
   *
   * A field on this payload rather than a `/api/overseer` of its own, and the
   * argument is `attention`'s one field up: **one payload, one clock, one
   * staleness.** A second endpoint would be a second `servedAt` to skew-correct
   * against, a second cache to go stale on its own schedule, and a second thing
   * that can be down while the page looks fine. It is also one file read —
   * `readCheckpointFeeds` in overseer-status.ts projects this and `attention`
   * out of the same bytes, so the inbox and the clock beside it can never come
   * from two different versions of the file.
   *
   * The size is why that was a real question rather than a formality: the
   * register can hold thirty-six sessions. `OverseerRegister` carries a bounded
   * ranked projection with the total beside it, so this field is a few hundred
   * bytes on a payload that already carries the rows themselves.
   */
  overseer: OverseerStatusFeed;
  /**
   * **CAN THIS ACCOUNT AFFORD MORE WORK?** — what the last usage pass found
   * about the logged-in account, or the reason there is nothing to say.
   *
   * The third field to arrive out of one checkpoint read, on the argument the
   * two above it already make: one payload, one clock, one staleness. It is
   * also the third projection out of `readCheckpointFeeds`, so the usage
   * reading, the inbox and the two clocks come from the same bytes — and the
   * card can say *the Overseer wrote 30 seconds ago and this reading is two
   * hours old* without either half being borrowed from another version of
   * the file. That sentence is the point of the card, and `UsageSummary`'s
   * `collectedAt` is why it is sayable.
   *
   * Bounded by construction: the 429s are grouped into incidents before they
   * cross, so the field is a few hundred bytes whether the box hit one limit
   * or thirty.
   */
  usage: UsageFeed;
  /**
   * **WHAT EXPENSIVE WORK IS RUNNING NOW.** This is the work projection from
   * the same single checkpoint read as `attention`, `overseer` and `usage`.
   * It is live state, never inferred from the five-minute persistence cadence:
   * that cadence governs what history keeps, not what this page calls current.
   */
  currentWork: WorkFeed;
  /**
   * **THE SERVER'S OWN CLOCK, AT THE MOMENT IT ANSWERED** — the one field here
   * that is about us rather than about the box.
   *
   * Every age the client draws is `browserNow − Date.parse(aServerTimestamp)`,
   * so a phone three minutes fast turns a current snapshot into a permanently-on
   * STALE banner. Neither `collectedAt` nor `attemptedAt` can stand in: the gap
   * between either of those and receipt is GENUINE SNAPSHOT AGE, and there is no
   * way to tell that apart from skew. state.ts and web/src/types.ts §
   * `ClockSkew` argue it in full.
   */
  servedAt: string;
  /**
   * **WHAT IS WAITING ON GREG, AND WHETHER THAT LIST MAY BE BELIEVED** — the
   * Questions tab's reconciliation of two observations that are never joined.
   *
   * A field here rather than a route of its own, for `attention`'s reason one
   * screen up: **one payload, one clock, one staleness.** It is also free —
   * `composeQuestions` is pure over the rows and the attention projection that
   * `fleetState` already holds, so it opens no file and captures no pane. It
   * carries REFERENCES rather than copies: a dialog item names a row id and the
   * panel reads the question off the row it already has, which it must do
   * anyway because an answer sends `rawQuestion` verbatim.
   *
   * **Required, not optional.** An optional top-level key crosses the client's
   * `Omit<>` derivation untouched and ships to a browser that never reads it,
   * which is the exact drop that derivation exists to prevent;
   * tests/fleet-compile-guards.test.ts refuses one. It was briefly an
   * intersection alias — `FleetStateWithQuestions` — because the task prompt
   * that produced this stage forbade editing anything already in this file.
   * That left two names for one payload and a plain `FleetState` that did not
   * require the field, which is a drift nobody would notice; the alias is gone.
   */
  questions: QuestionsView;
};
/* ------------------------------------------------------------------ *
 * IS SUPERVISION STILL WORKING? — the Overseer's own status.
 * ------------------------------------------------------------------ */

/**
 * **TWO CLOCKS, AND THEY COME APART EXACTLY WHEN SOMETHING IS WRONG.**
 *
 * The direction doc's § Two tenses insists on both, and the reason is the
 * coupling the seam created: the Overseer has no collector of its own, so it
 * lives off the dashboard's SSE stream. `writtenAt` says the Overseer is still
 * writing; `lastGoodSnapshotAt` says it is still HEARING. A daemon ticking
 * against a dead stream advances the first and freezes the second, and a
 * watchdog reading only the heartbeat would bless it:
 *
 * > **A dead dashboard is a fact the Overseer records, not a silence it sits
 * > in.**
 *
 * So this type never collapses them into one age, and the panel that draws it
 * warns on a stale source even while the heartbeat advances.
 *
 * ## Every part fails on its own
 *
 * `heartbeat`, `scheduler` and `register` each carry their own `unreadable`
 * arm rather than failing the whole projection. That is a request from the
 * scheduler stage (260908g) and it is right in general: its Stage 3c may widen
 * `StoredScheduler`'s discriminant, and a `kind` this build has never seen must
 * read as *I cannot read this part of the file* and not as *the Overseer is
 * unreadable*. The same rule the session rows already follow, one level down —
 * `parseStatus`'s default arm in web/src/types.ts.
 *
 * The one thing that is NOT per-part is the schema: a checkpoint whose version
 * this build does not know is refused whole, because the fields' meanings are
 * what the version is about. `OverseerStatusFeed`'s `unsupported-schema` arm.
 */
export type OverseerStatus = {
  /** The version the file declared. Carried so the page can name it, having accepted it. */
  schema: number;
  /** When the Overseer last wrote the checkpoint. The heartbeat's clock, effectively. */
  writtenAt: string;
  /**
   * The producer's own `collectedAt` from the last observation the Overseer
   * ACCEPTED — its source clock, and `null` when it has never accepted one.
   *
   * `null` is not "just started" and must not be drawn as fresh: a daemon that
   * has been up for an hour without a single accepted snapshot is the deaf case
   * in its purest form.
   */
  lastGoodSnapshotAt: string | null;
  /**
   * **THE DEADLINE THE DAEMON ITSELF IS USING** for *the collector has gone
   * quiet*, in milliseconds — or `null` from a daemon that did not say.
   *
   * Carried rather than restated because the two ends already drifted once
   * exactly here: `scripts/overseer-watchdog.ts` and the daemon called the same
   * `staleAfterMs` and passed it different inputs, so one said 300,000 and the
   * other 325,000 under the documented normal values. Sharing a FUNCTION
   * prevents formula drift and not input drift; sharing the ANSWER prevents
   * both. GPT Sol's C6 on the store, one consumer further out.
   *
   * A page that has no number falls back to its own constant and says which it
   * used. `null` is *the daemon did not say*, never zero and never a default.
   */
  sourceStaleAfterMs: number | null;
  heartbeat: OverseerHeartbeat;
  scheduler: OverseerScheduler;
  register: OverseerRegister;
};

/**
 * Which daemon wrote this, and how far it has got.
 *
 * `lastTickAt` is `null` on a daemon that has written a checkpoint and not yet
 * completed a tick — the truth about a fresh start, and not the same as a
 * daemon that has stopped ticking, which keeps its last one and lets it age.
 */
export type OverseerHeartbeat =
  | {
      kind: "reading";
      pid: number;
      instanceId: string;
      startedAt: string;
      lastTickAt: string | null;
      ticks: number;
    }
  /** The field is there and this build cannot read it. Not *there is no daemon*. */
  | { kind: "unreadable"; why: string };

/**
 * Whether the scheduler is switched on, in the daemon's own words.
 *
 * Four arms for the store's three, and the fourth is the point:
 *
 *  - `armed` / `off` — the daemon said so, at `at`, for the reason `why`.
 *  - `not-said` — the store's own `unknown`: no daemon in that build ever said.
 *    A checkpoint written before the field existed lands here.
 *  - `unreadable` — **a `kind` this build does not know**, or a field that is
 *    not shaped like one at all. 260908g's Stage 3c may widen the discriminant,
 *    and the widened value must not be able to render as `off`. It is one line
 *    on the card and nothing else on it is affected.
 *
 * `not-said` is renamed from the store's `unknown` deliberately: on this side
 * of the wire `unknown` would sit next to `unreadable` and the two would read
 * as the same thing, when one is *nobody decided* and the other is *we cannot
 * tell what was decided*.
 */
export type OverseerScheduler =
  | { kind: "armed"; why: string; at: string }
  /**
   * **SWITCHED ON, AND NOT ONE LOADED JOB CAN RUN.** GPT Sol's S8-7: this state
   * used to render as `armed`, because the word came from an environment
   * variable rather than from the definitions. It is neither `off` nor working,
   * so it gets its own word here as it does in the store.
   */
  | { kind: "blocked"; why: string; at: string }
  | { kind: "off"; why: string; at: string }
  | { kind: "not-said"; why: string; at: string }
  | { kind: "unreadable"; why: string };

/** Whether the Overseer's last work scan can be drawn beside these entries, and if not, why. */
export type OverseerRegisterWork =
  /** A scan taken FOR this checkpoint's inventory. `scannedAt` is when the kernel was read. */
  | { kind: "scanned"; scannedAt: string }
  /** No scan is being drawn: none has run, the probe failed, it belongs to an older inventory, or
   *  this page could not read it. One sentence, said once above the list rather than N times in it. */
  | { kind: "unavailable"; why: string };

/**
 * **THE OVERSEER'S OWN RECORD OF WHAT HAS BEEN RUNNING, AND NOT A LIVE-FLEET JOIN.**
 *
 * The register is the Overseer's past tense: it knows when a session entered
 * the state it is in, which the dashboard cannot know because it has no
 * yesterday. This carries a BOUNDED, RANKED PROJECTION of the oldest status
 * records worth showing: non-idle sessions, idle sessions with recognised
 * child work, and idle sessions without a usable pane reading, ordered by
 * pane-status age. Nothing on the page matches these entries to the fleet rows
 * beside them.
 *
 * **That refusal is the design.** A register entry and a fleet row can agree
 * about a pane and still be about different children: the generation tuple
 * (`tmuxServerPid`, `paneId`, `panePid`) can stay fixed while the process
 * inside it is replaced, so *"blocked for at least 20 minutes"* said against a
 * row needs continuity evidence. Execution identity now provides a key that
 * could earn that join, but this slice deliberately does not make it: these are
 * history, drawn as history, under their own heading. **Whatever is wrong here,
 * the fleet rows are unaffected** — they come from a different field of the
 * same payload and nothing about them is derived from this one.
 *
 * `total` is the whole register and `sessions` is the cap, so a card that shows
 * eight of thirty-six says so rather than looking like the whole fleet.
 */
export type OverseerRegister =
  | { kind: "read"; total: number; sessions: OverseerSessionHistory[]; work: OverseerRegisterWork }
  | { kind: "unreadable"; why: string };

/** One recognised piece of long-running work found under a pane. */
export type PaneJob = {
  /** The recogniser's id, as a plain string — the Overseer's vocabulary. A page that refused an id
   *  it had not heard of would drop the row that had changed. */
  recogniser: string;
  /** What to call it to a reader: "GPT review", "headless Claude", "test suite". */
  label: string;
  /** When the kernel said it started, or null when it could not be told. Accurate to about a
   *  SECOND, not a millisecond: `ps etimes` counts whole seconds. Never compare two for equality. */
  startedAt: string | null;
  /** How long it had been running WHEN THE TABLE WAS READ. Frozen here on purpose: a browser that
   *  computed `now - startedAt` would turn eighteen observed minutes into seventy-eight claimed
   *  ones on a daemon that stopped accepting inventories an hour ago. The reader gets this number
   *  and the scan's age, and the two together are a measurement rather than an extrapolation. */
  ranForMs: number | null;
  /** Unique only for as long as the process lives, so not an identity on its own — kept so a later
   *  reading has something to check against. */
  pid: number;
  /** Hops below the pane process. A `codex exec` dispatched by an agent sits at depth 8 on this box. */
  depth: number;
  /** THE EXECUTABLE AND ITS LEADING SUBCOMMAND, AND NOTHING ELSE — `codex exec`, `claude`, `node`.
   *  The full argv is deliberately not persisted: `ps` has already lost quoting and argument
   *  boundaries, a `codex exec` line carries a whole prompt, and no redactor over option names can
   *  promise to catch a positional secret. See the plan's "Product default" section. */
  command: string;
};

/** What the tree under one pane was doing, at the instant the table was read. */
export type PaneWork =
  /** Could not tell, and why. NEVER to be drawn as idle or as nothing running. */
  | { kind: "cannot-tell"; cause: string; why: string }
  /** Looked under the pane and found no recognised work. `inspected` is how many processes the walk
   *  examined, so "a bare pane" and "twenty-five processes, none recognised" stay different facts —
   *  the second is how a missing recogniser announces itself. `paneStartedAt` is required on both
   *  measured arms because without it the delayed scan cannot apply even its limited pid-reuse
   *  backstop; an unavailable start is `cannot-tell`, never `none`. */
  | { kind: "none"; inspected: number; paneCommand: string; paneStartedAt: string }
  /**
   * Found some. **A NON-EMPTY TUPLE RATHER THAN AN ARRAY**, so that "a positive reading with no
   * job" is a state the compiler refuses rather than one three parsers each have to reject and a
   * renderer has to carry a sentence for. It was an ordinary array until a review pointed at the
   * unreachable branch that shape had grown in `OverseerPanel`.
   */
  | { kind: "work"; jobs: readonly [PaneJob, ...PaneJob[]]; inspected: number; paneCommand: string; paneStartedAt: string };

/** One pane's reading, tagged with the Overseer's own session key so it can be joined to a register
 *  entry — the same key, written by the same daemon into the same file at the same instant. */
export type OverseerPaneWork = { key: string; work: PaneWork };

/**
 * **WHAT THE FLEET IS ACTUALLY DOING** — one process-table reading, classified per pane.
 *
 * ONE CLOCK FOR THE WHOLE SCAN, not one per pane, because there is one `ps`: every pane was decided
 * from the same reading of the same instant, and a per-pane clock would imply a precision that does
 * not exist.
 *
 * **A FAILED PROBE IS ONE ARM, NOT N IDENTICAL PANE FAILURES.** The first draft gave every pane a
 * `cannot-tell`, which repeated one fact per session and permitted mixed states that cannot happen —
 * half the fleet unreadable from a single `ps`. Only a successful scan carries pane readings.
 *
 * `sourceCollectedAt` is the `collectedAt` of the inventory this scan was taken FOR. It is what
 * stops a held reading attaching itself to a newer register: the projection joins only when it
 * matches the checkpoint's `lastGoodSnapshotAt`, so a scan that has fallen behind stops being drawn
 * rather than quietly describing sessions it never saw.
 */
export type OverseerWork =
  /** No scan has been taken. `at` is when the file was written, not when anything was read. */
  | { kind: "not-yet-run"; why: string; at: string }
  /** A scan was attempted for a real inventory and the process table could not be read. */
  | { kind: "probe-failed"; why: string; attemptedAt: string; sourceCollectedAt: string }
  | { kind: "scan"; scannedAt: string; sourceCollectedAt: string; panes: readonly OverseerPaneWork[] };

/** One session as the Overseer remembers it. Ranked by `since`, oldest first. */
export type OverseerSessionHistory = {
  /** The name the launcher gave it. Recognisable, and not addressable. */
  name: string;
  /** tmux's handle, meaningless without the server pid — which is why this is not a join key. */
  tmuxId: string;
  /**
   * The status the Overseer last recorded, as its own key — `working`,
   * `needs-you`, `waiting`, and whatever else the collector grows. A string
   * rather than a union: this is the Overseer's vocabulary, and a page that
   * refused a key it had not heard of would drop the row that had changed.
   */
  status: string;
  /**
   * The pane's reading from the scan taken for this register's inventory.
   * `null` is its own fact: the scan ran but carried no reading for this
   * session. It is neither an unavailable scan nor a per-pane `cannot-tell`.
   */
  work: PaneWork | null;
  /**
   * **WHEN IT ENTERED THAT STATE, AND WHETHER THAT IS A READING OR A FLOOR.**
   *
   * `lower-bound` means the daemon found it already in that state and cannot
   * see when it began — which was four identical `13m` rows against sessions
   * that had been working for hours. It renders `≥13m`, and the mark is
   * load-bearing rather than decorative.
   */
  since: { kind: "observed" | "lower-bound"; at: string };
};

/**
 * **IS SUPERVISION STILL WORKING?** — the whole reading, or the reason there
 * isn't one.
 *
 * The brief's four outcomes, in this file's existing vocabulary so the two
 * feeds read alike: *missing* is `checkpoint-absent`, *unreadable* is
 * `checkpoint-unreadable`, *unsupported-schema* is its own arm, *available* is
 * `published`. `not-asked` is the fifth and it is the parse default, for
 * exactly the reason `AttentionFeed` has one: the field was added without a
 * schema bump, so a server that predates it sends nothing, and silence from a
 * server that never heard of the file is not an observation of the box.
 *
 * **`unsupported-schema` is a separate arm rather than a `why` on the
 * unreadable one** because it is the one failure with an action attached: the
 * page can say which version it read and which it knows, and somebody can
 * deploy the other half. It is also the live case — the checkpoint on the box
 * read schema **1** on 2026-09-08 against a checked-in `STORE_SCHEMA` of 2 —
 * so this arm renders in production before either of the other two does.
 */
export type OverseerStatusFeed =
  | { kind: "published"; status: OverseerStatus }
  /** No checkpoint at the path we looked at. Says nothing about whether a daemon is alive. */
  | { kind: "checkpoint-absent" }
  /** One is there and could not be opened, read or parsed. */
  | { kind: "checkpoint-unreadable"; why: string }
  /** One is there, is JSON, and declares a version this build does not know. */
  | { kind: "unsupported-schema"; saw: string; known: number }
  /** This server did not look. Never a claim about the box. */
  | { kind: "not-asked" };

/* ------------------------------------------------------------------ *
 * WHAT AN ACTION DID, AS OPPOSED TO WHAT IT WAS ASKED TO DO.
 *
 * Stage 3 of docs/plans/260908j. Three shapes, and every one of them
 * exists because a route knew several different things and wrote down
 * one word — the Class B lossy join of docs/postmortems/260908b.
 *
 * **THE CEILING ON ALL OF IT: NOTHING HERE OBSERVES A CONSEQUENCE.**
 * The dashboard runs a command and reads its exit status, or hands a
 * sequence of `tmux send-keys` calls to steer.ts and reads how far it
 * got. Neither is evidence about the world afterwards — no process
 * table is re-read after a kill, and no agent acknowledges a keystroke.
 * So the vocabularies below are deliberately about the ATTEMPT, and the
 * plan cut a `reception observed` arm rather than ship one nothing can
 * fill. Do not add a field here that no code can honestly write.
 * ------------------------------------------------------------------ */

/**
 * How one step of a plan ended, judged against the gate the plan named.
 *
 * `failed-ignored` is the arm that stops a `best-effort` step being smoothed
 * into a pass: thirty kills of which eleven found nothing there is a fact worth
 * reading, and it is the difference between a signal that was accepted and one
 * that was not.
 */
export type PlanStepStatus = "passed" | "failed" | "failed-ignored";

/** One step of a plan, after it ran. */
export type PlanStepView = {
  argv: readonly string[];
  cwd: string;
  /** The step's own reason for existing, from the plan. */
  why: string;
  status: PlanStepStatus;
  /** Why it got that status — the gate, in words. */
  verdict: string;
  code: number | null;
  timedOut: boolean;
  spawnError: string | null;
  /** The tail of what it said, bounded, for a person. */
  tail: string;
};

/**
 * A plan, after it ran — **and this is the one whole-action effect contract
 * the server has.**
 *
 * `steps` is the steps that RAN, so a run that stopped is shorter than the plan
 * that produced it, and `stoppedAt` names where. That asymmetry is the useful
 * part: a reader can say *one of three steps ran* rather than *something went
 * wrong*, which is what the card said for the life of the feature because
 * `refusal()` in the browser dropped this whole object.
 *
 * Parameterised on the action id so the server can keep its closed `ActionId`
 * union while the browser reads a plain string. One declaration, two uses —
 * this file exists because the alternative was two declarations related by
 * nothing but hope.
 */
export type PlanRunView<Id extends string = string> = {
  action: Id;
  steps: PlanStepView[];
  /**
   * **HOW MANY STEPS THE PLAN HAD**, which `steps.length` does not say.
   *
   * Added in Stage 3 because the denominator was simply absent from the wire: a
   * three-step plan that stopped at the second sent two step outcomes and a
   * `stoppedAt`, so the only honest sentence a reader could build was *two
   * steps ran* — which reads as **all of them**. `1 of 3` and `2 of 2` are the
   * same list of facts without this number.
   */
  planned: number;
  /** True when every step ran and none failed a gate it was not allowed to fail. */
  completed: boolean;
  /** The index of the step that stopped the plan, or null. */
  stoppedAt: number | null;
};

/**
 * **WHAT ONE `kill -TERM <pid>` ESTABLISHED, WHICH IS LESS THAN IT SOUNDS.**
 *
 * The strongest arm is `signal-accepted`, and it is deliberately not called
 * `killed`: it means the `kill` command exited 0, so the signal was delivered
 * to a process that existed and that this uid may signal. A process is free to
 * ignore SIGTERM, and nothing re-reads the process table afterwards, so
 * *accepted* is the whole of the claim. `killed` was the word this route used,
 * about the pids it INTENDED to signal.
 */
export type KillObservation =
  /** `kill` exited 0. The signal went. Not proof the process is gone. */
  | "signal-accepted"
  /** `kill` exited non-zero: no such process, or not ours to signal. Nothing happened to it. */
  | "signal-refused"
  /**
   * The attempt did not settle. The `kill` could not be spawned, or was killed
   * for taking too long, or died on a signal itself — and in two of those three
   * **it ran**. **The most expensive arm to get wrong in either direction**:
   * the signal may have gone out before the command died, and it may not.
   *
   * There is deliberately no `not-attempted` beside this. `planKillProcesses`
   * builds one step per pid and a `best-effort` step cannot stop a plan, so no
   * pid on this route goes unreached; `killReport` asserts that rather than
   * carrying an arm nothing can produce. An arm no code can reach is
   * decoration, and the plan cut `reception observed` for the same reason.
   */
  | "not-established";

/** One pid, and what became of the attempt to signal it. */
export type KillAttempt = {
  pid: number;
  observation: KillObservation;
  /** The step's own verdict, verbatim. */
  why: string;
};

/**
 * A kill, reported as **intent and evidence separately**.
 *
 * `targeted` is the list the route set out to signal and is a fact about the
 * request; `observed` is what came back and is a fact about the box. They are
 * two fields rather than one because the route used to answer with the first
 * under a name that reads as the second, and a page cannot recover a
 * distinction the wire has already collapsed.
 *
 * **`targeted` WAS CALLED `attempted` FOR ONE DAY AND THAT WAS THE SAME
 * MISTAKE ONE NOTCH SMALLER.** This stage exists to stop a kill reporting
 * intent as outcome, and then named its own intent field after the attempt.
 * The list is who we aimed at; whether each was attempted is `observed`, one
 * entry at a time.
 *
 * There is no `planCompleted`. Every pid here has a step — `killReport`
 * asserts it — so a flag saying the plan reached the end of the list could
 * only ever be true, and a field that cannot be false is a claim rather than a
 * reading.
 */
export type KillReport = {
  /** Every pid the plan set out to signal, in order. INTENT, not effect. */
  targeted: readonly number[];
  /** One entry per targeted pid, in the same order. EVIDENCE. */
  observed: readonly KillAttempt[];
};

/**
 * **WHAT BECAME OF ONE RECIPIENT OF A BROADCAST**, in the vocabulary
 * docs/plans/260908j settled on: a transient phase, then four terminal states,
 * plus the three ways a row is never spoken to at all.
 *
 * The four that matter are the four the route used to answer `refused` for. A
 * `partial` send left the literal text in that agent's input box with no Enter
 * behind it, so the next Enter anybody presses submits it; `refused` reads as
 * *nothing reached them*, which is the opposite fact. `outcome-unknown` is the
 * arm for a `Delivery` of `unknown` **and** for a throw out of the delivery
 * module, which carries no reading at all.
 *
 * `keys-submitted` is the ceiling and it is named for what it proves: the tmux
 * calls completed. It is not `read`, and it is not `obeyed`.
 */
export type BroadcastRecipientOutcome =
  /** A DRY RUN only. What the send would do — never mixed with what one did. */
  | "would-send"
  /** Every tmux call completed. The keystrokes were submitted; nothing observed a reader. */
  | "keys-submitted"
  /** Some of the sequence arrived and it did not finish. Half a message may be sitting there. */
  | "partial"
  /** A throw, or a `Delivery` of `unknown`. It may have landed and it may not. */
  | "outcome-unknown"
  /** The delivery module refused with nothing sent: no keystroke left this box. */
  | "refused-before-effect"
  /** The queue's gate said "later" — the session is working. Nothing was sent. */
  | "held"
  /** The queue's gate said "never" — a shell, a dead Claude. Nothing was sent. */
  | "blocked"
  /** The fan-out ran out of time before this row. Nothing was sent. */
  | "not-reached";

/* ------------------------------------------------------------------ *
 * Execution identity: which RUN is in this pane, not which pane it is.
 * ------------------------------------------------------------------ */

/**
 * **A DURABLE NAME FOR ONE RUNNING PROCESS, and the whole reason this block
 * exists.**
 *
 * A pane outlives the things that run in it. `tmuxServerPid`, `paneId` and
 * `panePid` can all stay fixed while the `claude` inside the pane exits and
 * another one starts — the pane's shell is the same shell, so nothing above
 * moves — and `claudeSessionId` cannot see it either, because
 * `CLAUDE_SESSION_ID` is pinned into the tmux environment once, before Claude
 * runs, and is never rewritten (`ObservedRow.claimedConversationId` in
 * tools/overseer/observation.ts has the measurement). So every identity this
 * payload previously carried is stable across exactly the change that matters
 * most: **the conversation you were talking to has been replaced by a different
 * one wearing all of its addresses.**
 *
 * Three fields, and each one is load-bearing:
 *
 *  - `boot` is `/proc/sys/kernel/random/boot_id`, which the kernel mints per
 *    boot. Without it a token minted before a reboot could collide with one
 *    minted after, since pids and start ticks both restart.
 *  - `pid` names the process only for as long as it lives — the warning
 *    `ChildJob.pid` and `Harness.pid` already carry, and the reason the third
 *    field is not optional.
 *  - `startTicks` is field 22 of `/proc/<pid>/stat`, the process's start time in
 *    clock ticks since boot. It is EXACT and it is what closes pid reuse: the
 *    next process handed pid 4039575 cannot also have started at tick 72055933.
 *
 * **NOT `ProcessStart` FROM work.ts, and that is not a duplication.** That one
 * is derived from `ps etimes`, counts whole seconds, and its own comment says
 * two readings of one process can differ by a second and that it must *never be
 * compared for equality*. It answers "how long has this been running" for a
 * person. This answers "is this the same run", and equality is the only thing
 * it is for.
 */
export type ExecutionToken = {
  /** `/proc/sys/kernel/random/boot_id`. A different boot is a different world. */
  boot: string;
  /** The harness process's pid, at the instant of the reading. */
  pid: number;
  /** `/proc/<pid>/stat` field 22 — start time in clock ticks since boot. Exact. */
  startTicks: number;
};

/**
 * **WHICH CONVERSATION IS IN THERE — kept separate from whether the PROCESS is
 * identified, because the two are genuinely different questions.**
 *
 * Knowing that a live `claude` is the pane's descendant, and holding a durable
 * token for it, says nothing about which transcript it is writing. A bare
 * `claude` with no `--session-id` is a perfectly ordinary, perfectly verified
 * process whose conversation nothing on its command line names.
 *
 * `conflicting` is the arm the whole stage was built for: the tmux environment
 * claims one uuid and the live process's argv carries another, which is a fresh
 * Claude under an unchanged pane, caught.
 */
export type ConversationReading =
  /** The row carries no `CLAUDE_SESSION_ID`: a shell, a `setup`, a legacy session. */
  | { kind: "not-claimed" }
  /** The live harness's own `--session-id` equals the tmux environment's claim. */
  | { kind: "verified"; id: string }
  /**
   * The claim and the process disagree. **The claim is the stale one** — it was
   * written before the first Claude started and is never updated — so `observed`
   * is the conversation actually in the pane and `claimed` is what every address
   * in this payload would have sent you to.
   */
  | { kind: "conflicting"; claimed: string; observed: string }
  /** A claim with nothing to check it against, and the sentence saying what was missing. */
  | { kind: "unverifiable"; claimed: string; why: string };

/**
 * Why there is no execution reading. Each arm is a different thing to draw, and
 * none of them means "there is nothing running".
 *
 * The first two are the *nobody looked* pair and they are not interchangeable:
 * `not-probed` is this producer choosing not to run the pass, `not-reported` is
 * a producer too old to have one — which a consumer meets across a deploy and
 * must not read as a session that lost its identity.
 */
export type ExecutionUnknownCause =
  /** This collection did not run the pass. A `FleetRow` starts here. */
  | "not-probed"
  /** The payload had no `execution` field at all: a producer from before this stage. */
  | "not-reported"
  /** The row carried no pane pid, so there is no tree to walk. */
  | "no-pane-pid"
  /** The process table could not be read. `why` carries what the probe said. */
  | "process-table-unreadable"
  /** The table is not an ancestry, or the pane's own pid is not in it. */
  | "pane-tree-unreadable"
  /**
   * There is no `/proc` to read. **Unsupported, never "use the pid on its own"**
   * — a pid with nothing to disambiguate reuse is precisely the identity this
   * type exists to refuse.
   */
  | "platform-unsupported"
  /** `/proc/sys/kernel/random/boot_id` could not be read, so no token can be minted. */
  | "boot-identity-unreadable"
  /**
   * A harness was found and its start ticks could not be read — almost always
   * because it exited between the process table and the `/proc` read. We saw
   * it; we cannot name it durably; that is not a verified execution.
   */
  | "process-start-unreadable"
  /**
   * **THE PID WAS REUSED WHILE WE WERE LOOKING AT IT.**
   *
   * The harness kind and the conversation come from the process table; the
   * start token comes from a `/proc` read taken afterwards. If the process
   * exits and its pid is handed to another in between, those two describe
   * DIFFERENT PROCESSES, and stapling them together produces a `verified`
   * identity that never existed — the old conversation with the new process's
   * token, which the write gate would then allow. This arm is what the two
   * readings disagreeing produces instead. GPT Sol's P1-2, 2026-09-09.
   */
  | "process-changed-under-read"
  /**
   * `/proc/uptime` could not be read, so the process table's elapsed times and
   * `/proc`'s start ticks cannot be put on one clock and the check above cannot
   * be made. **Unverifiable rather than assumed good**: the arm exists to catch
   * a reading assembled from two processes, and an unmade check is not a passed
   * one.
   */
  | "uptime-unreadable";

/**
 * **WHAT IS ACTUALLY EXECUTING IN THIS PANE, or the honest reason we cannot
 * say.**
 *
 * Three arms, and the middle one is the one that is easy to leave out:
 *
 *  - `verified` — a live harness process under this pane, with a durable token.
 *    Two `verified` readings whose tokens are equal are the same run; two whose
 *    tokens differ are not, and no amount of matching pane ids changes that.
 *  - `claimed-only` — we looked, and the launch metadata is all there is: a pane,
 *    a claim, and nothing under it we can name. **This is not a weaker
 *    `verified`**; nothing identity-dependent may be done on it.
 *  - `unknown` — we did not look, or could not. `cause` says which.
 *
 * A verified execution with an unverifiable conversation is normal and is not a
 * defect: see `ConversationReading`.
 */
export type ExecutionReading =
  | {
      kind: "verified";
      token: ExecutionToken;
      /** Which harness the token names. The same union `Harness` uses. */
      harness: HarnessKind;
      conversation: ConversationReading;
    }
  /**
   * **ITS `conversation` CAN ONLY EVER BE `not-claimed` OR `unverifiable`**,
   * and a consumer that branches on `conflicting` here is writing dead code.
   *
   * Said out loud because the type does not say it and a reader of this file
   * inferred the opposite on 2026-09-09, which would have made the loudest
   * state look reachable from two arms when it is reachable from one. The
   * reason is structural rather than incidental: `claimed-only` means *the walk
   * ran and could not name what it found*, and an unnamed process is one whose
   * command line we did not read — so there is no observed conversation id to
   * disagree with the claim. `readExecutionIdentity` passes a null observation
   * on this path, unconditionally.
   *
   * **`conflicting` is reachable from `verified` and nowhere else.** If you are
   * looking for *this pane changed hands*, that is the one arm to check.
   *
   * The near miss worth knowing about is the other direction: when a harness IS
   * named and only its start ticks cannot be read, this returns
   * `unknown`/`process-start-unreadable` and DISCARDS the conversation verdict
   * it briefly had. That is deliberate — a failed `/proc` read almost always
   * means the process has just exited, and reporting which conversation a dead
   * process was running is a false alarm rather than a rescued fact.
   */
  | { kind: "claimed-only"; conversation: ConversationReading; why: string }
  | { kind: "unknown"; cause: ExecutionUnknownCause; why: string };

/* ------------------------------------------------------------------ *
 * A SESSION HELD BACK AFTER A SEND NOBODY CAN ACCOUNT FOR.
 *
 * Stage 4 of docs/plans/260908j. The dashboard types into other people's
 * input boxes, and `Delivery` already distinguishes the three things a
 * send can end as. Two of them — `partial` and `unknown` — mean **text
 * may be sitting in that agent's input box with no Enter behind it**,
 * and until somebody looks at the terminal nothing in this process can
 * find out. The next queued item draining into that same box would
 * concatenate itself onto half a sentence.
 *
 * So the ambiguity becomes a per-session HOLD. **Nothing below observes
 * a consequence**, for the reason the block above says: no agent
 * acknowledges a keystroke. `operator-confirmed` is a person's claim
 * about what they saw with their own eyes, recorded as a claim; it is
 * never a reading this software made.
 *
 * **AND NOTHING HERE IS EVER A RETRY.** A hold stops the NEXT item; it
 * never re-sends the one that went wrong. Releasing a hold sends nothing
 * either — both gestures below are records, not actions.
 * ------------------------------------------------------------------ */

/**
 * What was read about the send that opened or extended a hold.
 *
 * Four arms, and each one names a producer, because an arm nothing can
 * write is decoration — the rule the plan cut `reception observed` and
 * `not-attempted` under.
 *
 *  - `partial` — `fire()` in steer.ts reached some of the sequence and not
 *    the end of it (`Delivery` of `"partial"`).
 *  - `unknown` — `fire()` could not say (`Delivery` of `"unknown"`).
 *  - `threw` — the delivery module threw. It carries no `Delivery` at all,
 *    and the `try` surrounds the whole call, so it cannot say whether
 *    anything went out first. Produced by the direct steer route and by
 *    the broadcast; **the drain does not produce it**, and the comment on
 *    `deliverOne` says why — there the lease is left open instead, which
 *    stops that session's queue harder than a hold would.
 *  - `none-contradicted` — the transport said `delivery: "none"` and listed
 *    tmux calls that completed anyway. `nothingWasSent` refuses to certify
 *    that, and the honest reading of a self-contradicting report is the one
 *    that assumes something went out.
 */
export type UncertainSendReading = "partial" | "unknown" | "threw" | "none-contradicted";

/** Which of the three send paths left the input box in doubt. */
export type UncertainSendOrigin =
  /** The refresh loop's drain pass, delivering a queued item. */
  | "queued-delivery"
  /** Somebody typed into one session from the page — `POST /api/steer/…`. */
  | "direct-steer"
  /** One recipient of a fan-out — `POST /api/actions/box`. */
  | "broadcast";

/**
 * The two gestures that end a hold, **neither of which sends anything.**
 *
 *  - `operator-confirmed` — *I looked at the terminal and saw it.* A
 *    person's claim, stored as a person's claim. The dashboard did not
 *    observe it and the copy must never say it did.
 *  - `abandoned-unknown` — *Abandon the uncertainty.* It releases the hold
 *    and **claims nothing in either direction**: not that the text
 *    arrived, and — the half that is easy to get wrong — not that it did
 *    not.
 */
export type HoldReleaseGesture = "operator-confirmed" | "abandoned-unknown";

/**
 * Where a hold has got to.
 *
 * A union rather than a `state` string beside three optional fields, so
 * that reading the release gesture forces you to have established that it
 * WAS released. `superseded` carries both generations because the whole
 * argument for it is the comparison: a tmux server restart takes every
 * pane with it, so the input box the hold was about no longer exists.
 */
export type HoldOutcome =
  /** Still holding. Nothing drains into this session. */
  | { kind: "holding" }
  | {
      kind: "released";
      gesture: HoldReleaseGesture;
      at: number;
      /** What that gesture asserted, in words, for the page and the log. */
      what: string;
    }
  | {
      kind: "superseded";
      at: number;
      /** The tmux server the hold was opened against. */
      was: number;
      /** The one running now. */
      now: number;
      what: string;
    };

/**
 * One session's hold, as `GET /api/actions` sends it.
 *
 * **`why` IS A SENTENCE, following `QueuedItem.invalidated`** rather than
 * a code the page has to translate: a hold is a thing a person has to
 * decide about, and the deciding is done from the sentence.
 *
 * `version` is what makes the release idempotent AND safe. It goes up
 * every time another uncertain send lands on a session that is already
 * held, so a phone that has been in a pocket since version 1 cannot
 * release a hold that has since absorbed a second incident.
 */
export type QuarantineHoldView = {
  /** `<instance>-h<n>`. Opaque to the client, exactly like a queued item's id. */
  id: string;
  /** Bumped by each further uncertain send. Starts at 1. */
  version: number;
  sessionId: string;
  /** The pane the send was aimed at, or null when the producer had none to give. */
  paneId: string | null;
  claudeSessionId: string | null;
  /** Which run of this server opened it. */
  serverInstanceId: string;
  /** The tmux server it was opened against, or null if this server had not been told yet. */
  tmuxGeneration: number | null;
  /**
   * The first tmux server this dashboard was told about **after** this hold
   * opened, or null.
   *
   * **A SEPARATE FIELD RATHER THAN A LATE WRITE TO `tmuxGeneration`**, and the
   * separation is the whole of it: `tmuxGeneration` is a claim about the world
   * at the moment the send went out, and this is not one. A hold opened before
   * the server had been told any generation is bound to none, so no later
   * change proves anything about the pane it was about — and for a stage of
   * this file's life that meant such a hold could never be superseded at all,
   * turning a window one refresh cycle wide into an indefinite one.
   *
   * With this, the FIRST generation seen after the hold opens is recorded (it
   * proves nothing on its own — it may be the same tmux server the send went
   * to), and the next DISTINCT one supersedes: two different servers observed
   * after the fact means one of them replaced the other, and the input box is
   * gone either way.
   */
  firstSeenGeneration: number | null;
  /**
   * When the send that opened this came back, or **null when nothing recorded
   * that it ever opened**.
   *
   * Null on exactly one kind of hold: `basis.kind === "rehydrated-attempt"`,
   * rebuilt from a line written before the keystrokes and never resolved. Such
   * a hold cannot say when it opened, so it says so rather than offering the
   * moment the attempt was written down as if it were the same fact. The
   * attempt's own timestamp is on the basis, where it is labelled as what it is.
   */
  openedAt: number | null;
  /**
   * When the most recent uncertain send landed. Equals `openedAt` while
   * `incidents` is 1, and null on a `rehydrated-attempt` — nothing landed.
   */
  lastSendAt: number | null;
  /**
   * How many recorded incidents this hold covers. Never below 1.
   *
   * Uncertain sends whose answer this dashboard read, plus — on a
   * `rehydrated-attempt` — the one attempt nobody ever accounted for.
   */
  incidents: number;
  /**
   * What was read about the most recent send, or **null when nothing was ever
   * read**: a `rehydrated-attempt` is a hold over a send whose answer no
   * process survived to see.
   */
  reading: UncertainSendReading | null;
  /** Which path the most recent one came down. */
  origin: UncertainSendOrigin;
  why: string;
  outcome: HoldOutcome;
  /**
   * Whether this process watched this happen, or read it off a disk.
   *
   * See `HoldBasis`. It is the field that keeps the three nullable ones above
   * honest: each null has exactly one basis that produces it.
   */
  basis: HoldBasis;
};

/* ------------------------------------------------------------------ *
 * The cross-agent feed — `GET /api/feed`.
 *
 * Greg, 2026-09-08: *"add a 'Recent messages' tab with a rolling window of the
 * last N messages across all agents (making it easy to filter)"*.
 *
 * The per-session route (`/api/messages?id=`) answers *is this row telling me
 * the truth?* This one answers *what is the fleet saying* — and the difference
 * is not only scope. **The reader of this feed was never watching these
 * sessions**, so a message that is wrong, misattributed or missing has nothing
 * on screen to contradict it. Every type below that looks like defensive
 * bookkeeping is there for that reason, and the reasoning is in
 * docs/plans/260909b-recent-messages-tab-a-rolling-window-across-all-agents.md.
 * ------------------------------------------------------------------ */

/**
 * Who said it, on the wire.
 *
 * **A structural copy of `TurnSpeaker` in tools/fleet/transcript.ts**, which
 * this file may not import — the header above says why no import may ever
 * appear here, and transcript.ts reaches `node:fs`.
 *
 * The copy is kept honest in the direction that matters **for free, by an
 * ordinary assignment**: `routes-recent-feed.ts` assigns a `TurnSpeaker` into
 * this field, so an arm added to the reader and not to this union is a compile
 * error at the point of use. No guard, no ceremony, nothing to remember. The
 * other direction — an arm here the reader never produces — is harmless,
 * because the browser's parser rounds a speaker it does not know to
 * `unrecognised` rather than to `assistant`.
 */
export type FeedSpeaker =
  | "human"
  | "assistant"
  | "peer"
  | "notification"
  | "compact-summary"
  | "injected"
  | "api-error"
  | "system";

/** One tool call, as a label. Structural copy of `ToolCallSummary`, same argument. */
export type FeedToolCall = { name: string; detail: string | null };

/**
 * **HOW MUCH THE FEED IS ENTITLED TO CLAIM ABOUT WHO SAID THIS.**
 *
 * `CLAUDE_SESSION_ID` is pinned into a tmux session's environment when the pane
 * is created and is never updated (transcript.ts says so at length). So a pane
 * that has been re-used — the agent exited and somebody started a fresh
 * `claude`, or resumed a different conversation — still names the FIRST
 * conversation, and the reader will faithfully return that conversation's
 * turns. They are real messages, well formed, correctly attributed, about this
 * repo, and **not the conversation the row is about**.
 *
 * The per-session view can leave that to the reader's own judgement, because
 * somebody looking at one session usually knows what it was doing. **This feed
 * cannot**, so the claim is carried explicitly beside every message rather than
 * asserted by putting a session's name next to some text.
 *
 * `verified` REQUIRES `FleetRow.execution` (session
 * 260908f-roadmap-exec-identity), which is not on `dev` yet — so today this
 * route never returns it. That is deliberate: an arm nothing can currently
 * produce is better than a `verified` that means "we did not check".
 */
export type FeedAttribution =
  /** The live pane's conversation id was checked and matches. Needs `FleetRow.execution`. */
  | { kind: "verified" }
  /** A pinned id, nothing contradicting it, and nothing confirming it either. The ordinary case. */
  | { kind: "claimed-only"; why: string }
  /** Something positively disagrees — e.g. a transcript untouched for hours against a `working` row. */
  | { kind: "suspect"; why: string };

/** One message in the feed, with the session it was read for attached to it. */
export type FeedMessage = {
  /** tmux's SESSION handle, `$1643` — the address, and what the session filter matches on. */
  sessionId: string;
  /** For reading. Renames happen, so this is the name at read time, not an identity. */
  sessionName: string;
  sessionTitle: string | null;
  /** See `FeedAttribution`. Never omitted, because its absence would read as confidence. */
  attribution: FeedAttribution;
  speaker: FeedSpeaker;
  /**
   * ISO, on **the box's clock**, exactly as the transcript wrote it — never
   * shifted to the browser's. messages-client.ts § `MessageTurn.at` has the
   * full argument; the short version is that shifting it would assert an
   * absolute instant nothing happened at.
   *
   * Null is in the type and was **not** observed in 955 sampled turns. See
   * `FeedPayload.undated` for what happens to one if it ever appears.
   */
  at: string | null;
  /** Plain, untrusted, possibly truncated, **never markup**. */
  text: string;
  truncated: boolean;
  fullChars: number;
  toolCalls: FeedToolCall[];
  /** The record's own uuid, for a React key that survives a refresh. */
  uuid: string | null;
};

/**
 * What happened when we tried to read one session — carried for **every** row
 * in the snapshot, including the ones with nothing to read.
 *
 * Nine of 21 rows on the box tonight are shells and scheduled sessions still
 * running `sleep`; they answer `no-claude-session-id`. A feed that listed only
 * the sessions it could read would show a fleet of twelve and look complete
 * doing it.
 */
export type FeedSessionRead =
  | {
      kind: "read";
      /** How many turns this session contributed to the merge, before the global trim. */
      turns: number;
      /**
       * **WHETHER THIS SESSION'S NEWEST `limit` TURNS WERE ALL ACTUALLY READ.**
       *
       * False means the byte budget stopped the walk before the requested
       * number of turns — so this session may have said more than the feed
       * shows. A short answer and a quiet agent look identical on screen, which
       * is the silent-success failure this feature is most exposed to. See
       * `FeedPayload.mayBeMissing` for when it actually matters.
       */
      complete: boolean;
      /** The transcript's own mtime, ISO, box clock. The one check on the hazard above. */
      lastModified: string;
      bytesRead: number;
      fileBytes: number;
      /** Tool results the reader skipped, so "silent between two messages" is never implied. */
      toolResultsSkipped: number;
      /**
       * How many transcript files matched this conversation id. Anything but 1
       * means provenance is ambiguous — the reader exposes it for exactly that,
       * and a feed that showed the turns without it would be picking one file
       * silently.
       */
      copies: number;
      /**
       * Lines that would not parse. **1 is normal** — a live session is being
       * appended to while we read, so the last line can be half-written.
       * Anything higher means turns may be missing from this session's answer.
       */
      recordsUnparseable: number;
    }
  /** No transcript to read. `reason` is the reader's typed code, `why` its sentence. */
  | { kind: "not-found"; reason: string; why: string }
  /** There was a file and it could not be read. */
  | { kind: "unreadable"; path: string | null; why: string };

/** One session in the feed's own census of the fleet. */
export type FeedSession = {
  sessionId: string;
  name: string;
  title: string | null;
  read: FeedSessionRead;
};

/**
 * **WHY THE FEED MIGHT NOT BE THE LAST N MESSAGES AFTER ALL.**
 *
 * Identified by `sessionId`, never by name: names are reassigned when a session
 * dies and two sessions can wear the same one, so a warning keyed by name can
 * point at the wrong agent.
 */
export type FeedCoverageReason = {
  sessionId: string;
  /** The name at read time, for printing beside the id. Not an identifier. */
  name: string;
  kind:
    /** The byte budget stopped the walk before this session's newest N, inside the window shown. */
    | "byte-budget"
    /** There was a transcript and it could not be read. */
    | "unreadable"
    /** This session claims a conversation whose transcript could not be located. */
    | "no-transcript"
    /** Turns came back with no placeable timestamp, so they may have displaced dated ones. */
    | "undated"
    /** Timestamps went backwards within one session, so "newest" is not a total order there. */
    | "out-of-order"
    /** Two rows name the same conversation, so its turns would be counted twice. */
    | "duplicate-conversation";
  why: string;
};

/**
 * **WHETHER "THE LAST N MESSAGES" IS A CLAIM THIS PAYLOAD CAN ACTUALLY MAKE.**
 *
 * The merge is exact — any message among the true newest N must be among its
 * own session's newest N — but only while four premises hold: the census is
 * fixed, each message belongs to exactly one session, every session really
 * supplied its newest N, and local and global "newest" use the same total
 * order. Each of the reasons above breaks one of them.
 *
 * **THIS IS A PROPERTY OF THE WHOLE FEED, NOT AN ADVISORY ROW BESIDE IT.** An
 * earlier draft listed only the byte-truncated sessions, and GPT Sol's P1
 * against that design is the reason this type exists: an unreadable session can
 * contain *all* of the true newest messages, and showing it as one more row in
 * a census does nothing to stop the main list looking authoritative. So a
 * client cannot render this feed without meeting the question, and `complete`
 * is constructible only when every contributor satisfied the invariant.
 */
export type FeedCoverage = { kind: "complete" } | { kind: "indeterminate"; reasons: FeedCoverageReason[] };

export type FeedPayload =
  | {
      schema: 1;
      kind: "feed";
      /** What was asked for, after clamping — so the page can say it got less than it typed. */
      limit: number;
      /**
       * **NEWEST FIRST**, which is the opposite of `/api/messages`, and the
       * inversion is done here, once, rather than in every client.
       *
       * Stated this loudly because the sibling route returns turns newest LAST
       * and a reader arriving from messages-client.ts will assume the same here.
       * Doing it server-side means the ordering has one home and one test.
       */
      messages: FeedMessage[];
      /**
       * Messages with no timestamp, which cannot be placed in a global ordering.
       *
       * **Not dropped** — a feed that silently omits messages is the one thing
       * this must not be — and **not interleaved at a guessed position**, which
       * would assert an ordering nothing supports. Zero of 955 sampled turns
       * needed this. If it is ever non-empty, that is the signal to design
       * something better rather than evidence that this was enough.
       */
      undated: FeedMessage[];
      /** Every row in the snapshot, readable or not. See `FeedSessionRead`. */
      sessions: FeedSession[];
      /**
       * Whether this really is the last `limit` messages. **Required, and the
       * client may not render the list without consulting it.** See
       * `FeedCoverage`.
       */
      coverage: FeedCoverage;
      /**
       * **THE CENSUS BOUNDARY, WHICH IS THE HONEST CONTRACT.**
       *
       * There is no instant at which this answer describes the fleet. The
       * roster was collected at `collectedAt`, up to a minute before; the
       * transcripts were read between `readStartedAt` and `readFinishedAt`. So
       * a session created after `collectedAt` is absent, one that has since died
       * is still present and its transcript still reads, and a session read
       * early may have appended while a later one was being read.
       *
       * What this payload actually says is *"the newest turns observed from the
       * roster collected at C, during reads R0–R1"* — not *"the fleet right
       * now"*, which is what a single timestamp would imply. GPT Sol's P1 on the
       * plan; the three fields exist so the page can say the true thing.
       */
      collectedAt: string | null;
      readStartedAt: string;
      readFinishedAt: string;
      servedAt: string;
      /**
       * **WHICH TMUX SERVER THE `sessionId`s IN THIS ANSWER BELONG TO.**
       *
       * Every `sessionId` here is a tmux session handle, and a `$1643` is only
       * meaningful within one tmux server — the same argument `collect.ts` makes
       * about comparing two snapshots. So a page that joins these messages to
       * the session list from `/api/state` is comparing two sets of handles, and
       * without this it cannot tell whether they name the same world.
       *
       * The failure it prevents is not hypothetical and is silent: after a tmux
       * server restart, a `$1643` in a feed read a minute ago is a *different*
       * session from the `$1643` in the current snapshot, so the row would take
       * an unrelated session's status and a click on it would open the wrong
       * conversation. Both look entirely normal. GPT Sol's P0 on the plan for
       * the clickable/scannable pass.
       *
       * `null` when the collector could not read it, which is a reason to
       * withhold the join rather than to guess at it.
       */
      tmuxServerPid: number | null;
    }
  /** We could not look. Never merged with an empty `messages`, which would say the fleet was quiet. */
  | { schema: 1; kind: "unreadable"; why: string };

/* ------------------------------------------------------------------ *
 * The Deploys tab: what shipped to production, and how stale the record is.
 * ------------------------------------------------------------------ */

/**
 * The three headings a deploy's reader-facing entries appear under.
 *
 * A type rather than the `as const` array, which is a runtime value and belongs
 * in `deploys.ts` — this file may not hold one. docs/project/changelog.md
 * § The file has the reasoning for three rather than four: there is no section
 * for engineering, because a change a reader would notice is a headline change
 * whatever it took to build.
 */
export type DeploySection = "headline" | "enhancement" | "fix";

/** One thing a reader would notice, as the changelog pipeline wrote it. */
export type DeployEntry = {
  section: DeploySection;
  title: string;
  body: string;
  /** Where in the app, in the pipeline's words. Null when it named nowhere. */
  where: string | null;
  /** Full 40-character shas. The panel renders them as links into the repository. */
  commits: string[];
};

/**
 * One production deploy, as `src/web/changelog-versions.ndjson` has it.
 *
 * **Declared here rather than in `deploys.ts` because both ends read it**, and
 * this file's whole existence is the four fields that reached the browser and
 * were dropped by a client holding its own unrelated copy of a type. The reader
 * and the panel import this one.
 */
export type DeployVersion = {
  /** The deploy's timestamp, UTC. It is also the version's id. */
  version: string;
  /** Which release this is, counted from the OLDEST line — the number `/changelog` shows. */
  release: number;
  deploymentId: string;
  sha: string;
  previousSha: string | null;
  /**
   * How many commits this deploy shipped, or null when the line does not say.
   *
   * **A NON-MERGE COUNT** — the changelog pipeline drops merge commits, because
   * every one of them here is a `Merge remote-tracking branch 'origin/dev'`
   * carrying no change of its own. Anything drawn beside it must be counted the
   * same way or the two are not comparable. **Null is not zero**: a line that
   * has forgotten what it shipped has not shipped nothing.
   */
  commitCount: number | null;
  /**
   * Nothing a reader would notice. The common case, and not a fault.
   *
   * **Only ever true when `changelogReadable` is** — a deploy whose changelog
   * could not be read is not a quiet one, and saying so was the bug GPT Sol
   * found on 2026-09-09.
   */
  invisible: boolean;
  /**
   * **Whether "what changed" could be read at all**, as distinct from there
   * being nothing.
   *
   * False when `entries` is absent, is not an array, or held nothing readable
   * on a line that does not claim to be quiet. The panel must draw this as
   * *we could not read what changed*, never as *nothing changed*: the two look
   * identical and mean opposite things, and one of them is a headline feature
   * rendered as an empty deploy.
   */
  changelogReadable: boolean;
  /** Entries on this line that would not parse. Counted, never hidden. */
  unreadableEntries: number;
  /** When the changelog job wrote this line — **not** when the deploy happened. */
  generatedAt: string | null;
  entries: DeployEntry[];
};

/**
 * **Which deploy the git comparison is measured from — or why there is not one.**
 *
 * A discriminated reason rather than a nullable sha, because the two ways of
 * having no watermark need different sentences and had one between them until
 * GPT Sol's F1, 2026-09-09: an EMPTY record genuinely names no deploy, whereas a
 * record whose newest line is corrupt names plenty and simply cannot say which
 * is newest. Rendering the first explanation over the second is a confident
 * account of the wrong problem.
 */
export type Watermark =
  | { kind: "sha"; sha: string }
  /** The record holds no deploys at all. */
  | { kind: "none" }
  /** The record holds deploys, but its newest line would not parse. */
  | { kind: "newest-unreadable" };

/**
 * The three git readings, taken together as one snapshot.
 *
 * **One shape rather than three fields, because they must describe one tip.**
 * `origin/main` is mutable between processes — a dozen agents fetch all night —
 * so three independently-resolved calls can answer about three different
 * commits, and the result is a reading of nothing. GPT Sol's P2 finding 6.
 */
export type GitSnapshot = {
  main: MainRef;
  ancestry: AncestryReading;
  commitsSince: CountReading;
};

/**
 * **This checkout's cached `origin/main`** — where a deploy attempt last pushed
 * to, which is not the same as what is serving.
 *
 * `deploy.ts` pushes and only then waits for Vercel, so a build that failed
 * leaves main advanced with nothing serving from it. This was called
 * "production's tip" until GPT Sol's P3, 2026-09-09.
 *
 * `lastFetchAtMs` is the age of **the view, not of the commit**. The dashboard
 * never fetches — see `tools/fleet/git-probe.ts` — so a ref nobody has updated
 * in a week looks exactly like a week with no deploys unless the page can tell
 * the two apart.
 */
export type MainRef =
  | { kind: "ref"; sha: string; committedAt: string; lastFetchAtMs: number | null }
  | { kind: "unavailable"; why: string };

/**
 * How the newest recorded deploy sits against this checkout's cached tip.
 *
 * **Four arms, and the split between the middle two is the one that matters.**
 * It was three until 2026-09-09, with a single `not-ancestor` drawn as *a
 * rollback, or a deploy from a working directory* — an alarm. GPT Sol pointed
 * out that a **merely stale cached ref produces exactly that reading**: when the
 * changelog job has run since this checkout last fetched, the recorded deploy is
 * newer than the cached tip and is not its ancestor, and nothing has gone wrong
 * at all. Raising a rollback alarm on the commonest benign state would have
 * taught Greg to ignore the alarm.
 *
 * So the probe asks the question the other way round too, and:
 *
 *  - `ancestor` — the recorded deploy is in the cached tip's history. Normal.
 *  - `record-ahead` — the cached tip is an ancestor of the recorded deploy.
 *    **Named for the graph relation, not for the explanation**, because three
 *    different things produce it: the checkout is merely stale (much the
 *    commonest), the deploy was made from an unpushed working branch, or main
 *    was rolled back to the cached commit afterwards. It was called
 *    `cache-behind` and drawn as "nothing is wrong" for an hour on 2026-09-09,
 *    and neither the name nor the sentence followed from the evidence —
 *    GPT Sol's F2. The page says *usually* stale, and stops there.
 *  - `diverged` — neither contains the other. **This** is the rollback or the
 *    deploy from somebody's working directory, and it is worth a colour.
 *  - `unknown` — we could not ask. Never collapse this into any of the above; a
 *    git that would not run must not render as a rollback that never happened.
 */
export type AncestryReading =
  | { kind: "ancestor" }
  | { kind: "record-ahead" }
  | { kind: "diverged" }
  | { kind: "unknown"; why: string };

/**
 * How many commits separate the newest recorded deploy from production's tip.
 *
 * Non-merge, to match `DeployVersion.commitCount`. **`unknown` rather than a
 * fallback of `0`**: every failure of this question has a plausible, reassuring
 * wrong answer, and "0 commits behind" is the most reassuring possible way to
 * say we have no idea.
 */
export type CountReading =
  { kind: "count"; commits: number }
  /**
   * **Only meaningful when the ancestry is `ancestor`.**
   *
   * `git rev-list A..B` on divergent histories is a set difference, not "the
   * commits after A" — so on a rollback it would answer a number that reads like
   * a distance and is not one. The probe answers `not-comparable` instead, and
   * the panel draws nothing rather than a plausible wrong figure. GPT Sol,
   * 2026-09-09.
   */
  | { kind: "not-comparable"; why: string }
  | { kind: "unknown"; why: string };

/**
 * `GET /api/deploys`.
 *
 * **`deploys` with an empty `versions` and `unreadable` are different claims** —
 * *we read the record and it is empty* against *we could not read it* — and the
 * page must never draw them the same way. Same discipline as the health chart's
 * blank day, and the same reason: the collapsed version is a confident sentence
 * about production that nobody checked.
 *
 * On `commitsSince`, read `routes-deploys.ts` before writing a sentence about
 * the number. **It is not undeployed work.** Everything on `main` has shipped or
 * is shipping, since `main` is written only by `npm run deploy`; the number
 * lumps together deploys the changelog job has not recorded yet and a tip that
 * has not been deployed, and nothing on this box can separate those without a
 * Vercel token.
 */
export type DeploysPayload =
  | {
      schema: 1;
      kind: "deploys";
      /** Newest first, at most `limit` of them. */
      versions: DeployVersion[];
      /** How many the record holds altogether, so "show more" knows there is more. */
      total: number;
      /** What was served, after clamping — so the page can say if it got less. */
      limit: number;
      /** A sentence per line of the record that would not parse. Never merely counted. */
      unreadable: string[];
      /** Non-blank lines in the record, parsed or not. The denominator. */
      recordLines: number;
      /** When the changelog job last wrote a line. **Not** when anything deployed. */
      lastGeneratedAt: string | null;
      /** The newest deploy the record knows about, or null for an empty record. */
      newestRecordedSha: string | null;
      /**
       * **Whether the record's last line parsed** — and therefore whether
       * `newestRecordedSha` really is the newest deploy or merely the newest
       * one that survived.
       *
       * When false, every comparison below is measured from the wrong deploy,
       * and the page must say so instead of presenting a confident distance.
       * The record is append-only, so its last line is its newest deploy.
       */
      newestLineRead: boolean;
      /**
       * The git readings, as **one snapshot of one tip**.
       *
       * Nested rather than spread across three sibling fields, so it is not
       * possible to build a payload whose `ancestry` and `commitsSince` were
       * measured against different commits. GitSnapshot says why that is a real
       * risk here rather than a theoretical one.
       */
      git: GitSnapshot;
      /** The server's clock, so the page can age the record against it. */
      servedAtMs: number;
    }
  | { schema: 1; kind: "unreadable"; why: string };

/* ------------------------------------------------------------------ *
 * Starting a session from the web UI, and telling the Overseer about it.
 *
 * The FOURTH endpoint to move behind this file, and it moved because of a bug
 * rather than for tidiness. `LaunchRecord` was declared twice — in
 * `routes-new.ts` and again in `web/src/new-session-client.ts` — related by
 * nothing but hope, exactly like `QueueView` before it. A cross-family review
 * found that a launch which reached `started` could carry no notification state
 * at all, with no way to tell "not attempted" from "nobody wired it up", and
 * fixing that needs a discriminated union. The union changes the shape on the
 * wire, and changing the shape while the declaration is written twice is
 * invisible to the compiler: `parseLaunch` reads `v["state"]` as a raw string,
 * so a rename returns `null` for every record and the panel silently renders
 * nothing. Shaped exactly like docs/postmortems/260908b.
 * ------------------------------------------------------------------ */

/**
 * What became of the one line the dashboard sends the Overseer when a session
 * is started from the web UI.
 *
 * **There is no "sent".** Nothing on this box can observe reception —
 * `sendMessage` types keystrokes at a pane, and whether the agent read them,
 * whether the Enter landed, and whether the text concatenated with something
 * half-typed are all outside what we can see. So the success arm is
 * `submitted`, which claims exactly what happened, and every failure carries the
 * `Delivery` word that path already returns.
 *
 * The four not-a-send arms are four different facts, and the union exists so
 * the launch record cannot flatten them into "not sent": nobody holds the role,
 * which is what a box looks like after a reboot and is a real answer; the role
 * is contested, which is a fault to report and never a pick; we could not
 * establish who holds it or could not address them; and we found the holder and
 * the send would not go.
 */
export type NotifyOutcomeView =
  /**
   * **HANDED TO THE QUEUE, WHICH IS AS FAR AS THIS ROUTE'S KNOWLEDGE GOES.**
   *
   * Not "sent" and not even "submitted": the notice is in the drain's hands and
   * will go out on a later refresh, through the same coordinator every other
   * producer uses. What became of the keystrokes is the queue's story and the
   * queue's surface tells it — this record would have to poll to find out, and a
   * launch record that went stale claiming a delivery would be worse than one
   * that says plainly where it put the thing.
   */
  | { kind: "queued"; to: string; position: number }
  /** The queue turned it down — a full queue, a message it will not carry. */
  | { kind: "not-queued"; to: string; rule: string; why: string }
  /** The snapshot was readable and nobody holds the `overseer` role. */
  | { kind: "no-holder" }
  /** More than one session claims it. Reported, never resolved here. */
  | { kind: "contested"; names: readonly string[] }
  /** We could not establish who holds it, or could not address them. */
  | { kind: "cannot-tell"; why: string };

/**
 * Where a launch's notification has got to.
 *
 * `pending` is a real state and is set **before** the send is attempted, so a
 * notification can never delay the launch result — the page says a session
 * started the moment it started, and fills this in afterwards.
 */
export type NotifyState = { kind: "pending" } | NotifyOutcomeView;

/**
 * **THE DISCRIMINANT AND ITS NOTIFICATION, IN ONE FIELD, AND THE NESTING IS THE
 * POINT.**
 *
 * A union on a top-level `state` would be the obvious shape and it cannot be
 * used here: `routes-new.ts` mutates its record in place, and that record's
 * OBJECT IDENTITY is load-bearing — `launch()` ends with
 * `if (inFlight === record)`, a reference comparison an earlier review put there
 * so that two launches being live at once is loud rather than silent. Moving a
 * record between arms of a top-level union means replacing the object, which
 * breaks that check.
 *
 * Nesting the discriminant under one field keeps the identity — `record.progress
 * = {…}` is a single assignment — while still making the bad state
 * unrepresentable: a `starting` launch cannot carry an outcome, and a `started`
 * one cannot carry nothing.
 */
export type LaunchProgress =
  | { state: "starting"; notification: { kind: "not-attempted" } }
  | { state: "started"; notification: NotifyState }
  /** A launch that never started has nothing to tell anyone about. */
  | { state: "failed"; notification: { kind: "not-applicable" } };

/** One attempt, from the moment it is accepted to whatever became of it. */
export type LaunchRecordView = {
  /** Ours, not the box's — the handle the client polls with. */
  id: string;
  progress: LaunchProgress;
  /** The tmux session name: what the caller asked for, or the opaque one minted for them. */
  name: string | null;
  /** What was ASKED for. In repo mode the box may choose another — `startedDir`. */
  dir: string;
  /** `repo` is gjd-remote's verified origin resolution; `dir` is the `-d` escape hatch. */
  resolution: "repo" | "dir" | null;
  /** The directory the box says it actually started in, once it has said so. */
  startedDir: string | null;
  /** The prompt's size. **Never the prompt.** */
  promptBytes: number;
  requestedAt: string;
  finishedAt: string | null;
  /** Why it failed, in a sentence for a person. */
  error: string | null;
  /** A failure that MAY have started something — a timeout, a launcher that vanished. */
  maybeStarted: boolean;
  /** Anything true but awkward — a start whose name could not be read back. */
  note: string | null;
};

/** Everything the client needs to draw the button's state. */
export type NewSessionStatusView = {
  ok: true;
  /** A launch is in flight; a second POST would be refused. */
  busy: boolean;
  /** Milliseconds until a POST would be accepted; 0 when it would be now. */
  retryAfterMs: number;
  /** Newest first, capped — this is a live view, not a history. */
  launches: readonly LaunchRecordView[];
};

/* ------------------------------------------------------------------ *
 * CAN THIS ACCOUNT AFFORD MORE WORK? — the usage card's own shapes.
 *
 * The `UsageReport` block above is what `tools/overseer/usage.ts` MEASURES.
 * These are what the dashboard SHOWS, and they are deliberately narrower: a
 * report carries every 429 in the scanned window (27 on this box on 2026-09-08,
 * all of them the same limit), the whole cache blob and a scan's full coverage,
 * and a card that redrew all of it would be a second copy of `overseer usage`
 * rather than an answer to a question.
 *
 * **A view weaker than its wire type is the plan's own rule** — 260908f §
 * Reconciliation, on `wire.ts`: *"a browser-parsed view may deliberately be
 * weaker than its wire type."* The narrowing happens ONCE, on the server, in
 * `tools/fleet/usage-feed.ts`; the browser parses these shapes and nothing else.
 * That is what keeps the second parser in `web/src/types.ts` small enough to be
 * read in one sitting, which is the property that made it worth having.
 *
 * WHAT IS DROPPED, AND WHY EACH IS SAFE TO DROP:
 *
 *  - **Every `*Ms` twin of an ISO field.** The page judges freshness against
 *    its own skew-corrected clock (`ClockSkew` in web/src/types.ts); a
 *    server-computed `msUntilReset` would be as old as the payload and would
 *    read as current. ISO crosses; the age is computed where it is drawn.
 *  - **The individual 429s.** They are grouped into `UsageIncident` first —
 *    the acceptance line of this stage. Thirty sessions stopped by one window
 *    is ONE thing that has happened, and thirty rows is a page that hides it.
 *  - **Nothing from `ScanCoverage`.** It crosses whole and unmodified, because
 *    it is the positive control: *no limits hit* is only believable beside
 *    *opened 235 transcripts, scanned 232,961 lines*. Dropping it to save bytes
 *    would turn the one honest zero on this page into the unfalsifiable kind.
 *    docs/reusable/silent-success.md.
 * ------------------------------------------------------------------ */

/**
 * One window as the card draws it — **the `expired` arm still carries no
 * percentage**, and that is inherited on purpose rather than by accident.
 *
 * `UsageWindowReading` above refuses to put a void number in a numeric field,
 * *"not even under a name like `stalePercent`"*, because a renderer handed one
 * will eventually render it. Narrowing that type into a flatter one is exactly
 * the moment somebody would helpfully add the field back, so the rule is
 * restated here where the temptation is: the stale number lives in `why`, as
 * prose, where it cannot be mistaken for a reading.
 */
export type UsageWindowCard =
  | {
      kind: "value";
      window: UsageWindowName;
      /** 0–100, as `~/.claude.json` gave it. */
      utilizationPercent: number;
      /** ISO. The page renders it in UTC, London and Athens — `tools/fleet/zones.ts`. */
      resetsAt: string;
    }
  /** The cached number described a window that has already reset. No percentage exists on this arm. */
  | { kind: "expired"; window: UsageWindowName; resetsAt: string; why: string }
  | { kind: "unknown"; window: UsageWindowName; why: string };

/**
 * **THIRTY SESSIONS, ONE WINDOW, ONE INCIDENT** — the acceptance line of the
 * usage-visibility stage, as a type.
 *
 * A rate limit is a fact about an ACCOUNT AND A WINDOW, not about a
 * conversation: when the five-hour window fills, every session sharing the
 * account is rejected within seconds of the others, and the box goes on
 * producing one 429 per attempt for as long as anybody keeps trying. Measured
 * on 2026-09-08: 27 rejections sharing a single `resetsAt`. Listed one per row
 * that is a wall of red saying the same thing 27 times; the number that
 * actually matters — *when can work resume* — appears 27 times too and is the
 * same in each. So the grouping is not a display nicety, it is the reading.
 *
 * **The key is a window and its reset instant, and there is NO ACCOUNT IN IT.**
 * A `RateLimitHit` is a line in a transcript and carries no account id at all —
 * which is exactly why `classifyHit` in tools/overseer/usage.ts exists — and the
 * scan covers eight days that may span a `/login` swap. So two accounts whose
 * rejections happened to share a window name and a reset instant would land in
 * one incident, and nothing in the data could separate them.
 *
 * **An incident is therefore an OBSERVED WINDOW CLUSTER, not a proven event in
 * this account's life**, and nothing rendering one may say otherwise. Whether
 * any of them binds the logged-in account is `UsageVerdict`'s question, decided
 * with the cache attribution that only the daemon has. This type said the
 * account was "implicit in the report" until GPT Sol's P1(4) on 2026-09-09;
 * `chooseUsage` proves the report was COLLECTED for the current account, which
 * is a different claim from the hits inside it belonging to it.
 */
export type UsageIncident = {
  /**
   * Stable across passes, derived from the window and the reset instant —
   * never minted per render.
   *
   * The same property `RateLimitHit.id` has and for a weaker version of the
   * same reason: this one is a React key and a thing a person points at. An id
   * that changed every poll would remount the row every two minutes and would
   * make "the same incident" unsayable between two readings.
   */
  id: string;
  window: UsageWindowName;
  /** ISO. **The only number on this card that says when work can resume.** */
  resetsAt: string;
  /**
   * The conversations rejected in this window, deduplicated, in first-seen
   * order — the Claude conversation uuid, NOT a tmux handle or a pane id.
   * `RateLimitHit.claudeSessionId` says why the three must not be confused.
   */
  conversations: string[];
  /** Rejections counted. **≥ `conversations.length`**: one session retrying produces many. */
  rejections: number;
  /**
   * Rejections whose conversation could not be identified, counted rather than
   * dropped. A transcript record with no `sessionId` is a real thing; folding
   * it into the identified ones would inflate the session count, and dropping
   * it silently would understate the incident.
   */
  unidentifiedRejections: number;
  /** ISO of the earliest and latest rejection seen in this window, or null if none carried a timestamp. */
  firstHitAt: string | null;
  lastHitAt: string | null;
};

/**
 * **WHAT THE PAGE KNOWS ABOUT THE CURRENT ACCOUNT, AND WHAT IT CANNOT TELL.**
 *
 * `collectedAt` is the field that makes the rest of it honest, and it is NOT
 * the checkpoint's `writtenAt`: a usage pass takes 30–45 seconds over ~2.9 GB
 * and does not always finish, and `chooseUsage` deliberately republishes a
 * report from an earlier pass when a fresh scan fell over. So a card drawing
 * its age from the checkpoint's clock would show a two-hour-old reading as
 * thirty seconds old — the stale-reading-that-looks-current failure this whole
 * subsystem exists to refuse, moved one file along. The card ages this.
 */
export type UsageSummary = {
  /** ISO. **When this reading was taken**, which is not when the checkpoint was written. */
  collectedAt: string;
  /** Whose headroom this is. Recorded, never rotated — Greg's call; see `UsageAccount`. */
  account: UsageAccount;
  /** `limited` is ground truth from a 429; `approaching` is only ever a cache hint. */
  level: UsageLevel;
  /** The verdict's own sentences, verbatim. The card prints them rather than re-deriving a headline. */
  reasons: string[];
  /**
   * The cached hint, or the reason there is none. Never the ground truth —
   * `UsageReport`'s header.
   *
   * **`unattributed` CARRIES NO WINDOWS, and that is the same repair as
   * `UsageWindowReading`'s expired arm one level down.** A cache belongs to
   * whichever account was logged in when it was written, and after a `/login`
   * swap `~/.claude.json` can still hold the PREVIOUS subscription's numbers —
   * measured, and the reason `attributeCache` in tools/overseer/usage.ts exists
   * at all. A card that drew *96% used* under a heading naming a different
   * account would be reporting somebody else's headroom as this one's, which is
   * worse than reporting nothing.
   *
   * A percentage that a renderer can reach is a percentage that eventually gets
   * rendered, so the unattributable case is given no percentages to reach: the
   * numbers do not cross, and `why` carries the two account ids in prose.
   */
  cache:
    | {
        kind: "attributed";
        fetchedAt: string;
        /** Non-null on this arm by construction: attribution requires both sides to name the same account. */
        accountUuid: string;
        windows: UsageWindowCard[];
      }
    /** A cache was read and could not be shown to be this account's. No windows, deliberately. */
    | { kind: "unattributed"; why: string; fetchedAt: string | null; accountUuid: string | null }
    /** No cache could be read at all. */
    | { kind: "unknown"; why: string };
  /**
   * The 429s, grouped. **`none` is a claim and only `coverage` makes it
   * believable**, which is why every arm carries one, including `unknown`.
   */
  limits:
    | { kind: "incidents"; incidents: UsageIncident[]; coverage: ScanCoverage }
    | { kind: "none"; coverage: ScanCoverage }
    | { kind: "unknown"; why: string; coverage: ScanCoverage };
  /**
   * ISO of the moment work can actually resume, or null when nothing is
   * blocking. From `UsageVerdict.activeLimit`, which is the window that frees
   * up LAST when several are in force — not the first one to clear.
   */
  dueBackAt: string | null;
  /**
   * The window `dueBackAt` belongs to, or null with it.
   *
   * **BOTH HALVES, BECAUSE AN INCIDENT'S KEY IS BOTH HALVES.** A renderer
   * marking which incident the producer actually attributed compares against
   * `UsageIncident`'s key, and that key is `window + resetsAt`. Matching on the
   * instant alone labels every window that happens to reset at the same moment
   * — and `five_hour` and `seven_day` sharing an instant is ordinary, not
   * exotic, since both are aligned to the hour. One attributed limit would then
   * put an attributed badge on a cluster the daemon explicitly could not
   * attribute, which is the exact claim this stage spent a review round
   * removing. GPT Sol's P1(3) in round two, 2026-09-09.
   */
  dueBackWindow: UsageWindowName | null;
};

/**
 * The usage card's feed, with the same five ways of having nothing to say that
 * `OverseerStatusFeed` has, plus one of its own.
 *
 * **`no-report` is one of them, and it is the arm production draws most.** The
 * checkpoint was read perfectly well and it says no usage pass has produced a
 * report — because the daemon was started with `--no-usage`, or because it has
 * not reached its first 300-second usage tick, or because the field predates
 * this build. `StoredUsage`'s `none` arm carries the sentence; this passes it
 * through unchanged rather than flattening it into `checkpoint-unreadable`,
 * which would send a reader to look for a broken file that is fine.
 *
 * **`report-unreadable` is the seventh, and it is separate from `no-report`
 * precisely because the page says different things about them.** *No pass has
 * run* is ordinary and the sentence for it ends "nothing is wrong with the
 * file"; *a report is there and this build cannot read it* is a producer and a
 * consumer that have come apart, and telling somebody nothing is wrong is then
 * false and sends them away from the thing that is. GPT Sol's P1(3),
 * 2026-09-09 — the two had been folded into one arm.
 */
export type UsageFeed =
  /** The server did not look. NOT *nothing is limited* — see `AttentionFeed`. */
  | { kind: "not-asked" }
  | { kind: "checkpoint-absent" }
  | { kind: "checkpoint-unreadable"; why: string }
  | { kind: "unsupported-schema"; saw: string; known: number }
  /** The checkpoint is readable and holds no report. `at` is when it was WRITTEN; nothing was scanned. */
  | { kind: "no-report"; why: string; at: string }
  /** A report IS there and this reader could not make sense of it. Something is wrong, unlike above. */
  | { kind: "report-unreadable"; why: string; at: string }
  | { kind: "published"; summary: UsageSummary; coordinatorWrittenAt: string };


/* ------------------------------------------------------------------ *
 * The queue of ideas.
 * ------------------------------------------------------------------ */

/**
 * Who recorded a queue write.
 *
 * **Narrower than `Speaker` on purpose.** That type's third arm, `dashboard`,
 * means *a person acted and software is reporting it* — a report, never an
 * instruction. A queue write IS an instruction, and an item nobody authored is
 * exactly what gate 3 exists to refuse, so it must not be spellable here.
 *
 * `tools/overseer/idea-queue.ts` imports this rather than declaring its own,
 * which reads backwards — the record's model importing from the HTTP wire — and
 * is deliberate anyway: this file is the one home for a shape that crosses the
 * boundary, and the alternative is the twin declaration this file's header was
 * written about. `attention-classify.ts` and `usage-carry.ts` already reach here
 * the same way.
 */
export type QueueActor = "greg" | "overseer";

/** Where an item has got to. ONE axis — see `QueueRow` for the other two. */
export type QueueLifecycle = "queued" | "dispatched" | "done" | "dropped";

/** Whether anybody has said it may happen. */
export type QueueAuthorityKind = "proposed" | "authorized";

export type QueueProblemKind =
  | "unreadable-line"
  | "unknown-item"
  | "duplicate-item"
  | "missing-anchor"
  | "unauthorized-authorization"
  | "illegal-transition";

/** One thing that happened to an item. `what` is the server's own phrase. */
export type QueueTouch = { kind: string; at: string; by: QueueActor; what: string };

/**
 * How deep the queue is, split by **why** each item is not moving.
 *
 * The split is the useful part: a single number conflates *nobody has got to it*
 * with *it is waiting on you*, and only one of those is Greg's to fix.
 *
 * The four fields partition `rows` — an item that is both unauthorised and
 * waiting on Greg is counted once, under `needsGreg`, because that is the
 * actionable half. Adding them up must give the number of rows.
 */
export type QueueDepth = {
  dispatchable: number;
  needsGreg: number;
  unauthorized: number;
  /**
   * Rows held only because the FILE has a problem — approved, unblocked, and
   * still not dispatchable.
   *
   * Its own count because without it those rows were reported as
   * `unauthorized`, so a queue with one bad line said *12 not approved* beside
   * twelve perfectly approved rows, in the same view as the alarm explaining
   * that the file was the trouble. GPT Sol's P2-2.
   */
  queueHeld: number;
  dispatched: number;
  done: number;
  dropped: number;
};

export type QueueWindow = { days: number; dispatched: number; done: number };

/**
 * What the queue has actually done — **measured on the queue's own events**,
 * never on the fleet's session log.
 *
 * `duration` has exactly ONE arm, and that is a deliberate piece of type design
 * rather than an unfinished union. Greg asked for a wait estimate; GPT Sol
 * rejected the obvious one twice (P1-5 and its answer 3) and was right on every
 * term — median session length is a fact about the mix of work, a session is not
 * a queue item, session lifetime is censored by the long runs still going, and
 * concurrency is a policy number. *"Three dispatched in the last 7 days"* is an
 * observation; *"about four days"* is an inference this data cannot support.
 *
 * With one arm, a page cannot render a confident figure by forgetting a
 * comparison. When a real duration becomes possible — enough of this queue's own
 * `dispatched → done` pairs, grouped by size — it arrives as a second arm and
 * every reader is made to handle it.
 */
export type QueueThroughput = {
  windows: QueueWindow[];
  dispatchesEver: number;
  completionsEver: number;
  duration: { kind: "not-enough"; why: string };
};

/**
 * What can honestly be said about one item's wait.
 *
 * Four arms and none is a duration. *Running*, *waiting on you* and *nobody has
 * approved it* send a reader to three different actions; a single "unknown"
 * sends them nowhere.
 */
export type QueueItemWait =
  | { kind: "ahead"; ahead: number; why: string }
  /**
   * The FILE is the problem, not the item.
   *
   * Separate from every per-item reason because it outranks them: while the
   * record has a hole in it nothing may go out, so *"next in line"* would be a
   * promise the queue cannot keep — which the panel was making, beside the
   * alarm saying the opposite. Sol's P2-2.
   */
  | { kind: "queue-held"; why: string }
  | { kind: "running"; session: string | null; why: string }
  | { kind: "needs-greg"; waitingOn: string | null; why: string }
  | { kind: "not-authorized"; why: string };

/**
 * One row of the queue.
 *
 * **`ready` and `why` are computed on the SERVER**, and that is not an
 * optimisation. `ready` is `isDispatchable`, which is gate 3's own test; a
 * second implementation of it in browser TypeScript would be a second answer to
 * *"may this go out?"*, and the two would disagree the first time one moved. The
 * client renders the sentence it is given.
 */
export type QueueRow = {
  id: string;
  title: string | null;
  text: string;
  lifecycle: QueueLifecycle;
  authority: QueueAuthorityKind;
  /** The revision the approval names — `null` when it is only proposed. */
  authorizedRevision: number | null;
  /** Bumped by every content edit. Not equal to `authorizedRevision` means the approval lapsed. */
  revision: number;
  needsGreg: boolean;
  /** The server's `isDispatchable`. Never recomputed here. */
  ready: boolean;
  /** Why not, in the server's words. `null` exactly when `ready`. */
  why: string | null;
  wait: QueueItemWait;
  waitingOn: string | null;
  size: string | null;
  source: string | null;
  runs: string | null;
  areas: string[];
  addedBy: QueueActor;
  addedAt: string;
  lastTouchedAt: string | null;
  dispatchedTo: string | null;
  dispatchedAt: string | null;
  plan: string | null;
  droppedWhy: string | null;
  history: QueueTouch[];
  /** `null` means nobody has ranked it. Ordering only; never part of dispatch authority. */
  priority: number | null;
  /** Who set the priority now governing the row's position; null with an unstated priority. */
  priorityBy: QueueActor | null;
  /** When that priority was set, as ISO; null with an unstated priority. */
  priorityAt: string | null;
};

/**
 * `GET /api/queue`, with three arms because two of them are silences that mean
 * different things.
 *
 * **`never-written` is not an empty `queue`.** Nobody has used this queue is
 * ordinary; a file that exists and folds to nothing has had everything
 * dispatched or dropped. Drawn as the same blank list they become one claim.
 *
 * **`unreadable` is neither, and it is the one that matters.** The Overseer's
 * own store may cold-start because losing it costs only history. This file is
 * original human input and is not disposable, so a lost one rendering as a
 * healthy empty queue is the single worst thing this tab could do.
 */
export type QueueFeed =
  | { schema: 1; kind: "never-written"; why: string }
  | { schema: 1; kind: "unreadable"; why: string }
  | {
      schema: 1;
      kind: "queue";
      /** Opaque; names the tail as well as the count, so `behind` and `different` are distinguishable. */
      version: string;
      rows: QueueRow[];
      settled: QueueRow[];
      /** Withheld by the settled cap, so the page says "and N more" rather than implying that is all. */
      settledWithheld: number;
      depth: QueueDepth;
      throughput: QueueThroughput;
      /**
       * Anything the fold could not accept. **Non-empty means nothing in the
       * queue is dispatchable** — a queue two items short must not authorise
       * the items it did manage to read.
       */
      problems: { kind: QueueProblemKind; why: string }[];
      /** Where the file is, so a person can go and look at it. */
      path: string;
    };

/* ------------------------------------------------------------------ *
 * What a session is about, in a sentence.
 * ------------------------------------------------------------------ */

/**
 * A generated description of one session, or an honest account of why there
 * isn't one.
 *
 * Greg, 2026-09-09: *"For each session, provide a 1-2-sentence description of
 * what it's about, and show in the Session List."*
 *
 * **`not-yet-described` is the normal state for a while, and it is not an
 * error.** A description needs a *verified* execution identity, and every row
 * reads `unknown` until the dashboard and the daemon have been restarted onto
 * the code that produces one. So its wording has to be informative rather than
 * apologetic, or a page that is merely new will read as broken.
 *
 * **There is no arm carrying an empty string.** Greg ruled that out by name — a
 * model that answered a different question routinely returns the right shape
 * with empty strings in it, and publishing one is a row saying nothing
 * confidently.
 */
export type SessionDescription =
  | {
      kind: "described";
      /** A short display title. **Never renames the tmux session** — that name is an address. */
      title: string;
      /** One or two sentences: what this session is FOR. */
      description: string;
      /** When it was generated, so a reader can age it. */
      describedAt: string;
    }
  /** The pass has not reached this session yet, or has nothing to describe it from. */
  | { kind: "not-yet-described"; why: string }
  /** We know why there is no description and it is worth saying. */
  | { kind: "cannot-tell"; why: string };
/* ================================================================== *
 * STAGE 4b — A HOLD THAT OUTLIVED THE PROCESS THAT RECORDED IT
 *
 * A uniquely named banner rather than the bare separator this file uses
 * elsewhere: two sessions appending blocks that both open with the same
 * line collide in git even when the blocks are about different things.
 * ================================================================== */

/**
 * Where a hold's record came from, and therefore **what it is entitled to
 * say.**
 *
 * `tools/fleet/hold-ledger.ts` makes a hold survive a dashboard restart, and
 * the thing that must not survive with it is the impression that this process
 * watched any of it happen. A rehydrated hold is a record read off a disk by a
 * process that was not there: the run that made the send has ended, and nothing
 * here has been re-checked since the line was written.
 *
 *  - `observed-here` — this process made the send and read what came back.
 *  - `rehydrated-hold` — rebuilt at startup from a line the previous run wrote
 *    **after** its send returned. It knows what was read and when the hold
 *    opened, because that run wrote both down. What it cannot know is anything
 *    that happened after that line: if the operator released it and the process
 *    died before recording the release, this comes back holding. That is the
 *    conservative direction — pressing release a second time costs a tap, and
 *    the other mistake types into an input box nobody has looked at.
 *  - `rehydrated-attempt` — rebuilt from a line written **before** the
 *    keystrokes, which nothing ever resolved. **It does not know whether the
 *    send was even made**, let alone how far it got, and there is no moment at
 *    which anything opened, so `openedAt`, `lastSendAt` and `reading` are all
 *    null on such a hold. It is the strongest reason the ledger exists — a
 *    crash inside the transport is exactly the case where nobody can say what
 *    is in that input box.
 *
 * **THE UNKNOWN FIELDS ARE NULLABLE BESIDE THIS RATHER THAN CARRIED INSIDE
 * IT.** A union carrying `openedAt`, `lastSendAt`, `reading` and `incidents`
 * per arm is the better shape in the abstract, and it was rejected here for one
 * concrete reason: `HoldView` in web/src/actions-client.ts already re-types
 * every one of those to `| null`, because a server too old to send a field has
 * made no claim. So a union on the wire would be flattened back to exactly this
 * shape one file later, and the flattening would be the second place to get it
 * wrong. What the union buys — you cannot read `openedAt` without establishing
 * which case you are in — is bought here by the field docs plus this arm.
 */
export type HoldBasis =
  | { kind: "observed-here" }
  | {
      kind: "rehydrated-hold";
      /** When the previous run last wrote this hold down. It knows nothing after this. */
      recordedAt: number;
    }
  | {
      kind: "rehydrated-attempt";
      /** When the previous run wrote down that it was **about to** type. */
      attemptedAt: number;
    };

/* ===== DECISIONS MADE — THE ON-DEMAND REVIEW RECORD ============== *
 * A uniquely named banner rather than a bare separator: two blocks that
 * both open with the same separator line collide even when they share no
 * identifier. That is what happened here on 2026-09-09. The Codex usage
 * block below learnt it first; this is the same lesson applied.
 *
 * Types only: the node route and browser client both import this leaf.
 * ================================================================== */

export type DecisionWireClass = "assumption" | "decision" | "decline";
/** Who recorded a line. `daemon` is the report drain, and only ever copies a session's decision. */
export type DecisionWireRecorder = "greg" | "overseer" | "daemon";
export type DecisionWireAdviser = "sol" | "fable" | "nobody";

export type DecisionWireExecution =
  | { kind: "verified"; token: string; since: string }
  | { kind: "not-found" }
  | { kind: "unavailable"; why: string };

/** Who DECIDED. A schema-1 row is `legacy-unrecorded`, never the Overseer. */
export type DecisionWireAuthor =
  | { kind: "overseer" }
  | { kind: "greg" }
  | { kind: "session"; name: string; execution: DecisionWireExecution }
  | { kind: "legacy-unrecorded" };

/** What a schema-1 row carries for every schema-2 field. */
export type DecisionWireNotRecorded = "not-recorded";
export type DecisionWireRecorded<T> = { kind: "not-recorded" } | { kind: "recorded"; value: T };
export type DecisionWireConsequence = "high" | "medium" | "low";
export type DecisionWireReversibility = "easy" | "costly" | "one-way";
export type DecisionWireDomain = "product" | "technical";
/** The author's claim about Greg, shown as a claim — never as review. */
export type DecisionWireGregAsked = "no" | "asked-answered" | "asked-awaiting";
export type DecisionWireConfidence = "high" | "medium" | "low";

/* Restated from `artefact-ref.ts`, because this file may import nothing. The
   two must stay structurally equal: `routes-decisions.ts` assigns the owner's
   type to this one and the panel hands this one to `artefactHref`, so a drift
   in either direction is a compile error rather than a silent mismatch. */
export type DecisionWireArtefactRef =
  | { kind: "commit"; sha: string }
  | { kind: "path"; path: string }
  | { kind: "decision"; id: string }
  | { kind: "queue-item"; id: string };
export type DecisionWireArtefactCheck =
  | { state: "on-dev" }
  | { state: "found-locally" }
  | { state: "found" }
  | { state: "not-found" }
  | { state: "unchecked"; why: string };
export type DecisionWireEvidence = { ref: DecisionWireArtefactRef; check: DecisionWireArtefactCheck };

export type DecisionWireRecord = {
  id: string;
  recordedBy: DecisionWireRecorder;
  class: DecisionWireClass;
  question: string;
  options: { name: string; tradeoffs: string }[];
  chose: { option: string; note: string | null };
  why: string;
  advisers: DecisionWireAdviser[];
  bearsOn: {
    sessions: { name: string; execution: DecisionWireExecution }[];
    plan: string | null;
  };
  decidedAt: string;
  supersedes: string | null;
  supersededBy: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewNote: string | null;
  reversed: boolean;
  reversedAt: string | null;
  reversedWhy: string | null;
  touches: {
    kind: "decided" | "reviewed" | "reversed";
    at: string;
    by: DecisionWireRecorder;
    what: string;
  }[];
  author: DecisionWireAuthor;
  consequence: DecisionWireConsequence | DecisionWireNotRecorded;
  reversibility: DecisionWireReversibility | DecisionWireNotRecorded;
  domain: DecisionWireDomain | DecisionWireNotRecorded;
  recommendation: DecisionWireRecorded<string | null>;
  evidence: DecisionWireRecorded<DecisionWireEvidence[]>;
  gregAsked: DecisionWireGregAsked | DecisionWireNotRecorded;
  confidence: DecisionWireConfidence | null | DecisionWireNotRecorded;
};

export type DecisionWireSessionState =
  | { kind: "same-run-as-last-verified"; since: string }
  | { kind: "ended-or-replaced" }
  | {
      kind: "unavailable";
      why:
        | { kind: "checkpoint-unavailable" }
        | { kind: "execution-unavailable"; detail: string };
    };

export type DecisionRow = {
  record: DecisionWireRecord;
  ageMs: number;
  pendingReview: boolean;
  sessions: { name: string; state: DecisionWireSessionState }[];
};

export type DecisionWireProblem = {
  kind:
    | "unreadable-line"
    | "unauthorized-review"
    | "duplicate-decision"
    | "unknown-decision"
    | "duplicate-event"
    | "command-conflict"
    | "invalid-supersession"
    | "illegal-transition";
  why: string;
  eventId: string | null;
};

export type DecisionWireCheckpoint =
  | { kind: "current" }
  | { kind: "unavailable"; why: string };

export type DecisionWireAggregates =
  | {
      kind: "counts";
      notYetReviewed: number;
      trailingSevenDays: { decisions: number; reviews: number; reversals: number };
    }
  | { kind: "unavailable"; why: string };

/**
 * `GET /api/decisions`. Every arm carries the instant at which its claim was
 * composed. The route refuses loudly before either an input file or mandatory
 * context can exceed the synchronous work and response bounds respectively.
 *
 * **Schema 2 on every arm** (plan 260910e, WR-P2): schema 1's browser ignores
 * fields it does not know, so it would have drawn a session's decision as
 * "recorded by overseer". At 2 it says which version it can read instead.
 */
export type DecisionsFeed =
  | { schema: 2; kind: "never-written"; composedAt: string; why: string }
  | { schema: 2; kind: "unreadable"; composedAt: string; why: string }
  | {
      schema: 2;
      kind: "oversized-file";
      composedAt: string;
      why: string;
      sizeBytes: number;
      limitBytes: number;
    }
  | {
      schema: 2;
      kind: "oversized-unreviewed";
      composedAt: string;
      why: string;
      unreviewedCount: number;
      limitBytes: number;
    }
  | {
      schema: 2;
      kind: "decisions";
      version: string;
      path: string;
      composedAt: string;
      checkpoint: DecisionWireCheckpoint;
      aggregates: DecisionWireAggregates;
      rows: DecisionRow[];
      /** History omitted by either the 100-row cap or the 2 MiB byte cap. */
      historyWithheld: number;
      problems: DecisionWireProblem[];
    };

/* ================= CODEX SUBSCRIPTION USAGE ====================== *
 * A uniquely named banner, for the reason the actions block below
 * gives: two sessions appending blocks that both open with the bare
 * separator collide in git even when the blocks share no identifier.
 * That is exactly what happened between these two on 2026-09-09.
 * CODEX SUBSCRIPTION USAGE — THE LIVE APP-SERVER READING
 * ================================================================== */

export type CodexUsageWindow =
  | {
      kind: "value";
      /** Which slot the payload put it in. Provenance, never identity. */
      slot: "primary" | "secondary";
      windowMinutes: number;
      usedPercent: number;
      resetsAt: string;
      resetsAtMs: number;
    }
  | {
      kind: "unknown";
      slot: "primary" | "secondary";
      windowMinutes: number | null;
      why: string;
    };

export type CodexUsageBucket = {
  limitId: string;
  limitName: string | null;
  windows: CodexUsageWindow[];
  planType: string | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  individualLimit: {
    limit: string;
    used: string;
    remainingPercent: number;
    resetsAt: number;
  } | null;
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
};

export type CodexUsageReading =
  | {
      kind: "value";
      accountId: string | null;
      readAt: string;
      buckets: CodexUsageBucket[];
      resetCredits: number | null;
    }
  | { kind: "unknown"; why: string; retryable: boolean };
/* ================================================================== *
 * STAGE 6 — THE ACTIONS CATALOGUE'S SHARED WIRE SHAPES
 *
 * A uniquely named banner rather than the bare separator this file uses
 * elsewhere: two sessions appending blocks that both open with the same
 * line collide in git even when the blocks are about different things.
 * ================================================================== */

/** Where the action appears, and what it is addressed to. */
export type ActionScope =
  /** One session. Needs a `SteerTarget` or a worktree. */
  | "session"
  /** The box. Needs no session, and affects everybody. */
  | "box";

export type EnactedActionId = "remove-worktree" | "kill-session" | "kill-test-suites" | "kill-safe-processes";

export type BroadcastActionId = "resource-broadcast";

export type ActionId = SpokenActionId | EnactedActionId | BroadcastActionId;

/**
 * An effect outside the conversation: a directory deleted, a process signalled.
 *
 * There is no `text` on this arm and there never should be. The catalogue entry
 * is a DESCRIPTOR — the argv depends on which worktree, which session, which
 * pids, none of which is known until the moment of use — so the commands come
 * from the `plan*` functions below, which take those inputs and can refuse.
 */
export type EnactedAction = {
  effect: "enacted";
  id: EnactedActionId;
  scope: ActionScope;
  label: string;
  summary: string;
  /**
   * Literal `true`. An enacted action is never one-tap: each of the four
   * either deletes work, kills somebody's agent, or throws away a running test
   * suite. Typed as the literal so that adding a one-tap enacted action is a
   * compile error and therefore a decision.
   */
  needsConfirm: true;
  /**
   * The named gate that must pass before the effect, in prose, for the
   * confirmation dialog. The machine-readable form is the first `Step` of the
   * plan; this is what the person reads before they press yes.
   */
  gate: string;
};

/**
 * One sentence to every steerable session, each with its own resume time.
 *
 * Greg's word is **staggered**, and the direction doc says why in one line:
 * thirty-six agents told to pause for an hour all resume in the same second,
 * and the box falls over at the far end instead of the near one. So there is
 * no `text` here either — `renderBroadcast` produces a different sentence per
 * recipient, and the stagger is a parameter of the action rather than a
 * convention in whoever calls it.
 */
export type BroadcastAction = {
  effect: "broadcast";
  id: BroadcastActionId;
  scope: "box";
  label: string;
  summary: string;
  needsConfirm: true;
  stagger: Stagger;
};

export type Action = SpokenAction | EnactedAction | BroadcastAction;

/**
 * How the pause is spread across the fleet.
 *
 * `minMinutes` is not zero and must not be: a recipient told to pause for zero
 * minutes has not paused, and with an evenly spread window somebody always
 * draws the bottom of it. `windowMinutes` is Greg's "up to an hour".
 */
export type Stagger = {
  minMinutes: number;
  windowMinutes: number;
};

/* ================================================================== *
 * QUESTIONS VIEW — OBSERVATIONS, REFERENCES, AND NAMED SILENCES
 *
 * Appended as one block because this file is shared with the DOM-only client
 * and may contain types only: no imports and no runtime vocabulary.
 * ================================================================== */

/**
 * A session named by a question observation, and whether the same state
 * snapshot also contained both handles the fleet's steer routes require.
 *
 * `addressable` is only a statement about those handles. In particular, it is
 * not evidence that the execution which asked an inbox prose question still
 * occupies them; no prose item in this view authorises a write.
 */
export type QuestionTarget =
  /** Written by the server composer after resolving both handles on a fleet row. */
  | { kind: "addressable"; sessionId: string; sessionName: string }
  /** Written by the server composer when no row, pane handle, or conversation handle was observed. */
  | { kind: "unaddressable"; sessionId: string; sessionName: string; why: string };

/**
 * A reference-only composition of the two independent question observers.
 * Dialog display data stays on `rows`; prose display data stays attributable
 * to the attention item whose id is carried beside the copy.
 */
export type QuestionItem =
  /** Written by the server composer for a conversation-gate row with both steerable handles. */
  | {
      kind: "dialog";
      rowId: string;
      target: Extract<QuestionTarget, { kind: "addressable" }>;
    }
  /** Written by the server composer for the same observed dialog when either steerable handle was absent. */
  | {
      kind: "dialog-unaddressable";
      rowId: string;
      target: Extract<QuestionTarget, { kind: "unaddressable" }>;
    }
  /** Written by the server composer for an inbox prose observation whose primary member resolved to both handles. */
  | {
      kind: "prose";
      itemId: string;
      target: Extract<QuestionTarget, { kind: "addressable" }>;
      excerpt: string;
      why: string;
      waitingSince: string;
      attentionKind: AttentionKind;
      /** Each member is resolved independently; one missing row cannot erase its siblings. */
      duplicates: readonly QuestionTarget[];
    }
  /** Written by the server composer when an inbox prose observation's primary member had no steerable row. */
  | {
      kind: "prose-unaddressable";
      itemId: string;
      target: Extract<QuestionTarget, { kind: "unaddressable" }>;
      excerpt: string;
      why: string;
      waitingSince: string;
      attentionKind: AttentionKind;
      /** Each member is resolved independently; one missing row cannot erase its siblings. */
      duplicates: readonly QuestionTarget[];
    };

/**
 * Why this view cannot claim that its items are everything currently waiting.
 *
 * Every arm names the failed observation rather than diagnosing a process from
 * its silence. Arms written only by the browser stay here because they still
 * cross the component boundary in `QuestionsView`; the server never emits
 * them.
 */
export type QuestionGap =
  /** Written by the server composer when this server did not read an attention feed. */
  | { kind: "attention-not-asked" }
  /** Written by the server composer when no checkpoint existed at the path it inspected. */
  | { kind: "checkpoint-absent" }
  /** Written by the server composer when a checkpoint existed but its attention projection could not be read. */
  | { kind: "checkpoint-unreadable"; why: string }
  /** Written by the server composer when the attention pass published that it could not judge a list. */
  | { kind: "attention-list-unknown"; why: string }
  /** Written by the server composer when a published attention pass counted failed judgements. */
  | { kind: "attention-sessions-unreadable"; count: number }
  /** Written by the server composer when the attention pass reported that it scanned zero sessions. */
  | { kind: "attention-no-sessions-scanned" }
  /** Written by the server composer when no fleet snapshot has completed. */
  | { kind: "collection-not-observed" }
  /** Written by the server composer when the latest collection attempt reported an error beside retained rows. */
  | { kind: "collection-failed"; why: string }
  /** Written by the server composer when a needs-you row carried no pane-question reading. */
  | { kind: "row-question-unreadable"; rowId: string }
  /** Written by either freshness check when the fleet snapshot's clock was unreadable, ahead, or past its cadence deadline. */
  | { kind: "fleet-snapshot-stale"; collectedAt: string }
  /** Written by either freshness check when the checkpoint's clock was unreadable, ahead, or over five minutes old. */
  | { kind: "checkpoint-stale"; coordinatorWrittenAt: string }
  /** Written by either freshness check when the attention scan's clock was unreadable, ahead, or over six minutes old. */
  | { kind: "attention-scan-stale"; scannedAt: string }
  /** Written only by the browser parser when an older server sent no `questions` field. */
  | { kind: "questions-not-reported" }
  /** Written only by the browser parser when a present `questions` field could not be parsed. */
  | { kind: "questions-unreadable"; why: string }
  /** Written only by the browser parser when the present attention field could not be parsed. */
  | { kind: "attention-unreadable"; why: string }
  /** Written only by the browser parser when one or more rows in the same payload could not be parsed. */
  | { kind: "rows-unreadable"; count: number }
  /* THERE IS NO `attention-dialog-not-in-rows` ARM, and its absence is a
     decision rather than an omission. The inbox and the collector observe on
     different cadences, so an inbox dialog the pane no longer shows is ordinary
     lag — `questions.ts` § composeAttentionItem has the whole argument, and the
     reason the honest version of that arm cannot be written from these clocks. */
  /** Written only by the browser resolver when a dialog's row reference did not resolve to a parsed question. */
  | { kind: "dialog-reference-unresolved"; rowId: string; why: string }
  /** Written only by the browser resolver when a prose id did not resolve to the same parsed attention observation. */
  | { kind: "attention-reference-unresolved"; itemId: string; why: string }
  /** Written only by the browser resolver when independently parsed dialog fields contradict the server-only producer path. */
  | { kind: "dialog-source-inconsistent"; rowId: string; why: string }
  /** Written only by the browser when the reported item set omits an eligible parsed source observation. */
  | {
      kind: "eligible-observation-omitted";
      observation: { kind: "dialog"; rowId: string } | { kind: "prose"; itemId: string };
    };

/** Only this arm may support the sentence “nothing needs you”. */
export type QuestionsView =
  /** Written by the server composer only after both sources supplied fresh positive controls. */
  | { kind: "complete"; items: readonly QuestionItem[] }
  /** Written by either composer/parser when at least one observation is usable and at least one named gap remains. */
  | { kind: "partial"; items: readonly QuestionItem[]; gaps: readonly [QuestionGap, ...QuestionGap[]] }
  /** Written by either composer/parser when no source supplied a usable observation; the named silences are retained. */
  | { kind: "not-observed"; gaps: readonly [QuestionGap, ...QuestionGap[]] };

/* ================================================================== *
 * BOX ACTION PREVIEWS — THE MATERIAL A PERSON ACTUALLY CONFIRMS
 * ================================================================== */

export type FleetActionPreview = {
  schema: "fleet-action-preview/1";
  previewId: string;
  serverInstanceId: string;
  actionId: string;
  /** Epoch ms. Past this the preview is gone, whatever else matches. */
  expiresAt: number;
  material: FleetActionMaterial;
};

/**
 * THE CANONICAL MATERIAL — and everything that decides the effect is inside it.
 * Nothing that changes what happens, who it happens to, or what is said may sit
 * outside this object as a sibling request field.
 */
export type FleetActionMaterial =
  | {
      kind: "kill";
      /** Full identity. These, and only these, may be confirmed. */
      confirmable: readonly KillIdentity[];
      /** Echoed for equality and display, but never admitted to the signal target list. */
      excluded: readonly { pid: number; why: string }[];
    }
  | {
      kind: "broadcast";
      /** It changes the sentence AND its authority; outside the check, the words could differ. */
      speaker: "greg" | "overseer";
      /** Order is material: it decides each recipient's stagger position. */
      recipients: readonly BroadcastRecipientClaim[];
    };

/** A confirmable process: the pid, the exact start tick, and the boot it started in. */
export type KillIdentity = { pid: number; startTicks: number; bootId: string };

/** One recipient, exactly as the page claimed it, plus the pause it was promised. */
export type BroadcastRecipientClaim = {
  paneId: string;
  sessionId: string;
  claudeSessionId: string | null;
  panePid: number | null;
  /** The client's raw status claim, retained verbatim from the preview request. */
  status: unknown;
  /** The stagger this row was shown. Bound, so the delivered wait cannot differ from the read one. */
  minutes: number | null;
};

/** What a run hands back to name which preview it is confirming. */
export type FleetActionPreviewClaim = {
  previewId: string;
  serverInstanceId: string;
  actionId: string;
};

/** The display-only process details already shown by a kill preview. */
export type FleetKillCandidateView = {
  pid: number;
  rule: string;
  why: string;
  comm: string;
  args: string;
  rssKiB: number;
  etimeSeconds: number;
};

/** Kill and broadcast have distinct request arms so neither can acquire the other's inputs. */
export type FleetBoxActionRequest =
  | { actionId: "kill-test-suites" | "kill-safe-processes"; mode: "dry-run"; confirm?: false }
  | {
      actionId: "kill-test-suites" | "kill-safe-processes";
      mode: "run";
      confirm: true;
      preview: FleetActionPreviewClaim;
      material: Extract<FleetActionMaterial, { kind: "kill" }>;
    }
  | {
      actionId: "resource-broadcast";
      mode: "dry-run";
      confirm?: false;
      speaker: "greg" | "overseer";
      recipients: readonly Omit<BroadcastRecipientClaim, "minutes">[];
    }
  | {
      actionId: "resource-broadcast";
      mode: "run";
      confirm: true;
      preview: FleetActionPreviewClaim;
      material: Extract<FleetActionMaterial, { kind: "broadcast" }>;
    };

/* ================================================================== *
 * WORK HISTORY — WHAT THE ACCEPTED PROCESS-TABLE SCAN SAW
 * ================================================================== */

export type StoredWorkGroup = {
  /**
   * The Overseer's session key — an IDENTITY, and never a command line.
   *
   * `"$2916 none"`, or `"$2890 claims:<uuid>"`. It is what survives a rename,
   * which is why the scan is keyed by it, and it is **not** something to put in
   * front of a reader: see `sessionName`.
   */
  session: string;
  /**
   * The name the launcher gave that session, as it was **at the moment of the
   * scan** — or null when the register could not supply one.
   *
   * Stored beside the key rather than looked up at render time, because a
   * history is read long after the session it describes has gone: resolving a
   * name later would either fail for everything interesting or, worse, attach
   * today's name to yesterday's tmux id after a reuse. Null renders as the key,
   * which is ugly and true.
   */
  sessionName: string | null;
  /** The recogniser's id, as a plain string — the Overseer's vocabulary. */
  recogniser: string;
  /** Job processes with that recogniser under that pane, at the scanned instant. */
  jobs: number;
  timing:
    | { kind: "known"; oldestStartedAt: string; longestRanForMs: number }
    /** Some jobs' timing was unavailable. These aggregates cover `knownJobs` of `jobs`. */
    | { kind: "partial"; knownJobs: number; oldestStartedAt: string; longestRanForMs: number }
    | { kind: "unknown" };
};

export type StoredWork =
  | { kind: "not-yet-run"; asOf: string; why: string }
  | { kind: "probe-failed"; attemptedAt: string; sourceCollectedAt: string; why: string }
  /** We could not read the checkpoint, or could not accept its scan. OUR clock, not the daemon's. */
  | { kind: "checkpoint-unavailable"; checkedAt: string; why: string }
  | {
      kind: "scan";
      /** When the kernel was read. NOT the sample's own clock. */
      scannedAt: string;
      groups: StoredWorkGroup[];
      /** How many groups the cap dropped. Zero is the ordinary case. */
      groupsDropped: number;
      /** The uncertainty, as counts. */
      panes: { work: number; none: number; cannotTell: number };
    };

/** One checkpoint read's projection of its accepted work scan. */
export type WorkFeed =
  | { kind: "checkpoint-absent" }
  | { kind: "checkpoint-unreadable"; why: string }
  | { kind: "published"; work: StoredWork; coordinatorWrittenAt: string };

/**
 * **WAS WORK LOOKED AT ON THIS TURN, AND WHAT CAME BACK.** Carried on every arm
 * of a stored health sample, including the ones where the health collector
 * itself failed.
 *
 * `not-due` is written down rather than left implied, and that is the whole
 * point of the envelope existing at all. Without it, four different situations
 * produced an identical stored shape — a record from before work tracking
 * existed, a turn the cadence did not call for, a turn that was due while
 * health collection failed, and a turn whose summary would not fit — and no
 * amount of arithmetic over `WORK_EVERY_MS` could recover the difference across
 * a restart's phase change or before the first work sample. GPT Sol's F1,
 * 2026-09-10.
 *
 * So the absence of this field now means exactly one thing: **a sample written
 * before work tracking existed.** Everything else is a value.
 */
export type StoredWorkTurn =
  | { kind: "not-due" }
  | { kind: "due"; result: StoredWork };

/* ================================================================== *
 * ADMISSION FORECAST — A HYPOTHETICAL ANSWER, NEVER A RESERVATION
 * ================================================================== */

export type AdmissionKind = "test" | "review" | "browser";

/** DECLARED by the requester, not measured. Nothing verifies it, and today nothing uses it. */
export type AdmissionCostClass = "light" | "moderate" | "heavy";

export type AdmissionRequest = {
  kind: AdmissionKind;
  /** Null when this transport had no caller declaration to carry. */
  cost: AdmissionCostClass | null;
  /**
   * Who would do the work. A full execution identity rather than a bare pid,
   * because a pid can be reused after the process it named exits.
   */
  owner: ExecutionToken | null;
  /** The CALLER's clock. Diagnostic only — never sort or assign priority from it. */
  requestedAtClientMs: number | null;
};

/** What sort of statement a block contains. There is deliberately no enforcement label. */
export type AdmissionSignalLabel = "forecast" | "observed" | "not-modelled";

/** The gate's revision paired with the only prose this dashboard knows for that revision. */
export type AdmissionPolicy =
  | { gateVersion: number; explanation: string; whyWithheld: null }
  | { gateVersion: number; explanation: null; whyWithheld: string };

export type AdmissionOutcome =
  | {
      kind: "would-admit" | "would-reduce";
      /** The machine's default ask; a future run's own environment may ask for another value. */
      nominalWorkers: number;
      nominalWorkersSource: "machine-default";
      workers: number;
      capacity: number;
      availableBytes: number;
      reserveBytes: number;
      /** Qualifies these forecast worker numbers; irrelevant outcomes do not carry it. */
      caveat: string;
    }
  | {
      kind: "would-refuse";
      /** Verbatim output from the dashboard's call; it uses real-run grammar and names the dashboard pid. */
      forecastCallMessage: string;
      messageContext: "dashboard-forecast-call";
    }
  | { kind: "not-applicable"; why: string }
  | { kind: "unknown"; why: string }
  | { kind: "not-modelled"; why: string };

export type AdmissionRefusalEntry = {
  at: string;
  source: "test-run" | "readiness-precheck";
  policyVersion: number;
  availableBytes: number | null;
  reserveBytes: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  pid: number;
  host: string;
};

/** A readable journal, no directory yet, and a failed read are different facts. */
export type AdmissionRefusalJournal =
  | { kind: "read"; entries: AdmissionRefusalEntry[]; unparseableLines: number }
  | { kind: "directory-absent" }
  | { kind: "unreadable"; why: string };

/** `GET /api/admission`: a fresh forecast. It changes and reserves nothing. */
type AdmissionPayloadBase = {
  schema: 1;
  request: AdmissionRequest;
  /** When the server completed building this answer, by the SERVER's clock. */
  computedAtMs: number;
  journal: AdmissionRefusalJournal;
  census: AdmissionCensusState;
};

/** The label and outcome are one union so a non-modelled request cannot acquire the test gate's policy. */
export type AdmissionPayload = AdmissionPayloadBase &
  (
    | {
        label: "forecast";
        policy: AdmissionPolicy;
        outcome: Exclude<AdmissionOutcome, { kind: "not-modelled" }>;
      }
    | {
        label: "not-modelled";
        outcome: Extract<AdmissionOutcome, { kind: "not-modelled" }>;
        policy?: never;
      }
  );

/** The three executable-shaped process classes the admission census recognises. */
export type AdmissionCensusClass = "test" | "codex-batch" | "browser";

/** Counts from one completed pass over the process table. */
export type AdmissionCensusCounts = {
  byClass: Record<AdmissionCensusClass, { roots: number; uncertain: number }>;
  /** Rows whose identity, parent, or recogniser-bearing command name changed between the bracketing reads. */
  changedUnderRead: number;
  /** Pid entries that existed at enumeration but could not yield one complete row. */
  unreadable: number;
  /** Numeric entries returned by the process-table enumeration. */
  processesSeen: number;
};

/**
 * The cached census lifecycle. `observed` describes the kind of evidence on
 * every arm; it does not imply that a successful observation exists yet.
 */
export type AdmissionCensusState =
  | {
      kind: "not-yet-computed";
      label: "observed";
      startedAtMs: number;
    }
  | {
      kind: "value";
      label: "observed";
      census: AdmissionCensusCounts;
      /** The bounds of the pass during which these rows were observed. */
      startedAtMs: number;
      completedAtMs: number;
      durationMs: number;
      cadenceMs: number;
    }
  | {
      kind: "failed";
      label: "observed";
      why: string;
      failedAtMs: number;
      cadenceMs: number;
      lastGood: {
        census: AdmissionCensusCounts;
        /** The bounds of the successful pass whose counts remain available. */
        startedAtMs: number;
        completedAtMs: number;
      } | null;
    };

/* ---------------- Durable action receipt summaries ---------------- */

/**
 * The deliberately small, text-free receipt shape exposed by the Stage 1
 * read endpoint. Exact queued words remain only in the short-lived material
 * file and never cross this boundary.
 */
export type ReceiptSummary = {
  receiptId: string;
  op:
    | "queued-message"
    | "queued-action"
    | "steer-message"
    | "steer-answer"
    /** Stage 3: `remove-worktree` or `kill-session`, run from one session's row. */
    | "enacted-session"
    /** Stage 3: one recipient of a broadcast, sent to directly. `parentReceiptId` names the broadcast. */
    | "broadcast-recipient"
    /** Stage 3: a box-wide kill. Box-scoped, so `target` is null. */
    | "enacted-box"
    /** Stage 3: the parent of one broadcast request. Box-scoped; its recipients are its children. */
    | "broadcast";
  origin: "enqueue" | "broadcast" | "direct-steer" | "enacted";
  /**
   * True while the receipt is still non-terminal — `accepted`, `attempted` or
   * `returned`. A replay of a pending receipt is not an outcome: the action may
   * still happen (queued work) or be concluded at the next start.
   */
  pending: boolean;
  actor: {
    kind: "client-claimed" | "unattributed-http" | "system";
    id: string | null;
  };
  speaker: Speaker | null;
  /** Null exactly for a box-scoped op (`enacted-box`, `broadcast`) — never a sentinel session. */
  target: {
    sessionId: string;
    paneId: string | null;
    claudeSessionId: string | null;
    tmuxGeneration: number | null;
  } | null;
  /** The broadcast this receipt is one recipient of, or null. */
  parentReceiptId: string | null;
  /**
   * For an enacted plan, the steps known to have finished (each with its gate's
   * verdict on the receipt); null for anything that is not a plan. After a crash
   * mid-plan this is how far it is known to have got — never further.
   */
  stepsCompleted: number | null;
  /** A bounded description such as `message (42 characters)`, never its text. */
  what: string;
  acceptedAt: number;
  state:
    | "accepted"
    | "attempted"
    | "returned"
    | "withdrawn"
    | "keys-submitted"
    | "not-sent"
    | "outcome-unknown"
    /** Stage 3: an enacted plan passed every gate, or a broadcast's fan-out came to an end. */
    | "completed"
    /** Stage 3: an enacted plan stopped at a gate; `reason` is `gate-refused`. */
    | "plan-stopped";
  reason: string | null;
  attemptedAt: number | null;
  outcomeAt: number | null;
  reconciled: boolean;
  queueItemId: string | null;
  materialDeletionPending: boolean;
};

/* ===== WORK REPORTS — WHAT AN AGENT CLAIMED ====================== *
 * `GET /api/reports` (plan 260910e). A uniquely named banner, for the
 * reason the DECISIONS MADE block gives.
 *
 * **Every row is a claim, and the types say so**: `claimedBy`, never
 * "done", "ready", "landed" or "contradicts". A later claim is only a later
 * claim. Types only; restated from `tools/overseer/reports.ts`, which this
 * leaf may not import — `routes-reports.ts` assigns the owner's values to
 * these, so a drift is a compile error there. The artefact types are the
 * decision block's, which are pinned to `artefact-ref.ts` the same way.
 * ================================================================== */

export type ReportWireKind = "progress" | "blocked" | "decision" | "completed";
/** A self-declaration, as a decision's `by` is. */
export type ReportWireActor = { kind: "session"; name: string } | { kind: "overseer" } | { kind: "greg" };
/** The submitter's token against the register's verified run; null unless the actor is a session. */
export type ReportWireExecution = "same-verified-run" | "different-verified-run" | { unverifiable: string } | null;
export type ReportWireCorrection = { eventId: string; actor: ReportWireActor; at: string };
export type ReportWireJob = {
  plan: string | null;
  queueItem: string | null;
  occurrence: { jobId: string; scheduledAt: string } | null;
};
export type ReportWireBlockedOn = "greg" | "peer" | "review" | "environment" | "other";
export type ReportWireEnding = "finished" | "done-enough" | "important-work-left";
/** What the agent SAID it reviewed, tested and merged. An empty list is "not stated". */
export type ReportWireRevisions = { reviewed: string[]; tested: string[]; merged: string[] };

export type ReportWireClaim = {
  eventId: string;
  claimedBy: ReportWireActor;
  submittedAt: string;
  receivedAt: string;
  execution: ReportWireExecution;
  job: ReportWireJob;
  summary: string;
  artefacts: DecisionWireEvidence[];
  corrects: string | null;
  correctedBy: ReportWireCorrection | null;
  /** The next claim by the same reporter, if there is one. Never read as a disagreement. */
  laterClaim: string | null;
} & (
  | { kind: "progress" }
  | { kind: "blocked"; on: ReportWireBlockedOn; needs: string }
  | { kind: "completed"; ending: ReportWireEnding; revisions: ReportWireRevisions }
  | { kind: "decision"; decisionId: string }
);

/** Unreported is not idle, stuck or failed: it means nothing was said. */
export type ReportWireClaimed = { kind: "claimed"; claims: number; latest: ReportWireClaim };
export type ReportWireSession =
  | { name: string; register: "in-register"; latest: { kind: "unreported" } | ReportWireClaimed }
  | { name: string; register: "not-in-register"; latest: ReportWireClaimed };

/**
 * The register join, or why there is none. **Two shapes, so "every session is
 * unreported" and "the register could not be read" can never look alike.**
 */
export type ReportWireSessions =
  | { kind: "joined-with-register"; rows: ReportWireSession[] }
  | { kind: "register-unavailable"; why: string; reported: { name: string; latest: ReportWireClaimed }[] };

export type ReportWireProblem = {
  kind: "unreadable-line" | "duplicate-event" | "invalid-correction";
  why: string;
  eventId: string | null;
};

export type ReportsFeed =
  | {
      schema: 1;
      kind: "never-written";
      composedAt: string;
      why: string;
      /** Submitted and not yet recorded — the sign of a daemon that is not draining. */
      inFlight: number;
      refused: number;
    }
  | { schema: 1; kind: "unreadable"; composedAt: string; why: string }
  | { schema: 1; kind: "oversized-file"; composedAt: string; why: string; sizeBytes: number; limitBytes: number }
  | {
      schema: 1;
      kind: "reports";
      path: string;
      composedAt: string;
      sessions: ReportWireSessions;
      /** Newest first. */
      recent: ReportWireClaim[];
      /** Claims left out by the 200-row cap or the 2 MiB byte cap. */
      recentWithheld: number;
      inFlight: number;
      refused: number;
      problems: ReportWireProblem[];
    };
