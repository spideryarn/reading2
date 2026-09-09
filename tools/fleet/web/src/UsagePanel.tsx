/**
 * **CAN THESE ACCOUNTS AFFORD MORE WORK?** — the Claude and Codex usage cards,
 * on the Overseer tab beside the one that says whether supervision is running.
 *
 * ## What it is answering
 *
 * > Greg runs `/login` every couple of days to swap between Max subscriptions
 * > when he hits a limit, and nothing on this box can say how close the current
 * > account is, or which conversations have already been stopped by a 429.
 * >
 * > — tools/overseer/usage.ts, its reason for existing
 *
 * That module has measured it since 2026-09-08 and stored it on every daemon
 * tick. Nothing rendered it. This is the render.
 *
 * ## THREE THINGS THIS CARD REFUSES TO DO
 *
 *  - **Invent a percentage.** An expired cached window arrives with no number
 *    on it at all — not even under a scary name — because a void number reads
 *    exactly like a live one and a renderer handed a numeric field will
 *    eventually render it. wire.ts § `UsageWindowCard`.
 *  - **Say "no limits hit" on its own.** Every such sentence is drawn beside
 *    the coverage that makes it believable: *opened 235 of 240 transcripts,
 *    232,961 lines*. A zero with nothing under it is the unfalsifiable kind.
 *    docs/reusable/silent-success.md.
 *  - **Read an old 429 as a live block.** `level: "limited"` is a fact about the
 *    moment the reading was taken; a window that has since reset is HISTORY, and
 *    the card says so against its own clock rather than repeating the verdict.
 *    The plan's own words: *a post-reset old 429 is history*.
 *
 * ## The two clocks, again, and why this card needs both
 *
 * `coordinatorWrittenAt` is when the Overseer last wrote; `collectedAt` is when
 * the usage pass that produced this reading ran. **They are routinely hours
 * apart**: a full scan is 30-45 seconds over ~2.9 GB and does not always
 * finish, and `chooseUsage` in tools/overseer/usage-carry.ts deliberately
 * republishes an earlier pass's report when a fresh one falls over — which is
 * right, because a rejection whose window resets on Friday is still in force.
 * So the age on this card is `collectedAt`'s, and a card that had drawn the
 * checkpoint's clock would show a two-hour-old reading as thirty seconds old.
 *
 * ## Why this component takes the clock skew and no other does
 *
 * Every other timestamp on the page is shifted onto the browser's clock at the
 * parse boundary, because every other one becomes an AGE. These become
 * wall-clock times, in UTC, London and Athens — Greg is *"bouncing between
 * London/Athens"* — and shifting an instant before printing it as a wall clock
 * prints a time that is not the time. So `parseUsage` leaves them alone and
 * this file applies the skew itself, at the two places it needs a duration.
 */
import type { ReactNode } from "react";

import { zonedLine } from "../../zones.js";
import { Explain, type Tip } from "./Tooltip";
import type { CodexBucketView, CodexObservationView, CodexWindowView } from "./usage-history-client";
import type { ClockSkew, ScanCoverage, UsageIncident, UsageSummary, UsageView, UsageWindowCard } from "./types";
import { shiftMsToBrowserClock } from "./types";
import { Card, cx, Pill, StatCard, toneClasses, type StatValue } from "./ui";
import { formatDuration, type Tone } from "./view";

/**
 * How old a usage reading may be before its age is worth pointing at.
 *
 * The daemon takes one every 300 seconds, so this is four missed passes. It is
 * generous for the reason every threshold on this page is: a restart or a busy
 * box must not put a warning on a healthy card. **It never suppresses
 * anything** — the age is printed either way; past this it is printed loudly.
 */
const READING_STALE_MS = 20 * 60_000;

/**
 * An instant in the box's terms, as this browser's clock would have read it.
 *
 * `null` when the string is not a timestamp, or when nobody has measured the
 * skew — in which case `shiftMsToBrowserClock` shifts by zero, which is the
 * discipline of `ClockSkew` and not a silent guess.
 */
function browserMs(at: string, skew: ClockSkew): number | null {
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? shiftMsToBrowserClock(parsed, skew) : null;
}

/**
 * How long ago, in words — or the honest non-answer.
 *
 * **A TIMESTAMP IN THE FUTURE IS UNREADABLE, NOT FRESH.** The same rule
 * `OverseerPanel`'s `ageMs` follows, and for the same reason: a `Math.max(0, …)`
 * would read as "0s ago" for exactly as long as the fault lasted, which is how
 * a reading that stopped being taken goes on looking current.
 */
function ago(at: string, asOf: number, skew: ClockSkew): { ms: number | null; text: string } {
  const ms = browserMs(at, skew);
  if (ms === null || asOf - ms < 0) return { ms: null, text: "at a time this page cannot read" };
  return { ms: asOf - ms, text: `${formatDuration(asOf - ms)} ago` };
}

/**
 * Whether an instant is still ahead of us, and by how long.
 *
 * The one question the card asks that the server may not answer for it: an
 * *expired* computed on the server would be as old as the payload, and a
 * five-hour window can reset between the checkpoint being written and the page
 * being looked at.
 */
function untilReset(at: string, asOf: number, skew: ClockSkew): { kind: "ahead"; ms: number } | { kind: "passed"; ms: number } | { kind: "unreadable" } {
  const ms = browserMs(at, skew);
  if (ms === null) return { kind: "unreadable" };
  return ms > asOf ? { kind: "ahead", ms: ms - asOf } : { kind: "passed", ms: asOf - ms };
}

/**
 * An instant, in all three zones, as one string.
 *
 * **Unshifted, deliberately** — see the header. `zonedLine` returns `null` for
 * anything it cannot read, and this says so rather than printing `Invalid Date`.
 */
function whenLine(at: string): string {
  return zonedLine(at) ?? "at a time this page cannot read";
}

/**
 * **The cards this tab's stats carry, exported so a guard can reach them.**
 *
 * `tests/fleet-tooltip-copy.test.ts` only sees tips it can import — a stated
 * limit rather than an oversight — so a tip written inline in a component gets
 * none of the three house rules and does not count towards the floor. Session
 * `dashboard-tooltips` pointed this out on 2026-09-09, and it is cheap to fix:
 * a named map is the difference between the guard covering this rewrite and
 * silently not.
 */
export const USAGE_TIPS: Record<string, Tip> = {
  dueBack: {
    head: "When the limit lifts",
    what: "The moment work can start again, from the verdict's own attributed limit.",
    how: "Where several windows are in force it names whichever frees up LAST, not the first to clear — a reader acting on the earliest would be rejected again immediately. `UsageVerdict.activeLimit` decides it, rather than this card reading the incidents for itself.",
  },
  account: {
    head: "Whose headroom this is",
    what: "The account the last usage pass read, from `claude auth status` and ~/.claude.json.",
    how: "Recorded, never rotated: swapping between Max subscriptions is Greg's `/login`, not this page's. It matters because a cached utilisation can belong to the PREVIOUS account after a swap — the reading refuses to use one that does.",
  },
  reading: {
    head: "When this reading was taken",
    what: "The usage pass's own clock, not the moment the Overseer wrote the checkpoint carrying it.",
    how: "A full transcript scan runs 30-45 seconds over ~2.9 GB and does not always finish, and an earlier report is deliberately republished when a fresh pass falls over — because a rejection whose window resets on Friday is still in force. The two clocks come apart by hours routinely, and only this one sizes the age of the headroom above.",
  },
  cached: {
    head: "A hint, not ground truth",
    what: "~/.claude.json's cache of the utilisation headers returned on the last request.",
    how: "Measured on 2026-09-08: a file 48 minutes old still claimed 70% about a window that had reset 27 minutes earlier. So `resets_at` is a validity check rather than decoration, and a window past its reset is drawn with no percentage at all — a void number that reaches a renderer eventually gets rendered.",
  },
};

