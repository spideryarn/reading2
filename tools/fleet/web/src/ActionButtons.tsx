/**
 * The buttons, the confirmations, and the queue you can see.
 *
 * Greg, 2026-09-08: *"Add action-buttons we can take in a given Session, e.g.
 * continue, compact, pull, push, remove worktree, exit, run unix sleep for
 * 1h/3h/5h/10h, get input from Fable/GPT Sol and then use your judgment […]
 * (And ideally these would queue/steer if it's currently running, so that one
 * could press more than one, in combination with messages)"*.
 *
 * ## Three things this file is arranged around
 *
 * **1. The buttons are the vocabulary, not a picture of it.** Every one is
 * rendered from an entry the server sent (actions-client.ts § THE CATALOGUE IS
 * THE SERVER'S). There is no hand-written list anywhere in this client, which
 * is what makes it impossible for a button to exist here and not in `ACTIONS` —
 * and a button the coordinator agent cannot press is one nobody should be able
 * to press either.
 *
 * **2. Enacted actions are not siblings of spoken ones.** A spoken action is a
 * sentence: the agent reads it and decides, and if it ignores it, nothing
 * happened. `remove worktree`, `exit` and the kills delete a directory or
 * signal a process **whether or not anybody cooperates**. So they are under
 * their own heading, in the alarm colour, with their own sentence saying what
 * that class of thing does — and the colour is never the only carrier of it.
 *
 * **3. The queue is the feature, so it is on screen.** Pressing three *spoken*
 * buttons on a working session enqueues three things — an enacted one is
 * refused, see below; queue.ts's own header says a
 * queue you cannot see *"surprises you an hour later, which here means a
 * sentence arriving in a conversation that has moved on"*. So the list is
 * ordered, numbered, cancellable one at a time or all at once, and carries the
 * server's persistence warning verbatim — the queue lives in the fleet server's
 * memory and a restart discards it.
 *
 * ## What the confirmation must say, and why it is not `window.confirm`
 *
 * **The words are the product.** `actions.ts` writes each sentence to be acted
 * on by a real agent, and a confirm dialog that summarised it would be
 * approving something other than what is sent. So the confirmation shows the
 * exact text for a spoken action, and the exact `gate` — the named check that
 * runs first — for an enacted one.
 *
 * And it says the thing a person would otherwise get wrong: **on a working
 * session, an enacted action is refused, not queued and not done.** It used to
 * be queued, on the argument that ordering matters ("Push, then remove the
 * worktree" must not become the reverse); 2026-09-08 retreated from that,
 * because the thing that would deliver it is the refresh loop, and running
 * `git worktree remove` from the one loop whose failure takes the dashboard
 * down with it is worse than losing the ordering. `queue.ts`'s
 * `enacted-not-deliverable` carries the full reasoning.
 *
 * **This paragraph and the strip below it were untrue for the length of that
 * change**, which is the hazard worth naming: the sentence a page shows about
 * a rule is a second copy of the rule, and the compiler does not check prose.
 * A person who pressed Exit on a busy agent and walked away had not killed it —
 * and now has not queued it either. A page that let them believe otherwise
 * would be lying about the one class of action that cannot be undone.
 *
 * An inline strip rather than the browser's dialog: it can carry a paragraph of
 * the server's own words, it is readable on a phone, and it is in the DOM,
 * which means a test can read what a person would have read before pressing
 * yes.
 *
 * ## Nothing here decides whether a press will be allowed
 *
 * Same rule as SessionDetail's message box. This file does not reimplement
 * `steerableStatus` or `drainGate` to grey out a shell: the server's refusal
 * carries the sentence that explains it, and a second copy here would be a rule
 * to keep in step with one already written down. The only local refusal is
 * whether the row has the identifiers at all, which is a fact about the payload
 * on screen rather than a claim about the box — and it is made once, in
 * SessionDetail, and passed in.
 */
import { useCallback, useState, type ReactNode } from "react";

import { RawValue } from "./RawValue";
import { Explain } from "./Tooltip";
import {
  actingWarning,
  boxActions,
  queueFor,
  sessionActions,
  type ActionOutcome,
  type ActionsApi,
  type ActionsFeed,
  type BoxEffectReading,
  type BoxOutcome,
  type ClientAction,
  type PlanRunReading,
  type QueueItemView,
  type QueueOp,
  type QueueView,
  type StepReading,
} from "./actions-client";
import type { DeliveryReading } from "./steer-client";
import type { FleetRow } from "./types";
import { Button, Card, Mono, cx } from "./ui";

/* ------------------------------------------------------------------ *
 * Small shared pieces.
 * ------------------------------------------------------------------ */

/** A quiet heading over a group of controls. */
function GroupHeading({ children }: { children: ReactNode }): ReactNode {
  return (
    <h4 className="tw:mt-3 tw:px-1 tw:pb-1 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
      {children}
    </h4>
  );
}

/**
 * What became of a press, in the server's words.
 *
 * The three success arms are three different claims and are drawn as three
 * different sentences. `accepted` is the one that matters: the server said yes
 * and did not say whether it typed or queued, so this says exactly that and
 * points at the queue rather than picking the cheerful reading.
 */
/**
 * What each of the three queue gestures did, said without claiming anything else.
 *
 * `Record`s keyed by the union rather than a chain of ternaries, so a fourth op
 * added to `QueueOp` stops this file compiling instead of silently inheriting
 * one of these sentences. The abandon copy is the load-bearing one: it must not
 * read as "the message was not sent", because nothing knows that.
 */
const QUEUE_OP_HEAD: Record<QueueOp, string> = {
  cancelled: "Taken out of the queue.",
  revived: "Re-armed.",
  abandoned: "The lease is cleared.",
};

const QUEUE_OP_BODY: Record<QueueOp, string> = {
  cancelled: "It was never handed out for delivery, so nothing reached the session.",
  revived: "Its clock has been started again. It goes when the session is next at a prompt, which is checked about every 73 seconds.",
  abandoned:
    "That recalled nothing: if the delivery got as far as the pane, the message is in that agent's input box. What it did do is free the rest of this session's queue.",
};

/**
 * The two sentences for one successful press.
 *
 * **A `switch` with a `never` rather than the chain of ternaries this was.**
 * The chain ended in an `else` that meant `accepted`, so a fifth arm on
 * `ActionOutcome` would have inherited "The server took it." in silence —
 * which is the shape of every bug in docs/postmortems/260908b: a consumer with
 * nowhere to put a new fact, quietly rounding it to an old one. Adding
 * `queue-cleared` is exactly that fifth arm, so the chain went first.
 *
 * The cleared arm names **which item stayed, in the sentence itself**, because
 * that is the fact a person acts on: `clear()` keeps an item already leased,
 * and a card saying only "cleared" would leave them believing nothing more is
 * going out while one instruction still is.
 */
function successCopy(outcome: Extract<ActionOutcome, { ok: true }>): { head: string; body: string } {
  switch (outcome.kind) {
    case "queued":
      return {
        head: outcome.position === null ? "Queued." : `Queued — number ${outcome.position} in the line.`,
        body: "It has not been sent. It goes when the session is next at a prompt, and until then it can be cancelled below.",
      };
    case "delivered":
      return { head: "Sent now.", body: "The session's own reply lands in its terminal, not here." };
    case "queue-changed":
      return { head: QUEUE_OP_HEAD[outcome.op], body: QUEUE_OP_BODY[outcome.op] };
    case "queue-cleared": {
      const kept = outcome.keptInFlight;
      return {
        head:
          outcome.removed.length === 1
            ? "One item taken out of the queue."
            : `${outcome.removed.length} items taken out of the queue.`,
        body:
          kept === null
            ? "Nothing was on its way out, so this session's queue is now empty."
            : `One was NOT taken out, because it had already been handed over for delivery: “${itemName(kept)}”. Cancelling could not recall it and nor could this — there is no receipt for a keystroke — so treat it as sent.`,
      };
    }
    case "accepted":
      return {
        head: "The server took it.",
        body: "It did not say whether that means typed at the pane or added to the queue. The queue below is what to believe.",
      };
    default: {
      const never: never = outcome;
      return never;
    }
  }
}

