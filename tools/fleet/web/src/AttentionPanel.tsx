/**
 * **WHAT NEEDS GREG**, above the session list — the Overseer's ranked inbox.
 *
 * ## Why this exists at all
 *
 * `needs-you` on a session card means *Claude Code says a dialog is open*, and
 * that is the cheapest thing on the box. Measured on the live fleet 2026-09-08:
 * of fifteen sessions genuinely waiting on Greg, **ten had ended their turn
 * handing him a decision in sentences and not one of them showed as needing
 * him** — the decisions end in full stops, so a grep for question marks found 1
 * of 23. The list this panel draws is produced by `tools/overseer/attention.ts`,
 * which reads turn tails and judges them. This file renders that judgement and
 * makes none of its own.
 *
 * ## The three agreements it holds, so they survive the conversation
 *
 * **(a) No answer control, on any card, in v1.** Tapping a card SELECTS the
 * session and the existing `SessionDetail` machinery does the answering — there
 * is no new write path here. A `prose` item is INFERRED from a pane tail, and
 * the producer's own `readTurnTail` bug proved a card could quote *Greg's own
 * last message* back as an agent's question; a button beside that would have
 * acted on his own sentence. `dialog` items are mechanical rather than inferred,
 * but they get the same treatment: one rule is one thing to reason about, and
 * the detail pane already draws the dialog with its material beside it, which is
 * the thing an answer must never be given without.
 *
 * **(b) The producer sorts and this must not re-sort.** `AttentionList.items`
 * arrives ordered by consequence and then by how long it has waited. Two halves
 * that both sort are two halves that disagree about what is at the top, and the
 * half with the model calls is the one that can see why.
 *
 * **(c) `sessionsUnreadable` renders only when non-zero, and reads as a FLOOR.**
 * *"At least 4 need you … (1 could not be judged, so there may be more)"* — a
 * sentence and its retraction in the same block is worse than either. It counts
 * sessions we TRIED to judge and could not; a session correctly skipped never
 * lands there, which is what keeps the caveat off almost every pass.
 *
 * **On an EMPTY list the same field replaces the sentence instead of qualifying
 * it**, because there is no list of cards for the floor to be a floor of — the
 * whole output is one reassuring sentence, and a caveat under a sentence is
 * read as the sentence. That branch was written before this agreement and did
 * not look at the field at all; GPT Sol's C1, 2026-09-08.
 *
 * ## The rule every line here is measured against
 *
 * Fable's, 2026-09-08: *a caveat stays on screen only if it would change what
 * you do on this screen in the next ten seconds. If it only changes what you
 * would believe, it lives one tap away, attached to the fact it qualifies.*
 *
 * So the scan's age is on screen — the pass runs every two minutes and costs
 * model calls, and a list that stopped being produced looks exactly like a calm
 * fleet — and the floor caveat is on screen, and everything else is in an
 * `Explain`.
 *
 * ## `not-asked` draws nothing, and nothing else does
 *
 * The distinction this panel exists to keep. *No checkpoint has been published
 * here* is news; *this server did not look* is not a fact about the box at all.
 * Neither may ever render as an empty inbox — see `AttentionFeed` in wire.ts,
 * which argues it at the type, and `AttentionView` in types.ts for the fifth
 * state, which is a fact about the payload rather than about the box.
 *
 * ## An empty list consumes BOTH clocks, and a stale one wins
 *
 * `published` means published at some time, not currently, and there are two
 * clocks behind it that fail independently: `coordinatorWrittenAt` says whether
 * the Overseer is still checkpointing (every ~30s) and `list.scannedAt` says
 * whether the attention pass is still running (every ~2 min). So "nothing is
 * waiting on you" is only worth saying when both are fresh — otherwise the
 * staleness **replaces** it rather than sitting beside it, because a reassuring
 * sentence with a caveat under it is read as the sentence.
 */
import type { ReactNode } from "react";

