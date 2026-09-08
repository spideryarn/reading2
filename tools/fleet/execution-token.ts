/**
 * **THE EXECUTION TOKEN'S TEXT FORM, AND THE THREE DECISIONS ANYBODY MAKES WITH
 * IT** — as a leaf, so the browser can have them.
 *
 * ## Why this is a separate file from `execution-identity.ts`
 *
 * `execution-identity.ts` reads `/proc` and classifies process trees: it
 * imports `node:fs` and two Overseer modules, so it can never be imported by
 * `tools/fleet/web/src/`, which is compiled a second time by a DOM-only
 * project. But `continuityOf` and `identityWriteGate` are exactly the functions
 * the browser needs — they are what a component asks before it reuses a draft
 * or enables a write — and a policy that lives where its main consumer cannot
 * reach it gets copied instead of imported. GPT Sol's P2-3, 2026-09-09.
 *
 * So the split is by dependency rather than by topic: **what the machine says**
 * stays over there; **what it means** is here, and here has no imports at all
 * except types. `tools/overseer/diff.ts` and `store.ts` import this rather than
 * `execution-identity.ts` too, which also unbraids the layering — the Overseer
 * no longer reaches through a fleet module that reaches back into the Overseer.
 *
 * ## The text form is the contract, not an encoding detail
 *
 * `boot:pid:startTicks`. It is stored in the Overseer's register, written into
 * its event log, and used as a cache key by the dashboard. Every one of those
 * survives a restart, so the shape is a thing other code depends on, and
 * {@link isExecutionTokenText} is here so that "a malformed token is refused" is
 * a property something checks rather than a sentence in a comment.
 */
import type { ExecutionReading, ExecutionToken } from "./wire.js";

/**
 * The token as one comparable, storable string.
 *
 * A string rather than a structural compare because it has to survive a JSONL
 * round trip and be a map key in the Overseer's register, and because a
 * hand-written three-field `===` in each consumer is the shape this repo has
 * lost mornings to. The separator is `:`; a boot id is a uuid and the other two
 * are decimal, so nothing in a field can be confused for one.
 */
export function executionTokenText(token: ExecutionToken): string {
  return `${token.boot}:${token.pid}:${token.startTicks}`;
}

/**
 * A boot id, a pid and a start tick, in that order.
 *
 * Deliberately loose about the boot id's shape — it is whatever the kernel put
 * in `boot_id`, and pinning it to a uuid here would be this file inventing a
 * rule about a file it does not read — and strict about the two numbers, which
 * are ours. **Not exported as a parser returning the parts**: nothing should
 * take a token apart, because a consumer that compares fields instead of whole
 * strings is a second definition of what identity means.
 */
const TOKEN_TEXT = /^[^:\s]+:[1-9]\d{0,9}:\d{1,19}$/;

export function isExecutionTokenText(value: unknown): value is string {
  return typeof value === "string" && TOKEN_TEXT.test(value);
}

/**
 * **THE CONTINUITY QUESTION, and the only honest way to ask it.**
 *
 * A caller that owns something identity-dependent — a draft, a transcript
 * attribution, a measured duration — stores the token it was created under and
 * asks this every time it is about to use it. It does NOT ask "did a change
 * event fire": an event log is a record of what was noticed, and this is a
 * comparison of what is true now.
 *
 * Three answers and no fourth. `unverifiable` is not a soft `same`: it is the
 * arm that must quarantine, because *we cannot see it* and *it is still there*
 * are the same picture from here.
 */
export type Continuity =
  | { kind: "same"; token: string }
  | { kind: "replaced"; previous: string; current: string; why: string }
  | { kind: "unverifiable"; previous: string | null; why: string };

export function continuityOf(previous: string | null, current: ExecutionReading): Continuity {
  if (current.kind !== "verified") {
    return {
      kind: "unverifiable",
      previous,
      why:
        current.kind === "claimed-only"
          ? `nothing under this pane could be identified, so whether it is still the same run cannot be established: ${current.why}`
          : `there is no execution reading for this pane (${current.cause}), so whether it is still the same run cannot be established: ${current.why}`,
    };
  }
  const token = executionTokenText(current.token);
  if (previous === null) {
    return {
      kind: "unverifiable",
      previous: null,
      why: `this is run ${token}, and there is no earlier run recorded to compare it against`,
    };
  }
  if (previous === token) return { kind: "same", token };
  return {
    kind: "replaced",
    previous,
    current: token,
    why: `the process in this pane is run ${token} now, not ${previous} — it was replaced, and the pane, its pid and its CLAUDE_SESSION_ID all stayed the same across that`,
  };
}

