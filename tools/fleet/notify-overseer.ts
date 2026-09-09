/**
 * TELLING THE OVERSEER THAT SOMEBODY STARTED A SESSION FROM THE WEB UI.
 *
 * Greg, 2026-09-09: *"When we start a New Session in the web UI, it should
 * somehow notify the Overseer."* One line, into the pane of whichever session
 * holds the `overseer` role, when `POST /api/sessions/new` reaches `started`.
 *
 * ## It is a REPORT, and the whole design follows from that
 *
 * Nothing is being asked of the receiver. That is why it goes as
 * `Speaker: "dashboard"` — a third arm added on 2026-09-09 specifically for
 * this, whose prefix says *"Nobody is asking you for anything: a person started
 * a new session from the web UI, and this is the record of it."* The arm
 * **splits rather than softens** if anything sent through it is ever an
 * instruction, because the prefix would then be a false statement about its own
 * message. See `Speaker` in wire.ts.
 *
 * A private prefix constant here was the first plan and was refused by a
 * cross-family review (F5): `SPEAKER_PREFIX` is an exhaustive
 * `Record<Speaker, string>`, so a second constant could not have compiled
 * *honestly* — it would be a second hand-written declaration of one contract
 * with nothing relating the two, which is the twin that cost this project four
 * dropped fields in one night.
 *
 * ## It is QUEUED, not sent — and that is the whole delivery design
 *
 * This module hands the line to the shared steering queue and stops. It does not
 * type at a pane, and it could not: since `send-coordinator.ts`, `sendMessage`
 * is private to that file and every producer goes through the coordinator, whose
 * point is that the quarantine check and the transport call are adjacent with
 * nothing between them. A send from here, in a child process to keep it off the
 * event loop, would have carried its **own** quarantine book — so the hold check
 * would read empty and this notice could type a second sentence into a session
 * already held behind half of one. Duplicate keystrokes are the one thing that
 * neighbourhood forbids.
 *
 * Queueing dissolves that rather than mitigating it: `enqueueSharedMessage`
 * makes no tmux calls, so nothing blocks, and `drain.ts` delivers on the refresh
 * loop through the coordinator with the hold check in-process where it belongs.
 * It is also what Greg named — *"route it through the existing steer machinery
 * (`queue.ts`/`drain.ts` deliver keystrokes to a pane) rather than a new
 * sender"*.
 *
 * **So the success arm is `queued`, and it claims exactly that much.** Nothing
 * here can say the Overseer was told; the queue's own surface says what became
 * of the keystrokes. A launch record that went stale claiming a delivery would
 * be worse than one that says plainly where it put the thing.
 *
 * ## THE ROLE CAN MOVE BETWEEN QUEUEING AND DELIVERY, AND WE ACCEPT IT
 *
 * Who holds `overseer` is resolved here, at enqueue; the drain delivers up to
 * ~73 s later. If the role changes hands in between — the holder releasing it
 * while staying in the same pane — the note reaches the **former** Overseer, and
 * nothing in the delivery path would notice, because process identity is not
 * current role ownership.
 *
 * That is accepted rather than solved, and the licence is the arm's own rule:
 * this is a **report**, nobody is being asked for anything, so a misroute
 * delivers a stale fact to a peer instead of an instruction to the wrong agent.
 * **The moment anything sent under the `dashboard` speaker is an instruction,
 * this reasoning collapses along with the prefix** — which is the same reason
 * the arm splits rather than softens. Overseer's decision, 2026-09-09.
 *
 * ## Three things that are not the same as "no holder"
 *
 * A reading that could not be taken must not render as a reading, and the
 * states below are four different facts rather than one absence:
 *
 *  - **`no-holder`** — the snapshot was readable and nobody holds the claim.
 *    That is what a box looks like after a reboot, and it is a real answer.
 *  - **`contested`** — more than one session claims it. A fault to report,
 *    never a pick: choosing one would make this code the arbiter of a question
 *    it cannot answer.
 *  - **`cannot-tell`** — the snapshot was stale, unreadable, or the holder's row
 *    carried no address. We do not know whether anybody holds it.
 *  - **`refused`** — we found the holder and the send would not go: a dialog is
 *    open, the input box is not empty, the pane moved. Carries the refusal code
 *    and the `Delivery` word.
 */
