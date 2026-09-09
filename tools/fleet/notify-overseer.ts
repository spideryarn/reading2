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
 * ## Never the word "sent"
 *
 * **Nothing on this box can observe reception.** `sendMessage` types keystrokes
 * at a pane; whether the agent read them, whether the Enter landed, and whether
 * the text concatenated with something half-typed are all outside what we can
 * see. So the outcome vocabulary is the one that path already returns —
 * `none | partial | unknown` on failure — and success is **`submitted`**, which
 * claims exactly what happened. `partial` is the one to read twice: the text
 * landed and the Enter did not, so it is sitting unsent in the Overseer's input
 * box and will be prepended to whatever it types next.
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
import { renderMessage } from "./actions.js";
import type { OverseerClaim } from "./overseer-claim.js";
import type { Delivery, Speaker } from "./wire.js";

/**
 * What became of one notification.
 *
 * **Every arm carries why**, because the launch record renders this and a bare
 * word would be a state without a cause — the shape this codebase keeps having
 * to repair.
 */
export type NotifyOutcome =
  /** The keystrokes went to the pane. NOT "delivered", NOT "sent" — see the header. */
  | { kind: "submitted"; to: string; paneId: string }
  /** The snapshot was readable and nobody holds the `overseer` role. */
  | { kind: "no-holder" }
  /** More than one session claims it. Reported, never resolved here. */
  | { kind: "contested"; names: readonly string[] }
  /** We could not establish who holds it, or could not address them. */
  | { kind: "cannot-tell"; why: string }
  /** We found the holder and the send would not go. */
  | { kind: "refused"; to: string; code: string; why: string; delivery: Delivery }
  /** The send threw or the deadline expired after an effect may have begun. */
  | { kind: "unknown"; to: string; why: string };

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
  send: (target: {
    paneId: string;
    sessionId: string;
    claudeSessionId: string;
    panePid: number | null;
  }, text: string, declaredStatus: unknown) => Promise<
    { ok: true } | { ok: false; code: string; why: string; delivery: Delivery }
  >;
};

/**
 * Resolve the holder, compose the line, send it, and say what became of it.
 *
 * **The claim is re-read by the caller immediately before this runs** (F8): a
 * holder can release the role between the snapshot and delivery while staying in
 * the same pane, and every one of `sendMessage`'s guards would still pass —
 * process identity is not current role ownership.
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

  /* Through the shared attribution machinery, never around it. A refusal here
     is a real answer: `renderMessage` turns down a slash command from anyone
     but Greg, and a notice that began with one would be a command we did not
     mean to send. */
  const rendered = renderMessage(line, NOTIFY_SPEAKER);
  if (!rendered.ok) {
    return { kind: "cannot-tell", why: `the notice could not be composed: ${rendered.why}` };
  }

  try {
    const result = await deps.send(
      {
        paneId: row.paneId,
        sessionId: row.id,
        claudeSessionId: row.claudeSessionId,
        panePid: row.panePid,
      },
      rendered.text,
      row.status,
    );
    if (result.ok) return { kind: "submitted", to: row.name, paneId: row.paneId };
    return { kind: "refused", to: row.name, code: result.code, why: result.why, delivery: result.delivery };
  } catch (e) {
    /* NOT `refused`. A throw after the send began cannot distinguish "nothing
       happened" from "half of it did", and calling that a refusal would be the
       one claim we are never allowed to make. */
    return { kind: "unknown", to: row.name, why: e instanceof Error ? e.message : String(e) };
  }
}

/** One line for the launch record and the log. Never the message text. */
export function describeNotify(outcome: NotifyOutcome): string {
  switch (outcome.kind) {
    case "submitted":
      return `submitted to ${outcome.to} at ${outcome.paneId} — nothing here can tell whether it was read`;
    case "no-holder":
      return "not sent: nobody holds the overseer role";
    case "contested":
      return `not sent: ${outcome.names.length} sessions claim the overseer role (${outcome.names.join(", ")})`;
    case "cannot-tell":
      return `not sent: ${outcome.why}`;
    case "refused":
      return `refused by ${outcome.to} (${outcome.code}): ${outcome.why} — keystrokes: ${outcome.delivery}`;
    case "unknown":
      return `it is not known whether anything reached ${outcome.to}: ${outcome.why}`;
  }
}
