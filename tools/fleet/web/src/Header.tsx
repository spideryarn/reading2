/**
 * The masthead: the tally, the tabs, and the sentence about whether to believe
 * any of it.
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

import { MODES, MODE_LABELS, type Mode } from "./mode";
import { cx } from "./ui";
import type { FleetState } from "./types";
import { collectedAge, formatDuration, tally } from "./view";

/**
 * The freshness line, and whether it is an alarm.
 *
 * **A failure does not have to be recent to matter, and a snapshot does not
 * have to have failed to be old.** So this is stale if EITHER a refresh has
 * failed or the snapshot has aged past the threshold, and the two produce
 * different sentences because they need different reactions: one is "the server
 * is not answering", the other is "the server is answering with something old".
 */
export const STALE_AFTER_MS = 30_000;

export type Freshness = {
  stale: boolean;
  /** The short line that is always on screen. */
  age: string;
  /** The long explanation, shown only when something is wrong. */
  why: string | null;
};

export function freshness(args: {
  state: FleetState | null;
  receivedAt: number | null;
  error: string | null;
  failures: number;
  now: number;
}): Freshness {
  const { state, receivedAt, error, failures, now } = args;
  const dataAge = collectedAge(state, now);
  const heardAge = receivedAt === null ? null : Math.max(0, now - receivedAt);

  if (state === null) {
    return error === null
      ? { stale: false, age: "collecting…", why: null }
      : {
          stale: true,
          age: "no data",
          why: `Nothing has ever been collected. ${error}${failures > 1 ? ` (${failures} attempts)` : ""}`,
        };
  }

  const age = dataAge === null ? "collected at an unknown time" : `collected ${formatDuration(dataAge)} ago`;

  if (error !== null) {
    const since = heardAge === null ? "" : `, last heard ${formatDuration(heardAge)} ago`;
    return {
      stale: true,
      age,
      why: `${error}${since}${failures > 1 ? ` — ${failures} attempts in a row` : ""}. These rows are the last good ones.`,
    };
  }

  // The server can be answering while serving something old: `collect()` costs
  // about twelve seconds and the server caches it, so a stuck collection looks
  // exactly like a working one from out here. The snapshot's own age is the
  // only thing that can tell you.
  if (dataAge !== null && dataAge > STALE_AFTER_MS) {
    return {
      stale: true,
      age,
      why: `The server is answering, but the snapshot it is serving is ${formatDuration(dataAge)} old.`,
    };
  }

  return { stale: false, age, why: state.error === null ? null : `The server's last refresh failed: ${state.error}` };
}

function Tab({
  mode,
  current,
  onChoose,
}: {
  mode: Mode;
  current: Mode;
  onChoose: (mode: Mode) => void;
}): ReactNode {
  const active = mode === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onChoose(mode)}
      className={cx(
        "tw:flex-1 tw:cursor-pointer tw:rounded-lg tw:px-3 tw:py-1.5 tw:text-[13px] tw:font-medium",
        "tw:whitespace-nowrap tw:transition-colors",
        active
          ? "tw:bg-panel tw:text-ink tw:shadow-sm"
          : "tw:bg-transparent tw:text-ink-faint tw:hover:text-ink-soft",
      )}
    >
      {MODE_LABELS[mode]}
    </button>
  );
}

/** One count in the tally. Rendered only when it is non-zero, bar the total. */
function Count({ n, label, className }: { n: number; label: string; className?: string }): ReactNode {
  if (n === 0) return null;
  return (
    <span className={cx("tw:whitespace-nowrap", className)}>
      <span className="tw:font-mono tw:font-semibold">{n}</span> {label}
    </span>
  );
}

export function Header({
  state,
  fresh,
  mode,
  onChoose,
  onRefresh,
}: {
  state: FleetState | null;
  fresh: Freshness;
  mode: Mode;
  onChoose: (mode: Mode) => void;
  onRefresh: () => void;
}): ReactNode {
  const rows = state?.rows ?? [];
  const counts = tally(rows);

  return (
    <header className="tw:sticky tw:top-0 tw:z-10 tw:border-b tw:border-rule tw:bg-page/95 tw:backdrop-blur">
      <div className="tw:mx-auto tw:max-w-3xl tw:px-3 tw:pt-3">
        <div className="tw:flex tw:items-baseline tw:gap-2">
          <h1 className="tw:text-[15px] tw:font-semibold tw:tracking-tight">Fleet</h1>
          <span className="tw:text-[13px] tw:text-ink-faint">
            {rows.length} session{rows.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="tw:ml-auto tw:cursor-pointer tw:rounded-md tw:border tw:border-rule tw:px-2 tw:py-0.5 tw:text-[12px] tw:text-ink-soft tw:hover:border-rule-strong tw:hover:text-ink"
          >
            Refresh
          </button>
        </div>

        {/* The counts. `unknown` sits BESIDE the others whenever it is non-zero
            rather than being folded into "idle": one failed agents call turns
            every Claude row unknown at once, and "0 need you" over eleven
            unanswerable rows is exactly the lie this tool exists to avoid. */}
        <div className="tw:mt-1 tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5 tw:text-[13px] tw:text-ink-soft">
          <Count n={counts.needsYou} label="need you" className="tw:font-semibold tw:text-needs-ink" />
          <Count n={counts.working} label="working" className="tw:text-work-ink" />
          <Count n={counts.other - counts.unknown} label="quiet" />
          <Count n={counts.unknown} label="unknown" className="tw:font-semibold tw:text-unknown-ink" />
        </div>

        <p
          className={cx(
            "tw:mt-1 tw:text-[12px]",
            fresh.stale ? "tw:font-semibold tw:text-alarm" : "tw:text-ink-faint",
          )}
        >
          {fresh.stale ? `STALE — ${fresh.age}` : fresh.age}
        </p>

        <div
          role="tablist"
          aria-label="Fleet views"
          className="tw:mt-2 tw:mb-3 tw:flex tw:gap-1 tw:rounded-xl tw:bg-quiet-wash tw:p-1"
        >
          {MODES.map((m) => (
            <Tab key={m} mode={m} current={mode} onChoose={onChoose} />
          ))}
        </div>
      </div>

      {fresh.why !== null ? (
        <div className="tw:border-t tw:border-alarm/40 tw:bg-alarm-wash">
          <div className="tw:mx-auto tw:flex tw:max-w-3xl tw:flex-wrap tw:items-center tw:gap-2 tw:px-3 tw:py-2">
            <p className="tw:min-w-0 tw:flex-1 tw:text-[13px] tw:break-words tw:text-alarm">{fresh.why}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="tw:shrink-0 tw:cursor-pointer tw:rounded-md tw:bg-alarm tw:px-2.5 tw:py-1 tw:text-[12px] tw:font-semibold tw:text-page"
            >
              Try now
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