/**
 * **MAY SOMETHING KEYED TO A CONVERSATION BE WRITTEN RIGHT NOW?**
 *
 * Three conditions, all required: the execution is verified, the conversation
 * is verified, and the harness is one we can actually address. The third is
 * defence in depth rather than redundancy — the arms are produced together by
 * one function today, but this value also arrives off the wire from a producer
 * this build did not compile, and a payload asserting a verified conversation
 * on a `shell` pane must not open a write path. GPT Sol's P2-4.
 *
 * Every refusal carries the sentence a reader is shown beside the disabled
 * control, so it explains itself rather than greying out silently.
 *
 * **A CACHED `allowed` IS NOT AUTHORITY.** This takes a reading, and a reading
 * is what was true at the instant it was taken. The rule for a caller is that
 * the reading must be *fresh at the moment of the write* — which is what
 * `steer.ts`'s `verifyTarget` already does for keystrokes, re-deriving against
 * the live box rather than trusting what the page was rendered from. Storing an
 * `allowed: true` and acting on it later is the mistake this comment exists to
 * name; the token it returns is for recording what a write was done under, not
 * for re-authorising a later one.
 */
export type IdentityWriteGate = { allowed: true; token: string; conversationId: string } | { allowed: false; why: string };

/**
 * The harnesses a conversation-addressed write may target.
 *
 * `claude-code` and nothing else, and the two exclusions are the interesting
 * ones: `claude-headless` really is a Claude running a conversation, and it
 * stopped reading its terminal after its first prompt, so a write to it is
 * delivered to nobody. `shell` is the dangerous one — see
 * `HARNESS_CAPABILITIES` in tools/overseer/harness.ts, whose refusal for a
 * shell is that it would EXECUTE the text.
 */
const ADDRESSABLE: ReadonlySet<string> = new Set(["claude-code"]);

export function identityWriteGate(reading: ExecutionReading): IdentityWriteGate {
  if (reading.kind === "unknown") {
    return {
      allowed: false,
      why: `we cannot see what is running in this pane (${reading.cause}), so anything addressed to a conversation could reach a different one: ${reading.why}`,
    };
  }
  if (reading.kind === "claimed-only") {
    return {
      allowed: false,
      why: `nothing under this pane could be identified, so its conversation id is a launch claim rather than an observation: ${reading.why}`,
    };
  }
  switch (reading.conversation.kind) {
    case "verified":
      // THE HARNESS IS CHECKED EVEN THOUGH THE CONVERSATION IS VERIFIED. A
      // `verified` conversation on a `shell` is a combination this box's
      // producer cannot make and a payload can assert; the parsers refuse it
      // too, and this is the second of the two locks.
      if (!ADDRESSABLE.has(reading.harness)) {
        return {
          allowed: false,
          why: `this pane holds ${reading.harness}, which cannot be addressed by conversation, so a claim that it is running ${reading.conversation.id} is not something to act on`,
        };
      }
      return { allowed: true, token: executionTokenText(reading.token), conversationId: reading.conversation.id };
    case "not-claimed":
      return {
        allowed: false,
        why: `this pane holds ${reading.harness} and no conversation was ever claimed for it, so there is nothing here to address`,
      };
    case "conflicting":
      return {
        allowed: false,
        why:
          `this pane is running conversation ${reading.conversation.observed}, not ${reading.conversation.claimed} ` +
          `which every address on this row still names — a different Claude has been started here since launch`,
      };
    case "unverifiable":
      return {
        allowed: false,
        why: `nothing observable confirms that conversation ${reading.conversation.claimed} is the one in this pane: ${reading.conversation.why}`,
      };
    default: {
      const never: never = reading.conversation;
      throw new Error(`no write gate for conversation reading ${JSON.stringify(never)}`);
    }
  }
}
