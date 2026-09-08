/**
 * Pure display decisions: how old a thing reads, what a status is called, and
 * which rows come first.
 *
 * SEPARATE FROM THE COMPONENTS ON PURPOSE, and for the same reason
 * tools/fleet/page.ts is separate from server.ts: everything here is a function
 * of its arguments, so a test can say what time it is and assert a sentence
 * without mounting anything. `now` is always a parameter and never a call to
 * `Date.now()`.
 *
 * The triage bands are a restatement of `triageRank` in tools/fleet/status.ts,
 * and the duplication is the price of the client not importing node modules
 * (see the header of types.ts). The ordering decisions themselves belong to
 * that file — read its comments before changing one here, especially the two it
 * argues for: a busy shell stays in the last band, and `unknown` is not
 * promoted because one failed agents call turns every Claude row unknown at
 * once.
 */
import type { ClockSkew, FleetConsequence, FleetOptionKey, FleetRow, FleetState, FleetStatus } from "./types";

/**
 * Which colour language a row speaks.
 *
 * `alarm` is the fifth and is not a session status: it is the red the masthead
 * uses for staleness, borrowed by Box health for a `critical` reading. It is in
 * this union rather than in a second one so that a tone is a tone everywhere —
 * `toneClasses` in ui.tsx is a `Record` over exactly these names, so a sixth is
 * a type error at every call site at once rather than a quiet fall-through to
 * grey.
 */
export type Tone = "needs" | "work" | "idle" | "unknown" | "alarm";

/**
 * A duration in milliseconds, as the shortest sentence that is still true.
 *
 * Rounds towards the coarser unit only once there is a coarser unit worth
 * having: 90 seconds is "1m 30s" rather than "2m", because the difference
 * between one minute and two is the difference between "it just asked" and "it
 * has been sitting there".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    const rest = secs % 60;
    return mins < 5 && rest !== 0 ? `${mins}m ${rest}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 24) return restMins === 0 ? `${hours}h` : `${hours}h ${restMins}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** Seconds, for the countdown a `waiting` session carries. */
export function formatSeconds(secondsLeft: number): string {
  return formatDuration(Math.max(0, secondsLeft) * 1000);
}

/**
 * How old the snapshot is, in words — or null when there has never been one.
 *
 * **This is the load-bearing sentence on the page.** A dashboard that has
 * stopped updating and looks current is the failure mode this whole tool keeps
 * hitting, so the age is never absent and never inferred from the fact that
 * something is drawn.
 */
export function collectedAge(state: FleetState | null, now: number): number | null {
  if (state === null || state.collectedAt === null) return null;
  const at = Date.parse(state.collectedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, now - at);
}

/**
 * **How far this device's clock has to be out before the page mentions it.**
 *
 * One minute, and the number comes from `formatDuration` above rather than from
 * a threshold elsewhere: nothing on this page prints a duration finer than a
 * whole minute once it is past a minute, so a skew smaller than this cannot
 * move a number a reader can see. Past it, the correction at the parse boundary
 * is doing visible work and the reader is entitled to know why the times on
 * their phone and the times on the box disagree.
 *
 * Deliberately NOT the 2m 30s staleness threshold or the 30-minute transcript
 * one. Those are thresholds for ALARMS, and the ages they guard are corrected
 * now — this is not an alarm, it is a fact about the device, and tying it to a
 * number that exists for something else would make it move for the wrong reason.
 */
export const CLOCK_SKEW_NOTICE_MS = 60_000;

/**
 * One quiet line about the reader's own clock, or null when there is nothing to
 * say.
 *
 * **Without it a corrected page and a broken clock look identical.** Every age
 * here is shifted into this device's terms (types.ts § `ClockSkew`), so a phone
 * five minutes fast now reads correctly — and that is exactly why it has to be
 * said out loud: it is the one fact on this page nothing else will ever tell
 * the reader, and it explains any residual oddness between what this says and
 * what a terminal on the box says.
 *
 * **`unknown` draws nothing.** A server too old to send `servedAt` has made no
 * claim about its clock, and "we could not check your clock" is a sentence
 * about us that a reader can do nothing with — the same reason
 * `AttentionPanel` draws nothing at all for `not-asked`.
 *
 * Not loud, not red, and not a `Tip`: it is furniture, and an alarm here would
 * be one more thing that is on when nothing is wrong.
 */
export function clockNote(skew: ClockSkew): string | null {
  if (skew.kind === "unknown") return null;
  if (Math.abs(skew.ms) < CLOCK_SKEW_NOTICE_MS) return null;
  /* `skew.ms` is the server's clock minus this browser's, so a NEGATIVE skew is
     a device running fast — which is the case that was manufacturing alarms. */
  const direction = skew.ms < 0 ? "ahead of" : "behind";
  return `this device's clock is ${formatDuration(Math.abs(skew.ms))} ${direction} the box's — the times here are corrected for it`;
}

