/**
 * v0.5 of the fleet dashboard: the things you can DO to a session, as typed
 * values rather than as buttons.
 *
 * Greg's list, 2026-09-08: "continue, compact, pull, push, remove worktree,
 * exit, run unix sleep for 1h/3h/5h/10h, get input from Fable/GPT Sol and then
 * use your judgment, and anything else you can think of" — plus, for Box
 * Health, "kill anything that's safe to do", "kill all the running tests", and
 * a staggered resource broadcast. Direction:
 * docs/project/orchestrator-direction.md § What Greg asked for on 2026-09-08.
 * Stages: docs/plans/260907e-agent-fleet-dashboard.md § v0.5 and § v0.5c.
 *
 * WHY THIS IS DATA AND NOT A BUTTON HANDLER. The orchestrator is eventually a
 * coordinator AGENT, not Greg with a mouse (his decision, 2026-09-08). A
 * program cannot synthesise a click, so every action exists here as a value
 * with an id, and the page and the coordinator both go through `actionById`.
 * `ACTIONS` is JSON-serialisable on purpose: the client can render the whole
 * vocabulary from `/api/actions` rather than keeping a second copy of it.
 *
 * THE LINE THIS FILE IS BUILT AROUND, and the reason `Action` is a union
 * rather than a record with an optional `text`:
 *
 *  - **spoken** — a SENTENCE you would have typed. It goes out through
 *    `sendMessage` in steer.ts and the agent decides what to do with it. If the
 *    agent ignores it, nothing happened.
 *  - **enacted** — an effect OUTSIDE the conversation. `remove worktree` and
 *    `exit` delete a directory and kill a process whether or not anybody
 *    cooperates. These are commands this tool runs.
 *  - **broadcast** — a sentence to MANY sessions, where each recipient's
 *    sentence is DIFFERENT because the pause is staggered. It cannot be a
 *    `text: string`, which is why it is its own arm and not a spoken action
 *    with a fan-out flag.
 *
 * A caller that has an `Action` cannot read `.text` off it without narrowing,
 * and cannot hand an enacted action to `sendMessage`. That is the whole point:
 * "remove the worktree" typed at an agent is a request; run here it is a
 * deletion, and the two must not be confusable at the seam.
 *
 * NOTHING HERE RUNS ANYTHING. `plan*` returns argv for somebody else to run,
 * `killVerdict` judges a process record somebody else read. No child process,
 * no import side effects, no module-scope work — the rule steer.ts, status.ts
 * and state.ts are all written to, and for the same reason: importing this from
 * a test must not touch the box.
 *
 * KNOWN GAPS, stated here rather than discovered later:
 *
 *  - **A spoken action is a request, and there is no receipt.** We can prove
 *    the keystrokes went to the right pane (steer.ts does); we cannot prove the
 *    agent read the sentence, agreed with it, or acted on it. Anything that
 *    reports "paused for 40 minutes" off the back of a broadcast is inventing
 *    it.
 *  - **`killVerdict` judges a SNAPSHOT.** Between the `ps` that produced the
 *    record and the `kill` that acts on it, the pid can be recycled. That
 *    window is the same one steer.ts documents and cannot be closed from
 *    outside the kernel; it is narrowed by re-reading immediately before, not
 *    eliminated.
 */
import { descendsFrom } from "./steer.js";

/* ------------------------------------------------------------------ *
 * The vocabulary.
 * ------------------------------------------------------------------ */

/** Where the action appears, and what it is addressed to. */
export type ActionScope =
  /** One session. Needs a `SteerTarget` or a worktree. */
  | "session"
  /** The box. Needs no session, and affects everybody. */
  | "box";

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

export type EnactedActionId = "remove-worktree" | "kill-session" | "kill-test-suites" | "kill-safe-processes";

export type BroadcastActionId = "resource-broadcast";

export type ActionId = SpokenActionId | EnactedActionId | BroadcastActionId;

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

/* ------------------------------------------------------------------ *
 * The words.
 *
 * Each one is reviewed as PROSE, so they are written out in full rather than
 * assembled from fragments. A sentence composed at runtime is a sentence
 * nobody read before it was sent to thirty-six agents.
 * ------------------------------------------------------------------ */

/**
 * "Continue" alone is a weak instruction, and this is the whole reason the
 * texts are in a reviewed file rather than in an `onClick`.
 *
 * An agent that has stopped has usually stopped for a reason it can still
 * name, and the expensive failure on this box is not the stopped agent — it is
 * Fable's, quoted in the direction doc: the one working confidently on the
 * wrong thing. So "continue" asks for one sentence of orientation first, which
 * costs a line and surfaces a lost thread now instead of in twenty minutes,
 * and it explicitly licenses "I am finished", because an agent told only to
 * continue will invent work rather than contradict you.
 */
const CONTINUE_TEXT =
  "Carry on with the task you were given. Before you do, say in one sentence what you are resuming and what the next concrete step is, so that if you have lost the thread we both find out now rather than in twenty minutes. If you are actually finished, say so and stop — do not invent more work to have something to continue with.";

/**
 * `/compact` with instructions, because a bare one keeps what it guesses is
 * important. What a mid-task agent must not lose is the brief, the plan doc,
 * which files it has changed and what is still failing; what it can afford to
 * lose is tool output and file contents, which are one `Read` away.
 */
const COMPACT_TEXT =
  "/compact Keep the original brief, the plan doc and where you are in it, the files you have changed, the decisions you have already made and why, and anything still failing. Drop tool output, file contents you could re-read, and search results.";

