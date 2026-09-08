/**
 * The masthead: the tally, and the sentence about whether to believe any of it.
 *
 * **The mode switch used to be here and is now the bottom bar** (Dock.tsx),
 * which is the product's argument imported wholesale: on a phone the top of the
 * screen is the furthest thing from a thumb, and this page is read one-handed.
 * What is left up here is the two things you read rather than press.
 *
 * ## Staleness is the feature, not the furniture
 *
 * > A page that has stopped updating and looks current is the failure mode this
 * > whole project keeps hitting.
 *
 * So three separate facts are on screen whenever they are known, and none of
 * them is inferred from the fact that something is drawn:
 *
 *  - **how old the data is** — `collectedAt`, i.e. when the box was last asked;
 *  - **how long since we heard anything** — stamped by the client when a
 *    payload arrived, which is a fact about the connection rather than the box.
 *    These come apart: the server can be answering perfectly while serving a
 *    cached snapshot from an hour ago, and only the first number says so.
 *  - **what went wrong**, in the server's or the browser's own words, plus how
 *    many attempts have failed in a row.
 *
 * The banner is red and says STALE. It never replaces the rows underneath it —
 * a fleet you cannot currently reach is not an empty fleet — and it carries a
 * button, because "it will retry eventually" is not something a person standing
 * in front of a broken page can see.
 */