import { Explain } from "./Tooltip";
import type { AttentionItem, AttentionKind, AttentionList, AttentionView } from "./types";
import { Card, SectionHeading, cx } from "./ui";
import { formatDuration } from "./view";

/**
 * When each of the two clocks has been silent long enough to mean something.
 *
 * The cadences are the Overseer's — `TICK_MS` 30s and `ATTENTION_INTERVAL_MS`
 * 120s in tools/overseer/daemon.ts — and they are restated here rather than
 * imported, for the reason the whole client restates the server's contract:
 * daemon.ts is a node module and this file is compiled under DOM-only libs.
 *
 * **Generous on purpose, and wrong in the safe direction.** A restart, a slow
 * tick or a box under load must not put a warning on a healthy page — that is
 * A17, healthy operation spending most of its time alarming — so each threshold
 * is several missed cycles rather than one: ten missed checkpoint ticks, three
 * missed passes. If the Overseer's cadence changes and these do not, the page
 * nags slightly late rather than lying.
 */
const CHECKPOINT_STALE_MS = 5 * 60_000;
const SCAN_STALE_MS = 6 * 60_000;

/**
 * What a `kind` means, in the reader's words rather than the producer's.
 *
 * A `Record` keyed by the kind rather than a `switch`, for the reason
 * `TONE_CLASSES` in ui.tsx is one: a fifth kind is then a type error here rather
 * than a quiet fall-through to the mildest label on screen.
 *
 * **It is consequence, not urgency and not confidence** — the type says so, and
 * the tips say so too, because "irreversible" reads as *panic* unless somebody
 * tells you it means *cannot be undone once done*.
 */
const KINDS: Record<AttentionKind, { label: string; what: string; loud: boolean }> = {
  irreversible: {
    label: "irreversible",
    what: "Doing it cannot be undone — a delete, a deploy, a send.",
    loud: true,
  },
  product: { label: "product", what: "A decision about what the thing should be, not about how to build it.", loud: false },
  technical: { label: "technical", what: "A decision about how to build it.", loud: false },
  other: { label: "other", what: "None of the three above fitted.", loud: false },
};

/**
 * How old something is, or null when its timestamp is not one this page can use.
 *
 * **A TIMESTAMP IN THE FUTURE IS UNREADABLE, NOT FRESH.** It used to be
 * `Math.max(0, now − parsed)`, so a `scannedAt` ahead of `now` read as "0s ago"
 * — and went on reading as 0s ago for exactly as long as the fault lasted. That
 * suppresses the staleness branch below, and an empty list with a suppressed
 * staleness branch is the permanently calm fleet this whole panel exists to
 * prevent. `null` is the honest answer and the loud one: every caller treats an
 * age it cannot compute as stale, because an age nobody can compute is not
 * evidence of freshness. GPT Sol's C2, 2026-09-08 — the client half. The server
 * half is the coherence check in tools/fleet/attention.ts.
 *
 * **THE CLOCK-SKEW WINDOW IS GONE, AND ITS DELETION IS THE POINT OF v0.4j.**
 * This carried a flat `CLOCK_SKEW_MS = 2 * 60_000`, added an hour before the
 * stage that removed it, because these two timestamps came off two different
 * clocks — the box's and the phone's — so a phone three minutes fast made a
 * live inbox unreadable. That is fixed where it belongs: every server timestamp
 * is converted into this browser's terms at the parse boundary (types.ts §
 * `ClockSkew`), so both numbers below are readings of ONE clock and a
 * `scannedAt` genuinely ahead of now means a broken clock rather than an
 * ordinary phone.
 *
 * **AND IT IS MEASURED AGAINST AN ANCHOR, NOT AGAINST A TOLERANCE.** `asOf` is
 * `Math.max(now, receivedAt)` — a browser-clock reading that cannot be older
 * than the payload it is judging. What stood here instead was a
 * `RENDER_SLACK_MS = 5_000`, justified by `useNow` ticking once a second, and
 * **that reasoning was wrong at any value**: a phone in a pocket has its timers
 * throttled and then suspended, and iOS hands the tab back by starting a
 * refresh immediately — so a payload can be judged against a `now` that is
 * minutes old, and a blocked main thread does the same without any tab
 * switching. Five seconds turned a checkpoint written the instant it was served
 * into *"the Overseer stopped checkpointing at a time this page could not
 * read"*, which is the alarm-a-clock-manufactures failure one clock further in.
 * GPT Sol's K2, 2026-09-08. **Do not reintroduce a constant here**: the tick is
 * not the bound, and there is no bound.
 *
 * The anchor is sound because every corrected timestamp is at most the moment
 * the payload arrived: `servedAt` is later than everything the payload carries,
 * and the shift maps `servedAt` onto `receivedAt`. So a value still ahead of
 * `asOf` is a clock that is genuinely wrong, and it is `null` — still loud, and
 * still the honest answer.
 */
