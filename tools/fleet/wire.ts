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