const PULL_TEXT =
  "Merge the latest trunk into your branch before you go any further: git fetch origin && git merge origin/dev. Always merge, never rebase. If it conflicts, treat the conflict as a proposal rather than an edit — read the history behind both sides, keep the best of both, and show me what you propose before you change anything. Then re-run npm test and npm run typecheck, because the tree you were reasoning about has moved under you.";

const PUSH_TEXT =
  "Commit what you have finished and push it: run npm run check:staged-revert, then git add -- <any new files> && git commit -F <msg> -- <all your files>, then git push origin HEAD:dev. Commit only your own files by name in that one command — never git add -A, git add . or git commit -a, and never put git reset in front of it. Afterwards read git status rather than the success line: a hand-typed pathspec can silently drop a file. If nothing is actually ready, say so instead of committing something to look busy.";

const RUN_CHECKS_TEXT =
  "Run npm test and npm run typecheck now and tell me the result. Redirect the output to a file and grep it for failures rather than piping it through tail — the last two lines of typecheck are always a tick, and tail throws away the list of failing files, which is the only part you need. Re-run any failing file on its own before you believe it: this box goes red from contention, and most red batches are the box rather than your change.";

/**
 * The antidote to the failure Fable named, and the most valuable button here.
 *
 * It asks for the *justification* as well as the state, because "what are you
 * doing" is answered fluently by an agent forty minutes into the wrong thing.
 * The last clause is CLAUDE.md's own rule, asked the way Greg asks it: his
 * answer is often a fifth option nobody offered.
 */
const REPORT_STATUS_TEXT =
  "Stop and report before you do anything else, in four short lines: what you are building right now, why you believe that is the task you were given, what is left, and what you need from me. Do not resume until you have written it. If what you are building is the hard version of something that a small product decision — dropping a case, changing a default — would mostly remove, say that too, because that is often the answer I would give.";

const EASE_OFF_TEXT =
  "The box is short of resources right now: load and memory are both high and processes are being OOM-killed, so a job you start may die halfway and report nothing. Stop anything you can cheaply restart later — a test run, a browser, a dev server, a paid review — do not start anything that forks a worker per core, and stick to reading and editing files until I tell you the pressure is off. If something long is already most of the way through, say so and let it finish rather than losing the work.";

/**
 * The sleep texts, and the machinery question behind them.
 *
 * **`gjd-remote --wait` cannot do this.** It creates a session NOW and starts
 * Claude LATER — the pane runs one of our job scripts sitting on a `sleep`,
 * which is what produces `SessionState.waiting` with its `secondsLeft`. That
 * is a state in which Claude is not running yet, so `steerableStatus` refuses
 * to type into it at all: `--wait` is a way to schedule a session that does not
 * exist, not a way to pause a conversation that does. Pausing a live
 * conversation without losing it is therefore necessarily a spoken action.
 *
 * So the sentence has to name the mechanism, because every obvious mechanism on
 * this box is broken in a way the agent will not discover until it has already
 * lost the wait (measured, and written up in the fleet's own memory):
 *
 *  - a foreground `sleep` is capped at 600 seconds by the Bash tool;
 *  - a background waiter is OOM-killed on this box without warning — one died
 *    at 63 minutes with load 17.7, well under any threshold anybody checks;
 *  - `Monitor` and `ScheduleWakeup` both cap at one hour;
 *  - a `CronCreate` one-shot is scheduled inside the Claude process, so it
 *    cannot be OOM-killed, and it is the only mechanism that resumes THIS
 *    conversation with its context.
 *
 * **Two one-shots, not one**, a few minutes apart: waiting and having silently
 * died look identical from outside, which is docs/reusable/silent-success.md's
 * whole subject, and a second alarm is the cheapest insurance there is.
 */
function sleepText(hours: number): string {
  return `Pause for about ${hours} hours before you do anything else, and say so in your reply. Do not use a foreground sleep — the Bash tool caps at 600 seconds — and do not use a background waiter or a Monitor: this box OOM-kills background waiters without warning, and Monitor caps at an hour. Arm two CronCreate one-shots a few minutes apart, both about ${hours} hours from now, so that one dying silently does not lose the wait; tell me the two times you set, then stop your turn. When you wake, merge origin/dev first and re-read whatever you were part way through, because the tree will have moved.`;
}

const ASK_FABLE_TEXT =
  "Get Fable's input on the decision in front of you, then use your own judgment. Spawn a subagent with model: \"fable\" and hand it the actual evidence — the diff, the file, the two options and what each costs — rather than a summary of them, and ask it to arbitrate between them rather than to agree with you. Then tell me what it said, whether you are taking it, and why. Fable is a different model, not a different family, so this is product and design input; it is not the cross-family technical review, which is GPT Sol's job.";

const ASK_SOL_TEXT =
  "Get GPT Sol's input on the decision in front of you, then use your own judgment: npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 --prompt-file <prompt> --output <answer>, with a fresh --output path, because a killed run still writes its answer file and a stale review is indistinguishable from a new one. Hand it the scoped diff, the results file and the script that produced any number you are quoting, not just prose. Check the exit code AND that the answer arrived, since a review that returned nothing looks exactly like one that found nothing. Then check each finding yourself — some are wrong — and tell me which you are taking and which you are refusing, and why.";