function ageMs(at: string, asOf: number): number | null {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  const age = asOf - parsed;
  return age < 0 ? null : age;
}

/**
 * A quiet one-line state, with the detail one tap away.
 *
 * Every arm of this panel that is NOT a list of cards renders through here, so
 * they cannot drift apart into four different sizes of apology.
 */
function Note({
  head,
  what,
  how,
  loud = false,
  children,
}: {
  head: string;
  what: string;
  how: string;
  loud?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <p className="tw:px-1 tw:pt-4 tw:pb-1">
      <Explain
        tip={{ head, what, how }}
        placement="bottom"
        className={cx("tw:text-[13px]", loud ? "tw:font-medium tw:text-alarm-ink" : "tw:text-ink-faint")}
      >
        {children}
      </Explain>
    </p>
  );
}

export function AttentionPanel({
  attention,
  now,
  receivedAt,
  onSelect,
}: {
  attention: AttentionView;
  /** The page's one clock. Every age on screen agrees because they all read this. */
  now: number;
  /**
   * When this browser received the payload these timestamps came out of, by its
   * own clock — `null` before the first one has arrived, in which case there is
   * nothing on this panel to age anyway.
   *
   * It is the other half of the anchor above, and it is what makes the ages
   * here immune to a page whose clock has been asleep. Passed in rather than
   * stamped here: this component re-renders on every tick and would stamp a
   * fresh receipt each time, which is a receipt of nothing.
   *
   * This is `useFleetState`'s stamp, which is a React render LATER than the one
   * the skew was measured against inside `fetchFleetState` — and later is the
   * safe direction, because the anchor only has to be no earlier than the
   * payload it judges. transport.ts says why the two are separate.
   */
  receivedAt: number | null;
  /**
   * Pick a session. The SAME callback `App.tsx` threads to `SessionsPanel`, on
   * purpose: this panel adds a way IN to the session that already exists, and
   * not a second way to act on it. Agreement (a).
   */
  onSelect: (id: string) => void;
}): ReactNode {
  /* ONE ANCHOR FOR THE WHOLE PANEL, computed here rather than in `ageMs`, so
     that the checkpoint's clock and the list's cannot be judged against two
     different readings of ours. See `ageMs`. */
  const asOf = receivedAt === null ? now : Math.max(now, receivedAt);
  /* NOTHING AT ALL. `not-asked` means this server did not look — there is no
     fact to report, so there is no line, not even a quiet one. A page that drew
     "the coordinator is not running" here would be inventing an observation on
     behalf of a server that predates the field. */
  if (attention.kind === "not-asked") return null;

  if (attention.kind === "checkpoint-absent") {
    return (
      <Note
        head="No inbox has been published"
        /* NOT "the coordinator is not running", which is a claim the evidence
           does not support: an absent file proves only that nothing has been
           published AT THE PATH WE LOOKED AT. The Overseer may be starting, may
           have failed before its first write, may be pointed at another store.
           Same discipline as `Pause`'s `none`. */
        what="No Overseer checkpoint has been published here."
        how="The ranked list of what needs you is produced by the Overseer and published to its store directory. There is nothing at that path, so this page has nothing to show — which is NOT the same as nothing needing you. Any session below may be waiting on you with nothing watching."
      >
        no Overseer checkpoint has been published here
      </Note>
    );
  }

  if (attention.kind === "checkpoint-unreadable") {
    return (
      <Note
        head="The inbox could not be read"
        /* **NOT "a checkpoint is there and could not be read"**, which was a
           claim this arm cannot support. Only `ENOENT` establishes that nothing
           has been published; a permissions failure, a bad store path, an EIO —
           and a store directory that could not be resolved at all — land HERE,
           and in every one of those we never found out whether a checkpoint
           exists. So the sentence covers both *it is there and would not parse*
           and *we could not establish whether it is there*. GPT Sol's C3,
           2026-09-08; tools/fleet/attention.ts holds the other end. */
        what="A checkpoint could not be read here — either one is there and would not parse, or whether one is there could not be established."
        /* The `why` one tap away rather than on screen: it is a file path and a
           parser's sentence, and it changes what you would BELIEVE about the
           quiet rather than what you would do in the next ten seconds. The
           caveat itself — that the quiet is not evidence — is the visible half. */
        how={attention.why}
      >
        the inbox could not be read here
      </Note>
    );
  }

  if (attention.kind === "feed-unreadable") {
    return (
      <Note
        head="This page could not read the inbox"
        /* A fact about the payload, not about the box — which is why it does not
           say the coordinator is down and does not say nothing needs you. It
           means this build and this server have come apart, and the usual cause
           is a tab iOS kept alive across a deploy. */
        what="The server sent an inbox this build cannot read."
        how={`${attention.why}. That is this page being older or newer than the server rather than anything about the fleet — reload it. Until then nothing here can be concluded about what needs you.`}
      >
        this page could not read the inbox
      </Note>
    );
  }

  return (
    <Published list={attention.list} writtenAt={attention.coordinatorWrittenAt} asOf={asOf} onSelect={onSelect} />
  );
}

