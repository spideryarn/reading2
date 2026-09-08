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
