/**
 * The Queued ideas tab: what Greg has asked for and has not got yet.
 *
 * Greg, 2026-09-08: *"add a mode for 'Queued ideas' that shows a list of ideas
 * that will each get turned into a prompt for their own new-claude agent"*.
 *
 * ## The badge is the point of this tab, not the list
 *
 * A list of queued work is easy and not very useful. What Greg cannot see
 * anywhere else is **why each item is not moving**, and there are four different
 * answers, which the badge keeps apart:
 *
 *  - **needs you** — waiting on an answer from him. The only pile he can shift.
 *  - **proposal** — the Overseer noticed it and nobody has authorised it.
 *  - **approval lapsed** — he approved it, and it has been edited since, so the
 *    approval no longer names what the item says.
 *  - **ready** — authorised, unblocked, waiting for a slot.
 *
 * Flattening those into "blocked" would delete the tab's whole value. The
 * reasoning behind them is in
 * [`idea-queue.ts`](../../../overseer/idea-queue.ts) § three axes.
 *
 * ## The verdict is the server's, always
 *
 * `ready` and `why` arrive computed. They are `isDispatchable`, which is gate
 * 3's own test, and a second implementation of it here would be a second answer
 * to *"may this go out?"*. **Nothing in this file decides whether an item may be
 * dispatched** — it renders the sentence it is given.
 *
 * ## No forecast, and the tab says so out loud
 *
 * Greg asked for an estimate of the wait. There isn't one, deliberately, and the
 * panel prints the reason rather than leaving a gap where a number should be —
 * [`idea-queue-wait.ts`](../../../overseer/idea-queue-wait.ts) has the argument,
 * and *"a wide range does not repair a wrong estimator"* is the sentence.
 *
 * ## Read-only, and that is stated on the page
 *
 * Not because writes are unbuilt, but because the queue is an authorisation
 * record served by a process with no authentication. The footer says where to
 * write instead, so a reader who wants to reorder something is not left tapping
 * a row that does nothing.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Explain, TipCard, Tooltip, tipText, type Tip } from "./Tooltip";
import {
  badgeFor,
  depthClauses,
  httpQueueApi,
  shortId,
  type Badge,
  type QueueApi,
  type QueueView,
} from "./queue-client";
import { Card, Mono, Pill, SectionHeading, cx, toneClasses } from "./ui";
import type { Tone } from "./view";
import type { QueueRow } from "../../wire";

/** The badge's tone in the page's own colour language. A `Record`, so a fifth badge is a type error. */
const BADGE_TONE: Record<Badge["tone"], Tone> = {
  ready: "work",
  you: "needs",
  unapproved: "unknown",
  running: "work",
  settled: "idle",
  broken: "alarm",
};

const WAIT_TIP: Tip = {
  head: "Why there is no ETA",
  what: "How many items are ahead, and how many have actually gone out in the last 7 and 30 days.",
  how: "Measured on this queue's own events. A duration would need position × how long an item takes, and 'how long an item takes' is not a number this fleet has — sessions run from ten minutes to six hours, and most sessions were never queue items at all.",
};

export const HISTORY_TIP: Tip = {
  head: "History",
  what: "Every touch this item has had, in order, and who made it — added, moved, edited, approved, dispatched, settled.",
  how: "The reason the queue is an event log rather than a list: provenance is the question a Markdown table could not answer. Nothing is ever rewritten, so an approval that later lapsed is still here, above the edit that lapsed it.",
};

export const SETTLED_TIP: Tip = {
  head: "Recently settled",
  what: "Items that are finished or abandoned. They stay on the page rather than disappearing when they stop being work.",
  how: "Only the recent ones are drawn and the heading says how many older ones are not — an idea that was considered and rejected is worth more here than a gap, because otherwise the next sweep proposes it again.",
};

const APPROVAL_TIP: Tip = {
  head: "Approval names a revision",
  what: "An item approved and then edited shows as lapsed rather than staying approved.",
  how: "Your own edits re-approve as you make them; an agent's do not, so nothing can be approved small and then quietly enlarged.",
};