function Published({
  list,
  writtenAt,
  asOf,
  onSelect,
}: {
  list: AttentionList;
  /** The CHECKPOINT's clock. A different failure from the list's — see the header. */
  writtenAt: string;
  /** What every age here is measured against. `ageMs` says why it is not `now`. */
  asOf: number;
  onSelect: (id: string) => void;
}): ReactNode {
  if (list.kind === "unknown") {
    /* **THE `why` IS ON SCREEN HERE, and one tap away everywhere else on this
       panel.** That is not an inconsistency, it is Fable's rule applied: a
       caveat stays visible only if it would change what you do in the next ten
       seconds.

       `unknown` arrives from three genuinely different places — no pass has run
       in this Overseer yet, a pass ran and failed, or a stored list came back
       unreadable — and the producer keeps them as ONE arm on purpose, because
       what it means is *nobody can tell you*. Splitting it here would put the
       same reasoning in two places. But the three differ in what you do about
       them: "no pass has run yet" means wait, "the gateway returned 429" means
       go and look. So the producer's own sentence is the line, rather than a
       label with the sentence behind a disclosure.

       No age on this arm, deliberately. `scannedAt` on an `unknown` list can be
       the instant the CHECKPOINT was written rather than the instant anything
       was looked at — the store's `attentionNotYetRun` says so in as many
       words — so "scanned 4s ago" here would be a freshness nobody measured. */
    return (
      <p className="tw:px-1 tw:pt-4 tw:pb-1 tw:text-[13px] tw:text-ink-faint">
        no ranked list: {list.why}
      </p>
    );
  }

  const scanned = ageMs(list.scannedAt, asOf);
  const written = ageMs(writtenAt, asOf);
  /* ON SCREEN, ALWAYS, for a list. The pass runs about every two minutes and
     costs model calls, so a list that quietly stopped being produced looks
     exactly like a calm fleet — and that is the one failure this panel must not
     hide. It passes the ten-second test: a twenty-minute-old list is one you go
     and look at the sessions yourself about. */
  const age = scanned === null ? "scanned at a time this page could not read" : `scanned ${formatDuration(scanned)} ago`;

  /* **TWO CLOCKS, AND THEY FAIL INDEPENDENTLY.** `writtenAt` moves on every
     Overseer tick and `scannedAt` only when the paid pass runs, so a stopped
     daemon and a stopped pass are different faults with different fixes — and a
     panel that read only one of them would call the other one calm. A clock
     that cannot be parsed counts as stale, because an age nobody can compute is
     not evidence of freshness. */
  const stale =
    written === null || written > CHECKPOINT_STALE_MS
      ? {
          what: "The Overseer has not written a checkpoint recently.",
          line: `the Overseer stopped checkpointing ${written === null ? "at a time this page could not read" : formatDuration(written)} ago`,
          how: "The daemon rewrites its checkpoint every 30 seconds or so, whether or not the attention pass has run. This one has not moved, so nothing here is current and the fleet may have changed under it.",
        }
      : scanned === null || scanned > SCAN_STALE_MS
        ? {
            what: "The attention pass has not run recently.",
            line: `the attention pass last ran ${scanned === null ? "at a time this page could not read" : formatDuration(scanned)} ago`,
            how: "The Overseer is still checkpointing, so the daemon is alive — it is the pass that judges the fleet that has stopped, and it costs model calls, so a rate limit or a gateway failure is the usual reason. Nothing below is current.",
          }
        : null;

  /* THE POSITIVE CONTROL, and it is the field's own word for itself. Zero items
     out of zero sessions scanned proves the pass RAN and proves nothing about
     whether it JUDGED anything — a 429 from the gateway publishes exactly this
     with every count green. So it is a broken probe rather than a calm fleet,
     and it says so loudly. Drawn whenever the count is zero, above whatever
     items did arrive, rather than instead of them. */
  const brokenProbe =
    list.sessionsScanned === 0 ? (
      <Note
        head="The probe looked at nothing"
        what="This pass scanned zero sessions."
        how="The number of sessions scanned is the positive control: it proves the walk happened, and zero means it did not. So this is a broken probe rather than a quiet fleet, and nothing can be concluded from it about what needs you."
        loud
      >
        broken probe — nothing was scanned ({age})
      </Note>
    ) : null;

  if (list.items.length === 0) {
    if (brokenProbe !== null) return brokenProbe;
    /* **A STALE CLOCK REPLACES THE REASSURANCE RATHER THAN QUALIFYING IT.**
       "Nothing is waiting on you" with a caveat under it is read as "nothing is
       waiting on you"; the caveat is what a reader skips. And `published` means
       published at SOME time, not currently — so an empty list is only news
       about the box while both clocks are still moving. */
    if (stale !== null) {
      return (
        <Note head="Nothing to conclude" what={stale.what} how={stale.how} loud>
          {stale.line} — nothing here says whether anything needs you
        </Note>
      );
    }
    /* **AND SO DOES AN INCOMPLETE PASS, for exactly the same reason.**
       Agreement (c) — the count reads as a floor when something could not be
       judged — was implemented for the items-present branch only, and this
       branch never looked at `sessionsUnreadable` at all: `{items: [],
       sessionsScanned: 32, sessionsUnreadable: 1}` drew *"nothing is waiting on
       you · 32 sessions"*, asserting a calm fleet over a pass that failed to
       judge one of them. That is the one claim the floor caveat exists to
       withhold, made in the one branch nobody wrote it for. GPT Sol's C1,
       2026-09-08.

       It REPLACES the reassurance rather than qualifying it, like the stale
       branch above and for the same finding: "nothing is waiting on you" with a
       caveat underneath is read as "nothing is waiting on you". Not `loud` —
       this is a true and useful reading (*we judged thirty-one and none of them
       needs you*), unlike a stale clock, which is a reading of nothing.

       Both parsers refuse a list whose unreadable count exceeds its scanned
       count, so the subtraction cannot print a negative. */
    if (list.sessionsUnreadable > 0) {
      const judged = list.sessionsScanned - list.sessionsUnreadable;
      return (
        <Note
          head="Nothing among the ones we could judge"
          what={`None of the ${judged} sessions this pass could judge is waiting on you — ${age}.`}
          how={`The pass looked at ${list.sessionsScanned} sessions and could not judge ${list.sessionsUnreadable} of them — a pane that would not parse, a gateway that refused, a tail the budget did not reach. So this is not "nothing needs you": any of those ${list.sessionsUnreadable} may be waiting on you, and the sessions below are where you would look.`}
        >
          nothing among the {judged} we could judge is waiting on you · {list.sessionsUnreadable} of{" "}
          {list.sessionsScanned} could not be judged · {age}
        </Note>
      );
    }
    return (
      <Note
        head="Nothing waiting"
        what={`Nothing is waiting on you — ${age}.`}
        how={`The coordinator read ${list.sessionsScanned} sessions on that pass and judged that none of them is handing you a decision. It runs about every two minutes, so the age above is how far behind this can be.`}
      >
        {/* BOTH NUMBERS, ALWAYS. "Nothing needs you" out of 32 sessions and
            "nothing needs you" out of 2 are different facts, and the count is
            what tells them apart. */}
        nothing is waiting on you · {list.sessionsScanned} sessions {age}
      </Note>
    );
  }

  /* AGREEMENT (c): the count reads as a floor when anything could not be
     judged, and the retraction is a separate quiet line rather than a clause
     inside the headline. `sessionsUnreadable` counts sessions we TRIED to judge
     and could not — never one we correctly skipped — so this is off on almost
     every pass, which is what keeps it from becoming wallpaper. */
  const floor = list.sessionsUnreadable > 0;

  return (
    <section>
      <SectionHeading>
        {floor ? "at least " : ""}
        {list.items.length} waiting on you · {age}
      </SectionHeading>

      {brokenProbe}

      {/* Loud, and above the cards. A stale list with items on it is worse than
          a stale empty one, not better: every card here may have been answered
          twenty minutes ago, and acting on one is the expensive mistake. */}
      {stale !== null ? (
        <Note head="These may be out of date" what={stale.what} how={stale.how} loud>
          {stale.line}
        </Note>
      ) : null}

      {floor ? (
        <p className="tw:px-1 tw:pb-2 tw:text-[12px] tw:text-ink-faint">
          {list.sessionsUnreadable} of {list.sessionsScanned} could not be judged, so there may be more.
        </p>
      ) : null}

      {/* IN THE PRODUCER'S ORDER. No sort, no filter, no re-rank — agreement
          (b), and the half with the model calls is the half that can see why
          one of these matters more than another. */}
      {list.items.map((item) => (
        <AttentionCard key={item.id} item={item} asOf={asOf} onSelect={onSelect} />
      ))}
    </section>
  );
}