/** How long a session has been up, or null when its start time is unreadable. */
export function uptime(row: FleetRow, now: number): number | null {
  const at = Date.parse(row.startedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, now - at);
}

/**
 * How a status reads, and which band it belongs to.
 *
 * `unknown` shows its reason rather than a shrug — that is the whole point of
 * carrying one. A row nobody could ask about must not look like a quiet one.
 */
export function statusLabel(status: FleetStatus): { text: string; detail: string | null; tone: Tone } {
  switch (status.kind) {
    case "needs-you":
      return { text: "needs you", detail: null, tone: "needs" };
    case "working":
      return { text: "working", detail: null, tone: "work" };
    case "idle":
      return { text: "idle", detail: null, tone: "idle" };
    case "waiting":
      return { text: `waiting ${formatSeconds(status.secondsLeft)}`, detail: null, tone: "idle" };
    case "no-claude":
      return { text: "no agent", detail: null, tone: "idle" };
    case "shell":
      return {
        text: status.busy === null ? "shell" : status.busy ? "shell, busy" : "shell",
        detail: status.busy === null ? "the box could not say whether it is busy" : null,
        tone: "idle",
      };
    case "unknown":
      return { text: "unknown", detail: status.why, tone: "unknown" };
    default: {
      // Unreachable through `parseStatus`, which maps an unrecognised kind onto
      // `unknown` before it gets here. Kept so that adding an eighth arm to the
      // type fails to compile rather than inheriting a band.
      const never: never = status;
      return never;
    }
  }
}

/**
 * Which of the three bands a status belongs to. Lower sorts higher.
 *
 * The bands are Greg's, out of docs/project/overseer-direction.md: the
 * first question the page answers is *does anyone need something from me*, and
 * the second is *what is actually moving*. Everything else is one band, because
 * a screen with seven ranks is a screen nobody reads the bottom of.
 */
export function triageBand(status: FleetStatus): 0 | 1 | 2 {
  switch (status.kind) {
    case "needs-you":
      return 0;
    case "working":
      return 1;
    case "idle":
    case "waiting":
    case "no-claude":
    case "shell":
    case "unknown":
      return 2;
    default: {
      const never: never = status;
      return never;
    }
  }
}

/**
 * Triage order: who needs you, then what is moving, then everything else —
 * newest first within each band.
 *
 * **Copies rather than sorting in place**, because the argument is somebody's
 * snapshot and a poll handing the same array to two renderers is how that turns
 * into a bug you only see under load.
 *
 * A `startedAt` that will not parse sorts LAST within its band rather than
 * anywhere. `Date.parse` answers `NaN` instead of throwing, every comparison
 * with `NaN` is false, and a comparator that subtracts them returns `NaN` —
 * which sorts as "equal to everything", so the row lands wherever the sort
 * happened to walk and the page looks fine. tools/fleet/status.ts hit exactly
 * this and its comment is the longer version.
 */
export function triageSort(rows: readonly FleetRow[]): FleetRow[] {
  return [...rows].sort((a, b) => {
    const byBand = triageBand(a.status) - triageBand(b.status);
    if (byBand !== 0) return byBand;
    const at = Date.parse(a.startedAt);
    const bt = Date.parse(b.startedAt);
    return (Number.isFinite(bt) ? bt : -Infinity) - (Number.isFinite(at) ? at : -Infinity);
  });
}

/** How many rows are in each band, for the header. */
export type Tally = { needsYou: number; working: number; other: number; unknown: number };

/**
 * The counts the header shows.
 *
 * `unknown` is counted separately and shown BESIDE the others whenever it is
 * non-zero, rather than folded into "idle". One failed agents call turns every
 * Claude row unknown at once, and a header reading "0 need you" over eleven
 * unanswerable rows is the lie the status module exists to prevent.
 */
export function tally(rows: readonly FleetRow[]): Tally {
  const out: Tally = { needsYou: 0, working: 0, other: 0, unknown: 0 };
  for (const row of rows) {
    const band = triageBand(row.status);
    if (band === 0) out.needsYou += 1;
    else if (band === 1) out.working += 1;
    else out.other += 1;
    if (row.status.kind === "unknown") out.unknown += 1;
  }
  return out;
}