const PRIORITY_TIP: Tip = {
  head: "Priority",
  what: "How strongly somebody wants this item done, from 0 to 1. An em dash means nobody has ranked it.",
  how: "Higher numbers sort first, and an unranked item sorts below every ranked one. This orders the list only: it cannot authorise an item, answer Greg, or make anything dispatchable.",
};

/**
 * **A card per badge, because the badge is what this tab is for.**
 *
 * This file's own header says it: *"A list of queued work is easy and not very
 * useful. What Greg cannot see anywhere else is why each item is not moving."*
 * The badge carries that whole answer in one or two words, and until 2026-09-09
 * nothing on the page said what any of the words meant — the tab had two
 * tooltips, neither of them on a row.
 *
 * **Keyed by the visible label rather than by tone**, because two of the tones
 * carry two labels each (`settled` is both *done* and *dropped*, `unapproved`
 * is both *proposal* and *approval lapsed*) and those are exactly the pairs a
 * reader needs kept apart. That loses the compiler's exhaustiveness check, so
 * tests/fleet-queue-badge-tips.test.ts drives `badgeFor` over every state it can
 * reach and asserts each label it produces has a card here — which is a stronger
 * check than a `Record` anyway, since it also proves the state is reachable.
 *
 * Every `how` is quoted down from `tools/overseer/idea-queue.ts` or from
 * `queue-client.ts` § `badgeFor`, not written here.
 */
export const BADGE_TIPS: Record<string, Tip> = {
  ready: {
    head: "Ready",
    what: "Authorised, unblocked, and waiting only for a slot. Every item in that state wears this, not just the one at the front.",
    /* **This said the page never recomputes the verdict, and the page does.**
       `badgeFor` derives the badge here, from the item's three axes; it does
       not read `row.ready` at all. What arrives computed is the SENTENCE under
       the title, and that is the one the dispatch gate uses. GPT Sol's P0. */
    how: "Worked out on this page from the item's lifecycle, its authority, whether it is waiting on Greg, and whether the queue file itself has problems. It does not read the free-text “waiting on” field, so a ready item can still carry one. What actually decides a dispatch is the server's own verdict, which the page renders as the sentence under a title — and which is absent here precisely because there is nothing to say.",
  },
  "needs you": {
    head: "Needs you",
    /* It does NOT mean the item is otherwise clear: `badgeFor` returns this
       first, so an item that is also a proposal or lapsed wears it. Saying "not
       because it is unapproved" asserted something the badge cannot support. */
    what: "Waiting on an answer from Greg. It may be unapproved or out of turn as well — this simply outranks those, because it is the only one he can clear.",
    how: "Only he can mark it answered: noticing that something needs him is the coordinator's job, and deciding it no longer does is the answer itself. It is not the only pile that needs him — approving a proposal, or renewing a lapsed approval, is his alone as well.",
  },
  proposal: {
    head: "Proposal",
    what: "An idea the Overseer wrote down. Nobody has said it may happen.",
    how: "Authority and progress are different axes here: a proposal can sit at the very front of the queue and still not go out. It becomes real work when Greg authorises it, and only he can.",
  },
  "approval lapsed": {
    head: "Approval lapsed",
    what: "It was approved, and its words have been edited since — so the approval names something the item no longer says.",
    how: "Deliberate, and the reason an approval records a revision number rather than a yes: an agent's edit lapses it, Greg's own re-approves as he makes it. Nothing can be approved small and then quietly enlarged.",
  },
  running: {
    head: "Running",
    /* The queue records that a dispatch event was accepted. Nothing re-checks
       the session afterwards, so "is working on it now" was a claim about the
       present made from a record of the past. */
    what: "A dispatch was recorded for this item, naming a session. Open the row for the name.",
    how: "It says a dispatch happened, not that the session is still working or that anything has landed — nothing here re-checks it afterwards. The Sessions tab is what can say whether that session is alive.",
  },
  done: {
    head: "Done",
    what: "Finished and settled. Kept on the page rather than deleted, under Recently settled.",
    how: "The queue is an event log, so nothing is ever removed from it — which is what lets it answer who did what, in order, and is why a settled item still has its whole history.",
  },
  dropped: {
    head: "Dropped",
    what: "Abandoned rather than completed. The reason it was dropped is in the row when you open it.",
    how: "Also kept, for the same reason as done: an idea that was considered and rejected is worth more on the page than a gap, because otherwise the next sweep proposes it again.",
  },
  "on hold": {
    head: "On hold",
    what: "The queue file has a problem, and while it does nothing in it is dispatchable — whatever state this item is in.",
    /* **The word this card may not print is `not approved`**, and that is the
       same trap Header.tsx's freshness tip names about `STALE`: a test asserts
       that a queue held by a broken file never says those words anywhere on the
       page, because saying them is the exact misreport this badge was added to
       stop — and an explanation that quoted them would satisfy the search on
       every page and quietly retire the check. The sentence works without them;
       the check does not. Found by that test, 2026-09-09. */
    how: "It outranks the item's own reasons rather than replacing them, so an approved and unblocked item wears it too and one with its own blockers still has them. Its own count exists because without it these rows were reported as lacking approval — so a queue with one bad line accused twelve perfectly approved items.",
  },
};