/**
 * **TWO FACTS, ONE SENTENCE**, and the collapse is deliberate.
 *
 * `unknown` and `not-told` stay separate arms in `DeliveryReading` and in
 * `parseDelivery`, because they really are different things and a diagnosis
 * wants to know which. They used to get two headings here, and that was wrong
 * twice over.
 *
 *  - The `not-told` heading said *the server did not say*, which is FALSE half
 *    the time it appears: `parseDelivery` folds an absent `delivery` and a word
 *    this build does not recognise onto the same arm, so the server may well
 *    have said `"half-ish"` and been misunderstood here.
 *  - A person holding a phone does the same thing either way — go and look
 *    before pressing it again. Two headings that mean one action are a cost on
 *    a small screen, and they invite a reader to believe there is a difference
 *    to act on.
 *
 * **The distinction survives in the type, in the parse and in the tests**, and
 * it is what a later stage needs. The footer under this card — `why`, the
 * `code · HTTP nnn` line, and who said the words — separates the client-side
 * readings (`unreachable`, `not-json`, no reply at all) from a server refusal.
 * It does NOT separate an unparsable delivery word from an absent one, which is
 * exactly why the heading above it must claim neither.
 *
 * **AND IT IS NOT THE HEADING WHEN THE SERVER DESCRIBED A RUN.** Since Stage 3
 * of docs/plans/260908j, a `plan-failed` refusal carries the plan it ran, and
 * `PlanRunCard` below says which step stopped it. This copy is for the case it
 * was always for: a refusal with nothing in it but a code. See `planHeadline`.
 */
const CANNOT_TELL: { head: string; body: string } = {
  head: "This page cannot tell whether the action took effect.",
  body:
    "It may have taken effect and it may not; the words below are all there is to go on. Look before repeating it — a second press is a NEW action, not a repair of the first, and neither can be undone from here.",
};

/**
 * **WHAT A STOPPED PLAN ACTUALLY ESTABLISHED**, which is more than *we cannot
 * tell* and less than *nothing happened*.
 *
 * `steps` is the steps that RAN, so its length against the plan's is the whole
 * sentence: one of three ran, and the two after it did not. That is a fact
 * about the box, in the server's own arithmetic, and it was on the wire for the
 * life of this panel while the card above printed *this page cannot tell*.
 *
 * **It does not say what those steps DID to the box.** `worktree:check`
 * passing changed nothing, and `worktree:sweep` passing removed a directory.
 * The gate verdicts underneath are what a person reads for that, verbatim, and
 * this heading deliberately stops at *ran*.
 *
 * **Nor may the body call a step a command that exited**, which is what it said
 * until a review looked at `PlanStepView`: a spawn failure, a timeout and a
 * subprocess killed by a signal are all steps, and none of them exited. The
 * only thing true of every row is that the server reached it.
 */
function planHeadline(run: PlanRunReading): { head: string; body: string } {
  const ran = run.steps.length;
  /* `planned` is the plan's own count and `ran` is a floor under it, so a
     server that predates the field cannot make this read as *more* steps than
     it can prove. */
  const total = Math.max(ran, run.planned);
  return {
    head: run.completed ? "It ran every step, and was still refused." : `It stopped part-way: ${ran} of ${total} steps ran.`,
    body:
      "Each row below is a plan step the server reached, with the gate's own verdict. Reaching a step is not the same as a change to the box — read the verdicts before repeating this, because a second press runs the earlier steps again.",
  };
}

/** How a step ended, in a word a person can scan a list by. */
const STEP_MARK: Record<StepReading["status"], string> = {
  passed: "passed",
  failed: "STOPPED THE PLAN",
  "failed-ignored": "failed, and was allowed to",
  /* A word this build does not know. Named rather than dropped or guessed: the
     step whose status we cannot read is the one worth looking at. */
  unrecognised: "the server used a word this page does not know",
};

/** The steps the server said it ran, in order, with the gate's verdict on each. */
function PlanRunCard({ run }: { run: PlanRunReading }): ReactNode {
  return (
    <ol className="tw:mt-1 tw:space-y-1 tw:border-l tw:border-rule tw:pl-3 tw:text-[12px]">
      {run.steps.map((step, i) => (
        <li key={i} className="tw:break-words">
          <Mono>{step.argv.join(" ")}</Mono>
          <span className={cx("tw:px-1", step.status === "failed" ? "tw:font-medium tw:text-alarm-ink" : "tw:text-ink-faint")}>
            — {STEP_MARK[step.status]}
          </span>
          <span className="tw:text-ink">{step.verdict}</span>
          {step.tail === "" ? null : <div className="tw:text-ink-faint">{step.tail}</div>}
        </li>
      ))}
    </ol>
  );
}

/**
 * **WHAT A FAILED ACTION MAY BE SAID TO HAVE DONE**, which is three sentences
 * and used to be one.
 *
 * "Nothing happened." went above every failure, `from: "client"` included —
 * where the answer never came back and the request may perfectly well have
 * deleted a worktree or killed thirty processes. It is the most expensive
 * sentence on this page, because a person who reads it presses the button
 * again, and none of these actions can be taken back. **It is gone**: no
 * reading available here supports it, `none` included. See `none` below.
 *
 * A `Record` over the closed union, so a fifth arm of `DeliveryReading` fails
 * the build here rather than quietly taking the last branch — the same shape,
 * and the same reasoning, as `DELIVERY_HEADLINE` in SessionDetail.tsx.
 *
 * **The words differ from that one's on purpose and it is not a twin.** There
 * the subject is keystrokes going into an input box, and the advice is about a
 * retry appending to half-typed text. Here the subject is an action — a queue
 * gesture, a worktree removal, a kill — and there is nothing to append to, so
 * the advice is that a repeat is a fresh act rather than an addition. The TYPE
 * and the PARSE are shared, which is the part a second copy would rot.
 */
const ACTION_DELIVERY_COPY: Record<DeliveryReading["kind"], { head: string; body: string | null }> = {
  /**
   * **THIS ARM SPEAKS FOR KEYSTROKES AND MAY NEVER SPEAK FOR THE ACTION.**
   *
   * `Delivery` is minted by `fire()` in steer.ts and means one thing: what
   * became of a sequence of `tmux send-keys` calls. `none` says none of them
   * left this box. It says nothing whatever about a queue, a worktree or a
   * process — an action can be refused after its effect has already run, and a
   * route can state `none` about the keystroke half of a request that did
   * plenty besides.
   *
   * **It is also unreachable on this path today.** No `ok: false` body in
   * routes-actions.ts carries a `delivery` at all, so every action failure
   * lands on `not-told`; the fixtures below it in the tests are the only thing
   * that reaches these words. An unreachable arm making the strongest claim on
   * the page is the worst combination available, and that is what it was.
   *
   * **Do not widen this back out.** Whole-action effect is a different fact,
   * and it now has its own contract rather than borrowing this one: Stage 3 of
   * docs/plans/260908j put `run` on a `plan-failed` refusal and `effect` on a
   * box answer, and `planHeadline` above is what speaks for them. This heading
   * still describes keystrokes only, and there is still no keystroke on any
   * `ok: false` body this file's routes send — so the arm remains unreachable
   * and its claim remains the narrow one.
   */
  none: {
    head: "No keystrokes went out.",
    body:
      "That is the whole of what the server said, and it is only about keystrokes: it does not say whether the rest of the action took effect. Read its own words below before repeating it.",
  },
  /**
   * **"AND THE REST DID NOT" WAS FALSE**, and it contradicted the sentence
   * printed directly beneath it.
   *
   * `fire()` reaches `partial` down two roads and only one of them knows the
   * remainder failed. Its own `why` says "Part of the sequence arrived and the
   * rest cannot be accounted for" when `mayHaveLanded(e)`, and "and the rest
   * did not" only when it does not. So the card may assert the first clause —
   * some of it definitely happened — and must not assert the second.
   *
   * The old retry sentence was keystroke reasoning too ("acts again on whatever
   * the first one already did"), which is true of typing into a box and false
   * of a kill or a worktree removal: those do not accumulate, they simply
   * happen again.
   */
  partial: {
    head: "PART of it took effect.",
    body:
      "Some of it definitely happened and the sequence did not finish. The rest may or may not have happened as well; nothing here can tell you which. Look before repeating it — a second press is a NEW action, not a repair of the first, and neither can be undone from here.",
  },
  unknown: CANNOT_TELL,
  "not-told": CANNOT_TELL,
};

/**
 * **ONE SENTENCE PER STATE, RATHER THAN A COUNT OF THINGS THAT WENT OUT.**
 *
 * The words are the server's (`BroadcastRecipientOutcome` and
 * `KillObservation` in wire.ts) and the sentences are the ones a person acts
 * on. `keys submitted` is the ceiling on the delivery half — nothing here
 * observed a reader — and `signal accepted` is the ceiling on the kill half:
 * nothing re-read the process table, so no word below says a process died.
 *
 * A plain `Record` over strings rather than the closed unions, because
 * `StateCount.state` is a string on purpose: a word this build has not heard of
 * is counted and rendered verbatim rather than dropped, and dropping it would
 * hide exactly the rows that had changed.
 */