import type { OverseerClaim } from "./overseer-claim.js";
import type { NotifyOutcomeView, Speaker } from "./wire.js";

/**
 * What became of one notification.
 *
 * **Every arm carries why**, because the launch record renders this and a bare
 * word would be a state without a cause — the shape this codebase keeps having
 * to repair.
 */
/**
 * What became of one notification.
 *
 * Declared once, in `wire.ts`, because the launch record carries it to the
 * browser — a second declaration here is the twin that cost this area four
 * dropped fields in one night.
 */
export type NotifyOutcome = NotifyOutcomeView;

/** The speaker this module sends as, and the only one it may use. */
export const NOTIFY_SPEAKER: Speaker = "dashboard";

/**
 * The most a notification may say about the prompt.
 *
 * **`routes-new.ts` records `promptBytes` and never the prompt**, and its header
 * makes that an explicit promise. Greg asked for "the prompt's first line" in
 * the notice, which widens that promise, so the widening is bounded here and
 * named in one place rather than spread through the caller: one line, first line
 * only, truncated, and never the whole thing.
 *
 * Flagged to Greg rather than assumed — he asked for the first line and this
 * builds it, but whether a prompt's first line should leave this module at all
 * is his call, and the whole feature degrades to the session name if he says no.
 */
export const PROMPT_EXCERPT_CHARS = 160;

/**
 * The first line of the prompt, bounded, or null when there is nothing to show.
 *
 * Control characters are stripped rather than escaped: `checkText` in steer.ts
 * refuses any C0 character including tab, so a prompt containing one would make
 * the whole notification unsendable — and losing the notice because somebody
 * indented their prompt would be absurd.
 */
export function promptExcerpt(prompt: string): string | null {
  const firstLine = prompt.split("\n")[0] ?? "";
  /* A CODEPOINT FILTER RATHER THAN A REGEX, and the reason is in the file's
     history: the first version of this line was written as a character class
     spanning the C0 range, and the escapes landed in the source as RAW BYTES —
     a literal NUL, 0x1f and DEL sitting in the file. It worked, and it made the
     file binary to grep, which is how it was found at all. Nothing here needs an
     escape, so nothing here has one. */
  let clean = "";
  for (const ch of firstLine) {
    const code = ch.codePointAt(0) ?? 0;
    clean += code < 0x20 || code === 0x7f ? " " : ch;
  }
  clean = clean.trim();
  if (clean === "") return null;
  return clean.length <= PROMPT_EXCERPT_CHARS ? clean : `${clean.slice(0, PROMPT_EXCERPT_CHARS - 1)}…`;
}

/**
 * The line itself.
 *
 * **One line, and it must never begin with `/`.** `renderMessage` refuses a
 * slash command from any speaker but `greg`, so a prompt whose first line began
 * with a slash would make the notice unsendable — and the excerpt is positioned
 * after the prefix and after our own words, which is what keeps the composed
 * text from ever starting with one. The unit test asserts that directly rather
 * than trusting the argument.
 *
 * **The origin is in it because there is no authentication.** Anybody who can
 * reach the dashboard can start a session, so the honest statement is that it
 * came from the web UI at a particular address — not that Greg did it.
 */
export function notifyLine(input: {
  sessionName: string | null;
  origin: string | null;
  dir: string | null;
  promptFirstLine: string | null;
}): string {
  const who = input.origin === null ? "the web UI" : `the web UI at ${input.origin}`;
  const named = input.sessionName === null ? "a session whose name could not be read back" : input.sessionName;
  const parts = [`A new session was started from ${who}: ${named}.`];
  if (input.dir !== null) parts.push(`In ${input.dir}.`);
  parts.push(
    input.promptFirstLine === null
      ? "Its prompt's first line was empty."
      : `Its prompt began: ${JSON.stringify(input.promptFirstLine)}.`,
  );
  return parts.join(" ");
}

/** A row this module can address — the fields it needs and nothing else. */
export type AddressableRow = {
  id: string;
  name: string;
  paneId: string | null;
  panePid: number | null;
  claudeSessionId: string | null;
  status: unknown;
};

