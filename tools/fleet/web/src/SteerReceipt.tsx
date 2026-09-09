/**
 * **WHAT BECAME OF A SEND**, drawn once, for every surface that sends.
 *
 * ## Why this file exists
 *
 * Three separate delivery vocabularies have had to be removed from this
 * dashboard, one of them introduced by the stage that was removing the previous
 * one. So a second surface that types at a pane — the Overseer message and the
 * broadcast, both on the Overseer tab — does not get to describe a send in its
 * own words. It renders a `SteerOutcome` from steer-client.ts, with that file's
 * four `DeliveryReading` arms, and declares no vocabulary at all.
 *
 * ## Its relationship with SessionDetail.tsx, which is temporary and dated
 *
 * `SessionDetail.tsx` has the original of `DELIVERY_HEADLINE` and `Landed`, and
 * this file is a faithful move of them rather than a second opinion: the words
 * are that file's words, and the reasoning behind each is in its comments,
 * which have not been copied because a fact with two homes is a fact that
 * drifts. **This is now the canonical home**, by agreement with the session
 * that owns SessionDetail (`claude-agents-dashboard`, 2026-09-09), which will
 * delete its copy and import this one in its Stage 5.
 *
 * Until that lands there are two copies of one table. If you are here to change
 * a sentence and both still exist, **change both** — or better, finish the move
 * and delete the other.
 *
 * ## The one thing every word here is chosen against
 *
 * `verifyTarget` runs BEFORE the screen capture and before the `send-keys`
 * calls, and nothing re-reads the pane afterwards, because tmux has no
 * compare-and-send (steer.ts § KNOWN GAPS). **So this is a check, not a
 * receipt**, and no sentence in this file may read as one. That distinction was
 * got wrong once already, on the one surface where being wrong is expensive.
 */
import type { ReactNode } from "react";

import {
  checkLanding,
  listFields,
  type SentTarget,
  type SteerOutcome,
  type VerifiedReading,
} from "./steer-client";
import { Mono } from "./ui";

type SteerFailure = Extract<SteerOutcome, { ok: false }>;

/**
 * THE HEADLINE ON A REFUSAL, WHICH IS NOT ALWAYS "NOTHING WAS SENT".
 *
 * It was, for every refusal, until 2026-09-08 — and that sentence is false in
 * the most expensive direction available. A **partial** delivery means the text
 * landed in that agent's input box and the Enter did not, which invites exactly
 * the retry that appends to the half-sent text instead of replacing it. There
 * is no way to take the first one back.
 *
 * A `Record` over the closed union rather than a chain of ifs, so a fifth arm
 * in `DeliveryReading` fails the build here instead of quietly taking the last
 * branch. `not-told` is deliberately the same words as `unknown` minus the
 * cause: both mean *we cannot say what reached the pane*, and the difference —
 * whether the server had an opinion — changes nothing a person would do.
 */
export const DELIVERY_HEADLINE: Record<SteerFailure["delivery"]["kind"], { head: string; body: string | null }> = {
  none: { head: "Nothing was sent.", body: null },
  partial: {
    head: "PART of it was sent.",
    body:
      "The text reached that session's input box and the Enter did not, so it is sitting there unsent. Do NOT send it again — a second message would be added to the end of the first. Go and look: the terminal is the only place this can be fixed.",
  },
  unknown: {
    head: "It is not known whether anything was sent.",
    body:
      "The attempt failed in a way that cannot say what reached the pane. Look at the session before trying again — if the text is sitting in its input box, sending again would add to it rather than replace it.",
  },
  "not-told": {
    head: "It is not known whether anything was sent.",
    body:
      "The server refused without saying what became of the keystrokes. Treat that as unknown rather than as nothing: look at the session before sending again.",
  },
};