/**
 * The cache's own card, carrying the instant its age is an age of.
 *
 * Computed rather than the static `USAGE_TIPS.cached`, because a comment
 * claiming "the exact instant remains in the tip" while the tip was static was
 * an overclaim in prose about the thing prose cannot check — GPT Sol's round-two
 * P2, and [written-down-is-not-checked.md](../../../docs/reusable/written-down-is-not-checked.md)
 * is the class. The age is what a reader judges freshness by; the instant is
 * what they quote into a message, and it now exists.
 */
export function usageCachedTip(fetchedAt: string): Tip {
  return {
    head: USAGE_TIPS["cached"]!.head,
    what: `${USAGE_TIPS["cached"]!.what} This one was fetched ${whenLine(fetchedAt)}.`,
    how: USAGE_TIPS["cached"]!.how,
  };
}

/**
 * One window's card. Computed rather than a map entry, because half of it is
 * the window's own name and reset instant — the same shape as `instantTip`.
 */
export function usageWindowTip(window: UsageWindowCard): Tip {
  return {
    head: `The ${window.window} window`,
    what:
      window.kind === "value"
        ? `How much of this window remains, and the instant it refills: ${whenLine(window.resetsAt)}.`
        : "This window arrived with no usable percentage on it.",
    how: USAGE_TIPS["cached"]!.how,
  };
}

/** The quiet one-line-with-detail shape both other panels on this tab use. */
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
    <p className="tw:mt-2">
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

/**
 * The headline, from the verdict **and this browser's clock** — which is the
 * one place the card is allowed to disagree with the reading it is drawing.
 *
 * `limited` is ground truth about the moment `collectedAt` names. If every
 * window that produced it has since reset, repeating it would be a red banner
 * over an account that is free — so the clock gets the last word, and says
 * which of the two it is doing.
 */
function headline(
  summary: UsageSummary,
  asOf: number,
  skew: ClockSkew,
): { text: string; tone: Tone; cleared: boolean } {
  if (summary.level === "limited") {
    if (summary.dueBackAt === null) {
      /* `limited` with nothing to wait for. The producer says a 429 is in force
         and cannot say when it lifts, which is worth showing as-is rather than
         resolving in either direction. */
      return { text: "This account is rate-limited.", tone: "alarm", cleared: false };
    }
    const until = untilReset(summary.dueBackAt, asOf, skew);
    if (until.kind === "passed") {
      return {
        text: "The limit that stopped this account has since reset.",
        tone: "idle",
        cleared: true,
      };
    }
    return { text: "This account is rate-limited.", tone: "alarm", cleared: false };
  }
  switch (summary.level) {
    case "approaching":
      return { text: "This account is close to a limit.", tone: "needs", cleared: false };
    case "ok":
      return { text: "Nothing is blocking this account.", tone: "idle", cleared: false };
    case "unknown":
      /* NOT "fine". A level computed while every source failed would say `ok`
         and mean nothing — wire.ts § `UsageVerdict` has the argument. */
      return { text: "This page cannot tell how much headroom this account has.", tone: "unknown", cleared: false };
    default: {
      const never: never = summary.level;
      return { text: `Usage level ${JSON.stringify(never)}`, tone: "unknown", cleared: false };
    }
  }
}

/** Who the reading is about. `logged-out` is an answer, not a failure. */
function AccountLine({ account }: { account: UsageSummary["account"] }): ReactNode {
  if (account.kind === "logged-out") {
    return (
      <p className="tw:mt-2 tw:text-[13px] tw:font-medium tw:text-alarm-ink">
        Nobody is logged in on this box
        {account.projectsDirectory === null ? "" : ` (projects directory ${account.projectsDirectory})`}.
      </p>
    );
  }
  if (account.kind === "unknown") {
    return <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">Which account this is could not be read — {account.why}</p>;
  }
  return (
    <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
      <Explain
        tip={USAGE_TIPS["account"]!}
      >
        {account.email ?? "an account with no email on it"}
        {account.subscriptionType === null ? "" : ` · ${account.subscriptionType}`}
        {account.rateLimitTier === null ? "" : ` · ${account.rateLimitTier}`}
      </Explain>
    </p>
  );
}

/**
 * **One cached window, as the number the reader came for.**
 *
 * Rewritten from a list row on 2026-09-09 (plan 260909c). The row it replaced
 * put the one real number on this tab — a percentage — at 13px in the middle of
 * the third block, indistinguishable in size and colour from the three
 * non-answers beside it. The reader's question is *how much headroom is there*;
 * `StatCard` makes the answer the biggest thing in its box.
 *
 * ## `% LEFT`, NOT `% USED`, AND BOTH ARE ON SCREEN
 *
 * The wire carries `utilizationPercent` — how much is *gone*. The reader is
 * asking how much is *left*, and a card answering the complement of the
 * question makes them do the subtraction. So the value slot is `42% left` and
 * the evidence line under it says `58% used`, which keeps the producer's own
 * number visible and checkable rather than replacing it. GPT Sol's S2-01.
 *
 * ## EVERY WAY THIS CAN FAIL TO BE A NUMBER IS A DIFFERENT WORD
 *
 * The three `absent` states are not interchangeable, and picking between them
 * is this function's real job:
 *
 *  - **`unknown`** — the window has reset, so a cached number describes nothing.
 *    Ordinary. Both the typed `expired` arm and a `value` arm whose reset has
 *    since passed land here, because to a reader they are the same news.
 *  - **`unavailable`** — the cache entry could not be read at all. A fault
 *    rather than a gap, and drawn louder.
 *
 * **THE PERCENTAGE IS NOT DRAWN ONCE THE WINDOW HAS GONE**, on either path. The
 * producer said `value` because the window was live when it looked; a five-hour
 * window resets while a page is open, and an older report is deliberately
 * carried forward when a scan falls over. Drawing "96% — which has now passed,
 * so this number is void" is the exact failure `UsageWindowCard`'s `expired` arm
 * exists to prevent, arriving through the renderer instead of through the type.
 * GPT Sol's P1(1), 2026-09-09, and `StatValue` now refuses it structurally: the
 * absent arms have nowhere to put a number.
 */