/**
 * One thing waiting on Greg.
 *
 * The card is the control — `session-card` and `session-open` in tailwind.css
 * are the stretched-link pattern, so the whole card is a thumb-sized tap target
 * without wrapping it in a `<button>` that would nest the `Explain` triggers
 * inside another button. It **selects** the session; it does not answer it.
 */
function AttentionCard({
  item,
  asOf,
  onSelect,
}: {
  item: AttentionItem;
  /** What the wait is measured against. `ageMs` says why it is not `now`. */
  asOf: number;
  onSelect: (id: string) => void;
}): ReactNode {
  const kind = KINDS[item.kind];
  const waited = ageMs(item.waitingSince, asOf);
  return (
    <Card className={cx("session-card tw:mb-2 tw:border-l-4 tw:p-3", kind.loud ? "tw:border-l-alarm" : "tw:border-l-needs")}>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
        <Explain
          tip={{
            head: `A ${kind.label} decision`,
            what: kind.what,
            how: "This is about CONSEQUENCE, not urgency and not how sure we are. It is what the ordering above is built on, so the irreversible ones come first whatever else is older.",
          }}
          placement="bottom"
          className={cx(
            "tw:text-[11px] tw:font-semibold tw:tracking-wide tw:uppercase",
            kind.loud ? "tw:text-alarm-ink" : "tw:text-ink-faint",
          )}
        >
          {kind.label}
        </Explain>
        <span className="tw:ml-auto tw:text-[12px] tw:text-ink-faint">
          {/* SINCE WE FIRST SAW IT, not since we last saw it — the field's own
              contract, and the difference is the whole point of a card that has
              been sitting there for two hours. */}
          {waited === null ? "waiting, since when is unreadable" : `waiting ${formatDuration(waited)}`}
        </span>
      </div>

      <h3 className="tw:mt-1.5 tw:leading-snug tw:font-medium tw:break-words">
        <button type="button" className="session-open" onClick={() => onSelect(item.sessionId)}>
          {item.sessionName}
        </button>
      </h3>

      <Evidence item={item} />

      {/* Only when answering it from here is not a real option. `phone` and
          `unknown` draw nothing: the first changes nothing and the second would
          be a caveat about our own instrumentation on every card, which is the
          wallpaper PauseLine.tsx measured and refuses. */}
      {item.answerability.kind === "needs-a-screen" ? (
        <Explain
          tip={{
            head: "Not one for a phone",
            what: item.answerability.why,
            how: "You can still open the session from here — this only says that deciding it probably needs a screen in front of you.",
          }}
          placement="bottom"
          className="tw:mt-2 tw:block tw:text-[12px] tw:text-ink-faint"
        >
          needs a screen
        </Explain>
      ) : null}

      {/* The producer collapses identical questions across sessions, so a card
          with duplicates stands for more than one waiting agent. Saying nothing
          would under-count the fleet on the one screen that is meant to say how
          much is waiting. */}
      {item.duplicates.length > 0 ? (
        <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
          {item.duplicates.length === 1 ? "1 other session is" : `${item.duplicates.length} other sessions are`} asking
          the same thing: {item.duplicates.map((d) => d.sessionName).join(", ")}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * WHY WE BELIEVE THIS NEEDS GREG, and the two arms are answered by different
 * mechanisms — which is why they do not look the same.
 *
 * `dialog` is observed: the harness says a dialog is open and these are its
 * options, drawn **as text**. They are not buttons, by agreement (a): the
 * detail pane is where a dialog is answered, because that is where the material
 * being approved is drawn beside it.
 *
 * ## The prose arm is `why` first and `excerpt` behind a disclosure
 *
 * **This is the opposite of how it was first built, and live data decided it.**
 * The first version put the excerpt in the flow and the `why` one tap away. On
 * 2026-09-08 the real list carried two `prose` items whose excerpts were 1,116
 * and 1,736 characters — 17 and 21 lines, one of them a table of process states
 * with its wrapped lines intact. Rendered unbounded, one card is 21 lines tall
 * on a 390px phone and the second item is off the bottom of the screen.
 *
 * The `why` is one human-written sentence and it is what a person acts on:
 * *"The agent says the stack is idle and explicitly waits for the person to say
 * whether it should shut down."* The excerpt is what they check the inference
 * AGAINST — it changes what you would believe rather than what you would do in
 * the next ten seconds, which is Fable's rule for putting something a tap away.
 *
 * It is terminal output, so it opens into a `<pre>` with its whitespace intact
 * and its own scrollbars — `max-h-72 overflow-auto`, the same treatment
 * `Material` in SessionParts.tsx gives an approval diff. A wrapped mangle of a
 * table is worse than not showing it, and a page that scrolls sideways is worse
 * than a card that does.
 */
function Evidence({ item }: { item: AttentionItem }): ReactNode {
  if (item.evidence.kind === "dialog") {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-needs/40 tw:bg-needs-wash tw:p-3">
        <p className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-needs-ink tw:uppercase">Asking</p>
        <p className="tw:mt-1 tw:break-words tw:whitespace-pre-wrap">{item.evidence.question}</p>
        {item.evidence.options.length === 0 ? (
          <p className="tw:mt-2 tw:text-[12px] tw:text-ink-soft">No options could be read off the pane.</p>
        ) : (
          <ul className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
            {item.evidence.options.map((option, i) => (
              <li key={`${i}-${option}`} className="tw:break-words">
                {option}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const lines = item.evidence.excerpt.split("\n").length;
  return (
    <div className="tw:mt-2">
      {/* The headline: one sentence, the producer's own, and the thing a person
          acts on. Never truncated — it is a sentence, not a transcript. */}
      <p className="tw:text-[13px] tw:break-words tw:text-ink">{item.evidence.why}</p>
      {/* A `<details>` rather than a tooltip: the card holds terminal output
          measured at up to 1,736 characters, and a floating panel is the wrong
          container for something you scroll. The idiom is the one
          SessionDetail.tsx and ActionButtons.tsx already use.

          **`attention-evidence` IS LOAD-BEARING AND IS NOT STYLING.** The card is
          a stretched link — `.session-open::after` covers it edge to edge — and a
          positioned overlay paints above in-flow content whatever the DOM order
          says. Without the lift this whole disclosure was UNREACHABLE BY TAP OR
          CLICK: measured 2026-09-08 in Chrome on the box, `elementFromPoint` at
          every corner and the centre of the summary returned `button.session-open`,
          Playwright refused the click as intercepted, and a real wheel over the
          opened `<pre>` left `scrollTop` at 0. Only Tab+Enter worked, which a
          phone does not have — and the phone is what this is for. See the rule in
          tailwind.css beside `.explain`, which is lifted for the same reason. */}
      <details className="attention-evidence tw:mt-1">
        <summary className="tw:cursor-pointer tw:rounded-md tw:px-1 tw:py-1 tw:text-[12px] tw:text-ink-faint tw:hover:text-ink-soft">
          inferred from its last turn — show the last {lines} line{lines === 1 ? "" : "s"} of its screen
        </summary>
        {/* **NOT LABELLED AS A QUOTATION, and that is a live defect being worked
            around rather than a nicety.** The producer picks this text BY
            POSITION in the pane, not by whether it contains the sentence the
            `why` is about — so on the first real pass, 2026-09-08, one of two
            items had a table of process states as the "evidence" for a claim
            about what its agent said. Its `why` was correct.

            An unlabelled excerpt that does not contain the relevant sentence
            teaches a reader to distrust a `why` that was right, which costs
            more than showing nothing would. So this says what it actually is.
            No hedge goes on the `why` itself: the `why` is not the unreliable
            half. The producer's author has the selection as the next fix. */}
        <p className="tw:mt-1 tw:px-1 tw:text-[12px] tw:text-ink-faint">
          The tail of that session's screen, as it was captured. It is taken by position rather than by
          search, so it may not be the part the sentence above is about.
        </p>
        {/* `<pre>` because it IS a terminal capture — a table of process states
            reflowed into prose is worse than not showing it. The scroll is
            inside the card, never the page: narrow-windows.md's rule. */}
        <pre className="material tw:mt-1 tw:max-h-72 tw:overflow-auto tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:p-2 tw:font-mono tw:text-[12px] tw:text-ink">
          {item.evidence.excerpt}
        </pre>
      </details>
    </div>
  );
}