/**
 * **The six things that can be wrong with the queue FILE**, as opposed to with
 * an item in it. Each is drawn as a bare word in a red card beside the server's
 * own sentence about it, and the words are the record's vocabulary rather than
 * anybody's English.
 *
 * Quoted down from where each is emitted in `tools/overseer/idea-queue.ts`.
 */
export const PROBLEM_TIPS: Record<string, Tip> = {
  "unreadable-line": {
    head: "Unreadable line",
    what: "A line of the record could not be parsed at all, so whatever it said has not been applied.",
    how: "The file is append-only and read from the top, so a line nobody can read is a hole in the middle of the history rather than a missing item at the end.",
  },
  "unknown-item": {
    head: "Unknown item",
    what: "Something happened to an item that was never added — an approval, a move or a dispatch naming an id with no beginning.",
    how: "Applied to nothing rather than guessed at. Anything that happens TO an item — an approval, a move, a dispatch — names an id that must already have been added; an `added` line is how one begins and is not this. It can mean the `added` line is elsewhere in the file and could not be read.",
  },
  "duplicate-item": {
    head: "Duplicate item",
    what: "One id was added twice. The first is kept and the second was ignored.",
    how: "Not last-one-wins: the first `added` is the one whose provenance is real, and letting a later line replace Greg's words is the one edit this file must never make silently.",
  },
  "missing-anchor": {
    head: "Missing anchor",
    what: "An item was placed before or after another one that is not in the queue, so its position could not be honoured.",
    how: "The order is a sequence of placements rather than a stored list, which is what makes two writers safe — and what makes a placement against a settled item a fault to report rather than a position to invent.",
  },
  "unauthorized-authorization": {
    head: "Unauthorised authorisation",
    what: "A line grants approval, or clears a waiting-on-Greg flag, under an actor other than Greg.",
    /* **`by` is a self-declaration, not a proven identity** — idea-queue.ts
       says so outright: any process running as this user can append `by:
       "greg"`. So this is about what the record says, never about who typed
       it, and the card must not imply the second. GPT Sol's P0. */
    how: "Checked when the record is read rather than when it is written, because a rule enforced at one entrance has an unguarded second one — the CLI and a hand-edited file both reach this file, and the dashboard cannot, being read-only. It is a governance constraint and not an OS boundary: the actor on a line is what that line claims, never proof of who wrote it.",
  },
  "illegal-transition": {
    head: "Illegal transition",
    what: "Something happened to an item in a state where it cannot happen — dispatched twice, moved after it settled, approved for a revision that has already changed.",
    how: "Reported rather than applied. A dispatch line in this file reads as permission, so the check is on the transition itself: an approval that names stale words is stale on arrival.",
  },
};

/**
 * **What each of a row's fields is, when it is opened.**
 *
 * These are the queue CLI's own flags — `--source`, `--waiting-on`, `--size`,
 * `--areas`, `--runs` — and the panel's footer tells the reader to use that CLI,
 * so the labels are spelled the way the flags are and the cards say what
 * `IdeaMetadata` says about each.
 *
 * **`source` and `plan` are two different things and the page used to conflate
 * them.** The `source` field was drawn under the label *plan*, and the real
 * `plan` field — the plan doc the dispatched session went on to write — was
 * never rendered at all. So the row named a field it was not showing and hid
 * the one the label promised. Found while writing these cards, 2026-09-09.
 */