function windowStat(window: UsageWindowCard, asOf: number, skew: ClockSkew): {
  value: StatValue;
  evidence: ReactNode;
  tone: Tone;
} {
  if (window.kind === "unknown") {
    /* **`unknown`, AND THIS ARM HAS NOW BEEN WRONG TWICE.**

       First draft: `unavailable`, which drew three red alarm cards on a tab
       whose verdict is "cannot tell" — a gap painted as a fault. Second draft:
       `withheld`, on the reasoning that a number had arrived and could not be
       shown to be valid. Both were the renderer deciding something it cannot
       know. GPT Sol, UL-02, 2026-09-09: this one producer arm covers **a cache
       value with no `resets_at`, a non-object entry, an invalid date, a missing
       or non-numeric utilisation, and an out-of-range utilisation** — a mixture
       of withheld, invalid and source failure, which no consumer can unpick
       from `{ kind, window, why }`.

       So `Unknown` is the only defensible common rendering, and the fix that
       would let it be sharper is **the producer carrying its own absence
       classification**, not the renderer guessing harder. Noted in plan 260909c
       as a change to `wire.ts`, which this session does not own. */
    return { value: { kind: "absent", state: "unknown", why: window.why }, evidence: null, tone: "unknown" };
  }
  if (window.kind === "expired") {
    /* THE PRODUCER'S SENTENCE, NOT A PREFIX AND THEN THE PRODUCER'S SENTENCE.
       The first draft wrote "this window has already reset, so the cached number
       describes nothing: " in front of `why` — and `why` already says exactly
       that, so the card printed the same fact twice and ran to eleven lines.
       Restating a measurement's own words is the thing this file's header
       forbids; doing it immediately before quoting them is just long. */
    return { value: { kind: "absent", state: "unknown", why: window.why }, evidence: null, tone: "unknown" };
  }
  const until = untilReset(window.resetsAt, asOf, skew);
  if (until.kind !== "ahead") {
    return {
      value: {
        kind: "absent",
        state: "unknown",
        why: `this window reset at ${whenLine(window.resetsAt)}${
          until.kind === "passed" ? `, ${formatDuration(until.ms)} ago` : ""
        }, so its cached number describes nothing`,
      },
      evidence: null,
      tone: "unknown",
    };
  }
  /* **ROUNDED, BECAUSE THE COMPLEMENT OF A DECIMAL IS UGLY.** Both parsers
     require a finite value in [0, 100], so `left` can be neither negative nor
     NaN nor over 100 — but `100 - 99.99` is `0.010000000000005116`, and that
     reaches the screen as the answer to "how much is left". GPT Sol's UL-06.
     One decimal place, then trailing zeroes dropped, so 42 stays `42` and 0.01
     becomes `0`. A `0% left` that was really 0.01% is the right rounding
     direction: it does not overstate the headroom. */
  const left = Number((100 - window.utilizationPercent).toFixed(1));
  return {
    value: { kind: "value", text: `${left}% left` },
    /* The producer's own number stays on screen beside the one derived from it,
       so a reader can check the arithmetic without leaving the page — and the
       reset is a DURATION, because that is the form that survives being read in
       another timezone. The three zoned instants are one tap away, not gone. */
    evidence: (
      <>
        {window.utilizationPercent}% used · resets in {formatDuration(until.ms)}
      </>
    ),
    /* **NO SEVERITY OF OUR OWN.** The first draft coloured this card by
       thresholds it invented — alarm under 10% left, needs under 25% — and GPT
       Sol (UL-05) measured what that costs against the producer's actual
       default of 80% used: at 75% used the card would say `needs` while the
       verdict still says `ok`, and at 90% it would say `alarm` while the
       producer says only `approaching`. **A card contradicting the verdict
       above it** is precisely the second interpretation of one measurement this
       file's header forbids, and I had flagged the numbers as invented in the
       review prompt before knowing they were also wrong.

       **`idle`, which is the neutral one — NOT `work`.** The first attempt at
       this fix used `work`, and `work` is the green in this palette: the status
       colour for a session that is running. On a headroom figure green does not
       mean "measured", it means "healthy" — so `4% left` would have been drawn
       in the reassuring colour, which is a severity claim of exactly the kind
       the finding was about, made in the other direction. Sol's word was
       *neutral* and it was the right word.

       A real number, drawn as a real number: 22px and semibold still make it
       the biggest thing in its box, which is what the card is for. The
       account's severity is the verdict's to state, once, at the top. The way
       to earn a per-window colour is for the producer to carry a per-window
       status — noted in plan 260909c. */
    tone: "idle",
  };
}

/** One cached window as a card, with its zoned reset instant in the tip rather than on the page. */
function WindowStatCard({ window, asOf, skew }: { window: UsageWindowCard; asOf: number; skew: ClockSkew }): ReactNode {
  const { value, evidence, tone } = windowStat(window, asOf, skew);
  return (
    <StatCard
      label={window.window}
      value={value}
      evidence={evidence}
      tone={tone}
      tip={usageWindowTip(window)}
    />
  );
}

/**
 * **ONE INCIDENT, HOWEVER MANY SESSIONS IT STOPPED** — the acceptance line of
 * this stage, on screen.
 *
 * The grouping is `groupUsageIncidents` in tools/fleet/usage-feed.ts and the
 * reasoning is on `UsageIncident` in wire.ts. What this component adds is the
 * one thing a server cannot: whether the window has reset *now*, rather than at
 * the moment the reading was taken.
 *
 * ## IT SAYS "NOT YET RESET", NEVER "IN FORCE", AND THE DIFFERENCE IS REAL
 *
 * The first version of this row said *is in force* about any rejection whose
 * window had not reset. Run against the live checkpoint on 2026-09-08 it drew
 * **IN FORCE seven_day** over a verdict of **UNKNOWN** — the card contradicting
 * the reading it was drawing, in the reassuring direction's opposite.
 *
 * The producer is right and the row was wrong. `computeUsageVerdict` classifies
 * every unexpired rejection three ways, not two — `ours`, `contradicted`,
 * `unattributable` — and **only `ours` may set `limited`**, because Greg swaps
 * between Max subscriptions with `/login` and a transcript keeps the rejections
 * that account collected. An unexpired 429 from an account he has since left
 * looks exactly like one from the account he is on; only the cache attribution
 * can tell them apart, and only the daemon has it.
 *
 * So the row states the fact it can see — this window has or has not reset —
 * and **the verdict at the top of the card is the only thing that claims the
 * account is blocked.** A second interpretation of one measurement is what
 * tools/overseer/usage.ts's header forbids, and this was one.
 */