const WRAP_UP_TEXT =
  "Bring this to a good stopping point rather than starting anything new. Finish the change you are in the middle of, run npm test and npm run typecheck, commit your own files by name and push with git push origin HEAD:dev, then tell me in three lines what landed, what is unfinished, and what the next agent would need to know to pick it up. Do not remove your worktree — run npm run worktree:check and tell me what it said, and let me do the removal.";

const STOP_AND_ASK_TEXT =
  "Stop where you are and do not decide this one yourself. Write down the decision you are about to make, the options you can see and what each one costs, and your own recommendation with how confident you are, then wait for me rather than proceeding. If a small product change — dropping a case, changing a default, accepting a worse edge case — would take most of the engineering out, say that first, because it is usually the answer.";

/**
 * The broadcast sentence, per recipient.
 *
 * Two things it does that a fixed sentence cannot. It tells the agent that its
 * number is deliberately different from everybody else's and asks it not to
 * round — an agent handed "pause for 37 minutes" will otherwise helpfully make
 * it 40, and forty is what everybody else rounds to as well, which is the
 * failure the stagger exists to prevent. And it asks for a check of `uptime`
 * and `free -g` on waking, so that thirty-six agents resuming into a box that
 * is still on fire do not all start a test suite.
 */
function broadcastText(minutes: number): string {
  return `The box is out of resources: load and memory are both high and processes are being OOM-killed, so anything you start now may die halfway and report nothing. First, stop anything you can cheaply restart later — a test run, a browser, a dev server, a paid review — and say what you stopped. Then pause for ${minutes} minutes before doing anything else: arm two CronCreate one-shots about ${minutes} minutes from now, tell me the times, and stop your turn. That ${minutes} is deliberately different for every agent so that we do not all resume in the same second, so please do not round it. When you wake, check uptime and free -g before you start anything heavy.`;
}

/* ------------------------------------------------------------------ *
 * The catalogue.
 * ------------------------------------------------------------------ */

const SPOKEN: readonly SpokenAction[] = [
  {
    effect: "spoken",
    id: "continue",
    scope: "session",
    label: "Continue",
    summary: "Resume, after saying in one sentence what is being resumed.",
    text: CONTINUE_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "compact",
    scope: "session",
    label: "Compact",
    summary: "/compact, told what to keep and what to drop.",
    text: COMPACT_TEXT,
    form: "slash-command",
    // Compaction is not reversible from inside the conversation, and unlike a
    // sentence the agent cannot decline it.
    needsConfirm: true,
  },
  {
    effect: "spoken",
    id: "pull",
    scope: "session",
    label: "Pull latest",
    summary: "Merge origin/dev, treat a conflict as a proposal, re-run the checks.",
    text: PULL_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "push",
    scope: "session",
    label: "Commit & push",
    summary: "Commit own files by name and push to dev.",
    text: PUSH_TEXT,
    form: "prose",
    // It writes to the shared trunk. Not irreversible, but externally visible,
    // which is the line the direction doc draws for what deserves a second tap.
    needsConfirm: true,
  },
  {
    effect: "spoken",
    id: "run-checks",
    scope: "session",
    label: "Run checks",
    summary: "npm test and npm run typecheck, read properly.",
    text: RUN_CHECKS_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "report-status",
    scope: "session",
    label: "Where are you?",
    summary: "What you are building, why you think it is the task, what is left, what you need.",
    text: REPORT_STATUS_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "ease-off",
    scope: "session",
    label: "Ease off",
    summary: "The box is loaded — drop what is cheap to restart.",
    text: EASE_OFF_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "sleep-1h",
    scope: "session",
    label: "Sleep 1h",
    summary: "Pause an hour, with two CronCreate one-shots.",
    text: sleepText(1),
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "sleep-3h",
    scope: "session",
    label: "Sleep 3h",
    summary: "Pause three hours, with two CronCreate one-shots.",
    text: sleepText(3),
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "sleep-5h",
    scope: "session",
    label: "Sleep 5h",
    summary: "Pause five hours, with two CronCreate one-shots.",
    text: sleepText(5),
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "sleep-10h",
    scope: "session",
    label: "Sleep 10h",
    summary: "Pause ten hours, with two CronCreate one-shots.",
    text: sleepText(10),
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "ask-fable",
    scope: "session",
    label: "Ask Fable",
    summary: "Product judgment from Fable, then use your own.",
    text: ASK_FABLE_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "ask-sol",
    scope: "session",
    label: "Ask GPT Sol",
    summary: "Cross-family technical review, then use your own judgment.",
    text: ASK_SOL_TEXT,
    form: "prose",
    // It costs money and forty-five minutes of a loaded box.
    needsConfirm: true,
  },
  {
    effect: "spoken",
    id: "wrap-up",
    scope: "session",
    label: "Wrap up",
    summary: "Reach a stopping point, push, and hand over.",
    text: WRAP_UP_TEXT,
    form: "prose",
    needsConfirm: false,
  },
  {
    effect: "spoken",
    id: "stop-and-ask",
    scope: "session",
    label: "Stop and ask",
    summary: "Do not decide this one — write the options and wait.",
    text: STOP_AND_ASK_TEXT,
    form: "prose",
    needsConfirm: false,
  },
];

