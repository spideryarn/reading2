/**
 * WHY THIS SESSION IS NOT DOING ANYTHING, in one line beside the badge.
 *
 * Greg, 2026-09-08: *"can you try and distinguish between statuses like
 * `Working`, `Hit usage limits`, and `Paused/waiting` […] and ideally make a
 * note of when it should reactivate (and whether it's overdue)"*.
 *
 * ## Beside the status, never instead of it
 *
 * `Pause` is an added fact rather than an eighth `FleetStatus` arm — a
 * cron-parked session and a rate-limited one are both genuinely `idle`, and the
 * reasoning is on the type in `wire.ts`. So this renders *next to* the pill and
 * the pill is unchanged. A reader who ignores this line still gets a true page.
 *
 * ## Overdue is the loud one, and it is the only loud one
 *
 * Fable's ruling, 2026-09-08: **a rate-limited session never resumes by
 * itself**, so *overdue* is deterministic rather than a guess — and it is the
 * single most actionable thing the board can say. Measured cost of not saying
 * it: a session hit its limit at 06:02 with a 06:30 reset and the next turn was
 * a person typing "Continue" at 08:21. **111 minutes of a session that could
 * have gone again.**
 *
 * Everything else here is quiet on purpose. A session waiting until 17:00 is
 * working as intended and must not compete with the one that needs a person.
 *
 * ## `cannot-tell` renders where the question arises, and `none` never does
 *
 * `none` means *we looked everywhere we can look and it is waiting for
 * nothing* — no line, because the status pill already says what it is doing.
 *
 * `cannot-tell` means a source was shut, so the calm on that row is not
 * evidence. That is worth saying — absence of a warning is not the same as a
 * warning of absence, and this page has had that wrong three times. **But only
 * where the calm is the thing you are reading.** Measured on the live box,
 * 2026-09-08: 29 of 32 rows were `cannot-tell`, and a phrase repeated on 29
 * cards is not a caveat, it is wallpaper — the state this whole module exists
 * to avoid, arrived at from the other direction.
 *
 * So the rule is the question itself. **`Pause` answers "why is this session
 * not doing anything", and on a row that IS doing something the question does
 * not arise.** A `working` row is working; a `shell` has no transcript to read
 * by construction. Neither draws an unknown. A quiet row does, because there
 * the question is live and unanswered: is this finished, or is it stuck?
 *
 * **Positive states always draw, whatever the status** — `in-a-shell-call` on a
 * `working` row is the entire point of the stage, since that is the session the
 * board has been calling *Working* while it sits blocked on a command.
 *
 * This will matter more this week than later: the rate-limit collector reports
 * `unknown` until 2026-09-12, while 27 unattributable rejections from a
 * signed-out account expire (w2-usage-limits, 2026-09-08). So `cannot-tell` is
 * the common answer right now and should read as considered, not as broken.
 *
 * Nothing here is a bare number: every time carries what it is a time OF, and
 * every duration carries what it has been that long SINCE.
 */
import type { ReactNode } from "react";

import { Explain } from "./Tooltip";
import type { FleetStatus, Pause } from "./types";
import { cx } from "./ui";
import { formatDuration } from "./view";

/**
 * A clock time in the READER'S zone, which is the phone's, not the box's.
 *
 * The box runs UTC and Greg does not. A reset time is only useful if it can be
 * compared against a watch without arithmetic, so the browser formats it — and
 * an unparseable timestamp returns null rather than `Invalid Date`, because a
 * row that cannot say when something happens should say so rather than print a
 * word that looks like a value.
 */
export function clockTime(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** The two windows worth naming; anything else renders by its raw name. */
function windowName(window: string): string {
  if (window === "five_hour") return "session limit";
  if (window === "seven_day") return "weekly limit";
  return window;
}

export function PauseLine({
  pause,
  status,
  now,
  className,
}: {
  pause: Pause;
  /** Whether the question this answers arises at all. See the header. */
  status: FleetStatus;
  now: number;
  className?: string;
}): ReactNode {
  if (pause.kind === "none") return null;

  const quiet = cx("tw:text-[12px] tw:text-ink-faint", className);
  const loud = cx("tw:text-[12px] tw:font-medium tw:text-alarm-ink", className);

  if (pause.kind === "cannot-tell") {
    /* Only where the calm is the thing being read. A row that is visibly busy
       is not a row whose quiet needs explaining, and a shell has no transcript
       by construction — drawing "waiting? unknown" on those is a sentence about
       our own instrumentation on a card about somebody's agent. See the header
       for the measurement that decided it. */
    if (status.kind !== "idle") return null;
    return (
      <Explain
        tip={{
          head: "Whether it is waiting for something",
          what: "Could not tell.",
          how: `${pause.why} So a quiet row here is not evidence that nothing is waiting — one of the places we look was shut.`,
        }}
        placement="bottom"
        className={quiet}
      >
        waiting? unknown
      </Explain>
    );
  }

  if (pause.kind === "in-a-shell-call") {
    return (
      <Explain
        tip={{
          head: "In a shell call",
          what: `${formatDuration(pause.sinceMs)} so far`,
          how: "The agent is blocked on a command it started — a sleep, a test run, a build. Claude Code's own status for this is `shell`, which `claude agents --json` normalises to `busy`, which is why the board used to call it Working.",
        }}
        placement="bottom"
        className={quiet}
      >
        in a shell call {formatDuration(pause.sinceMs)}
      </Explain>
    );
  }

  const at = pause.kind === "rate-limited" ? pause.resetsAt : pause.at;
  const clock = clockTime(at);
  const what = pause.kind === "rate-limited" ? `hit its ${windowName(pause.window)}` : "waiting for a scheduled wake-up";

  /* A time we could not parse is not a time. The state is still true and still
     worth saying; what goes is the claim about when. */
  if (clock === null) {
    return (
      <Explain
        tip={{
          head: pause.kind === "rate-limited" ? "Rate limited" : "Scheduled wake-up",
          what: `It ${what}.`,
          how: `The server sent ${JSON.stringify(at)} as the time, which this page could not read — so it can say that it is waiting and not when it is due.`,
        }}
        placement="bottom"
        className={quiet}
      >
        {pause.kind === "rate-limited" ? "rate limited" : "waiting"}, time unreadable
      </Explain>
    );
  }

  const overdueMs = Math.max(0, now - Date.parse(at));

  if (pause.overdue) {
    return (
      <Explain
        tip={{
          head: "Overdue",
          what: `Due back at ${clock}, ${formatDuration(overdueMs)} ago.`,
          how:
            pause.kind === "rate-limited"
              ? "A rate-limited session does not resume by itself: it printed the error, ended its turn, and stopped. It has been able to go again since the time above and nobody has told it to."
              : "Its wake-up time has passed and it has taken no turn since.",
        }}
        placement="bottom"
        className={loud}
      >
        {pause.kind === "rate-limited" ? "rate limited" : "wake-up"} — overdue {formatDuration(overdueMs)}
      </Explain>
    );
  }

  return (
    <Explain
      tip={{
        head: pause.kind === "rate-limited" ? `Hit its ${windowName(pause.window)}` : "Scheduled wake-up",
        what: `Due back at ${clock}.`,
        how:
          pause.kind === "rate-limited"
            ? "It printed the error, ended its turn, and stopped. It will not resume on its own when the window resets — somebody has to tell it to."
            : "It asked to be woken at this time and is otherwise at a prompt, so you can still type at it now.",
      }}
      placement="bottom"
      className={quiet}
    >
      {pause.kind === "rate-limited" ? "rate limited" : "waking"} · {clock}
    </Explain>
  );
}
