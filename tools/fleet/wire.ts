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
  volatile: true;
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

/**
 * **THE OVERSEER'S OWN RECORD OF WHAT HAS BEEN RUNNING, AND IT IS NOT A JOIN.**
 *
 * The register is the Overseer's past tense: it knows when a session entered
 * the state it is in, which the dashboard cannot know because it has no
 * yesterday. This carries a BOUNDED, RANKED PROJECTION of it — the longest
 * waiting first — and nothing on the page matches these entries to the fleet
 * rows beside them.
 *
 * **That refusal is the design.** A register entry and a fleet row can agree
 * about a pane and still be about different children: the generation tuple
 * (`tmuxServerPid`, `paneId`, `panePid`) can stay fixed while the process
 * inside it is replaced, so *"blocked for at least 20 minutes"* said against a
 * row needs continuity evidence this build does not have. The plan's Execution
 * identity stage is what earns that join; until then these are history, drawn
 * as history, under their own heading. **Whatever is wrong here, the fleet rows
 * are unaffected** — they come from a different field of the same payload and
 * nothing about them is derived from this one.
 *
 * `total` is the whole register and `sessions` is the cap, so a card that shows
 * eight of thirty-six says so rather than looking like the whole fleet.
 */
export type OverseerRegister =
  | { kind: "read"; total: number; sessions: OverseerSessionHistory[] }
  | { kind: "unreadable"; why: string };

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
  openedAt: number;
  /** When the most recent uncertain send landed. Equals `openedAt` while `incidents` is 1. */
  lastSendAt: number;
  /** How many uncertain sends this hold has absorbed. Never below 1. */
  incidents: number;
  /** The reading of the most recent one. */
  reading: UncertainSendReading;
  /** Which path the most recent one came down. */
  origin: UncertainSendOrigin;
  why: string;
  outcome: HoldOutcome;
};

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
 * Production's tip, as the dashboard's checkout last heard it.
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
 *  - `cache-behind` — the cached tip is an ancestor of the recorded deploy: this
 *    checkout simply has not fetched since that deploy. Benign, and common.
 *  - `diverged` — neither contains the other. **This** is the rollback or the
 *    deploy from somebody's working directory, and it is worth a colour.
 *  - `unknown` — we could not ask. Never collapse this into any of the above; a
 *    git that would not run must not render as a rollback that never happened.
 */
export type AncestryReading =
  | { kind: "ancestor" }
  | { kind: "cache-behind" }
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
  | { kind: "submitted"; to: string; paneId: string }
  | { kind: "no-holder" }
  | { kind: "contested"; names: readonly string[] }
  | { kind: "cannot-tell"; why: string }
  | { kind: "refused"; to: string; code: string; why: string; delivery: Delivery }
  | { kind: "unknown"; to: string; why: string };

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