const ENACTED: readonly EnactedAction[] = [
  {
    effect: "enacted",
    id: "remove-worktree",
    scope: "session",
    label: "Remove worktree",
    summary: "Delete this agent's working tree, after the check that git cannot do.",
    needsConfirm: true,
    gate:
      "npm run worktree:check must exit 0 inside the tree first. git status is not that check: data/ and .env.local are gitignored, so a clean status reports 'safe' over the top of work nothing else has a copy of, and git worktree remove refuses over modified and untracked files but not over ignored ones.",
  },
  {
    effect: "enacted",
    id: "kill-session",
    scope: "session",
    label: "Exit (kill session)",
    summary: "gjd-remote kill — the conversation ends and does not come back.",
    needsConfirm: true,
    gate:
      "The tmux session handle and name must still be paired as the dashboard last saw them. Names are reassigned when a session dies, so a kill addressed by name alone can land on a session that took the name afterwards.",
  },
  {
    effect: "enacted",
    id: "kill-test-suites",
    scope: "box",
    label: "Kill test suites",
    summary: "SIGTERM every vitest runner on the box.",
    needsConfirm: true,
    gate:
      "Each pid must satisfy the vitest-runner rule and none of the standing refusals. The suites are the biggest single lever on this box and the one whose loss costs least — a killed run is re-runnable, and the agents are already told to read a killed status as no information.",
  },
  {
    effect: "enacted",
    id: "kill-safe-processes",
    scope: "box",
    label: "Kill what is safe",
    summary: "SIGTERM only processes matching a named safety rule.",
    needsConfirm: true,
    gate:
      "Each pid must match one of the named rules in SAFE_KILL_RULES and none of the standing refusals. 'Safe' is that list and nothing else — never a judgement made at the moment of the click.",
  },
];

const BROADCASTS: readonly BroadcastAction[] = [
  {
    effect: "broadcast",
    id: "resource-broadcast",
    scope: "box",
    label: "Broadcast: ease off, staggered",
    summary: "Tell every steerable session the box is loaded, each with its own resume time.",
    needsConfirm: true,
    // Five minutes at the near end because a shorter pause does not relieve
    // anything; sixty at the far end because that is Greg's "up to an hour".
    stagger: { minMinutes: 5, windowMinutes: 60 },
  },
];

export const ACTIONS: readonly Action[] = [...SPOKEN, ...ENACTED, ...BROADCASTS];

/**
 * An id off the wire into an action, or null.
 *
 * The parameter is `string` rather than `ActionId` deliberately: this is the
 * boundary where a JSON body from a browser arrives, and there the union is a
 * comment. Everything past this point has a real `Action`.
 */
export function actionById(id: string): Action | null {
  return ACTIONS.find((a) => a.id === id) ?? null;
}

/** The actions offered on a session row. */
export function sessionActions(): readonly Action[] {
  return ACTIONS.filter((a) => a.scope === "session");
}

/** The actions offered on the Box Health panel. */
export function boxActions(): readonly Action[] {
  return ACTIONS.filter((a) => a.scope === "box");
}

/* ------------------------------------------------------------------ *
 * Rendering the words.
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

const SPEAKER_PREFIX: Record<Speaker, string> = {
  greg: "[Greg, via the fleet dashboard] ",
  overseer: "[The Overseer — an automated coordinator, NOT Greg. Weigh this as a suggestion from a peer, and push back if it is wrong for what you are doing.] ",
};

/** What actually goes to `sendMessage` for a spoken action. */
export function renderSpoken(action: SpokenAction, speaker: Speaker): string {
  // A slash command must be the first thing on the line or Claude Code will not
  // run it, so it cannot carry a prefix. That is a real hole in the attribution
  // rule and it is named rather than papered over: `/compact` from the Overseer
  // is indistinguishable from `/compact` from Greg. It is also the one action
  // whose text contains no instruction to be weighed, so the cost is small.
  if (action.form === "slash-command") return action.text;
  return SPEAKER_PREFIX[speaker] + action.text;
}

/**
 * How many minutes THIS recipient is asked to pause for.
 *
 * Spread evenly across `[minMinutes, windowMinutes]`, so the first recipient
 * resumes at the near end and the last at the far end, and the fleet comes back
 * over the whole window instead of in one second.
 *
 * `total === 1` gets the near end rather than a division by zero: one agent
 * asked to pause is not a stagger, and making it wait the full hour because it
 * is the only one would be perverse.
 *
 * ROUNDING CANNOT COLLAPSE THE SPREAD while there are more minutes than
 * recipients: the spacing is at least one minute, and rounding is monotone, so
 * adjacent values stay distinct. When there are more recipients than minutes it
 * genuinely cannot, and duplicates are the honest outcome rather than a bug —
 * tests/fleet-actions.test.ts pins both cases.
 */
export function staggerMinutes(index: number, total: number, stagger: Stagger): number {
  const { minMinutes, windowMinutes } = stagger;
  if (!Number.isSafeInteger(index) || index < 0) return minMinutes;
  if (!Number.isSafeInteger(total) || total <= 1 || index >= total) return minMinutes;
  const span = windowMinutes - minMinutes;
  if (span <= 0) return minMinutes;
  return Math.round(minMinutes + (span * index) / (total - 1));
}

/** The recipient's position in the fan-out. Both halves are needed to stagger. */
export type Recipient = { index: number; total: number };

/**
 * What goes to ONE recipient of a broadcast.
 *
 * **Render at delivery, never at enqueue.** The minutes are relative to the
 * moment the agent reads them, so a broadcast that sat in a queue for twenty
 * minutes and then said "pause for five" has told an agent to resume before the
 * ones that went out first. queue.ts stores the action, not the sentence, for
 * exactly this reason.
 */
export function renderBroadcast(action: BroadcastAction, to: Recipient, speaker: Speaker): string {
  const minutes = staggerMinutes(to.index, to.total, action.stagger);
  return SPEAKER_PREFIX[speaker] + broadcastText(minutes);
}