const BOX_STATE_COPY: Record<string, string> = {
  "would-send": "would be told",
  "keys-submitted": "keys submitted — nothing here saw them read",
  partial: "PART of the message went, and the rest is unaccounted for",
  "outcome-unknown": "may or may not have landed",
  "refused-before-effect": "refused, with nothing sent",
  held: "not at a prompt, so nothing was sent",
  blocked: "cannot be typed into, so nothing was sent",
  "not-reached": "ran out of time before this one",
  "signal-accepted": "signal accepted — not proof the process is gone",
  "signal-refused": "no such process, or not ours to signal",
  /* NOT "the kill could not be run", which this arm was called for a day. It
     also covers a `kill` that timed out and one killed by a signal, and in both
     of those the command RAN — so the summary contradicted the verdict printed
     underneath it in exactly the two cases with the least evidence behind
     them. */
  "not-established": "the signal attempt did not settle — it may have gone out and it may not",
  unstated: "the server gave no state for this one",
};

/**
 * The per-recipient / per-pid counts, and the heading that replaces "Done."
 *
 * **"Done." OVER A BROADCAST THAT HALF-LANDED IS THE DEFECT.** The old card
 * decided its heading from `dryRun` alone, so a fan-out where six of
 * thirty-six sessions were left holding half a message read exactly like one
 * where all thirty-six went out — the counts were in `RawValue` underneath,
 * where a list of thirty-six objects looks the same either way. Same for a
 * kill: `killed: [5001, 5002]` under the word "Done.".
 *
 * So the heading is a ratio and never a verdict, and `Done.` survives only for
 * an answer that carried no effect report at all.
 *
 * **EXPORTED SO A TEST CAN DRIVE IT WITH A REAL ROUTE'S BYTES**, for
 * `effectHeadline`'s reason one function down: the card that calls it is two
 * clicks deep in a DOM, and the assertion that matters here — *no sentence on
 * this list may be past tense about a process* — is about this component
 * rather than about the panel around it. A review found the accepted-state
 * sentence could be changed to "process killed" with the whole suite still
 * green, because nothing rendered the accepted state through the real one.
 */