export const FACT_TIPS: Record<string, Tip> = {
  priority: PRIORITY_TIP,
  "waiting on": {
    head: "Waiting on",
    what: "What has to happen before this can start, in the queue's own words — “a lull”, “the next gateway edit”.",
    how: "Free text and nothing acts on it: a note to a person, not a condition anything evaluates. What decides whether an item may go out is the server's dispatch verdict, printed under the title — neither this field nor the badge.",
  },
  size: {
    head: "Size",
    what: "A rough guess at how big the job is. Free text, usually something like XS or L, but nothing constrains it to those.",
    how: "A guess and never a promise, and not what the queue times itself by: sessions here run from ten minutes to six hours, which is why the panel refuses to turn a position into an ETA.",
  },
  source: {
    head: "Source",
    what: "The plan or doc that already holds the detail, repo-relative — where the idea came from.",
    how: "Ordinary metadata on the item, so an edit can change it at any time. What a dispatch recorded is the separate `plan` field below, and until 2026-09-09 this one was drawn under that name.",
  },
  plan: {
    head: "Plan",
    what: "The path that was recorded alongside this item's dispatch.",
    how: "Supplied by whoever recorded the dispatch. Nothing here checks that the file exists, or that the dispatched session is what wrote it. It appears only once something has gone out, unlike `source` above, which is set when the idea is queued.",
  },
  runs: {
    head: "Runs",
    what: "The reusable instructions the dispatched session is meant to follow, as a path.",
    how: "A path rather than a copy of the words, so editing that doc changes what the next dispatch does without anything here being rewritten.",
  },
  areas: {
    head: "Areas",
    what: "The files or directories this touches, used to write the file set into the brief the session is given.",
    how: "A declaration rather than a lock: nothing enforces it, and nothing stops a session editing outside it. It is what a brief's file set is written from.",
  },
  session: {
    head: "Session",
    what: "The session name recorded with the dispatch.",
    how: "Taken as free text rather than checked against tmux, so it is where to start looking on the Sessions tab rather than a promise that a session by that name is running. Names are reused when a session dies, so it identifies a launch at best.",
  },
};

/**
 * The card for a badge, and **the retreat when a badge arrives that this build
 * has no words for.**
 *
 * A ninth badge is a change to `badgeFor`, which is checked by a test rather
 * than by the compiler — so the possibility is real, and the failure to design
 * for would be a card asserting something about a word it does not know.
 * Instead it says that plainly and points at the sentence that IS about this
 * item, which the row draws anyway.
 */
export function badgeTip(label: string): Tip {
  return (
    BADGE_TIPS[label] ?? {
      head: label,
      what: `This build of the dashboard has no description for a “${label}” item.`,
      how: "It is a state the queue has grown since this page was built. The sentence under the title is the server's own, and it is about this item rather than about the word.",
    }
  );
}

/**
 * The whole id behind the eight characters on screen.
 *
 * The row prints `3v9879qs`; every command in the footer wants `qi-3v9879qs`,
 * and a reader who types what they can see gets an error rather than an item.
 */
function idTip(id: string): Tip {
  return {
    head: "This item's id",
    what: `In full: ${id}. The list drops the shared prefix, which is noise when every row has it.`,
    how: "It is what the queue's own commands take, so the prefix is not optional there — and it never changes, even as the item is edited, approved, dispatched and settled.",
  };
}

/** The same retreat, for a problem the queue file can have that this build cannot name. */
function problemTip(kind: string): Tip {
  return (
    PROBLEM_TIPS[kind] ?? {
      head: kind,
      what: `This build of the dashboard has no description for a “${kind}” problem.`,
      how: "The sentence beside it is the server's own account of what went wrong, and it is the one to act on.",
    }
  );
}