/**
 * One line about any action, with the `never` that makes a new arm a compile
 * error rather than an inherited default.
 *
 * The `never` is the point of the function as much as the string is: the day
 * somebody adds a fourth effect — an action that runs a command AND says
 * something, say — this stops compiling and they have to decide what it is,
 * instead of it falling through to "spoken" and being typed at an agent.
 */
export function describeAction(action: Action): string {
  switch (action.effect) {
    case "spoken":
      return `${action.label}: a message to one session${action.form === "slash-command" ? ", run by Claude Code rather than judged by the agent" : ""}`;
    case "enacted":
      return `${action.label}: this tool runs a command, whether or not the agent cooperates`;
    case "broadcast":
      return `${action.label}: a message to every steerable session, staggered over ${action.stagger.windowMinutes} minutes`;
    default: {
      const never: never = action;
      return never;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Plans: argv for an enacted action, or a refusal.
 * ------------------------------------------------------------------ */

/**
 * How a runner decides whether a step passed.
 *
 *  - `exit-zero` — the ordinary gate. A non-zero exit stops the plan.
 *  - `stdout-has-line` — the output must contain this line, trimmed, exactly.
 *    Used to bind a name to a handle before acting on the name.
 *  - `best-effort` — a failure is recorded and the plan continues. Only for
 *    kills, where "that pid is already gone" is the ordinary case and not an
 *    error.
 */
export type StepPass = { kind: "exit-zero" } | { kind: "stdout-has-line"; line: string } | { kind: "best-effort" };

export type Step = {
  argv: readonly string[];
  cwd: string;
  /** Why this step is here, for the log and for the person reading the confirm. */
  why: string;
  pass: StepPass;
};

/**
 * An enacted action's commands, in order.
 *
 * THE RUNNER'S CONTRACT, which is not expressible in the type and so is written
 * here: run the steps in order, stop at the first that fails its `pass` unless
 * that pass is `best-effort`, and never run a later step after an earlier one
 * failed. A runner that ran step 2 after step 1's `worktree:check` said no
 * would delete an agent's only copy of a day's work, and every guard in this
 * file would have passed.
 *
 * No shell, anywhere: argv arrays for `execFile`, so a directory name with a
 * space or a semicolon in it is a directory name.
 */
export type Plan = { action: EnactedAction; steps: readonly Step[] };

export type PlanRefusalRule =
  | "bad-input"
  | "not-a-worktree"
  | "never-the-primary-checkout"
  | "no-pids";

export type PlanResult = { ok: true; plan: Plan } | { ok: false; rule: PlanRefusalRule; why: string };

function planNo(rule: PlanRefusalRule, why: string): PlanResult {
  return { ok: false, rule, why };
}

function isAbsolutePosix(p: string): boolean {
  return p.startsWith("/") && !p.includes("\0");
}

/** Trailing slashes off, so two spellings of the same directory compare equal. */
function normalizeDir(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/**
 * Is this path inside the place worktrees live?
 *
 * `claude --worktree` and `npm run worktree:setup` both put a tree at
 * `<primary>/.claude/worktrees/<name>`, so requiring those two segments is a
 * cheap structural guard against a plan pointed at a home directory or a
 * checkout. **A worktree created somewhere else is refused rather than
 * removed**, which is the safe direction to be wrong in: the cost of a false
 * "no" is that somebody removes it by hand.
 */
export function isUnderWorktreesDir(dir: string): boolean {
  const parts = normalizeDir(dir).split("/");
  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i] === ".claude" && parts[i + 1] === "worktrees" && (parts[i + 2] ?? "") !== "") return true;
  }
  return false;
}

/** A git ref name we are willing to put on a command line. */
function looksLikeBranch(branch: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/.test(branch) && !branch.includes("..");
}

/**
 * Remove a worktree: check first, then sweep.
 *
 * **Step 1 is the whole reason this is an enacted action and not a sentence.**
 * `npm run worktree:check` exists because `data/` and `.env.local` are
 * gitignored, so a clean `git status` reports "safe" over the top of a pipeline
 * run that cost money — and `git worktree remove` refuses over modified and
 * untracked files but NOT over ignored ones, so for the case that matters most
 * nothing else is looking. It exits 0 for safe, 1 for blocked, 2 for "could not
 * even look", and all three are handled by `exit-zero`: an unknown is a
 * blocker, which is the check's own rule.
 *
 * Step 2 is `worktree:sweep -- remove`, which re-runs every guard including a
 * fresh fetch, so a verdict from ten minutes ago cannot cascade. Two of its
 * refusals are worth knowing before somebody reports them as bugs: it will not
 * remove a worktree touched in the last 24 hours however merged it looks, and
 * it will not remove one whose branch is not an ancestor of `origin/dev`.
 * **A refusal from either step is the system working**, not a failure to route
 * around.
 */
export function planRemoveWorktree(action: EnactedAction, input: { dir: string; branch: string; primaryDir: string }): PlanResult {
  if (action.id !== "remove-worktree") return planNo("bad-input", `planRemoveWorktree was given the '${action.id}' action`);
  const dir = normalizeDir(input.dir);
  const primaryDir = normalizeDir(input.primaryDir);
  if (!isAbsolutePosix(dir)) return planNo("bad-input", `'${input.dir}' is not an absolute path`);
  if (!isAbsolutePosix(primaryDir)) return planNo("bad-input", `'${input.primaryDir}' is not an absolute path`);
  if (dir === primaryDir) return planNo("never-the-primary-checkout", "that directory is the primary checkout, not a worktree");
  if (!isUnderWorktreesDir(dir)) {
    return planNo("not-a-worktree", `'${dir}' is not under a .claude/worktrees/ directory, so this refuses to remove it`);
  }
  if (!looksLikeBranch(input.branch)) return planNo("bad-input", `'${input.branch}' is not a branch name this will put on a command line`);

  return {
    ok: true,
    plan: {
      action,
      steps: [
        {
          argv: ["git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD"],
          cwd: primaryDir,
          why: "Is that branch the one actually checked out in that directory? dir and branch arrive from the page as two independent claims, and only this makes them one.",
          pass: { kind: "stdout-has-line", line: input.branch },
        },
        {
          argv: ["npm", "run", "worktree:check"],
          cwd: dir,
          why: "Is anything in here that exists nowhere else? git status cannot answer this: data/ and .env.local are gitignored, and an unknown counts as a blocker.",
          pass: { kind: "exit-zero" },
        },
        {
          argv: ["npm", "run", "worktree:sweep", "--", "remove", "--branch", input.branch],
          cwd: primaryDir,
          why: "The guarded removal, which re-runs its own classification and a fresh fetch rather than trusting the verdict above.",
          pass: { kind: "exit-zero" },
        },
      ],
    },
  };
}

/**
 * Kill a session: prove the name still means this session, then let
 * `gjd-remote` do it.
 *
 * **The verify step exists because `gjd-remote kill` takes a NAME**, and the
 * hardest-won rule in the direction doc is that names are reassigned when a
 * session dies. gjd-remote resolves the name to a handle and kills the handle,
 * which closes the window inside itself; what it cannot know is that the name
 * meant something else when the dashboard rendered the row. So step 1 asks tmux
 * for the live `<handle> <name>` pairs and the runner requires ours to be among
 * them. That is the "execution generation" the direction doc asks for, spelled
 * as data.
 *
 * We do not grow a second way to kill. `gjd-remote kill` reads the Claude uuid
 * before killing so the log records it, and matching by uuid is what makes
 * `gjd-remote log` able to say what was killed after `ls` has renamed it.
 */
export function planKillSession(action: EnactedAction, input: { name: string; sessionId: string; primaryDir: string }): PlanResult {
  if (action.id !== "kill-session") return planNo("bad-input", `planKillSession was given the '${action.id}' action`);
  const primaryDir = normalizeDir(input.primaryDir);
  if (!isAbsolutePosix(primaryDir)) return planNo("bad-input", `'${input.primaryDir}' is not an absolute path`);
  if (!/^\$\d+$/.test(input.sessionId)) return planNo("bad-input", `'${input.sessionId}' is not a tmux session handle`);
  // tmux session names on this box are slugs and job stamps. A name with a
  // newline in it would break the line comparison below, and one starting with
  // `-` would be read as a flag.
  if (input.name === "" || input.name.startsWith("-") || /[\s\0]/.test(input.name)) {
    return planNo("bad-input", `'${input.name}' is not a session name this will put on a command line`);
  }

  return {
    ok: true,
    plan: {
      action,
      steps: [
        {
          argv: ["tmux", "list-sessions", "-F", "#{session_id} #{session_name}"],
          cwd: primaryDir,
          why: "Does that name still mean that session? Names are reassigned when a session dies, and a kill on a recycled name is not an error you get to take back.",
          pass: { kind: "stdout-has-line", line: `${input.sessionId} ${input.name}` },
        },
        {
          argv: ["npx", "tsx", "scripts/gjd-remote.ts", "kill", input.name],
          cwd: primaryDir,
          why: "gjd-remote's own kill, which records the Claude uuid in the log before the session goes.",
          pass: { kind: "exit-zero" },
        },
      ],
    },
  };
}

/**
 * SIGTERM a list of pids somebody has already judged.
 *
 * **A list of pids, never a pattern.** `pkill -f vite` on this box takes out
 * every other agent's dev server, and `pkill -f <string>` matches the shell
 * running it. The caller resolves candidates to records, runs each through
 * `killVerdict`, and hands the survivors here.
 *
 * TERM and not KILL, and no escalation. A vitest run given TERM tears down its
 * workers and releases its lockfiles; `-9` leaves them. If a process survives
 * TERM, that is worth a second look by a person rather than a second signal
 * fired automatically.
 *
 * Every step is `best-effort`, because a pid that exited between the scan and
 * the signal is the ordinary case: `kill` exits non-zero for it, and treating
 * that as a failure would abandon the rest of the list.
 */
export function planKillProcesses(action: EnactedAction, input: { pids: readonly number[]; cwd: string }): PlanResult {
  if (action.id !== "kill-test-suites" && action.id !== "kill-safe-processes") {
    return planNo("bad-input", `planKillProcesses was given the '${action.id}' action`);
  }
  const cwd = normalizeDir(input.cwd);
  if (!isAbsolutePosix(cwd)) return planNo("bad-input", `'${input.cwd}' is not an absolute path`);
  if (input.pids.length === 0) return planNo("no-pids", "nothing matched the rule, so there is nothing to kill");
  for (const pid of input.pids) {
    // pid 1 is init and a negative pid is a PROCESS GROUP — `kill -TERM -1`
    // signals every process the user may signal, which on this box is the whole
    // fleet. Refusing the batch rather than filtering it: a caller that handed
    // us a -1 does not know what it is holding.
    if (!Number.isSafeInteger(pid) || pid <= 1) return planNo("bad-input", `${pid} is not a pid this will signal`);
  }

  return {
    ok: true,
    plan: {
      action,
      steps: input.pids.map((pid) => ({
        argv: ["kill", "-TERM", String(pid)],
        cwd,
        why: `SIGTERM ${pid}. Already gone is not a failure.`,
        pass: { kind: "best-effort" } as StepPass,
      })),
    },
  };
}

/* ------------------------------------------------------------------ *
 * "Safe to kill" as a rule with a name.
 * ------------------------------------------------------------------ */

/**
 * One process, as `ps` and `/proc` describe it.
 *
 * Raw fields rather than a verdict, for the reason `SteerIo` returns raw
 * output: the classifying is the part that can be wrong, so it belongs on this
 * side of the seam where a fixture can drive it.
 *
 * `comm` IS TRUNCATED TO 15 CHARACTERS by the kernel and can contain a space —
 * measured on this box, the tmux server's is `tmux: server`, a supabase
 * postgres wrapper's is `.postgres-wrapp`, and a vitest node's is
 * `node-MainThread`. Every rule below is written against that reality rather
 * than against a tidy program name.
 */
export type ProcRecord = {
  pid: number;
  ppid: number;
  /** `ps -o comm=`. Truncated to 15 chars; may contain a space. */
  comm: string;
  /** `ps -o args=`. The whole command line. */
  args: string;
  /** `readlink /proc/<pid>/cwd`, or null when it could not be read. */
  cwd: string | null;
  rssKiB: number;
  etimeSeconds: number;
};

/** Whose ancestry we must not cut, and where the pid tree comes from. */
export type KillContext = {
  /** This process. `parseParents` from steer.ts produces the map. */
  selfPid: number;
  parents: ReadonlyMap<number, number>;
};

/** Reasons a kill is refused, whatever else is true of the process. */
export type KillRefusalRule =
  /** pid 0 or 1, or a negative number, which `kill` reads as a process group. */
  | "pid-out-of-range"
  /** It is us, or something we are running inside. Killing it kills the killer. */
  | "self-or-ancestor"
  /** Its program is on the protected list: an agent, the terminal multiplexer, a database. */
  | "protected-program"
  /** Nothing matched. The default, and the reason this file is a list rather than a judgement. */
  | "no-rule-matched";

/** The named rules under which a process may be killed. */
export type SafeKillRule =
  /**
   * Its working directory has been deleted out from under it. The strongest
   * available evidence of an orphan — rule 2 of diagnose-box-resources.md's
   * four questions — and it is what a removed worktree leaves behind.
   */
  | "cwd-deleted"
  /**
   * A browser started with `--remote-debugging-pipe` whose launcher has exited.
   * The pipe died with the parent, so **nothing can reconnect to it**, which is
   * exactly the distinction that doc draws: a `--remote-debugging-port` browser
   * outlives its launcher on purpose and a live session can reattach, so that
   * one is not safe and is not matched here.
   */
  | "orphaned-debug-pipe-browser";

/** The rule under which a test suite may be killed. */
export type TestSuiteRule = "vitest-runner";

export type KillRule = SafeKillRule | TestSuiteRule;

export const SAFE_KILL_RULES: readonly SafeKillRule[] = ["cwd-deleted", "orphaned-debug-pipe-browser"];

export type KillVerdict =
  | { kill: true; rule: KillRule; why: string }
  | { kill: false; refusal: KillRefusalRule; why: string };

/**
 * Programs that are never killed by this tool, matched on a prefix of `comm`.
 *
 * A prefix because `comm` is truncated to 15 characters, so a longer protected
 * name arrives cut short; matching a prefix means a program whose first
 * characters look protected is refused rather than killed, which is the
 * direction to be wrong in.
 *
 * **`claude` is on this list**, and that is the entry that matters: a Claude
 * process with a deleted working directory still holds somebody's context, and
 * ending it is `kill-session`'s job with `kill-session`'s confirmation, never a
 * side effect of a box-health sweep.
 */
export const PROTECTED_COMM_PREFIXES: readonly string[] = [
  "systemd",
  "init",
  "sshd",
  "tmux",
  "mosh-server",
  "claude",
  "postgres",
  ".postgres",
  "docker",
  "containerd",
  "cron",
  "atd",
  "sudo",
  "su",
  "login",
  "agetty",
  "nginx",
  "dbus",
  "gpg-agent",
  "beam.smp",
];

function isProtected(comm: string): boolean {
  const name = comm.trim().toLowerCase();
  return PROTECTED_COMM_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * `readlink /proc/<pid>/cwd` marks a removed directory with a ` (deleted)`
 * suffix. Anchored at the end, because a directory can legitimately be called
 * `notes (deleted)` and the kernel's marker is always last.
 */
export function hasDeletedCwd(cwd: string | null): boolean {
  return cwd !== null && / \(deleted\)$/.test(cwd);
}

/**
 * Split a command line into tokens for looking at argv[0] and argv[1].
 *
 * Naive on whitespace, and that is fine for what it is used for: an argument
 * containing a space cannot make a token END with `/node_modules/.bin/vitest`
 * unless it really is that path, and the rules below only ever ask whether some
 * token has that shape.
 */
function tokens(args: string): string[] {
  return args.trim().split(/\s+/).filter((t) => t !== "");
}

/**
 * Is this the process that runs a vitest suite?
 *
 * **Matched on an EXECUTABLE PATH, never on the string "vitest" appearing
 * anywhere.** That is the trap diagnose-box-resources.md names twice: `pgrep -f
 * <name>` matches command lines rather than programs, and on 2026-09-04 it
 * counted 162 "chrome" processes that were mostly MCP servers whose arguments
 * mentioned chrome. An agent editing `vitest.config.ts`, or running
 * `grep -r vitest`, has "vitest" on its command line and must not be killed for
 * it.
 *
 * The real shapes on this box, measured 2026-09-08:
 *
 *   sh   -c vitest run
 *   node /home/greg/.../<worktree>/node_modules/.bin/vitest run
 *
 * We match the second and not the first. Killing the node makes the `sh -c`
 * that is waiting on it exit by itself; killing the `sh` would orphan the node,
 * which is the wrong half to take.
 */
export function isVitestRunner(proc: ProcRecord): boolean {
  const parts = tokens(proc.args);
  return parts.some(
    (t) =>
      t.endsWith("/node_modules/.bin/vitest") ||
      t.endsWith("/node_modules/vitest/vitest.mjs") ||
      /\/node_modules\/vitest\/dist\/.*\.m?js$/.test(t),
  );
}

/**
 * A browser whose launcher has gone and which nothing can reattach to.
 *
 * All three conditions are load-bearing. `--remote-debugging-pipe` rather than
 * `--remote-debugging-port`, because the port variant is designed to outlive
 * its launcher and a live session can reconnect to it — on 2026-09-04 an
 * orphaned-looking browser turned out to belong to a session with 15 live
 * processes. `ppid === 1` because that is what "the launcher exited" looks
 * like, and it is evidence rather than proof, which is why it is paired with
 * the pipe. And `comm` rather than `args`, so the MCP servers currently running
 * on this box with `--browser chrome` in their arguments — which are not
 * browsers — do not match.
 */
export function isOrphanedDebugPipeBrowser(proc: ProcRecord): boolean {
  const name = proc.comm.trim().toLowerCase();
  // An exact match on the program name. `chrome_crashpad` is a real comm on
  // this box (16 of them right now) and is not a browser; a prefix test would
  // have taken it.
  const isBrowser = name === "chrome" || name === "chromium" || name === "google-chrome";
  if (!isBrowser) return false;
  if (proc.ppid !== 1) return false;
  return proc.args.includes("--remote-debugging-pipe");
}

export type KillPolicy = "safe-to-kill" | "test-suites";

/**
 * May this process be killed under this policy?
 *
 * **THE REFUSALS ARE CHECKED FIRST AND THEY WIN.** A vitest run whose parent is
 * this very server, or a `claude` with a deleted working directory, is refused
 * however well it matches. That ordering is the file's one real safety
 * property, and the test that proves it is the one that feeds a matching
 * process that is also protected and asserts the refusal.
 *
 * The `never` on the policy switch means a third policy cannot inherit
 * `safe-to-kill`'s rules by accident.
 */
export function killVerdict(proc: ProcRecord, policy: KillPolicy, ctx: KillContext): KillVerdict {
  if (!Number.isSafeInteger(proc.pid) || proc.pid <= 1) {
    return { kill: false, refusal: "pid-out-of-range", why: `${proc.pid} is not a pid this will ever signal` };
  }
  // `descendsFrom(selfPid, proc.pid, …)` is true when proc is US or an ancestor
  // of us. Reused from steer.ts rather than written again: it is bounded at 32
  // hops and stops on a repeated pid, because a process table read a line at a
  // time can contain a cycle that existed at no instant.
  if (descendsFrom(ctx.selfPid, proc.pid, ctx.parents)) {
    return { kill: false, refusal: "self-or-ancestor", why: `pid ${proc.pid} is this process or something it is running inside` };
  }
  if (isProtected(proc.comm)) {
    return { kill: false, refusal: "protected-program", why: `'${proc.comm.trim()}' is on the protected list and is never killed here` };
  }

  switch (policy) {
    case "test-suites":
      if (isVitestRunner(proc)) {
        return { kill: true, rule: "vitest-runner", why: `pid ${proc.pid} is a vitest runner; a killed suite is re-runnable` };
      }
      return { kill: false, refusal: "no-rule-matched", why: `pid ${proc.pid} is not a vitest runner` };
    case "safe-to-kill":
      if (hasDeletedCwd(proc.cwd)) {
        return { kill: true, rule: "cwd-deleted", why: `pid ${proc.pid} is running in a directory that has been deleted: ${proc.cwd}` };
      }
      if (isOrphanedDebugPipeBrowser(proc)) {
        return {
          kill: true,
          rule: "orphaned-debug-pipe-browser",
          why: `pid ${proc.pid} is a browser on a debugging PIPE whose launcher has exited, so nothing can reconnect to it`,
        };
      }
      return { kill: false, refusal: "no-rule-matched", why: `pid ${proc.pid} matches no rule in SAFE_KILL_RULES` };
    default: {
      const never: never = policy;
      return never;
    }
  }
}

/** Every process the policy would kill, with the rule that licensed each one. */
export function selectForKill(
  procs: readonly ProcRecord[],
  policy: KillPolicy,
  ctx: KillContext,
): { pid: number; rule: KillRule; why: string }[] {
  const chosen: { pid: number; rule: KillRule; why: string }[] = [];
  for (const proc of procs) {
    const verdict = killVerdict(proc, policy, ctx);
    if (verdict.kill) chosen.push({ pid: proc.pid, rule: verdict.rule, why: verdict.why });
  }
  return chosen;
}