import type { ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import { Button, cx } from "./ui";
import type { FleetState } from "./types";
import { clockNote, collectedAge, formatDuration, tally } from "./view";

/**
 * **How far past the collector's own cadence a snapshot has to be before the
 * page stops believing it.**
 *
 * A multiplier, not a duration — which is the whole fix. This was
 * `STALE_AFTER_MS = 30_000` until a browser pass watched the live page for
 * ninety seconds and found it red for most of every cycle: the collector runs
 * every 55–60 seconds, deliberately, because one collection costs the box about
 * ten seconds of transcript-grepping. So the page was crying wolf by design,
 * and a banner that is on most of the time is one nobody reads — which costs
 * this tool the single signal it is built around.
 *
 * 2.5 is a missed collection plus most of a second one. Below 2, one late poll
 * on a loaded box is an alarm; much above 3, a collector that has genuinely
 * stopped gets three minutes of silence before anybody is told.
 */
export const STALE_AFTER_CADENCES = 2.5;

/**
 * What to assume until the page has watched two collections happen.
 *
 * It is the observed cadence on 2026-09-08 and it is a **fallback**, not the
 * rule: `state.refreshMs` beats it if the server ever sends one, and the
 * cadence `useFleetState` measures beats it as soon as a second distinct
 * snapshot lands, which is a minute. Written here rather than inline so there
 * is one place to look when the number is wrong.
 */
export const ASSUMED_CADENCE_MS = 60_000;

/**
 * **WHICH KIND OF STALE THIS IS: a loop that stopped, or one that hung.**
 *
 * The two look identical from a snapshot's age alone, and they are the two
 * halves of the fault `attemptedAt` was added for. A collection that never
 * settles throws nothing, so `error` stays null and everything else on this
 * masthead says calm — measured at ~30 minutes stale with `error: null`, which
 * reads as a slightly-quiet box rather than as a dashboard that stopped looking.
 *
 * `attemptedAt` is set BEFORE every attempt, so the comparison is the whole
 * diagnostic: an attempt LATER than the last success is one that began and has
 * not come back, and no attempt since the last success is a loop that is no
 * longer running. `readAttemptClock` (tools/fleet/attempt-clock.ts) is what turns
 * the raw field into the three cases, and the third of them — a server that does
 * not report it — must not be read as *never attempted*, which would print
 * "wedged" over every older server.
 *
 * Appended only to the STALE sentence. On a fresh snapshot there is nothing to
 * diagnose, and a line explaining which kind of fine it is would be the caveat
 * on every row that Fable's rule is about.
 */
export function attemptNote(state: FleetState, now: number): string {
  const clock = state.attemptedAt;
  if (clock.kind === "never-attempted") {
    return "No collection has ever been started, so this is a collector that has not run rather than one that is late.";
  }
  /* NOT A FAULT AND NOT A WEDGE. Say what is missing rather than guess what it
     would have said — the same discipline as the payload's own `not-asked`. */
  if (clock.kind === "not-reported") return `Whether one is still being attempted cannot be told: ${clock.why}.`;

  const attemptedAgo = Math.max(0, now - Date.parse(clock.at));
  const collected = state.collectedAt === null ? null : Date.parse(state.collectedAt);
  const laterThanSuccess = collected === null || Date.parse(clock.at) > collected;
  return laterThanSuccess
    ? `A collection was started ${formatDuration(attemptedAgo)} ago and has not finished — this is a run that hung, not a quiet box.`
    : "No collection has been started since that one finished, so the loop itself has stopped rather than a single run hanging.";
}

export type Freshness = {
  stale: boolean;
  /** The short line that is always on screen. */
  age: string;
  /** The long explanation, shown only when something is wrong. */
  why: string | null;
  /** The card the age line carries, so the threshold is never a mystery. */
  tip: Tip;
};

export function freshness(args: {
  state: FleetState | null;
  receivedAt: number | null;
  error: string | null;
  failures: number;
  now: number;
  /** What the page has watched happen. See `useFleetState`. */
  cadenceMs?: number | null;
}): Freshness {
  const { state, receivedAt, error, failures, now } = args;
  const dataAge = collectedAge(state, now);
  const heardAge = receivedAt === null ? null : Math.max(0, now - receivedAt);

  /* Told, then observed, then assumed — in that order, because being told is
     better than inferring and inferring is better than guessing. */
  const cadence = state?.refreshMs ?? args.cadenceMs ?? ASSUMED_CADENCE_MS;
  const staleAfter = cadence * STALE_AFTER_CADENCES;

  const source =
    state?.refreshMs != null
      ? "which the server tells us"
      : args.cadenceMs != null
        ? "measured from the gap between the last two snapshots"
        : "assumed, until this page has seen two collections";
  const heard = heardAge === null ? "nothing has arrived yet" : `last heard from ${formatDuration(heardAge)} ago`;

  const tip: Tip = {
    head: "How old this is",
    what: `The box is collected about every ${formatDuration(cadence)} (${source}), and one collection costs it around ten seconds of work — so a number a minute old is normal, not a fault.`,
    /* **The word this line goes red and prints is deliberately not in here.**
       The page must be searchable for it: `tests/fleet-web.test.tsx` asserts
       that nothing on a healthy page says it, which is the broadest guard there
       is against the banner appearing when it should not — and an explanation
       that quoted the word would satisfy that search on every page and quietly
       retire the check. The sentence works without it; the check does not. */
    how: `This line goes red past ${formatDuration(staleAfter)}, or the moment a refresh fails — whichever comes first. Right now: ${heard}.`,
  };

  if (state === null) {
    return error === null
      ? { stale: false, age: "collecting…", why: null, tip }
      : {
          stale: true,
          age: "no data",
          why: `Nothing has ever been collected. ${error}${failures > 1 ? ` (${failures} attempts)` : ""}`,
          tip,
        };
  }

  /**
   * **`collectedAt: null` means the first collection has not finished**, which
   * is a different thing from a snapshot whose timestamp will not parse — and a
   * very different thing from an empty box. The server answers `rows: []`,
   * `collectedAt: null`, `error: null` for the ten seconds after a restart, and
   * a page that reads that as "collected at an unknown time" over an empty list
   * tells you the box is idle while thirty-six agents run on it.
   *
   * It is not stale, either: nothing has aged, so there is nothing to disbelieve
   * yet. The panel says what is happening (`SessionsPanel`), and this line
   * agrees with it.
   */
  const neverCollected = state.collectedAt === null;
  const age = neverCollected
    ? "collecting…"
    : dataAge === null
      ? "collected at an unknown time"
      : `collected ${formatDuration(dataAge)} ago`;

  if (error !== null) {
    const since = heardAge === null ? "" : `, last heard ${formatDuration(heardAge)} ago`;
    return {
      stale: true,
      age,
      why: `${error}${since}${failures > 1 ? ` — ${failures} attempts in a row` : ""}. These rows are the last good ones.`,
      tip,
    };
  }

  // The server can be answering while serving something old: `collect()` costs
  // about twelve seconds and the server caches it, so a stuck collection looks
  // exactly like a working one from out here. The snapshot's own age is the
  // only thing that can tell you.
  if (dataAge !== null && dataAge > staleAfter) {
    return {
      stale: true,
      age,
      why:
        `The server is answering, but the snapshot it is serving is ${formatDuration(dataAge)} old — over ` +
        `${formatDuration(staleAfter)}, which is ${STALE_AFTER_CADENCES}× its usual ${formatDuration(cadence)}. ` +
        attemptNote(state, now),
      tip,
    };
  }

  return {
    stale: false,
    age,
    why: state.error === null ? null : `The server's last refresh failed: ${state.error}`,
    tip,
  };
}

/** One count in the tally. Rendered only when it is non-zero. */
function Count({ n, label, className }: { n: number; label: string; className?: string }): ReactNode {
  if (n === 0) return null;
  return (
    <span className={cx("tw:whitespace-nowrap", className)}>
      <span className="tw:font-mono tw:font-semibold">{n}</span> {label}
    </span>
  );
}

/**
 * The width everything on the page agrees on.
 *
 * Wide, and the panels narrow themselves rather than the shell narrowing them:
 * a masthead pinned to 48rem over a three-column list would read as two
 * unrelated pages. `--safe-left`/`--safe-right` are here because this is the
 * element that meets the notch in landscape.
 */
export const SHELL = "tw:mx-auto tw:w-full tw:max-w-[96rem] tw:px-[calc(0.75rem+var(--safe-left))]";

export function Header({
  state,
  fresh,
  onRefresh,
}: {
  state: FleetState | null;
  fresh: Freshness;
  onRefresh: () => void;
}): ReactNode {
  const rows = state?.rows ?? [];
  const counts = tally(rows);
  /* **THE ONE LINE ABOUT THE READER'S OWN DEVICE.** Every age above is already
     shifted into this browser's terms at the parse boundary, so this changes
     nothing about them — it exists because a corrected page and a broken clock
     otherwise look identical, and because nothing else will ever tell Greg his
     phone is five minutes fast. Quiet by construction: no colour, no card, and
     nothing at all under a minute (view.ts § `CLOCK_SKEW_NOTICE_MS`).

     Three outcomes, not two: a measured skew worth mentioning, a measured one
     too small to move a printed number (silence), and a skew that could not be
     measured at all — which says so rather than passing as the second, because
     an unmeasured correction and a zero one draw the same page. */
  const clock = state === null ? null : clockNote(state.clockSkew);

  return (
    <header className="masthead">
      <div className={cx(SHELL, "tw:py-2.5")}>
        <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-3 tw:gap-y-1">
          <h1 className="tw:text-[15px] tw:font-semibold tw:tracking-tight">Fleet</h1>
          <span className="tw:text-[13px] tw:text-ink-faint">
            {rows.length} session{rows.length === 1 ? "" : "s"}
          </span>

          {/* The counts. `unknown` sits BESIDE the others whenever it is
              non-zero rather than being folded into "idle": one failed agents
              call turns every Claude row unknown at once, and "0 need you" over
              eleven unanswerable rows is exactly the lie this tool exists to
              avoid. */}
          <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5 tw:text-[13px] tw:text-ink-soft">
            <Count n={counts.needsYou} label="need you" className="tw:font-semibold tw:text-needs-ink" />
            <Count n={counts.working} label="working" className="tw:text-work-ink" />
            <Count n={counts.other - counts.unknown} label="quiet" />
            <Count n={counts.unknown} label="unknown" className="tw:font-semibold tw:text-unknown-ink" />
          </div>

          {/* The age, and the card that says what "stale" means and when we
              last heard anything. `Explain` puts the same sentence in the
              button's accessible name, so it is not hover-only — which matters
              most here, because this line is the one thing on the page you are
              most likely to be squinting at on a phone. */}
          <Explain
            tip={fresh.tip}
            placement="bottom"
            className={cx(
              "tw:ml-auto tw:text-[12px]",
              fresh.stale ? "tw:font-semibold tw:text-alarm" : "tw:text-ink-faint",
            )}
          >
            {fresh.stale ? `STALE — ${fresh.age}` : fresh.age}
          </Explain>
        </div>

        {/* Its own row rather than another item in the wrap above, so that on a
            phone it never lands between the tally and the age and pushes the
            one number this page is read for onto a second line. */}
        {clock === null ? null : (
          <p className="tw:mt-0.5 tw:text-[12px] tw:text-ink-faint">{clock}</p>
        )}
      </div>

      {fresh.why !== null ? (
        <div className="tw:border-t tw:border-alarm/40 tw:bg-alarm-wash">
          <div className={cx(SHELL, "tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:py-2")}>
            <p className="tw:min-w-0 tw:flex-1 tw:text-[13px] tw:break-words tw:text-alarm">{fresh.why}</p>
            <Button variant="loud" onClick={onRefresh}>
              Try now
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