function Row({ row, queueHasProblems }: { row: QueueRow; queueHasProblems: boolean }): ReactNode {
  const badge = badgeFor(row, queueHasProblems);
  const tone = BADGE_TONE[badge.tone];
  const [open, setOpen] = useState(false);
  /* **`source` was labelled `plan`, and `plan` was never drawn.** Two different
     fields — where the idea came from, and the plan the dispatched session went
     on to write — and the row named one while showing the other. See
     `FACT_TIPS` above. */
  const facts: [string, string | null][] = [
    /* **The two things the badge's card cannot give a phone.** Its tooltip is
       `mouseOnly` (it lives inside this row's own button), and the row's `why`
       is null exactly when the item is ready — so without these, a sighted
       touch reader had no route to either. Rows of the same `dl` rather than a
       paragraph: this tab's complaint is length. GPT Sol's P1. */
    [badge.label, badgeTip(badge.label).what],
    ["id", row.id],
    ["priority", row.priority === null ? "unstated — below every ranked item" : String(row.priority)],
    [
      "priority set",
      row.priorityBy === null || row.priorityAt === null
        ? null
        : `set by ${row.priorityBy}, ${row.priorityAt.slice(0, 10)}`,
    ],
    ["waiting on", row.waitingOn],
    ["size", row.size],
    ["source", row.source],
    ["plan", row.plan],
    ["runs", row.runs],
    ["areas", row.areas.length === 0 ? null : row.areas.join(", ")],
    ["session", row.dispatchedTo],
  ];

  return (
    <Card className={cx("tw:mb-2 tw:border-l-4", toneClasses(tone).edge)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="tw:flex tw:w-full tw:flex-wrap tw:items-start tw:gap-2 tw:p-3 tw:text-left"
      >
        {/* **The badge, explained — this tab's own point, and the one element
            on it that had no card.**

            Not `Explain`, and both halves of why are structural. It renders a
            `<button>`, and this badge sits *inside* the row's disclosure button
            — a button in a button is invalid and reads as one control. And a
            tap here has to expand the row, so the card is `mouseOnly` for the
            same reason the dock's are: it would otherwise land over the thing
            the tap just opened.

            What a phone reader gets instead is not nothing. `row.why` under the
            title is the server's own sentence about this exact item, drawn
            always; the card adds the vocabulary behind the word, and the same
            sentence is in the row button's accessible name through the `sr-only`
            span, which is where a screen reader finds it. */}
        <Tooltip content={<TipCard tip={badgeTip(badge.label)} />} placement="bottom" mouseOnly>
          <span>
            <Pill tone={tone}>{badge.label}</Pill>
            <span className="tw:sr-only"> — {tipText(badgeTip(badge.label))}</span>
          </span>
        </Tooltip>
        <span className="tw:min-w-0 tw:flex-1 tw:text-[13px] tw:text-ink">
          {row.title ?? row.text}
          {/* **The server's sentence, verbatim.** This is the only place the
              page explains a verdict, and it is not paraphrased — a shortened
              version would be a second claim about the same thing. */}
          {row.why === null ? null : (
            <span className="tw:mt-0.5 tw:block tw:text-[12px] tw:text-ink-soft">{row.why}</span>
          )}
          {/* **Only the two arms that add something the badge did not say.**
              `needs-greg` and `not-authorized` repeat `why` above, and printing
              a reason twice makes a reader look for the difference. */}
          {row.wait.kind === "ahead" || row.wait.kind === "queue-held" ? (
            <span className="tw:mt-0.5 tw:block tw:text-[12px] tw:text-ink-faint">{row.wait.why}</span>
          ) : null}
        </span>
        {/* The full id, which is what the CLI in the footer wants — the `qi-`
            prefix is stripped on screen because it is the same on every row,
            and it is not optional in a command. `mouseOnly` and an `sr-only`
            sentence, for the same nesting and tap reasons as the badge. */}
        <Tooltip content={<TipCard tip={idTip(row.id)} />} placement="bottom" mouseOnly>
          <span>
            <Mono>{shortId(row.id)}</Mono>
            <span className="tw:sr-only"> — {tipText(idTip(row.id))}</span>
          </span>
        </Tooltip>
        {/* Priority is beside the id because both are compact ordering facts.
            This is inside the disclosure button, so its card is mouse-only and
            the opened facts repeat the value for a touch reader. */}
        <Tooltip content={<TipCard tip={PRIORITY_TIP} />} placement="bottom" mouseOnly>
          <span className={cx("tw:text-[12px]", row.priority === null ? "tw:text-ink-faint" : "tw:text-ink-soft")}>
            {row.priority === null ? "—" : row.priority}
            <span className="tw:sr-only"> — {tipText(PRIORITY_TIP)}</span>
          </span>
        </Tooltip>
      </button>

      {open ? (
        <div className="tw:border-t tw:border-rule tw:px-3 tw:pt-2 tw:pb-3">
          {/* The full text, when the row was showing only a title. */}
          {row.title === null ? null : (
            <p className="tw:mb-2 tw:text-[12px] tw:whitespace-pre-wrap tw:text-ink-soft">{row.text}</p>
          )}
          <dl className="tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1 tw:text-[12px]">
            {facts.map(([label, value]) =>
              value === null ? null : (
                <div key={label} className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
                  {/* Out here in the opened disclosure, not inside the row's
                      button, so these can be real `Explain` triggers that open
                      under a finger. */}
                  <dt className="tw:text-ink-faint">
                    {FACT_TIPS[label] === undefined ? (
                      label
                    ) : (
                      <Explain tip={FACT_TIPS[label]} placement="bottom">
                        {label}
                      </Explain>
                    )}
                  </dt>
                  <dd className="tw:min-w-0 tw:break-words tw:text-ink-soft">{value}</dd>
                </div>
              ),
            )}
            <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
              <dt className="tw:text-ink-faint">approval</dt>
              <dd className="tw:text-ink-soft">
                {row.authority === "proposed"
                  ? "none — a proposal"
                  : row.authorizedRevision === row.revision
                    ? `granted for revision ${row.revision}`
                    : `granted for revision ${row.authorizedRevision}, now at ${row.revision}`}
              </dd>
            </div>
          </dl>

          {/* **The history, because provenance is why this is an event log.**
              Who did what, in order — the question a Markdown table could not
              answer and the reason the file is shaped the way it is. */}
          <SectionHeading tip={HISTORY_TIP}>History</SectionHeading>
          <ol className="tw:space-y-0.5 tw:text-[12px]">
            {/* **Keyed on content, not on position.** A touch carries no id,
                and two of them can share a timestamp — a batch appended in one
                write does — so neither field alone is unique; all three
                together are, and unlike an array index they survive a list
                that ever gains an entry at the front. */}
            {row.history.map((touch) => (
              <li key={`${touch.at}-${touch.kind}-${touch.what}`} className="tw:flex tw:gap-2">
                <span className="tw:shrink-0 tw:text-ink-faint">{touch.by}</span>
                <span className="tw:min-w-0 tw:text-ink-soft">{touch.what}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Every kind of nothing, kept apart — the page's standing rule
 * ([fleet-dashboard-modes.md](../../../../docs/project/fleet-dashboard-modes.md)
 * § Absence is stated, never drawn).
 *
 * Five arms and each draws differently, because an empty list would read as
 * *nothing is queued* — a confident, false sentence about the record of what
 * Greg has asked for.
 */
export function QueuePanel({
  api = httpQueueApi,
  refreshNonce = 0,
}: {
  api?: QueueApi;
  /** Bumped by the dock's Refresh. The panel has its own route, so it must be told. */
  refreshNonce?: number;
}): ReactNode {
  const [view, setView] = useState<QueueView>({ kind: "loading" });

  /* `refreshNonce` is not read in the body — pressing the dock's Refresh
     changes it, which re-runs the effect, which re-reads the queue. Biome sees
     an unnecessary dependency, which is exactly what it is and exactly what is
     wanted; `DeploysPanel` says the same thing over the same line. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal — re-running when it changes is the point.
  useEffect(() => {
    let live = true;
    void api.fetch().then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [api, refreshNonce]);

  if (view.kind === "loading") {
    return <p className="tw:p-3 tw:text-[13px] tw:text-ink-faint">Reading the queue…</p>;
  }
  if (view.kind === "no-answer") {
    /* OUR voice, not the server's — the phone's network trouble must not appear
       on screen as a claim about the queue. */
    return (
      <Card className="tw:border-l-4 tw:border-l-unknown tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">This tab could not read the queue.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
      </Card>
    );
  }
  if (view.kind === "never-written") {
    return (
      <Card className="tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">Nothing has been queued here yet.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
      </Card>
    );
  }
  if (view.kind === "unreadable") {
    /* **THE LOUD ONE.** The Overseer's store may cold-start because losing it
       costs only history; this file is original human input and is not
       disposable, so it must never be drawn as a healthy empty queue. */
    return (
      <Card className="tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
        <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">The queue file could not be read.</p>
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">{view.why}</p>
        <p className="tw:mt-2 tw:text-[12px] tw:text-alarm-ink">
          This is not an empty queue — it is a queue nobody can currently read, so nothing in it should be
          dispatched until it is fixed.
        </p>
      </Card>
    );
  }

  const clauses = depthClauses(view.depth);
  const hasProblems = view.problems.length > 0;

  return (
    <div>
      {/* **PROBLEMS FIRST, ABOVE EVERYTHING.** A queue with a hole in it
          authorises nothing at all, and that outranks any individual row. */}
      {hasProblems ? (
        <Card className="tw:mb-3 tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:p-3">
          <p className="tw:text-[13px] tw:font-semibold tw:text-alarm-ink">
            {view.problems.length === 1 ? "One problem" : `${view.problems.length} problems`} in the queue file —
            nothing here is dispatchable until they are resolved.
          </p>
          <ul className="tw:mt-1 tw:space-y-0.5 tw:text-[12px] tw:text-alarm-ink">
            {/* Keyed on content, like the history: two problems of one kind
                differ only in their `why`, so the pair is what identifies one. */}
            {view.problems.map((problem) => (
              <li key={`${problem.kind}-${problem.why}`}>
                {/* The bare word is the record's vocabulary, not English, and
                    it is the loudest thing on the tab when it appears. */}
                <Explain tip={problemTip(problem.kind)} placement="bottom">
                  <span className="tw:font-semibold">{problem.kind}</span>
                </Explain>{" "}
                — {problem.why}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="tw:mb-3 tw:p-3">
        <p className="tw:text-[13px] tw:text-ink">
          {clauses.length === 0 ? "The queue is empty." : clauses.join(" · ")}
        </p>
        <Explain tip={WAIT_TIP} className="tw:mt-1 tw:block">
          <p className="tw:text-[12px] tw:text-ink-soft">
            {view.throughput.windows.map((w) => `${w.dispatched} dispatched in ${w.days}d`).join(" · ")}
          </p>
        </Explain>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">{view.throughput.duration.why}</p>
      </Card>

      {view.rows.length === 0 ? (
        <Card className="tw:p-3">
          <p className="tw:text-[13px] tw:text-ink">Nothing is waiting.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
            The queue file has been read and everything in it has been dispatched or dropped — which is not the
            same as nothing ever having been queued.
          </p>
        </Card>
      ) : (
        view.rows.map((row) => <Row key={row.id} row={row} queueHasProblems={hasProblems} />)
      )}

      {view.settled.length > 0 ? (
        <>
          <SectionHeading tip={SETTLED_TIP}>
            Recently settled{view.settledWithheld > 0 ? ` (${view.settledWithheld} older not shown)` : ""}
          </SectionHeading>
          {view.settled.map((row) => (
            <Row key={row.id} row={row} queueHasProblems={hasProblems} />
          ))}
        </>
      ) : null}

      {/* **Says where to write, so a reader who taps a row and gets nothing is
          not left guessing.** The reason it is read-only is a security one and
          it is not hidden behind a tooltip. */}
      <Explain tip={APPROVAL_TIP} className="tw:mt-4 tw:block">
        <p className="tw:px-1 tw:text-[12px] tw:text-ink-faint">
          Read-only here: the queue is what authorises work, and this dashboard has no login. Add, approve or
          reorder with <Mono>npx tsx scripts/overseer-queue.ts</Mono> — the file is <Mono>{view.path}</Mono>,
          at version <Mono>{view.version}</Mono>.
        </p>
      </Explain>
    </div>
  );
}