/** `repo · worktree`, with the parts that are genuinely unknown simply absent. */
export function whereLine(row: FleetRow): string | null {
  const parts = [row.repo, row.worktree].filter((p): p is string => p !== null && p !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * What to press to choose an option, said in one short phrase.
 *
 * **It describes the keystroke, not the button.** Since 2026-09-08 the detail
 * pane can answer a dialog, and the phrase sits beside the button that does it
 * — so it says what would be typed at the terminal, which is the thing a reader
 * cannot see and the one fact that makes the answer checkable afterwards.
 *
 * `unrecognised` means THIS BUILD cannot describe the keystroke, and nothing
 * may be disabled on the strength of it: the object that goes back to the
 * server is the server's own, so a newer server may understand a key this one
 * has no words for (types.ts § `rawQuestion`).
 */
export function optionHint(key: FleetOptionKey): string {
  switch (key.via) {
    case "digit":
      return `press ${key.digit}`;
    case "arrows":
      return `${key.key} ×${key.presses}, then Enter`;
    case "selected":
      return "already selected — Enter";
    case "unrecognised":
      return "keystroke unknown";
    default: {
      const never: never = key;
      return never;
    }
  }
}

/* ------------------------------------------------------------- ordering -- */

/**
 * The ways the list can be sorted.
 *
 * Greg, 2026-09-08: *"list all the sessions in the left-hand column, with
 * different ways to order them (how long they've been running, status (the
 * default), anything else that might be ueful, etc)"*.
 *
 * **`status` is the default and it is the one the page is for** — see the head
 * of SessionsPanel.tsx. The others exist because the questions they answer are
 * real ones and the triage order cannot answer them: *what has been running all
 * night*, *what did I just start*, *where is the one in that worktree*. Each is
 * a different first sort key over the same rows, and every one of them falls
 * back to the same tiebreak so that two rows never swap places between renders
 * for no reason.
 *
 * A `Record` keyed by the union rather than a list of objects with a `key`, so
 * a fifth ordering is a type error at the label table, the sorter and the
 * control at once.
 */
export type Ordering = "status" | "longest" | "newest" | "name" | "where";

export const ORDERINGS: readonly Ordering[] = ["status", "longest", "newest", "name", "where"];

export const ORDERING_LABELS: Record<Ordering, string> = {
  status: "Status",
  longest: "Longest running",
  newest: "Newest",
  name: "Name",
  where: "Repo and worktree",
};

/** An ordering off the URL, or the default for anything this build does not know. */
export function parseOrdering(value: string | undefined): Ordering {
  return (ORDERINGS as readonly string[]).includes(value ?? "") ? (value as Ordering) : "status";
}

/** What a row is called, for sorting and for the list. Never the empty string. */
export function rowLabel(row: FleetRow): string {
  return row.title ?? row.name;
}

/**
 * Start time as a number, with the unparseable ones pushed to one end.
 *
 * `NaN` is the hazard the whole of `triageSort`'s comment is about: every
 * comparison with it is false and a comparator that subtracts two of them
 * returns `NaN`, which sorts as "equal to everything" — so the row lands
 * wherever the sort happened to walk and the page looks fine. One helper, so
 * there is one place that decides.
 */
function startedMs(row: FleetRow): number | null {
  const at = Date.parse(row.startedAt);
  return Number.isFinite(at) ? at : null;
}

/** Ascending by start time; a row with no readable start time sorts last. */
function byStart(a: FleetRow, b: FleetRow, oldestFirst: boolean): number {
  const at = startedMs(a);
  const bt = startedMs(b);
  if (at === null && bt === null) return 0;
  if (at === null) return 1;
  if (bt === null) return -1;
  return oldestFirst ? at - bt : bt - at;
}

/**
 * The rows in the order the reader asked for. **Copies rather than sorting in
 * place**, because the argument is somebody's snapshot and a poll handing the
 * same array to two renderers is how that becomes a bug you only see under
 * load.
 *
 * Every arm ends at the same tiebreak — the tmux handle, which is unique and
 * stable — so a list of identically-named sessions has a fixed order rather
 * than whatever the sort walked into.
 */
export function sortRows(rows: readonly FleetRow[], order: Ordering): FleetRow[] {
  if (order === "status") return triageSort(rows);
  const compare = (a: FleetRow, b: FleetRow): number => {
    switch (order) {
      case "longest":
        return byStart(a, b, true);
      case "newest":
        return byStart(a, b, false);
      case "name":
        return rowLabel(a).localeCompare(rowLabel(b), undefined, { sensitivity: "base" });
      case "where": {
        /* A session with no repo goes last rather than sorting under the empty
           string, where it would sit above everything and look like the most
           important thing on the page. */
        const aw = whereLine(a);
        const bw = whereLine(b);
        if (aw === null && bw === null) return 0;
        if (aw === null) return 1;
        if (bw === null) return -1;
        return aw.localeCompare(bw, undefined, { sensitivity: "base" });
      }
      default: {
        const never: never = order;
        return never;
      }
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}

/* ---------------------------------------------------- what an option does -- */

/**
 * How alarming a tone is, as a number.
 *
 * It exists so that the rule below can be CHECKED rather than remembered. Two
 * tones can be equally alarming — `idle` and `work` are both "nothing to see
 * here" — so this is a rank, not an ordering of the union.
 */
export const TONE_ALARM: Record<Tone, number> = {
  idle: 0,
  work: 0,
  unknown: 1,
  needs: 2,
  alarm: 3,
};

/**
 * How far an option reaches, ranked — and **`unknown` is not the mild one.**
 *
 * `classifyConsequence` in tools/fleet/pane.ts is a reading of English off a
 * terminal, written to be wrong in one direction only: nothing falls through to
 * `once`, and anything it does not recognise is `unknown`. Its own comment says
 * the client must treat `unknown` as **at least as serious as `persistent`**.
 *
 * **The trap this table exists to avoid**: draw `persistent` in red and
 * `unknown` in neutral grey, and the conservative default becomes the least
 * alarming badge on screen — so a new Claude Code label ("Yes, and remember
 * this") would classify as `unknown` and render as the safest-looking thing
 * there. The guarantee would be exactly inverted, silently, by a colour choice.
 *
 * So the rule is written as an inequality over these tables and the suite holds
 * it, rather than as a comment asking the next person to be careful.
 */
export const CONSEQUENCE_RANK: Record<FleetConsequence, number> = {
  decline: 0,
  once: 1,
  persistent: 2,
  unknown: 3,
};

export const CONSEQUENCE_TONE: Record<FleetConsequence, Tone> = {
  decline: "idle",
  once: "idle",
  persistent: "alarm",
  /* At least as alarming as `persistent`, by the rule above. Equal rather than
     louder: shouting more about the one we are unsure of than about the one we
     know is persistent would train a reader to ignore both. */
  unknown: "alarm",
};

/** What the badge says. Short — it sits at the end of an option's own sentence. */
export const CONSEQUENCE_LABEL: Record<FleetConsequence, string> = {
  decline: "declines",
  once: "this time only",
  persistent: "and from now on",
  unknown: "unclassified — assume it is from now on",
};

/** The longer version, for the card the badge carries. */
/**
 * The second half of the card — what a reader could NOT have guessed by
 * pressing the control (docs/project/tooltips.md).
 *
 * **A Record rather than one sentence for all four, because one sentence said
 * the same thing twice on the arm that matters.** `unknown`'s `what` already
 * explains that the classifier is written to be wrong in one direction only and
 * that anything it cannot place is drawn as loudly as a permanent choice — so a
 * `how` repeating both, which is what shipped, filled the slot reserved for new
 * information with an echo. Found in a screenshot rather than in a review:
 * rendered together the two paragraphs read as one point made twice, and
 * neither is wrong on its own.
 *
 * The three classified arms keep the one-direction sentence, because for those
 * it IS the unguessable part: a reader looking at "Yes, and don't ask again"
 * has no way to know the label was matched by a rule that deliberately errs
 * loud.
 */
export const CONSEQUENCE_HOW: Record<FleetConsequence, string> = {
  decline:
    "Worked out from the wording of the label, which is all the terminal gives us. It is written to be wrong in one direction only, so anything it cannot classify is drawn as loudly as a permanent choice.",
  once: "Worked out from the wording of the label, which is all the terminal gives us. It is written to be wrong in one direction only, so anything it cannot classify is drawn as loudly as a permanent choice.",
  persistent:
    "Worked out from the wording of the label, which is all the terminal gives us. It is written to be wrong in one direction only, so anything it cannot classify is drawn as loudly as a permanent choice.",
  /* NOT a repeat of `what`. What a reader cannot guess here is that the badge
     says nothing about THIS option in particular — every option on an
     AskUserQuestion is unclassified, because the agent writes its own labels
     and none of them says "yes". */
  unknown:
    "The wording of the label is all the terminal gives us, and this one matches nothing the classifier knows. On a question an agent wrote itself, that is normal and every option will say the same — it is the answer to how far this goes, not a judgement about this option against the others.",
};

export const CONSEQUENCE_WHAT: Record<FleetConsequence, string> = {
  decline: "Refuses this one thing. The session carries on and asks again next time.",
  once: "Approves this action and nothing after it.",
  persistent: "Approves this AND changes what the session will approve on its own from now on, without asking.",
  unknown:
    "The label is not one this page recognises, so nobody can say how far it reaches. It is drawn as loudly as a persistent choice on purpose: the classifier is written to be wrong in one direction only, so a new wording arrives here rather than in the mild bucket.",
};