function IncidentRow({
  incident,
  attributed,
  asOf,
  skew,
}: {
  incident: UsageIncident;
  /**
   * Whether THIS incident is the one the producer named as the active limit.
   *
   * Not "is the account limited": that was a global flag, and it made every
   * unreset cluster loud the moment any one of them was attributed — including
   * the ones the daemon had explicitly failed to attribute. An incident is an
   * observed window cluster (wire.ts § `UsageIncident`), so the only one that
   * has earned emphasis is the one `UsageVerdict.activeLimit` points at.
   * GPT Sol's P1(4), 2026-09-09.
   */
  attributed: boolean;
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  const until = untilReset(incident.resetsAt, asOf, skew);
  const unreset = until.kind === "ahead";
  const loud = unreset && attributed;
  const sessions = incident.conversations.length;
  return (
    <li
      className={cx("tw:mt-2 tw:border-l-2 tw:pl-3 tw:text-[13px]", loud ? "tw:border-l-alarm" : "tw:border-l-rule-strong")}
    >
      <p className={cx("tw:font-medium", loud ? "tw:text-alarm-ink" : "tw:text-ink-soft")}>
        <span className="tw:font-mono tw:text-[12px]">{incident.window}</span>{" "}
        {unreset ? (
          <Explain
            tip={{
              head: attributed
                ? "Not reset, and the reading attributes it to this account"
                : "Not reset — which is not the same as blocking you",
              what: "The window these rejections named has not reached its reset instant yet.",
              how: "Whether it still blocks THIS account is the verdict's call, not this row's: swapping subscriptions with /login leaves the previous account's rejections in the transcripts, and an unexpired 429 from an account you have left looks identical to one from the account you are on. Only the cached utilisation can attribute it, and the reading above has already done that.",
            }}
          >
            has not reset yet
          </Explain>
        ) : (
          "has reset — history, not a live block"
        )}
      </p>
      <p className="tw:mt-1 tw:text-ink-soft">
        <Explain
          tip={{
            head: "One window, one incident",
            what: "Every rejection sharing this window and this reset instant, counted once as the thing that happened.",
            how: "When the window fills, every session on the account is rejected within seconds of the others, and each retry writes another 429. Twenty-seven rejections across thirty conversations is one event seen many times — listing them separately would repeat the same reset instant thirty times and bury it.",
          }}
        >
          {sessions === 0 ? "no identified conversation" : `${sessions} ${sessions === 1 ? "conversation" : "conversations"}`}
          {", "}
          {incident.rejections} {incident.rejections === 1 ? "rejection" : "rejections"}
          {/* COUNTED, NEVER FOLDED IN. A rejection whose transcript record
              carried no conversation id is real; adding it to the session count
              would be a fiction and dropping it would understate the incident. */}
          {incident.unidentifiedRejections > 0
            ? ` (${incident.unidentifiedRejections} of them from a conversation this scan could not name)`
            : ""}
        </Explain>
      </p>
      <p className="tw:mt-1 tw:text-ink-soft">
        resets {whenLine(incident.resetsAt)}
        {until.kind === "ahead" ? ` — in ${formatDuration(until.ms)}` : ""}
        {until.kind === "passed" ? ` — ${formatDuration(until.ms)} ago` : ""}
      </p>
      {incident.firstHitAt === null ? null : (
        /* ZONED LIKE EVERY OTHER SOURCE TIMESTAMP ON THE CARD. These were ages
           alone, which is a different rule from the one this stage promised —
           and an age is the half that stops being true the moment the line is
           pasted into a message. GPT Sol's P1(6), 2026-09-09. */
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
          first rejection {ago(incident.firstHitAt, asOf, skew).text} — {whenLine(incident.firstHitAt)}
          {incident.lastHitAt === null || incident.lastHitAt === incident.firstHitAt
            ? ""
            : `, last ${ago(incident.lastHitAt, asOf, skew).text} — ${whenLine(incident.lastHitAt)}`}
        </p>
      )}
    </li>
  );
}

/**
 * **THE UNRESET WINDOWS IN FULL, AND THE REST AS A COUNT.**
 *
 * Measured against the live checkpoint on 2026-09-08: nine incidents, one of
 * them unreset and eight of them days old. Drawn as nine equal rows, the one
 * that matters is the second line of a wall, and the reader's eye has to do the
 * date arithmetic the page was built to do for them.
 *
 * **The history is summarised rather than dropped**, because it is real
 * evidence about the box: eight separate windows filled in a week is a pattern,
 * and a page that showed only *nothing is blocking you right now* would hide it.
 * What it is not is a list of things to act on — nor evidence about *this
 * account* specifically, which it cannot be: a transcript rejection carries no
 * account id and the scan spans days that may include a `/login` swap.
 * wire.ts § `UsageIncident`, and GPT Sol's P1(4).
 *
 * `groupUsageIncidents` has already sorted by reset instant, latest first, so
 * the unreset ones are a prefix and the partition preserves that order.
 */
function Incidents({
  incidents,
  dueBackAt,
  dueBackWindow,
  asOf,
  skew,
}: {
  incidents: UsageIncident[];
  /**
   * The producer's own attributed active limit, or null — `UsageVerdict.activeLimit`'s
   * reset instant and window. The ONE incident that has earned emphasis; see
   * `IncidentRow`.
   *
   * **Both fields, because an incident's key is both fields.** `five_hour` and
   * `seven_day` sharing a reset instant is ordinary — they are aligned to the
   * hour — and matching on the instant alone would badge both.
   */
  dueBackAt: string | null;
  dueBackWindow: string | null;
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  const unreset: UsageIncident[] = [];
  const history: UsageIncident[] = [];
  for (const incident of incidents) {
    /* An instant this page cannot read counts as HISTORY rather than as
       unreset: the loud arm has to be the one we can show a reset time for. */
    (untilReset(incident.resetsAt, asOf, skew).kind === "ahead" ? unreset : history).push(incident);
  }
  const mostRecent = history[0] ?? null;
  return (
    <>
      {unreset.length === 0 ? (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          Every rejection this scan found names a window that has already reset.
        </p>
      ) : (
        <ul>
          {unreset.map((incident) => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              attributed={
                dueBackAt !== null && incident.resetsAt === dueBackAt && incident.window === dueBackWindow
              }
              asOf={asOf}
              skew={skew}
            />
          ))}
        </ul>
      )}
      {mostRecent === null ? null : (
        <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
          <Explain
            tip={{
              head: "Windows that have already reset",
              what: "Earlier rejection clusters inside the range this scan covered — history, not a block.",
              how: "Kept as a count rather than as rows: none of them is a thing to act on, and they are not necessarily this account's — a transcript rejection carries no account id, and the scan covers days that may span a /login swap. `npx tsx scripts/overseer.ts usage` lists them in full.",
            }}
          >
            {history.length} earlier {history.length === 1 ? "window" : "windows"} in the range this scan covered
          </Explain>
          {" — most recent reset "}
          {whenLine(mostRecent.resetsAt)}.
        </p>
      )}
    </>
  );
}

/**
 * THE POSITIVE CONTROL, printed under every answer including the reassuring
 * one.
 *
 * It is the difference between *no rejections in this window* and *nothing was
 * opened*, and the second reads identically without it. `truncatedByLimit` is
 * called out because an absence that covers less ground than it looks like is
 * the one that gets believed.
 */
function Coverage({ coverage }: { coverage: ScanCoverage }): ReactNode {
  return (
    <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
      <Explain
        tip={{
          head: "What the scan actually opened",
          what: "The numbers that make a zero mean something.",
          how: "A probe that found no rejections and a probe that opened nothing print the same sentence without these. The scan will not report `none` at all unless it opened transcripts and parsed lines — this is that evidence, on screen where it can be checked.",
        }}
      >
        scanned {coverage.transcriptsOpened} of {coverage.transcriptsSelected} selected transcripts (
        {coverage.transcriptsFound} found), {coverage.linesScanned.toLocaleString("en-GB")} lines,{" "}
        {coverage.candidateLines} candidates, {coverage.tookMs}ms
      </Explain>
      {coverage.transcriptsUnreadable > 0 ? ` · ${coverage.transcriptsUnreadable} unreadable` : ""}
      {coverage.malformedCandidates > 0 ? ` · ${coverage.malformedCandidates} MALFORMED` : ""}
      {coverage.truncatedByLimit ? " · TRUNCATED by the transcript bound, so this covers less than it looks like" : ""}
    </p>
  );
}

/** The reading itself. */
function Reading({
  summary,
  coordinatorWrittenAt,
  asOf,
  skew,
}: {
  summary: UsageSummary;
  coordinatorWrittenAt: string;
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  const head = headline(summary, asOf, skew);
  const reading = ago(summary.collectedAt, asOf, skew);
  /* THE READING'S OWN AGE, NOT THE CHECKPOINT'S. They are routinely hours
     apart — see the header — and this is the one the card is about. */
  const stale = reading.ms === null || reading.ms > READING_STALE_MS;
  const written = ago(coordinatorWrittenAt, asOf, skew);

  return (
    <>
      {/* ------------------------------------------------------ 1 · THE ANSWER --
          The decision the reader came for, and nothing between it and the top
          of the card. `lead` rather than the body size, because until
          2026-09-09 this <h2> inherited 15px from `body` and the eleven
          paragraphs under it were 13px — a 2px gap doing the work of a
          hierarchy. Plan 260909c § Reading the Usage tab off the pixels. */}
      <div data-slot="usage-verdict" className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
        <h2 className={cx("tw:text-lead tw:font-semibold", toneClasses(head.tone).ink)}>{head.text}</h2>
        <Pill tone={head.tone}>{head.cleared ? "cleared" : summary.level}</Pill>
      </div>

      {/* **WHEN WORK CAN RESUME SITS WITH THE VERDICT, NOT WITH THE CACHE.**
          It is the second half of the answer — *you are blocked* is only half
          of *and here is when you are not* — and it comes from the verdict's
          own attributed limit rather than from `~/.claude.json`, so filing it
          under "cached headroom" would attribute it to the wrong source. */}
      {/* **NOT DRAWN ONCE THE LIMIT HAS CLEARED**, which is a bug GPT Sol found
          in the first draft (UL-01): with `dueBackAt` in the past, `headline()`
          correctly says the limit has since reset — and this card, reading the
          same fact, said **"Work can resume in — Unknown"** right underneath it.
          The answer is not unknown; as far as the attributed limit goes, work
          can resume now, and the sentence above already says so. Two components
          reading one instant and disagreeing about it in view of each other is
          the thing this whole page is written against. */}
      {summary.dueBackAt === null || head.cleared ? null : (
        <div className="tw:mt-3">
          <DueBackCard dueBackAt={summary.dueBackAt} asOf={asOf} skew={skew} />
        </div>
      )}

      {/* ------------------------------------------ 2 · THE NUMBERS, IF THERE ARE ANY --
          One card per window. Every arm of `cache` reaches this block, because
          "there is no number and here is why" is an answer and drawing nothing
          is not — the reader who sees an empty space concludes the page is
          broken, or worse, that everything is fine.

          **THE HEADING SAYS "CACHED" AND THAT WORD IS LOAD-BEARING.** These
          numbers are a hint and the rejections are the ground truth — this
          file's header, and `UsageSummary.cache`'s. The first draft of this
          rewrite dropped the heading, on the grounds that each card now carries
          its own label; the existing suite caught it, which is what it is for.
          A tooltip saying "a hint, not ground truth" is not the page saying it. */}
      <h3 className="tw:mt-3 tw:text-label tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
        Cached headroom
      </h3>
      {/* **THE CACHE'S OWN AGE, ONCE, FOR THE WHOLE GROUP.**

          This went missing in the rewrite and GPT Sol found it (UL-04). The old
          render showed `cache.fetchedAt`; the new one showed only
          `summary.collectedAt`, and **those are different clocks** — a fresh
          usage pass routinely republishes a cache fetched hours earlier, so a
          stale-but-valid percentage was reading as freshly taken. That is the
          precise failure `design-a-screen.md` § Absence names, and it arrived by
          deletion rather than by a wrong word.

          Once, here, rather than per tile: these numbers all came out of one
          fetch, and a timestamp on each of five cards is the wall of provenance
          this rewrite removed. Same rule, the other way up. */}
      {summary.cache.kind === "attributed" ? (
        <p className="tw:mt-1 tw:text-note tw:text-ink-faint">
          <Explain tip={usageCachedTip(summary.cache.fetchedAt)}>
            cached {ago(summary.cache.fetchedAt, asOf, skew).text}
          </Explain>
        </p>
      ) : null}
      <div data-slot="usage-headroom" className="tw:mt-1 tw:grid tw:grid-cols-2 tw:gap-2">
        {/* **EVERY WINDOW GETS A CARD, INCLUDING THE ABSENT ONES.**

            A draft between these two folded the `unknown` windows into a
            disclosure, because on the live box three of the five entries are
            ancillary codenames — `nimbus_quill`, `spend`,
            `member_dashboard_available` — that carried five near-identical
            lines each and most of the first screenful.

            **Withdrawn on GPT Sol's UL-03**, and the reason is worth keeping
            because the idea will occur to the next person too. It partitioned
            by EPISTEMIC STATE when the thing that justified it was RELEVANCE,
            and those are not the same set: `five_hour` arriving unreadable is
            decision-changing and was being folded away beside the noise.
            Nothing in the data can tell them apart — `UsageWindowName` is
            `string`, so the producer names no window as ancillary — which makes
            the compaction unbuildable here rather than merely unwise. It also
            had a bug the comment beside it denied: with EVERY window unknown
            the disclosure was suppressed by its own `!every(...)` guard, so all
            the names and reasons vanished.

            The height cost is real and stays. The way to earn the compaction is
            for the wire to say which windows are primary; plan 260909c. */}
        {summary.cache.kind === "attributed" && summary.cache.windows.length > 0
          ? summary.cache.windows.map((window) => (
              <WindowStatCard key={window.window} window={window} asOf={asOf} skew={skew} />
            ))
          : null}
        {summary.cache.kind === "attributed" && summary.cache.windows.length === 0 ? (
          <StatCard
            label="Headroom"
            value={{ kind: "absent", state: "unknown", why: "The cache carried no windows at all." }}
            tone="unknown"
          />
        ) : null}
        {summary.cache.kind === "unknown" ? (
          /* `unknown`, not `unavailable`: this producer arm covers *Claude has
             not cached a reading here*, which is ordinary, as well as a cache
             that could not be parsed, which is a fault. Sol's UL-02 again — one
             arm, two meanings, and the consumer cannot tell which it has. */
          <StatCard
            label="Headroom"
            value={{
              kind: "absent",
              state: "unknown",
              why: `The cached utilisation could not be read — ${summary.cache.why}`,
            }}
            tone="unknown"
          />
        ) : null}
        {summary.cache.kind === "unattributed" ? (
          /* **`withheld`, NOT `unknown`, AND THE DISTINCTION IS THE WHOLE POINT.**
              The arm carries no windows — wire.ts § `UsageSummary.cache` — so
              this is not a component choosing to hold numbers back; it is a
              component that has none. The failure it closes: after a `/login`
              swap the file can still hold the previous subscription's numbers,
              and a card naming account B over account A's *96% used* is somebody
              else's headroom reported as this one's. GPT Sol's P0(1),
              2026-09-09. A reader who saw `Unknown` here would think nobody had
              looked; `Withheld` says a number exists and has not earned the
              right to be shown. */
          <StatCard
            label="Headroom"
            value={{
              kind: "absent",
              state: "withheld",
              why: `${summary.cache.why}${
                summary.cache.fetchedAt === null
                  ? ""
                  : ` (cached ${ago(summary.cache.fetchedAt, asOf, skew).text})`
              }`,
            }}
            tone="unknown"
            tip={{
              head: "This cached utilisation cannot be shown to be this account's",
              what: "A cache was read, and nothing establishes that it belongs to the account named here.",
              how: "~/.claude.json holds whichever account was logged in when it was written, so after a /login swap it can still carry the previous subscription's percentages. Rather than draw somebody else's headroom under this account's name, the numbers are not carried at all. The rejections are unaffected: they are ground truth about a limit, whoever's it was.",
            }}
          />
        ) : null}
      </div>

      {/* ------------------------------------------------------- 3 · WHY --
          The producer's reasons stay on the page rather than going into a
          disclosure, and that is a deliberate reading of the ten-second rule
          rather than an oversight: a reader who does not trust the verdict goes
          and checks it by hand, which costs more than these lines do. What went
          into the disclosure below is the material that explains the MECHANISM
          rather than qualifying the READING.
          docs/reusable/design-a-screen.md § what does the reader do next. */}
      {summary.reasons.length > 0 ? (
        <div data-slot="usage-why" className="tw:mt-3">
          {/* **THE TENSE IS THE CARD'S TO SET, THE SENTENCES ARE NOT.** The
              producer's reasons are present tense and true of the moment the
              reading was taken — "a five_hour rejection is still in force". Once
              the clock says that window has reset, the headline above says so,
              and printing the reason underneath unqualified had the card
              contradicting itself in the same breath. One line of framing fixes
              it without editing a word the producer wrote, which is the thing
              that must not happen: re-writing a measurement's own sentences is
              how a second interpretation gets in. GPT Sol's P1(2), 2026-09-09. */}
          <h3 className="tw:text-label tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
            {head.cleared ? `Why — at the time of this reading, ${reading.text}` : "Why"}
          </h3>
          <ul className="tw:mt-1 tw:space-y-1 tw:text-body tw:text-ink-soft">
            {/* THE PRODUCER'S OWN SENTENCES, VERBATIM. The reading rules live in
                tools/overseer/usage.ts and re-deriving a headline from the parts
                here would be a second interpretation of one measurement. */}
            {summary.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* -------------------------------------------------- 4 · THE EVIDENCE --
          What makes the answer above believable, and no more than that: who it
          is about, how old it is, and what the scan actually opened. One
          timestamp for the reading rather than one per fact — the rule in
          design-a-screen.md § Absence, whose naive per-tile form produces
          exactly the wall this rewrite is removing. */}
      <div data-slot="usage-evidence" className="tw:mt-3 tw:border-t tw:border-rule tw:pt-2">
        <AccountLine account={summary.account} />
        <p className={cx("tw:mt-1 tw:text-note", stale ? "tw:font-medium tw:text-alarm-ink" : "tw:text-ink-faint")}>
          <Explain
            tip={{
              head: "When this reading was taken",
              what: `The usage pass's own clock — not the checkpoint's. This one was taken ${whenLine(summary.collectedAt)}, and the Overseer wrote the checkpoint carrying it ${written.text}, ${whenLine(coordinatorWrittenAt)}.`,
              how: "A full transcript scan is 30-45 seconds over ~2.9 GB and does not always finish, and the Overseer deliberately republishes an earlier pass's report when a fresh one falls over, because a rejection whose window resets on Friday is still in force. So this number and the Overseer's own write clock come apart routinely, and only this one says how old the headroom above is.",
            }}
          >
            Reading taken <strong className="tw:tabular-nums">{reading.text}</strong>
          </Explain>
        </p>
        {summary.limits.kind === "unknown" ? (
          <Note
            head="The rejection scan could not answer"
            what="It opened what it could and cannot say whether anything was rejected."
            how="This is NOT `no limits hit`. The scan refuses to report an absence it cannot size, so an unknown here means the ground truth is missing and only the cached hint above is left — and that is a hint."
            loud
          >
            this page cannot tell whether anything was rejected — {summary.limits.why}
          </Note>
        ) : null}
        {summary.limits.kind === "none" ? (
          <p className="tw:mt-1 tw:text-note tw:text-ink-soft">
            No rejection was found in the window this scan covered.
          </p>
        ) : null}
        {/* THE POSITIVE CONTROL STAYS ABOVE THE FOLD, NOT IN THE DISCLOSURE.
            It is what makes a reassuring absence falsifiable, and an absence
            whose evidence is one tap away is an absence nobody checks. */}
        <Coverage coverage={summary.limits.coverage} />
      </div>

      {/* --------------------------------------------- 5 · THE PROVENANCE --
          Closed by default, and this is the only part of the card that is.
          Everything here changes what a reader BELIEVES about the machinery
          rather than what they do about the account in the next ten seconds:
          old rejection clusters, the second clock, the full scan mechanics.
          Nothing that qualifies the verdict is in here — that is § Why, above,
          and putting it here would be the redesign quietly demoting a caveat,
          which is the failure this whole plan is pointed at. */}
      {summary.limits.kind === "incidents" ? (
        <details data-slot="usage-provenance" className="tw:mt-3">
          <summary className="tw:cursor-pointer tw:text-note tw:text-ink-faint">
            Rejections seen, in full
          </summary>
          <Incidents
            incidents={summary.limits.incidents}
            dueBackAt={summary.dueBackAt}
            dueBackWindow={summary.dueBackWindow}
            asOf={asOf}
            skew={skew}
          />
        </details>
      ) : null}
    </>
  );
}

/**
 * **When work can resume** — the one instant on this card that a reader acts
 * *at* rather than judges freshness by.
 *
 * So it is the one that keeps its wall-clock form, in the tip: the rest of the
 * card's timestamps became durations on 2026-09-09 because
 * `05:51 UTC · 06:51 London · 08:51 Athens` is one fact said three times, ten
 * of them on the old tab, and a duration survives being read in a timezone
 * nobody predicted. A deadline does not: *in 3h* is useless for deciding
 * whether to wait up.
 */
function DueBackCard({ dueBackAt, asOf, skew }: { dueBackAt: string; asOf: number; skew: ClockSkew }): ReactNode {
  const until = untilReset(dueBackAt, asOf, skew);
  const value: StatValue =
    until.kind === "ahead"
      ? { kind: "value", text: formatDuration(until.ms) }
      : until.kind === "passed"
        ? { kind: "absent", state: "unknown", why: `that reset passed ${formatDuration(until.ms)} ago` }
        : /* AN UNREADABLE INSTANT IS A FAULT, NOT A GAP. `ago` and `untilReset`
             both refuse to coerce one, and a card that said "unknown" here would
             file a broken timestamp under the same word as an honest absence. */
          { kind: "absent", state: "unavailable", why: "that instant could not be read" };
  return (
    <StatCard
      label="Work can resume in"
      value={value}
      evidence={until.kind === "ahead" ? whenLine(dueBackAt) : null}
      tone="needs"
      tip={USAGE_TIPS["dueBack"]!}
    />
  );
}

/**
 * **CAN THIS ACCOUNT AFFORD MORE WORK?** — one card, six ways of not being able
 * to answer, and one reading.
 *
 * **Only `null` draws nothing**, and `null` is *no payload has arrived yet* —
 * the same narrow rule `OverseerStatusCard` follows, and for the same reason:
 * this card IS the evidence, so a card that vanishes leaves a reader looking
 * for it with no explanation.
 */
function ClaudeUsageCard({
  usage,
  now,
  receivedAt,
  skew,
}: {
  /** The reading, or `null` before any payload has arrived. */
  usage: UsageView | null;
  now: number;
  /** When this browser received the payload, by its own clock — the anchor. */
  receivedAt: number | null;
  /**
   * The measured difference between the box's clock and this browser's.
   *
   * **The only card on the page that takes it**, because it is the only one
   * whose timestamps arrive unshifted — they are drawn as wall-clock times in
   * three zones, and shifting an instant before printing it as a wall clock
   * prints a time that is not the time. See the header, and `parseUsage`.
   */
  skew: ClockSkew;
}): ReactNode {
  /* ONE ANCHOR FOR THE WHOLE CARD, so two ages on it cannot be judged against
     two different readings of ours. OverseerPanel.tsx § `ageMs`. */
  const asOf = receivedAt === null ? now : Math.max(now, receivedAt);

  if (usage === null) return null;

  if (usage.kind === "published") {
    return (
      <Card className="tw:mb-3 tw:p-4">
        <Reading
          summary={usage.summary}
          coordinatorWrittenAt={usage.coordinatorWrittenAt}
          asOf={asOf}
          skew={skew}
        />
      </Card>
    );
  }

  return (
    <Card className="tw:mb-3 tw:border-l-4 tw:border-l-unknown tw:p-4">
      <h2 className="tw:font-medium">There is no reading of this account&rsquo;s usage.</h2>
      {usage.kind === "not-asked" ? (
        <Note
          head="This server does not report usage"
          what="The payload arrived and carried no usage reading at all."
          how="A server older than this feature sends none — after a rollback, or against a box running an earlier build. It is not a claim that the account is fine: nothing here has looked."
        >
          this server did not report what the account has left
        </Note>
      ) : null}
      {usage.kind === "no-report" ? (
        <Note
          head="No usage pass has produced a report"
          what="The Overseer's checkpoint was read perfectly well and says it has no usage reading."
          how="Ordinary rather than broken: the daemon may have been started with --no-usage, or may not have reached its first 300-second usage tick. Nothing is wrong with the file. `npx tsx scripts/overseer.ts usage` takes a reading on demand."
        >
          {usage.why} (checkpoint written {whenLine(usage.at)})
        </Note>
      ) : null}
      {usage.kind === "report-unreadable" ? (
        /* **NOT `no-report`, AND THIS IS THE WHOLE REASON THEY ARE TWO ARMS.**
            That one's sentence ends "nothing is wrong with the file", which is
            false here and sends a reader away from the thing that is wrong.
            GPT Sol's P1(3), 2026-09-09. */
        <Note
          head="A usage report is there and this build cannot read it"
          what="The checkpoint carries a usage report and this server could not make sense of it."
          how="A producer and a consumer that have come apart — most likely one of the two halves is older than the other, or the report is malformed. The whole report is refused rather than half-drawn: a card showing windows with no verdict behind them would be making a claim it cannot support. Nothing else on this page depends on it."
          loud
        >
          {usage.why} (checkpoint written {whenLine(usage.at)})
        </Note>
      ) : null}
      {usage.kind === "checkpoint-absent" ? (
        <Note
          head="No checkpoint has been published"
          what="No Overseer checkpoint has been published at the path this server looked at."
          how="The Overseer publishes ~/.overseer/current.json (or under OVERSEER_STORE_DIR). There is nothing there, so nothing on this box is reporting the account's headroom — which is not the same as the account having any."
        >
          no Overseer checkpoint has been published where this server looked
        </Note>
      ) : null}
      {usage.kind === "checkpoint-unreadable" ? (
        <Note
          head="The checkpoint could not be read"
          what="A checkpoint is there and this server could not open, read or parse it."
          how="Nothing else on this page depends on it: the sessions are collected here. Until it can be read, the account's headroom is unknown rather than fine."
          loud
        >
          the checkpoint could not be read — {usage.why}
        </Note>
      ) : null}
      {usage.kind === "unsupported-schema" ? (
        <Note
          head="The checkpoint is a version this build does not read"
          what={`It declares schema ${usage.saw}; this build reads schema ${usage.known}.`}
          how="Refused rather than coerced: fields have changed meaning across versions, so reading one version as the other draws confident nonsense rather than a gap. One of the two halves needs deploying."
          loud
        >
          the checkpoint says schema {usage.saw} and this page reads schema {usage.known}
        </Note>
      ) : null}
      {usage.kind === "feed-unreadable" ? (
        <Note
          head="The server's answer could not be read"
          what="The server sent a usage reading this build cannot make sense of."
          how="A page and a server that have come apart — most likely one of them is older than the other. It is not the same as the server not looking, which says so in its own words."
          loud
        >
          this page could not read the server&rsquo;s answer — {usage.why}
        </Note>
      ) : null}
    </Card>
  );
}

function codexWindowLabel(window: CodexWindowView): string {
  if (window.windowMinutes === 300) return "5 hours";
  if (window.windowMinutes === 10_080) return "7 days";
  if (window.windowMinutes !== null) return `${window.windowMinutes.toLocaleString("en-GB")} minutes`;
  return `${window.slot} window (duration unknown)`;
}

function CodexWindowStat({
  window,
  asOf,
  skew,
  reached,
}: {
  window: CodexWindowView;
  asOf: number;
  skew: ClockSkew;
  reached: boolean;
}): ReactNode {
  if (window.kind === "unknown") {
    return (
      <StatCard
        label={codexWindowLabel(window)}
        value={{ kind: "absent", state: "unknown", why: window.why }}
        tone="unknown"
      />
    );
  }
  const reset = untilReset(window.resetsAt, asOf, skew);
  if (reset.kind !== "ahead") {
    return (
      <StatCard
        label={codexWindowLabel(window)}
        value={{
          kind: "absent",
          state: reset.kind === "unreadable" ? "unavailable" : "unknown",
          why:
            reset.kind === "unreadable"
              ? "the reset instant could not be read"
              : `this window already reset ${formatDuration(reset.ms)} ago, so its old percentage is not current headroom`,
        }}
        tone="unknown"
      />
    );
  }
  const barWidth = Math.max(0, Math.min(100, window.usedPercent));
  return (
    <StatCard
      label={codexWindowLabel(window)}
      value={{ kind: "value", text: `${window.usedPercent}% used` }}
      evidence={
        <>
          <span>resets in {formatDuration(reset.ms)}</span>
          <span className="tw:mt-2 tw:block tw:h-1 tw:overflow-hidden tw:rounded-full tw:bg-rule" aria-hidden="true">
            <span
              data-slot="codex-utilization-bar"
              className="tw:block tw:h-full tw:bg-current"
              style={{ width: `${barWidth}%` }}
            />
          </span>
        </>
      }
      tone={reached ? "alarm" : "idle"}
      tip={{
        head: `The ${codexWindowLabel(window)} Codex window`,
        what: `The source reported ${window.usedPercent}% used, resetting ${whenLine(window.resetsAt)}.`,
        how: "The duration names this window. Primary and secondary are source positions and mean different durations on different buckets.",
      }}
    />
  );
}

function bucketWindowCards(bucket: CodexBucketView, asOf: number, skew: ClockSkew): ReactNode {
  const bySlot = new Map<CodexWindowView["slot"], CodexWindowView[]>();
  for (const window of bucket.windows) {
    const values = bySlot.get(window.slot) ?? [];
    values.push(window);
    bySlot.set(window.slot, values);
  }
  if (bySlot.size === 0) {
    return (
      <StatCard
        label="Headroom"
        value={{ kind: "absent", state: "unknown", why: `${bucket.limitId} carried no windows` }}
        tone="unknown"
      />
    );
  }
  return [...bySlot.entries()].map(([slot, windows]) =>
    windows.length === 1 ? (
      <CodexWindowStat
        key={`${bucket.limitId}:${slot}`}
        window={windows[0]!}
        asOf={asOf}
        skew={skew}
        reached={bucket.rateLimitReachedType !== null || bucket.spendControlReached === true}
      />
    ) : (
      <StatCard
        key={`${bucket.limitId}:${slot}`}
        label={`${slot} window`}
        value={{
          kind: "absent",
          state: "unavailable",
          why: `${bucket.limitId} carried duplicate ${slot} windows, so neither was chosen`,
        }}
        tone="unknown"
      />
    ),
  );
}

function CodexBucketSection({
  bucket,
  general,
  asOf,
  skew,
}: {
  bucket: CodexBucketView;
  general: boolean;
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  const reached = bucket.rateLimitReachedType;
  const controlWhy =
    general && bucket.spendControlReached !== false
      ? "General headroom is unavailable because spend-control state was reached or unavailable."
      : general && bucket.individualLimit !== null
        ? "General headroom is unavailable because an individual spend limit was reported."
        : null;
  return (
    <section className="tw:mt-3">
      <h3 className="tw:text-label tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
        {general ? "General headroom" : `Model-specific limit — ${bucket.limitName ?? bucket.limitId}`}
      </h3>
      {reached !== null ? (
        <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
          When this reading was taken, the backend reported a reached limit — {reached.length === 0 ? "type not named" : reached}
        </p>
      ) : null}
      {bucket.spendControlReached === true ? (
        <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
          When this reading was taken, the backend reported that spend control was reached.
        </p>
      ) : null}
      {controlWhy === null ? (
        <div className="tw:mt-1 tw:grid tw:grid-cols-2 tw:gap-2">
          {bucketWindowCards(bucket, asOf, skew)}
        </div>
      ) : (
        <StatCard
          label="General headroom"
          value={{ kind: "absent", state: "unavailable", why: controlWhy }}
          tone="unknown"
        />
      )}
    </section>
  );
}

function CodexUsageCard({
  codex,
  asOf,
  skew,
}: {
  codex: CodexObservationView | null;
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  if (codex === null) return null;
  if (codex.kind !== "value") {
    return (
      <Card className="tw:mb-3 tw:p-4">
        <h2 className="tw:text-lead tw:font-semibold">Codex subscription</h2>
        <div className="tw:mt-3">
          <StatCard
            label="General headroom"
            value={{ kind: "absent", state: codex.kind === "unknown" ? "unavailable" : "unknown", why: codex.why }}
            tone="unknown"
          />
        </div>
      </Card>
    );
  }

  const reading = ago(codex.readAt, asOf, skew);
  if (reading.ms === null) {
    return (
      <Card className="tw:mb-3 tw:p-4">
        <h2 className="tw:text-lead tw:font-semibold">Codex subscription</h2>
        <StatCard
          label="General headroom"
          value={{
            kind: "absent",
            state: "unavailable",
            why: "the reading instant is in the future or cannot be compared with this page’s clock",
          }}
          tone="unknown"
        />
      </Card>
    );
  }
  const stale = reading.ms > READING_STALE_MS;
  const bucketGroups = new Map<string, CodexBucketView[]>();
  for (const bucket of codex.buckets) {
    const group = bucketGroups.get(bucket.limitId) ?? [];
    group.push(bucket);
    bucketGroups.set(bucket.limitId, group);
  }
  const general = bucketGroups.get("codex") ?? [];
  const other = [...bucketGroups.entries()].filter(([limitId]) => limitId !== "codex");

  return (
    <Card className="tw:mb-3 tw:p-4">
      <h2 className="tw:text-lead tw:font-semibold">Codex subscription</h2>
      <p className={cx("tw:mt-1 tw:text-note", stale ? "tw:font-medium tw:text-alarm-ink" : "tw:text-ink-faint")}>
        {codex.accountId === null ? "Account not attributed" : `Account ${codex.accountId}`} · Reading taken {reading.text}
      </p>

      {general.length === 1 ? (
        <CodexBucketSection bucket={general[0]!} general asOf={asOf} skew={skew} />
      ) : (
        <div className="tw:mt-3">
          <StatCard
            label="General headroom"
            value={{
              kind: "absent",
              state: general.length === 0 ? "unknown" : "unavailable",
              why:
                general.length === 0
                  ? "General Codex headroom is unknown because the reading carried no codex bucket. Model-specific limits below do not stand in for it."
                  : "The reading carried duplicate codex buckets, so neither was chosen as general headroom.",
            }}
            tone="unknown"
          />
        </div>
      )}

      {other.map(([limitId, buckets]) =>
        buckets.length === 1 ? (
          <CodexBucketSection key={limitId} bucket={buckets[0]!} general={false} asOf={asOf} skew={skew} />
        ) : (
          <section key={limitId} className="tw:mt-3">
            <h3 className="tw:text-label tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
              Model-specific limit — {limitId}
            </h3>
            <StatCard
              label="Limit"
              value={{ kind: "absent", state: "unavailable", why: `the reading carried duplicate ${limitId} buckets` }}
              tone="unknown"
            />
          </section>
        ),
      )}

      <div className="tw:mt-3">
        <StatCard
          label="Full resets available"
          value={
            codex.resetCredits === null
              ? { kind: "absent", state: "unknown", why: "the source did not report reset credits" }
              : { kind: "value", text: `${codex.resetCredits} reset ${codex.resetCredits === 1 ? "credit" : "credits"}` }
          }
          evidence="Shown only; this page never consumes one."
          tone="idle"
        />
      </div>
    </Card>
  );
}

/** The two account readings, kept together so both mounts receive one Codex owner. */
export function UsageCard({
  usage,
  codex,
  now,
  receivedAt,
  skew,
}: {
  usage: UsageView | null;
  codex: CodexObservationView | null;
  now: number;
  receivedAt: number | null;
  skew: ClockSkew;
}): ReactNode {
  const asOf = receivedAt === null ? now : Math.max(now, receivedAt);
  return (
    <>
      <ClaudeUsageCard usage={usage} now={now} receivedAt={receivedAt} skew={skew} />
      <CodexUsageCard codex={codex} asOf={asOf} skew={skew} />
    </>
  );
}