/**
 * Everything impure, injected — so every arm above is reachable in a test with
 * no tmux, no pane and no gateway.
 *
 * `send` is async **deliberately**, and it is the fix for F7. `sendMessage` is
 * synchronous `execFileSync` over as many as six tmux and process calls at ten
 * seconds each, and running that on the dashboard's event loop would stall the
 * page for up to a minute under exactly the loaded-box conditions this tool
 * exists to report on. The production wiring puts it in a child process with one
 * total deadline; this module only knows that the answer arrives later.
 */
export type NotifyDeps = {
  /** The claim, already read from a snapshot by the caller that has one. */
  claim: OverseerClaim;
  /** The rows of that same snapshot, so the holder's address comes from one reading. */
  rows: readonly AddressableRow[];
  /**
   * Hand one line to the shared steering queue.
   *
   * **The text is RAW and must stay raw.** `enqueueMessage` calls
   * `renderMessage` itself — to apply the slash rule and to length-check *with*
   * the prefix, which counts towards the limit — and `drain.ts` renders again at
   * delivery. Handing it an already-prefixed string prefixes it twice, which
   * reads as clumsy rather than as a bug and fails nothing, so a test asserts
   * the raw form rather than trusting this comment.
   */
  enqueue: (
    target: { sessionId: string; claudeSessionId: string },
    text: string,
    speaker: Speaker,
  ) => { ok: true; position: number } | { ok: false; rule: string; why: string };
};

/**
 * Resolve the holder, hand the line to the queue, and say what became of it.
 *
 * **Synchronous work only.** Nothing here touches a pane, a process or the
 * network, so it cannot stall the dashboard — which is the whole reason this is
 * an enqueue rather than a send. It stays `async` because the caller's seam is
 * async and because a future binding may want to be.
 */
export async function notifyOverseer(deps: NotifyDeps, line: string): Promise<NotifyOutcome> {
  const { claim } = deps;
  if (claim.kind === "none") return { kind: "no-holder" };
  if (claim.kind === "contested") return { kind: "contested", names: claim.names };
  if (claim.kind === "cannot-tell") return { kind: "cannot-tell", why: claim.why };

  const row = deps.rows.find((r) => r.id === claim.id);
  if (row === undefined) {
    return { kind: "cannot-tell", why: `the claim names ${claim.id}, which is not in the snapshot it came from` };
  }
  if (row.paneId === null || row.claudeSessionId === null) {
    return {
      kind: "cannot-tell",
      why: `${row.name} holds the claim and has no ${row.paneId === null ? "pane" : "conversation id"} to address`,
    };
  }

  /* THE RAW LINE AND THE SPEAKER, NOT A RENDERED STRING. `enqueueMessage`
     applies `renderMessage` itself — for the slash rule, and to length-check
     WITH the prefix, which counts towards the limit — and `drain.ts` renders
     again at delivery. Handing it something already prefixed prefixes it twice,
     which reads as clumsy rather than as a bug and fails nothing, so the test
     asserts the raw form rather than trusting this comment.

     The attribution is not lost by staying out of it: the speaker travels, and
     the queue is where it is applied. */
  const result = deps.enqueue({ sessionId: row.id, claudeSessionId: row.claudeSessionId }, line, NOTIFY_SPEAKER);
  if (result.ok) return { kind: "queued", to: row.name, position: result.position };
  /* `rule` travels rather than being flattened: a full queue is a fact about
     THIS recipient and `bad-text` is a fact about the MESSAGE, and a record that
     could not tell them apart could render neither honestly. */
  return { kind: "not-queued", to: row.name, rule: result.rule, why: result.why };
}

/** One line for the launch record and the log. Never the message text. */
export function describeNotify(outcome: NotifyOutcome): string {
  switch (outcome.kind) {
    case "queued":
      return `queued for ${outcome.to}, position ${outcome.position} — the queue says what becomes of it, not this record`;
    case "not-queued":
      return `the queue would not take it for ${outcome.to} (${outcome.rule}): ${outcome.why}`;
    case "no-holder":
      return "nothing queued: nobody holds the overseer role";
    case "contested":
      return `nothing queued: ${outcome.names.length} sessions claim the overseer role (${outcome.names.join(", ")})`;
    case "cannot-tell":
      return `nothing queued: ${outcome.why}`;
  }
}