/**
 * **WHAT WAS CHECKED IMMEDIATELY BEFORE SENDING, AGAINST WHAT WAS ASKED FOR.**
 *
 * The comparison is against the row **as it was when the send was requested**
 * (`SentTarget`), not the row on screen now: an outcome outlives the payload it
 * was made against, and comparing with the live row asks a question nobody
 * asked and can answer it wrongly in both directions.
 *
 * **A disagreement should be unreachable** — `verifyTarget` refuses a claim that
 * does not match live tmux — so reaching it means a guard upstream did not
 * hold, which is worth saying out loud rather than trusting silently.
 *
 * `not-told` draws nothing at all: a success with no address is what a server
 * older than that field sends, and the arm exists so silence cannot be rendered
 * as an address, not so that it can be announced.
 */
export function Landed({ verified, target }: { verified: VerifiedReading; target: SentTarget }): ReactNode {
  const check = checkLanding(verified, target);
  if (check.kind === "not-told") return null;
  const gap =
    check.unchecked.length === 0
      ? null
      : ` The ${listFields(check.unchecked)} could not be compared — this row carried none when you sent.`;
  if (check.kind === "agrees") {
    return (
      <p className="tw:mt-1 tw:text-ink-soft">
        Verified <Mono>{check.verified.paneId}</Mono> in <Mono>{check.verified.sessionId}</Mono> immediately before the
        keys went — {listFields(check.compared)} all matched the row this was addressed to, resolved against live tmux
        rather than copied back from the request. Nothing looked at the pane afterwards, so this is a check, not a
        receipt.{gap}
      </p>
    );
  }
  return (
    <p className="tw:mt-1 tw:font-medium tw:break-words tw:text-alarm-ink">
      IT WAS NOT THE SESSION THIS WAS ADDRESSED TO. Just before sending, the server resolved the target to{" "}
      <Mono>{check.verified.paneId}</Mono> in <Mono>{check.verified.sessionId}</Mono> (pid{" "}
      <Mono>{check.verified.panePid}</Mono>), and it was addressed to <Mono>{check.target.paneId ?? "no pane"}</Mono> in{" "}
      <Mono>{check.target.sessionId}</Mono> (pid <Mono>{check.target.panePid ?? "unstated"}</Mono>). The{" "}
      {listFields(check.differing)} differ. Go and look at both before sending anything else.{gap}
    </p>
  );
}

/**
 * One send, in full, for a surface with room for it.
 *
 * `extra` is where a caller puts advice that only it can give — a Refresh
 * button, a pointer at the terminal. This component deliberately offers none of
 * its own: what to do next depends on which surface you are on, and a control
 * that appears under every refusal is one people stop reading.
 */
export function SteerReceipt({
  outcome,
  target,
  extra,
}: {
  outcome: SteerOutcome;
  /** The row's identity AT THE MOMENT THE SEND WAS REQUESTED. See `Landed`. */
  target: SentTarget;
  extra?: ReactNode;
}): ReactNode {
  if (outcome.ok) {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-work-ink">Sent.</p>
        <Landed verified={outcome.verified} target={target} />
        {outcome.sent.length > 0 ? (
          <p className="tw:mt-1 tw:text-ink-soft">
            {/* The argv, because "what did you actually press" is the first
                question anybody asks about a session that then did something
                surprising, and reconstructing it from prose is guesswork. */}
            Typed at the pane: <Mono>{outcome.sent.map((call) => call.join(" ")).join("  |  ")}</Mono>
          </p>
        ) : null}
        <p className="tw:mt-1 tw:text-ink-faint">
          The session's own reply lands in its terminal, not here. The list will catch up at the next collection.
        </p>
        {extra}
      </div>
    );
  }
  const said = DELIVERY_HEADLINE[outcome.delivery.kind];
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-alarm-ink">{said.head}</p>
      {said.body === null ? null : <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">{said.body}</p>}
      {/* Verbatim. Every word of this is the server's. */}
      <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        <Mono>{outcome.code}</Mono>
        {outcome.status === null ? null : (
          <>
            <span className="tw:px-1">·</span>
            <Mono>{`HTTP ${outcome.status}`}</Mono>
          </>
        )}
        <span className="tw:px-1">·</span>
        {outcome.from === "server" ? "said by the dashboard server" : "said by this browser"}
      </p>
      {extra}
    </div>
  );
}
