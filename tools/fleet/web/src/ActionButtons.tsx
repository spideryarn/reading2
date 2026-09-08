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
 * ordered, numbered, cancellable, and carries the server's persistence warning
 * verbatim — the queue lives in the fleet server's memory and a restart
 * discards it.
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
import {
  boxActions,
  queueFor,
  sessionActions,
  type ActionOutcome,
  type ActionsApi,
  type ActionsFeed,
  type BoxOutcome,
  type ClientAction,
  type QueueItemView,
  type QueueOp,
  type QueueView,
} from "./actions-client";
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

export function ActionOutcomeCard({ outcome, onRefresh }: { outcome: ActionOutcome; onRefresh: () => void }): ReactNode {
  if (outcome.ok) {
    const head =
      outcome.kind === "queued"
        ? outcome.position === null
          ? "Queued."
          : `Queued — number ${outcome.position} in the line.`
        : outcome.kind === "delivered"
          ? "Sent now."
          : outcome.kind === "queue-changed"
            ? QUEUE_OP_HEAD[outcome.op]
            : "The server took it.";
    const body =
      outcome.kind === "queued"
        ? "It has not been sent. It goes when the session is next at a prompt, and until then it can be cancelled below."
        : outcome.kind === "delivered"
          ? "The session's own reply lands in its terminal, not here."
          : outcome.kind === "queue-changed"
            ? QUEUE_OP_BODY[outcome.op]
            : "It did not say whether that means typed at the pane or added to the queue. The queue below is what to believe.";
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-work-ink">{head}</p>
        <p className="tw:mt-1 tw:text-ink-soft">{body}</p>
        {outcome.kind === "queued" && outcome.why !== null ? (
          <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
        ) : null}
        {outcome.kind === "delivered" && outcome.sent.length > 0 ? (
          <p className="tw:mt-1 tw:text-ink-soft">
            Typed at the pane: <Mono>{outcome.sent.map((call) => call.join(" ")).join("  |  ")}</Mono>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-alarm-ink">Nothing happened.</p>
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
          <p className="tw:mt-1 tw:text-ink-soft">
            This tool runs a command. It happens whether or not the agent cooperates.
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
          <GroupHeading>Say something to it</GroupHeading>
          <p className="tw:px-1 tw:pb-1.5 tw:text-[12px] tw:text-ink-faint">
            Each of these types a sentence into its input box. The agent reads it and decides — if it ignores one,
            nothing happened.
          </p>
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {spoken.map((action) => (
              <Button key={action.id} disabled={disabled} onClick={() => press(action)}>
                {action.label}
              </Button>
            ))}
          </div>
          <TheWords actions={spoken} />
        </>
      ) : null}

      {enacted.length > 0 ? (
        <>
          <GroupHeading>Change things directly</GroupHeading>
          <p className="tw:px-1 tw:pb-1.5 tw:text-[12px] tw:text-ink-faint">
            These are not sentences. This tool runs a command — a directory deleted, a process signalled — and it
            happens whether or not the agent cooperates. Each one asks twice.
          </p>
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {enacted.map((action) => (
              <Button key={action.id} variant="danger" disabled={disabled} onClick={() => press(action)}>
                {action.label}
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

function itemLine(item: QueueItemView): { what: string; detail: string | null } {
  if (item.payload.kind === "action") {
    return { what: item.payload.label, detail: item.payload.text };
  }
  if (item.payload.kind === "message") {
    return { what: "Your message", detail: item.payload.text };
  }
  return { what: "Something this page cannot read", detail: item.payload.why };
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
                <div className="tw:mt-1">
                  <RawValue value={preview.would} depth={0} />
                </div>
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
            {preview !== null && preview.ok ? (
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
          <p className={cx("tw:font-medium", done.ok ? "tw:text-work-ink" : "tw:text-alarm-ink")}>
            {done.ok ? "Done." : "Nothing happened."}
          </p>
          {done.ok ? (
            <>
              {done.why === null ? null : <p className="tw:mt-1 tw:break-words tw:text-ink">{done.why}</p>}
              <div className="tw:mt-1">
                <RawValue value={done.would} depth={0} />
              </div>
              <p className="tw:mt-1 tw:text-ink-faint">
                What the server did, in its own words. A broadcast is a request: nothing here can prove an agent read
                it.
              </p>
            </>
          ) : (
            <>
              <p className="tw:mt-1 tw:break-words tw:text-ink">{done.why}</p>
              <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
                <Mono>{done.code}</Mono>
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
