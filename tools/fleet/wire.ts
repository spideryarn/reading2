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
 * written up in docs/project/orchestrator-direction.md § `idle` is the bug:
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
  | { kind: "in-a-shell-call"; sinceMs: number }
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