export function BoxEffectSummary({ effect }: { effect: BoxEffectReading }): ReactNode {
  return (
    <ul className="tw:mt-1 tw:space-y-0.5 tw:text-[12px]">
      {effect.states.map((s) => (
        <li key={s.state} className="tw:break-words tw:text-ink">
          <span className="tw:font-medium">{s.count}</span> <Mono>{s.state}</Mono>
          <span className="tw:text-ink-soft"> — {BOX_STATE_COPY[s.state] ?? "this page does not know that word"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The ratio a box answer may be headed with, or null when it carried no effect
 * report.
 *
 * Exported so a test can drive it with the bytes a real handler produced. The
 * card itself is only reachable after two clicks in a DOM, and the assertion
 * that matters — *these two answers must not get the same heading* — is about
 * this function.
 */
export function effectHeadline(effect: BoxEffectReading | null): string | null {
  if (effect === null) return null;
  const of = (state: string): number => effect.states.find((s) => s.state === state)?.count ?? 0;
  if (effect.kind === "broadcast") {
    const would = of("would-send");
    if (would > 0) return `It would go to ${would} of ${effect.recipients} rows.`;
    return `Keys submitted to ${of("keys-submitted")} of ${effect.recipients} rows.`;
  }
  return `Signal accepted for ${of("signal-accepted")} of ${effect.targeted} pids.`;
}

export function ActionOutcomeCard({ outcome, onRefresh }: { outcome: ActionOutcome; onRefresh: () => void }): ReactNode {
  if (outcome.ok) {
    const { head, body } = successCopy(outcome);
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-work-ink">{head}</p>
        <p className="tw:mt-1 tw:text-ink-soft">{body}</p>
        {outcome.kind === "queued" && outcome.why !== null ? (
          <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
        ) : null}
        {/* THE RECEIPT. The queue this was read from is gone by the time this
            card is drawn, so the words that were in it are the only record left
            of what a person just destroyed. */}
        {outcome.kind === "queue-cleared" ? (
          <>
            <ul className="tw:mt-1 tw:list-disc tw:pl-5 tw:text-ink">
              {outcome.removed.map((item) => (
                <li key={item.id} className="tw:break-words">
                  {itemLine(item).what}
                  {itemLine(item).detail === null ? null : (
                    <span className="tw:text-ink-soft"> — {itemLine(item).detail}</span>
                  )}
                </li>
              ))}
            </ul>
            {outcome.unreadable > 0 ? (
              <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">
                {outcome.unreadable} more {outcome.unreadable === 1 ? "item was" : "items were"} taken out and could
                not be read, so the list above is short by that many.
              </p>
            ) : null}
          </>
        ) : null}
        {outcome.kind === "delivered" && outcome.sent.length > 0 ? (
          <p className="tw:mt-1 tw:text-ink-soft">
            Typed at the pane: <Mono>{outcome.sent.map((call) => call.join(" ")).join("  |  ")}</Mono>
          </p>
        ) : null}
      </div>
    );
  }
  /* THE SERVER'S OWN ACCOUNT WINS OVER THIS PAGE'S UNCERTAINTY. When the body
     described a run, saying *this page cannot tell* is false — it can, because
     it was told. `ACTION_DELIVERY_COPY` speaks for the refusals that carry
     nothing but a code. */
  const said = outcome.run === null ? ACTION_DELIVERY_COPY[outcome.delivery.kind] : planHeadline(outcome.run);
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-alarm-ink">{said.head}</p>
      {said.body === null ? null : <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">{said.body}</p>}
      {/* Verbatim. Every word of this is the server's. */}
      <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
      {outcome.run === null ? null : <PlanRunCard run={outcome.run} />}
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
      {outcome.status === 409 ? (
        <p className="tw:mt-2">
          <Button onClick={onRefresh}>Refresh and look again</Button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The strip that stands between a tap and the thing happening.
 *
 * It shows what will actually be sent or run — the words, or the gate — because
 * approving a summary of something is not approving it.
 */
function ConfirmStrip({
  action,
  busy,
  onYes,
  onNo,
}: {
  action: ClientAction;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}): ReactNode {
  const enacting = action.effect === "enacted";
  return (
    <div
      role="group"
      aria-label={`Confirm ${action.label}`}
      className={cx(
        "tw:mt-2 tw:rounded-lg tw:border tw:border-l-4 tw:p-3 tw:text-[13px]",
        enacting ? "tw:border-alarm/40 tw:border-l-alarm tw:bg-alarm-wash" : "tw:border-rule tw:border-l-rule-strong",
      )}
    >
      <p className={cx("tw:font-medium", enacting && "tw:text-alarm-ink")}>Confirm: {action.label}</p>

      {action.effect === "spoken" ? (
        <>
          <p className="tw:mt-1 tw:text-ink-faint">
            {action.form === "slash-command"
              ? "This is a slash command. Claude Code runs it — the agent cannot decline it."
              : "These exact words go into its input box, and the agent decides what to do with them."}
          </p>
          <p className="tw:mt-1 tw:break-words tw:text-ink">{action.text}</p>
        </>
      ) : null}

      {action.effect === "enacted" ? (
        <>
          {/* THE WARNING THAT USED TO LIVE ABOVE THE BUTTONS, permanently, on
              every session page. It belongs here: read there it qualified a
              button nobody had pressed, and read here it qualifies the one
              that is about to run. Nothing is lost — the concrete examples
              came down with it. */}
          <p className="tw:mt-1 tw:text-ink-soft">
            This is not a sentence. This tool runs a command — a directory deleted, a process signalled — and it
            happens whether or not the agent cooperates.
          </p>
          <p className="tw:mt-1 tw:text-ink-faint">What is checked first:</p>
          {/* The server's own sentence about its own gate. */}
          <p className="tw:mt-1 tw:break-words tw:text-ink">{action.gate}</p>
          {/* THE THING A PERSON WOULD OTHERWISE GET WRONG. See the header. */}
          <p className="tw:mt-1 tw:text-ink-soft">
            If this session is working, this will be refused rather than queued — nothing delivers a queued command,
            so it is turned away at the door instead of waiting for a turn that never comes. Try it again when the
            session is idle.
          </p>
        </>
      ) : null}

      {action.effect === "broadcast" ? (
        <>
          <p className="tw:mt-1 tw:text-ink-soft">
            This goes to every steerable session on the box, and each one is asked to pause for a different length of
            time so they do not all resume in the same second.
          </p>
          {action.stagger === null ? (
            <p className="tw:mt-1 tw:text-unknown-ink">
              The server did not say how the pauses are spread, so this page cannot tell you how long anybody will
              wait.
            </p>
          ) : (
            <p className="tw:mt-1 tw:text-ink">
              Between {action.stagger.minMinutes} and {action.stagger.windowMinutes} minutes each.
            </p>
          )}
        </>
      ) : null}

      <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-2">
        <Button variant={enacting ? "danger" : "loud"} disabled={busy} onClick={onYes}>
          {busy ? "Working…" : `Yes — ${action.label.toLowerCase()}`}
        </Button>
        <Button disabled={busy} onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The exact words, on the page rather than in a tooltip.
 *
 * A `<details>` because there are fifteen of them and they are paragraphs, and
 * because a tooltip cannot be the only copy of something a person is about to
 * send to a real agent. It is also the answer to *what does this button
 * actually say* without pressing it, which is the question the confirm strip
 * answers only for the ones that ask twice.
 */
function TheWords({ actions }: { actions: ClientAction[] }): ReactNode {
  const spoken = actions.filter((a): a is Extract<ClientAction, { effect: "spoken" }> => a.effect === "spoken");
  if (spoken.length === 0) return null;
  return (
    <details className="tw:mt-2">
      <summary className="tw:cursor-pointer tw:rounded-md tw:px-1 tw:py-1 tw:text-[12px] tw:text-ink-faint tw:hover:text-ink-soft">
        What each of these actually says
      </summary>
      {/* MOVED HERE FROM ABOVE THE BUTTONS, where it was a permanent paragraph
          on twenty-two pages. The heading "Ask it to…" carries the same fact —
          that these are requests an agent may decline — in three words, and
          this is where somebody reading the exact wording wants the caveat
          anyway. Fable's rule: an honest label replaces a paragraph. */}
      <p className="tw:mt-1 tw:px-1 tw:text-[12px] tw:text-ink-faint">
        Each of these types a sentence into its input box. The agent reads it and decides — if it ignores one,
        nothing happened.
      </p>
      <dl className="tw:mt-1 tw:space-y-2 tw:border-l tw:border-rule tw:pl-3">
        {spoken.map((action) => (
          <div key={action.id}>
            <dt className="tw:text-[13px] tw:font-medium">{action.label}</dt>
            <dd className="tw:text-[13px] tw:break-words tw:text-ink-soft">{action.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** An action this build cannot classify: named, explained, and not pressable. */
function Unrecognised({ actions }: { actions: ClientAction[] }): ReactNode {
  const odd = actions.filter((a) => a.effect === "unrecognised");
  if (odd.length === 0) return null;
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-unknown-ink">
        {odd.length === 1 ? "One action" : `${odd.length} actions`} this page cannot offer.
      </p>
      <p className="tw:mt-1 tw:text-ink-soft">
        The server knows about {odd.length === 1 ? "it" : "them"} and this build does not, so there is nothing here
        that can tell you what pressing {odd.length === 1 ? "it" : "them"} would do. The terminal still can.
      </p>
      <ul className="tw:mt-1 tw:space-y-1">
        {odd.map((action) => (
          <li key={action.id} className="tw:break-words">
            <Mono>{action.id}</Mono> — {action.effect === "unrecognised" ? action.why : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The line in front of a button that is going to refuse.
 *
 * **TOLD, NOT INFERRED, AND THEN READ.** `FLEET_ACT_ENABLED` is off by default,
 * so on the live page every enacted action and every broadcast answers 409
 * `acting-disabled` on the second tap. The route has always sent the flag,
 * under a comment saying the alternative is *"a person discovering it by
 * tapping and getting a 503"* — and nothing read it, so that is what the page
 * did. `actingWarning` returns the SERVER'S sentence, never one written here,
 * and returns null when the server said nothing rather than warning on silence.
 *
 * The buttons stay pressable: a dry run is not gated by the flag, and what it
 * shows is worth having even when the second tap will refuse.
 */
function ActingOff({ feed }: { feed: ActionsFeed | null }): ReactNode {
  const why = actingWarning(feed);
  if (why === null) return null;
  return (
    /* FIVE LINES OF RED BECAME ONE, AND THE FACT DID NOT MOVE. This is a
       server-wide setting rendered on every session page, so its full
       explanation — the env var, the restart, what a dry run still does — is a
       tap rather than a paragraph twenty-two times over. What stays visible is
       the part that changes what a thumb does: the buttons below say "(dry
       run)" in their own labels, which is the honest label doing the work the
       paragraph was doing. Deleting the fact would break this page's one
       non-negotiable rule; moving it behind the thing it qualifies does not. */
    <Explain
      tip={{
        head: "This server will not act",
        what: why,
        how: "A dry run still works — ask what it would do, and do it in the terminal if that is what you want. The second press, the one that would act, will be refused.",
      }}
      placement="bottom"
      className="tw:mb-1.5 tw:block tw:px-1 tw:text-[12px] tw:text-alarm-ink"
    >
      Dry runs only on this server
    </Explain>
  );
}

/**
 * The spoken vocabulary, cut into what a thumb wants first and what it does not.
 *
 * **Fifteen buttons at equal weight is a list, not a choice.** Fable's ruling,
 * 2026-09-08, from the real page at 390px: within two seconds of opening a
 * session you want to answer it, continue it, ask where it is, or wrap it up —
 * and the other ten are deliberate acts you are willing to open a disclosure
 * for. So four are visible and the rest are grouped behind *More*.
 *
 * **THE UNGROUPED GROUP IS THE POINT.** The server owns this catalogue and can
 * add to it; a client that grouped by a closed list of ids would silently drop
 * a new action it had never heard of, which is precisely the class of defect
 * this module spent 2026-09-08 removing — sixteen instances of a consumer
 * quietly not rendering what a producer sent. So anything not named below
 * lands in *Other* and is still pressable. The list is a preference, not a
 * filter.
 */
const FIRST_ROW: readonly string[] = ["continue", "report-status", "pull", "wrap-up"];
const LATER_GROUPS: readonly { name: string; ids: readonly string[] }[] = [
  { name: "Work", ids: ["push", "run-checks", "compact"] },
  { name: "Pause", ids: ["ease-off", "sleep-1h", "sleep-3h", "sleep-5h", "sleep-10h"] },
  { name: "Hand off", ids: ["ask-fable", "ask-sol", "stop-and-ask"] },
];

export function groupSpoken(spoken: ClientAction[]): {
  first: ClientAction[];
  rest: { name: string; actions: ClientAction[] }[];
} {
  const byId = new Map(spoken.map((a) => [a.id, a]));
  const taken = new Set<string>();

  const take = (ids: readonly string[]): ClientAction[] => {
    const out: ClientAction[] = [];
    for (const id of ids) {
      const action = byId.get(id);
      if (action === undefined) continue;
      out.push(action);
      taken.add(id);
    }
    return out;
  };

  const first = take(FIRST_ROW);
  const rest = LATER_GROUPS.map((g) => ({ name: g.name, actions: take(g.ids) })).filter(
    (g) => g.actions.length > 0,
  );

  // Everything the server offered that this build has never heard of. Named
  // rather than dropped; see the header.
  const other = spoken.filter((a) => !taken.has(a.id));
  if (other.length > 0) rest.push({ name: "Other", actions: other });

  // A catalogue with none of the four first-row ids in it would otherwise draw
  // an empty row above a disclosure holding everything, which reads as broken.
  if (first.length === 0 && rest.length > 0) {
    const promoted = rest[0];
    if (promoted !== undefined) return { first: promoted.actions, rest: rest.slice(1) };
  }
  return { first, rest };
}

/* ------------------------------------------------------------------ *
 * One session's actions.
 * ------------------------------------------------------------------ */

/**
 * The buttons in the detail pane, in two groups with a line drawn between them.
 *
 * `unaddressable` is SessionDetail's one local refusal, passed in rather than
 * made again: a row with no pane handle or no conversation id has nothing the
 * server could check, and saying so beats fifteen buttons that all fail.
 */
export function SessionActions({
  row,
  feed,
  api,
  asked,
  error,
  unaddressable,
  onChanged,
}: {
  row: FleetRow;
  feed: ActionsFeed | null;
  api: ActionsApi;
  /** Whether the catalogue has ever been asked for. Tells "none" from "not yet". */
  asked: boolean;
  error: string | null;
  unaddressable: string | null;
  /** Re-read the queues. Called after anything that could have changed them. */
  onChanged: () => void;
}): ReactNode {
  const [pending, setPending] = useState<ClientAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const run = useCallback(
    async (action: ClientAction): Promise<void> => {
      setBusy(true);
      const result = await api.run(row, action.id);
      setOutcome(result);
      setPending(null);
      setBusy(false);
      onChanged();
    },
    [api, onChanged, row],
  );

  const press = useCallback(
    (action: ClientAction): void => {
      if (action.effect === "unrecognised") return;
      if (action.needsConfirm) {
        setPending(action);
        return;
      }
      void run(action);
    },
    [run],
  );

  const actions = sessionActions(feed);
  const spoken = actions.filter((a) => a.effect === "spoken");
  const enacted = actions.filter((a) => a.effect === "enacted");
  const disabled = busy || unaddressable !== null;
  const grouped = groupSpoken(spoken);
  /* Read once here so the button labels and the warning above them cannot
     disagree about whether this server acts. `not-told` is not `off`: a server
     that never said has made no claim, and a "(dry run)" suffix would be one. */
  const acting = feed?.acting ?? { kind: "not-told" as const };

  /* Three empty pages, not one — the same distinction the sessions list makes.
     "Not asked yet", "asked and failed", and "asked and there are none" are
     different facts and only the last is news. */
  if (actions.length === 0) {
    return (
      <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-rule-strong tw:p-3 tw:text-[13px] tw:text-ink-soft">
        {!asked ? (
          <p>Asking the server what it can do…</p>
        ) : error !== null ? (
          <>
            <p className="tw:font-medium tw:text-alarm-ink">The list of actions could not be read.</p>
            <p className="tw:mt-1 tw:break-words tw:text-ink">{error}</p>
            <p className="tw:mt-2">
              <Button onClick={onChanged}>Try again</Button>
            </p>
          </>
        ) : feed !== null && feed.catalogue.kind === "absent" ? (
          <p>
            This server sent no list of actions at all, which is not the same as having none — it is probably older
            than this page.
          </p>
        ) : feed !== null && feed.catalogue.kind === "unreadable" ? (
          /* THE THIRD SENTENCE, and it blames this page rather than the server.
             The two-answer version of this said the server was old when the
             truth was that its catalogue had a shape this build cannot read —
             which is exactly the wrong way round for the person deciding what
             to do next. See `CatalogueReading`. */
          <p>
            This page could not read the list of actions this server sent, so it cannot say what you can do here:{" "}
            {feed.catalogue.why}
          </p>
        ) : (
          <p>This server offers no actions for a session.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {feed !== null && feed.unreadableActions > 0 ? (
        <p className="tw:mb-2 tw:text-[13px] tw:text-alarm-ink">
          {feed.unreadableActions} action{feed.unreadableActions === 1 ? "" : "s"} in the server's list could not be
          read, so {feed.unreadableActions === 1 ? "it is" : "they are"} missing from everything below.
        </p>
      ) : null}

      {spoken.length > 0 ? (
        <>
          {/* NO HEADING HERE. There used to be one — "Say something to it" —
              nested inside a section of the same name, and then repeated 300px
              lower over the composer, so the page said the same four words
              about two different things. The section heading above this
              component is the only one. Fable, 2026-09-08: the single most
              confusing thing on the page, and it costs nothing to remove. */}
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {grouped.first.map((action) => (
              <Button key={action.id} disabled={disabled} onClick={() => press(action)}>
                {action.label}
              </Button>
            ))}
          </div>
          {grouped.rest.length === 0 ? null : (
            <details className="tw:mt-2">
              <summary className="tw:cursor-pointer tw:rounded-md tw:px-1 tw:py-1 tw:text-[13px] tw:text-ink-soft tw:hover:text-ink">
                More ({grouped.rest.reduce((n, g) => n + g.actions.length, 0)})
              </summary>
              <div className="tw:mt-1 tw:space-y-2 tw:border-l tw:border-rule tw:pl-3">
                {grouped.rest.map((group) => (
                  <div key={group.name}>
                    <p className="tw:pb-1 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
                      {group.name}
                    </p>
                    <div className="tw:flex tw:flex-wrap tw:gap-1.5">
                      {group.actions.map((action) => (
                        <Button key={action.id} disabled={disabled} onClick={() => press(action)}>
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {/* OUTSIDE THE DISCLOSURE, not inside it. Fable put it at the bottom
              of "More", which is right when More holds ten buttons — but a
              server offering only two or three actions has no More at all, and
              nesting it there made "what each of these actually says"
              unreachable exactly when the catalogue was small. That is the
              shape of every bug in this module's postmortem: a thing that
              renders in the case you looked at and not in the case you did
              not. */}
          <TheWords actions={spoken} />
        </>
      ) : null}

      {enacted.length > 0 ? (
        <>
          {/* "FORCE", NOT "CHANGE THINGS DIRECTLY". One word carries what a
              paragraph was carrying, and the paragraph itself — "these are not
              sentences, this tool runs a command, each one asks twice" — has
              moved to ConfirmStrip, which is the moment it changes what
              somebody does. Read here it is a warning about a button you have
              not pressed; read there it is a warning about the one you have. */}
          <GroupHeading>Force</GroupHeading>
          <ActingOff feed={feed} />
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {enacted.map((action) => (
              <Button key={action.id} variant="danger" disabled={disabled} onClick={() => press(action)}>
                {action.label}
                {acting.kind === "off" ? " (dry run)" : ""}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      <Unrecognised actions={actions} />

      {pending === null ? null : (
        <ConfirmStrip action={pending} busy={busy} onYes={() => void run(pending)} onNo={() => setPending(null)} />
      )}

      {outcome === null ? null : <ActionOutcomeCard outcome={outcome} onRefresh={onChanged} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The queue.
 * ------------------------------------------------------------------ */

/**
 * Who put this in the queue, as a sentence — or null when it was Greg, which is
 * the unremarkable case, and when the server did not say.
 *
 * **The words it will actually arrive with.** The server prefixes a spoken item
 * at delivery with a line naming its sender, so an item queued by an automated
 * coordinator is going to reach that agent announcing itself as one. Showing it
 * here means the person holding the Cancel button is reading the same thing the
 * agent will.
 *
 * Silence is not an accusation: a server that sent no `speaker` gets no
 * sentence, exactly as `stale` and `stuck` get no claim made for them.
 */
function queuedBy(item: QueueItemView): string | null {
  return item.speaker === "overseer" ? "Queued by the Overseer, an automated coordinator — it will arrive saying so." : null;
}

function itemLine(item: QueueItemView): { what: string; detail: string | null } {
  if (item.payload.kind === "action") {
    return { what: item.payload.label, detail: item.payload.text };
  }
  if (item.payload.kind === "message") {
    // NOT "Your message" WHEN IT IS NOT YOURS. The queue is one ordered list per
    // session and anything that can reach the route can add to it, so the
    // possessive was a claim this page had no basis for the moment a coordinator
    // could queue anything.
    return { what: item.speaker === "overseer" ? "A message" : "Your message", detail: item.payload.text };
  }
  return { what: "Something this page cannot read", detail: item.payload.why };
}

/**
 * One item named inside a sentence, rather than drawn as a row.
 *
 * **`what` alone will not do here.** Every queued message renders as *"Your
 * message"*, so a sentence saying *"this one stays: Your message"* over a queue
 * that held three of them identifies nothing — and the sentence exists
 * precisely so a person knows WHICH instruction is still on its way out. The
 * words are what tell them apart, so the words are in it.
 */
function itemName(item: QueueItemView): string {
  const line = itemLine(item);
  return line.detail === null ? line.what : `${line.what} — ${line.detail}`;
}

/**
 * WHAT THIS ITEM'S STATE IS, IN ONE ORDERED ANSWER.
 *
 * Four of the five states are things the queue has decided and sent — the page
 * reads them and never recomputes one — and the order is the whole point: they
 * can be true at once, and a reader believes the reassuring one. `noteGeneration`
 * deliberately leaves a leased item alone, so *dead* and *going out* co-occur;
 * a `stale` item that the server has also marked would be offered a re-arm that
 * cannot help. So the strongest, most permanent claim wins.
 *
 * `stale` and `stuck` arrive as `boolean | null`; **only `=== true` counts**,
 * because a server too old to send the field made no claim and this page must
 * not make one for it.
 */
type ItemState = "dead" | "stuck" | "stale" | "going" | "waiting";

function itemState(item: QueueItemView): ItemState {
  if (item.invalidated !== null) return "dead";
  if (item.stuck === true) return "stuck";
  if (item.stale === true) return "stale";
  if (item.leasedAt !== null) return "going";
  return "waiting";
}

/**
 * One waiting item, and the two ways out of a queue that has jammed.
 *
 * **A leased item says it is going now and offers Cancel anyway.** Whether a
 * lease can still be cancelled is the server's rule, not this page's, and the
 * client must not reimplement it — but the person deserves to know that the
 * keystrokes may already have left, because "cancelled" and "cancelled in time"
 * are different things and there is no receipt for a keystroke.
 *
 * **STUCK AND STALE ARE HERE BECAUSE THE PRODUCT COULD REACH THEM AND OFFERED
 * NOTHING** (GPT Sol's D2 and D4, 2026-09-08). A stale item was drawn as one
 * waiting its turn under copy promising delivery; a lease the delivery module
 * threw out of was drawn as "Being delivered now" for ever, blocking everything
 * behind it, while `cancel()` refused it and `clear()` kept it. Each now says
 * what it is and carries the one gesture that moves it.
 *
 * **Abandoning asks twice, and the second question is the honest warning.** It
 * clears the dashboard's lease and does nothing whatever to the pane: the
 * keystrokes may have gone out, and drain.ts leaves the lease open precisely
 * because nothing here can tell.
 */
function QueueItem({
  item,
  index,
  busy,
  onCancel,
  onRevive,
  onAbandon,
}: {
  item: QueueItemView;
  index: number;
  busy: boolean;
  onCancel: () => void;
  onRevive: () => void;
  onAbandon: () => void;
}): ReactNode {
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const line = itemLine(item);
  const state = itemState(item);
  return (
    <li className={cx("tw:mt-1.5 tw:rounded-lg tw:border tw:border-rule tw:p-2.5", state === "going" && "tw:bg-work-wash")}>
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
        <span className="tw:font-mono tw:text-[12px] tw:text-ink-faint">{index + 1}.</span>
        <span className="tw:min-w-0 tw:flex-1 tw:text-[13px] tw:font-medium tw:break-words">{line.what}</span>
        {state === "stale" ? (
          <Button disabled={busy} onClick={onRevive}>
            Send it anyway
          </Button>
        ) : null}
        {state === "stuck" && !confirmingAbandon ? (
          <Button disabled={busy} onClick={() => setConfirmingAbandon(true)}>
            Abandon it
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {line.detail === null ? null : (
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-soft">{line.detail}</p>
      )}
      {queuedBy(item) === null ? null : <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-faint">{queuedBy(item)}</p>}
      {/*
        ONE SENTENCE, CHOSEN BY `itemState`. The alarm colour on the two that
        mean an instruction is not going anywhere — the honest reading is that
        it is lost, and the queue keeps it only so the reason can be read.
      */}
      {state === "dead" ? (
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-alarm-ink">
          This will not be delivered. {item.invalidated}
        </p>
      ) : state === "stuck" ? (
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-alarm-ink">
          Handed out for delivery and never confirmed. Nothing else in this queue can go out until it is cleared.
        </p>
      ) : state === "stale" ? (
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-alarm-ink">
          This has waited too long to be sent unasked, so nothing is going to deliver it. Send it anyway starts its
          clock again — it then goes when the session is next at a prompt, which is checked about every 73 seconds.
        </p>
      ) : state === "going" ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-work-ink">
          Being delivered now. Cancelling may not recall it — there is no receipt for a keystroke.
        </p>
      ) : null}
      {state === "stuck" && confirmingAbandon ? (
        <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-2.5">
          <p className="tw:text-[12px] tw:break-words tw:text-ink">
            Abandoning this does not recall a keystroke. Nothing here can tell whether the delivery died before the
            keys went out or after, so the message may already be in that agent&apos;s input box. All this does is
            clear the dashboard&apos;s record of it, so the rest of the queue can move.
          </p>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-1.5">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirmingAbandon(false);
                onAbandon();
              }}
            >
              Yes, abandon it
            </Button>
            <Button disabled={busy} onClick={() => setConfirmingAbandon(false)}>
              Keep waiting
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * One session's queue, or the reason there is nothing to show.
 *
 * The persistence warning is the server's own string and is drawn on every
 * non-empty queue. queue.ts: *"a page that renders the queue without showing
 * that is a bug"* — quiet loss is exactly the failure silent-success.md is
 * about, and a queue that vanished when somebody restarted the dashboard would
 * otherwise look like a queue that drained.
 *
 * **Clear the queue is the fourth gesture and the only destructive one**, and it
 * is here because `SteeringQueue.clear()` was written, bounded and tested and no
 * route or button could reach it — instance 9 of docs/postmortems/260908b,
 * *"`revive()`'s shape exactly"*. It has the treatment every destructive thing
 * in this file has: a preview naming what would go, no Confirm when the page
 * cannot say what would go, and — the part specific to this one — a sentence
 * naming what would NOT go. See `pendingClear`.
 */
export function SessionQueue({
  sessionId,
  feed,
  api,
  asked,
  error,
  onChanged,
}: {
  sessionId: string;
  feed: ActionsFeed | null;
  api: ActionsApi;
  asked: boolean;
  error: string | null;
  onChanged: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  /**
   * **WHAT THE PERSON IS LOOKING AT, FROZEN AT THE TAP** — or null when nobody
   * has asked to clear anything.
   *
   * Held rather than recomputed from `queue` on every render, and that is the
   * safety property rather than a rendering preference. This panel is on a poll:
   * a list computed live would change under somebody mid-read, and they would
   * then confirm the destruction of a list they had not seen — which is the one
   * thing a bulk delete must not do. So the ids sent are the ids drawn, and if
   * the queue has moved on the server refuses `stale-view` and says to look
   * again. A refusal is the correct outcome there; a silent best effort is not.
   *
   * `unreadable` rides along because it is a fact about the same reading: a
   * queue holding items this page could not parse cannot be previewed honestly,
   * and the strip then withholds Confirm entirely.
   */
  const [pendingClear, setPendingClear] = useState<{
    drop: QueueItemView[];
    keep: QueueItemView[];
    unreadable: number;
  } | null>(null);
  const queue = queueFor(feed, sessionId);

  /**
   * The three gestures that change something already in the queue.
   *
   * One function taking the call, rather than three near-copies: the busy flag,
   * the outcome card and the re-read after are the same in every case, and the
   * only thing that differs is which of the server's routes is asked. `cancel`
   * keeps its own name at the call sites for readability.
   */
  const act = useCallback(
    async (call: (sessionId: string, itemId: string) => Promise<ActionOutcome>, itemId: string): Promise<void> => {
      setBusy(true);
      const result = await call(sessionId, itemId);
      setOutcome(result);
      setBusy(false);
      onChanged();
    },
    [onChanged, sessionId],
  );
  const cancel = useCallback((itemId: string) => act(api.cancel, itemId), [act, api]);
  const revive = useCallback((itemId: string) => act(api.revive, itemId), [act, api]);
  const abandon = useCallback((itemId: string) => act(api.abandon, itemId), [act, api]);

  const clear = useCallback(
    async (itemIds: readonly string[]): Promise<void> => {
      setBusy(true);
      const result = await api.clear(sessionId, itemIds);
      setOutcome(result);
      setBusy(false);
      setPendingClear(null);
      onChanged();
    },
    [api, onChanged, sessionId],
  );

  /* BEFORE THE EMPTY-QUEUE SENTENCE, because it is a different fact. A queue
     whose item list this page could not read is not a queue with nothing in it,
     and "Nothing is waiting." is the most reassuring thing this panel can say —
     so it must never be what an unreadable payload produces. See
     `QueueView.itemsUnreadable`. */
  if (queue !== null && queue.itemsUnreadable) {
    return (
      <p className="tw:text-[13px] tw:text-alarm-ink">
        This server sent a queue for this session with no list of items this page can read, so nothing here can
        say what is waiting. That is not the same as nothing waiting — treat it as unknown, and look at the
        session before sending anything that depends on order.
      </p>
    );
  }

  if (queue === null || queue.items.length === 0) {
    return (
      <p className="tw:text-[13px] tw:text-ink-soft">
        {!asked
          ? "Asking what is waiting…"
          : error !== null
            ? `The queue could not be read: ${error}`
            : feed !== null && !feed.queuesOffered
              ? "This server sent no queues at all, which is not the same as having none — it is probably older than this page."
              : /* The cadence in seconds rather than "a minute or so": the pass
                   that drains this runs after each collection, which is ~73
                   seconds apart and not 60 (tools/fleet/drain.ts). Vague here
                   is what makes somebody press Queue and then watch. */
                "Nothing is waiting. A message or a spoken action pressed while it is working queues up here, and goes out once it is back at a prompt — checked about every 73 seconds."}
      </p>
    );
  }

  return (
    <div>
      <ol>
        {queue.items.map((item, index) => (
          <QueueItem
            key={item.id}
            item={item}
            index={index}
            busy={busy}
            onCancel={() => void cancel(item.id)}
            onRevive={() => void revive(item.id)}
            onAbandon={() => void abandon(item.id)}
          />
        ))}
      </ol>
      {queue.unreadableItems > 0 ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">
          {queue.unreadableItems} more {queue.unreadableItems === 1 ? "item is" : "items are"} in this queue and could
          not be read, so the list above is short by that many.
        </p>
      ) : null}

      {/*
        EMPTYING THE WHOLE QUEUE, WHICH IS DESTRUCTIVE AND GETS THE HOUSE
        TREATMENT FOR THAT: a preview of what would go, named, and no Confirm at
        all when the page cannot say what would go — the same shape as
        `BoxActions` in front of a kill, for the same reason.

        Offered only when something is actually droppable. A leased item is not,
        and a queue holding nothing but one of those has a per-item Abandon
        instead: a "Clear" that removed nothing would be a button whose only
        possible outcome is a refusal.
      */}
      {queue.items.some((i) => i.leasedAt === null) && pendingClear === null ? (
        <p className="tw:mt-2">
          <Button
            disabled={busy}
            onClick={() =>
              setPendingClear({
                drop: queue.items.filter((i) => i.leasedAt === null),
                keep: queue.items.filter((i) => i.leasedAt !== null),
                unreadable: queue.unreadableItems,
              })
            }
          >
            Clear the queue
          </Button>
        </p>
      ) : null}

      {pendingClear === null ? null : (
        <div
          role="group"
          aria-label="Confirm clearing the queue"
          className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3 tw:text-[13px]"
        >
          <p className="tw:font-medium tw:text-alarm-ink">
            {pendingClear.drop.length === 1
              ? "Take this one thing out of the queue?"
              : `Take these ${pendingClear.drop.length} things out of the queue?`}
          </p>
          <ul className="tw:mt-1 tw:list-disc tw:pl-5 tw:text-ink">
            {pendingClear.drop.map((item) => (
              <li key={item.id} className="tw:break-words">
                {itemLine(item).what}
                {itemLine(item).detail === null ? null : <span className="tw:text-ink-soft"> — {itemLine(item).detail}</span>}
              </li>
            ))}
          </ul>
          {/*
            **WHAT WILL NOT GO IS AS LOAD-BEARING AS WHAT WILL.** `clear()` keeps
            an item already handed over for delivery, on purpose: the keystrokes
            may be on their way and there is no receipt for a keystroke. A
            confirmation that listed only the casualties would be read as "the
            queue will be empty afterwards", which would be false in exactly the
            case that matters.
          */}
          {pendingClear.keep.map((item) => (
            <p key={item.id} className="tw:mt-1 tw:break-words tw:text-ink">
              This one stays, because it has already been handed over for delivery: “{itemName(item)}”. Nothing here
              can recall it.
            </p>
          ))}
          {/*
            THE EMPTY-PREVIEW CASE, COPIED FROM `BoxActions` RATHER THAN
            REINVENTED. A queue with items this page could not read cannot be
            previewed, and a Confirm over a partial list would destroy things
            that were never on screen.
          */}
          {pendingClear.unreadable > 0 ? (
            <p className="tw:mt-2 tw:font-medium tw:text-alarm-ink">
              {pendingClear.unreadable} {pendingClear.unreadable === 1 ? "item in this queue is" : "items in this queue are"}{" "}
              unreadable by this page, so the list above is not what would go and there is no Confirm below. Cancel
              them one at a time, or restart the dashboard server, which discards every queue.
            </p>
          ) : null}
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-1.5">
            {pendingClear.unreadable > 0 ? null : (
              <Button variant="danger" disabled={busy} onClick={() => void clear(pendingClear.drop.map((i) => i.id))}>
                {busy ? "Working…" : "Yes, clear them"}
              </Button>
            )}
            <Button disabled={busy} onClick={() => setPendingClear(null)}>
              Keep them
            </Button>
          </div>
        </div>
      )}
      {/* The server's own sentence about its own volatility. */}
      <p className="tw:mt-2 tw:text-[12px] tw:break-words tw:text-ink-faint">{queue.warning}</p>
      {outcome === null ? null : <ActionOutcomeCard outcome={outcome} onRefresh={onChanged} />}
    </div>
  );
}

/**
 * Every queue on the box, in one place.
 *
 * This is the coordinator's-eye view and it is real, which is why it is on the
 * Orchestrator tab: the thing that tab was missing was not a mock of a
 * decision log, it was *what is about to be said to whom*. `titles` maps a tmux
 * handle to the session's title where the latest snapshot has one; a queue
 * whose session is not in the snapshot is still drawn, because an item waiting
 * for a session nobody can see is the most interesting one on the page.
 */
export function FleetQueues({
  feed,
  api,
  asked,
  error,
  titles,
  onChanged,
}: {
  feed: ActionsFeed | null;
  api: ActionsApi;
  asked: boolean;
  error: string | null;
  titles: Map<string, string>;
  onChanged: () => void;
}): ReactNode {
  const queues: QueueView[] = (feed?.queues ?? []).filter((q) => q.items.length > 0);
  const total = queues.reduce((n, q) => n + q.items.length, 0);

  if (queues.length === 0) {
    return (
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        {!asked
          ? "Asking what is waiting…"
          : error !== null
            ? `The queues could not be read: ${error}`
            : feed !== null && !feed.queuesOffered
              ? "This server sent no queues at all, which is not the same as having none."
              : "Nothing is waiting anywhere on the box."}
      </p>
    );
  }

  return (
    <div>
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        {total} {total === 1 ? "thing is" : "things are"} waiting, across {queues.length}{" "}
        {queues.length === 1 ? "session" : "sessions"}. None of it has been sent yet.
      </p>
      {queues.map((queue) => (
        <div key={queue.sessionId} className="tw:mt-3">
          <h3 className="tw:text-[13px] tw:font-medium tw:break-words">
            {titles.get(queue.sessionId) ?? "a session not in the latest snapshot"}{" "}
            <Mono>{queue.sessionId}</Mono>
          </h3>
          <SessionQueue
            sessionId={queue.sessionId}
            feed={feed}
            api={api}
            asked={asked}
            error={error}
            onChanged={onChanged}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The box.
 * ------------------------------------------------------------------ */

/**
 * What a box action would do, before it does it.
 *
 * **The dry run is not a nicety, it is the confirmation.** *"Kill what is
 * safe"* is a sentence about a rule; what a person needs before pressing yes is
 * the list of processes it matched on this box a second ago. So pressing a box
 * button asks the server *what would you kill* and shows the answer, and only
 * then offers to do it.
 *
 * **A dry run that failed offers no Confirm.** The direction doc's own line:
 * *"Where a choice is between 'correct and unavailable' and 'plausible and up',
 * take the first: being down is recoverable in one command, and being
 * confidently wrong is not."* The fallback is `ssh` and `gjd-remote`, and it is
 * complete.
 *
 * And `dryRun` is read off the ANSWER. A server that ignored the flag would
 * otherwise be reported here as having answered a question when it had killed
 * seventeen processes.
 */
export function BoxActions({
  feed,
  api,
  asked,
  error,
  onChanged,
}: {
  feed: ActionsFeed | null;
  api: ActionsApi;
  asked: boolean;
  error: string | null;
  onChanged: () => void;
}): ReactNode {
  const [pending, setPending] = useState<ClientAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BoxOutcome | null>(null);
  const [done, setDone] = useState<BoxOutcome | null>(null);

  const actions = boxActions(feed);

  const press = useCallback(
    async (action: ClientAction): Promise<void> => {
      setPending(action);
      setPreview(null);
      setDone(null);
      setBusy(true);
      setPreview(await api.box(action.id, true));
      setBusy(false);
    },
    [api],
  );

  const commit = useCallback(
    async (action: ClientAction): Promise<void> => {
      setBusy(true);
      const result = await api.box(action.id, false);
      setDone(result);
      setPending(null);
      setPreview(null);
      setBusy(false);
      onChanged();
    },
    [api, onChanged],
  );

  if (actions.length === 0) {
    return (
      <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-rule-strong tw:p-3 tw:text-[13px] tw:text-ink-soft">
        {!asked ? (
          <p>Asking the server what it can do to the box…</p>
        ) : error !== null ? (
          <>
            <p className="tw:font-medium tw:text-alarm-ink">The list of actions could not be read.</p>
            <p className="tw:mt-1 tw:break-words tw:text-ink">{error}</p>
            <p className="tw:mt-2">
              <Button onClick={onChanged}>Try again</Button>
            </p>
          </>
        ) : (
          <p>This server offers nothing that acts on the box.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="tw:px-1 tw:pb-1.5 tw:text-[12px] tw:text-ink-faint">
        Every one of these asks the box what it <em>would</em> do first, and shows you that answer before it does
        anything.
      </p>
      <ActingOff feed={feed} />
      <div className="tw:flex tw:flex-wrap tw:gap-1.5">
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={action.effect === "enacted" ? "danger" : "quiet"}
            disabled={busy || action.effect === "unrecognised"}
            onClick={() => void press(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <Unrecognised actions={actions} />

      {pending === null ? null : (
        <div
          role="group"
          aria-label={`Confirm ${pending.label}`}
          className={cx(
            "tw:mt-2 tw:rounded-lg tw:border tw:border-l-4 tw:p-3 tw:text-[13px]",
            pending.effect === "enacted"
              ? "tw:border-alarm/40 tw:border-l-alarm tw:bg-alarm-wash"
              : "tw:border-rule tw:border-l-rule-strong",
          )}
        >
          <p className={cx("tw:font-medium", pending.effect === "enacted" && "tw:text-alarm-ink")}>
            Confirm: {pending.label}
          </p>
          <p className="tw:mt-1 tw:text-ink-soft">{pending.summary}</p>
          {pending.effect === "enacted" ? (
            <>
              <p className="tw:mt-1 tw:text-ink-faint">What is checked first:</p>
              <p className="tw:mt-1 tw:break-words tw:text-ink">{pending.gate}</p>
            </>
          ) : null}
          {pending.effect === "broadcast" ? (
            <p className="tw:mt-1 tw:text-ink-soft">
              A sentence to every steerable session, each asked to pause for a different length of time
              {pending.stagger === null
                ? ", though the server did not say how they are spread"
                : ` — between ${pending.stagger.minMinutes} and ${pending.stagger.windowMinutes} minutes`}
              . Nothing here can prove an agent read it, let alone obeyed it.
            </p>
          ) : null}

          <div className="tw:mt-2 tw:rounded-md tw:border tw:border-rule tw:p-2.5">
            <p className="tw:text-[12px] tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
              What it would do
            </p>
            {busy && preview === null ? (
              <p className="tw:mt-1 tw:text-ink-soft">Asking…</p>
            ) : preview === null ? (
              <p className="tw:mt-1 tw:text-ink-soft">Nothing asked yet.</p>
            ) : preview.ok ? (
              <>
                {!preview.dryRunStated ? (
                  <p className="tw:mt-1 tw:text-unknown-ink">
                    The server did not say whether that was a dry run, so this page cannot promise nothing has already
                    happened.
                  </p>
                ) : !preview.dryRun ? (
                  <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
                    The server says that was NOT a dry run. It was asked for one. Treat this as already done and check
                    the box.
                  </p>
                ) : null}
                {preview.why === null ? null : <p className="tw:mt-1 tw:break-words tw:text-ink">{preview.why}</p>}
                {/*
                  **A CONFIRMATION THAT CANNOT SAY WHAT IT WOULD DO MUST NOT
                  LOOK LIKE ONE THAT CAN.** For the life of this panel the
                  server sent no field of this name and `RawValue` drew the
                  literal grey word "null" — an answer, in the same type as a
                  real preview, in front of `kill-test-suites`. So the empty
                  case is now a sentence in the alarm colour that names what is
                  missing, and it is deliberately NOT filled in from anything
                  this page could guess.
                */}
                {preview.result === null || preview.result === undefined ? (
                  <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
                    This server did not say what it would destroy, so there is no Confirm below — the terminal and{" "}
                    <Mono>gjd-remote</Mono> can still do it.
                  </p>
                ) : (
                  <>
                    {/* The same counts as the answer card, so the two read
                        alike and the promise can be compared with the receipt
                        row for row. */}
                    {preview.effect === null ? null : <BoxEffectSummary effect={preview.effect} />}
                    <div className="tw:mt-1">
                      <RawValue value={preview.result} depth={0} />
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">It could not tell you.</p>
                <p className="tw:mt-1 tw:break-words tw:text-ink">{preview.why}</p>
                <p className="tw:mt-1 tw:text-ink-soft">
                  So there is no Confirm below. Doing this without knowing what it would touch is the one thing worth
                  refusing — the terminal and <Mono>gjd-remote</Mono> can still do it.
                </p>
              </>
            )}
          </div>

          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-2">
            {/*
              **A DRY RUN THAT SAID NOTHING IS NOT A DRY RUN**, and it gets the
              same treatment as one that failed: no Confirm. The rule above is
              this file's own — "doing this without knowing what it would touch
              is the one thing worth refusing" — and an `ok` answer with no
              `result` in it leaves the person exactly as uninformed, while
              looking like an answer. Every arm of the route fills `result`, so
              this is unreachable against a server of this vintage; it is the
              honest reading of an older one.
            */}
            {preview !== null && preview.ok && preview.result !== null && preview.result !== undefined ? (
              <Button
                variant={pending.effect === "enacted" ? "danger" : "loud"}
                disabled={busy}
                onClick={() => void commit(pending)}
              >
                {busy ? "Working…" : `Yes — ${pending.label.toLowerCase()}`}
              </Button>
            ) : null}
            <Button
              disabled={busy}
              onClick={() => {
                setPending(null);
                setPreview(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {done === null ? null : (
        <div
          className={cx(
            "tw:mt-2 tw:rounded-lg tw:border tw:p-3 tw:text-[13px]",
            done.ok ? "tw:border-work/40 tw:bg-work-wash" : "tw:border-alarm/40 tw:bg-alarm-wash",
          )}
        >
          {/*
            "Done." IS A CLAIM, AND IT IS THE SERVER'S TO MAKE. A server that
            answered the second tap with a dry run has done nothing, and saying
            "Done." over that is the reassuring half of a contradiction — the
            same defect § Stage v0.5f names for "Queued." over a cancel. The
            answer's own `dryRun` decides; a server that did not say gets the
            heading that does not know.

            **AND SO IS "Nothing happened."**, which is the failure half of the
            same rule and was exempt from it until 2026-09-08. This is the panel
            with `kill` on it: a second tap whose reply never came back may have
            ended thirty processes, and the page said the opposite. The sentence
            is now gone from every arm — `ACTION_DELIVERY_COPY`, above, and its
            comments say why no reading here can support it.
          */}
          {/*
            **AND "Done." IS A CLAIM ABOUT EVERY RECIPIENT AND EVERY PID**,
            which is the third of these. `effectHeadline` turns the answer's own
            per-row states into a ratio, so a fan-out that reached three of five
            cannot be headed with the same word as one that reached five. Plain
            "Done." survives only for an answer that carried no effect report.
          */}
          <p className={cx("tw:font-medium", done.ok ? "tw:text-work-ink" : "tw:text-alarm-ink")}>
            {!done.ok
              ? done.run === null
                ? ACTION_DELIVERY_COPY[done.delivery.kind].head
                : planHeadline(done.run).head
              : !done.dryRunStated
                ? "The server answered."
                : done.dryRun
                  ? "Nothing was done."
                  : (effectHeadline(done.effect) ?? "Done.")}
          </p>
          {done.ok ? (
            <>
              {done.dryRunStated && done.dryRun ? (
                <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
                  It answered with a dry run, so this is still only what it WOULD do. Nothing on the box has changed.
                </p>
              ) : !done.dryRunStated ? (
                <p className="tw:mt-1 tw:text-unknown-ink">
                  It did not say whether that was a dry run, so this page cannot tell you whether anything happened.
                </p>
              ) : null}
              {done.why === null ? null : <p className="tw:mt-1 tw:break-words tw:text-ink">{done.why}</p>}
              {/* THE COUNTS ABOVE THE DUMP, not instead of it: `RawValue` still
                  draws every field the server sent, including the ones this
                  page has no schema for. */}
              {done.effect === null ? null : <BoxEffectSummary effect={done.effect} />}
              {done.result === null || done.result === undefined ? (
                <p className="tw:mt-1 tw:text-ink-soft">It said nothing about what it touched.</p>
              ) : (
                <div className="tw:mt-1">
                  <RawValue value={done.result} depth={0} />
                </div>
              )}
              <p className="tw:mt-1 tw:text-ink-faint">
                What the server did, in its own words. A broadcast is a request: nothing here can prove an agent read
                it.
              </p>
            </>
          ) : (
            <>
              {(done.run === null ? ACTION_DELIVERY_COPY[done.delivery.kind].body : planHeadline(done.run).body) === null ? null : (
                <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
                  {done.run === null ? ACTION_DELIVERY_COPY[done.delivery.kind].body : planHeadline(done.run).body}
                </p>
              )}
              <p className="tw:mt-1 tw:break-words tw:text-ink">{done.why}</p>
              {done.run === null ? null : <PlanRunCard run={done.run} />}
              {/* THE STATUS BELONGS HERE TOO. The session card has always shown
                  it and this one did not, and the difference matters now that
                  `unknown` and `not-told` share one heading: this line is where
                  a person finds out which situation they are in. "HTTP 500,
                  said by this browser" is an answer that came back unreadable;
                  no status at all is a request whose answer never came. */}
              <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
                <Mono>{done.code}</Mono>
                {done.status === null ? null : (
                  <>
                    <span className="tw:px-1">·</span>
                    <Mono>{`HTTP ${done.status}`}</Mono>
                  </>
                )}
                <span className="tw:px-1">·</span>
                {done.from === "server" ? "said by the dashboard server" : "said by this browser"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A card wrapper, so the two panels that use `BoxActions` agree without copying. */
export function BoxActionsCard(props: Parameters<typeof BoxActions>[0]): ReactNode {
  return (
    <Card className="tw:mt-3 tw:p-4">
      <h2 className="tw:font-medium">Act on the box</h2>
      <div className="tw:mt-2">
        <BoxActions {...props} />
      </div>
    </Card>
  );
}
