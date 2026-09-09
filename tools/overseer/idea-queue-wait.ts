/**
 * HOW LONG UNTIL MY IDEA GETS PICKED UP — answered with observations, not a
 * forecast.
 *
 * Greg asked for this by name: *"get an estimate of how long the wait time is"*.
 * What this module produces is deliberately less than that sentence, and the
 * reason is the whole of the header. **It is flagged for him in the plan as a
 * place where he asked for one thing and is getting a narrower one**, so he can
 * overrule it; it is not a scope cut made quietly.
 *
 * ## The forecast that was built and then deleted
 *
 * *Position in queue × median session length ÷ concurrency.* A first version of
 * this file computed exactly that, with a ±60% band and its assumptions
 * printed. GPT Sol rejected it twice over (P1-5 and its answer 3), and it was
 * right on every term:
 *
 *  - **Median session length is a fact about the mix of work**, not about any
 *    item. Sessions here run from a ten-minute doc fix to a six-hour build, and
 *    the mix changes with whatever Greg is thinking about that week.
 *  - **A session is not a queue item.** Most sessions on this box were never
 *    queued at all — Greg types "New-claude: …" and one starts — so measuring
 *    the fleet to predict the queue measures the wrong population.
 *  - **`startedAt → tmux-session-gone` is session lifetime, not work
 *    duration.** It includes planning, reviews, blocked time, the debrief and a
 *    lingering shell. It is also *censored*: the six-hour sessions still running
 *    are missing from the sample of completed ones, so the average of what has
 *    finished is biased short by construction.
 *  - **Concurrency is a policy number.** The Overseer holds itself to a handful
 *    of dispatches and stops on the usage window; dividing by it dresses a
 *    choice somebody made this evening as a property of the system.
 *  - And the queue is not FIFO anyway: *"a lull"* work starts only when nothing
 *    more important is waiting, so ordinal position does not convert to time.
 *
 * **A wide range does not repair a wrong estimator** — Sol's sentence, and the
 * thing worth remembering. Padding a number that measures the wrong quantity
 * makes it unfalsifiable rather than honest.
 *
 * ## What this returns instead
 *
 * *"Three queue items dispatched in the last 7 days"* is an observation.
 * *"About four days"* is an inference this data cannot support. So: depth,
 * split by why each item is not moving, and throughput over two windows with
 * the sample count attached. A reader who can see *twelve waiting, five need
 * you, two running, three went out last week* has most of what a forecast would
 * have told them and none of its false precision.
 *
 * The duration is not gone forever: once the queue has enough of its own
 * `dispatched → done` observations, grouped by declared size, a real one becomes
 * possible. `throughput` is what will measure it, and until then it says how far
 * off that is.
 */
import { isDispatchable, type IdeaItem, type QueueView } from "./idea-queue.js";

/** The two windows. Short enough to notice a change, long enough to have anything in it. */
export const WINDOWS_DAYS: readonly number[] = [7, 30];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How deep the queue is, split by **why** each item is not moving.
 *
 * The split is the useful part. A single number conflates *nobody has got to it*
 * with *it is waiting on you*, and only one of those is Greg's to fix — which
 * makes the second the one worth putting in front of him.
 */
export type QueueDepth = {
  /** Authorised, unblocked, waiting for a slot. The only ones a rate would apply to. */
  readonly dispatchable: number;
  /** Waiting on Greg for an answer, not on a slot. */
  readonly needsGreg: number;
  /** Proposals nobody has authorised, and approvals lapsed by a later edit. */
  readonly unauthorized: number;
  /** Running now. */
  readonly dispatched: number;
  readonly done: number;
  readonly dropped: number;
};

export function queueDepth(view: QueueView): QueueDepth {
  let dispatchable = 0;
  let needsGreg = 0;
  let unauthorized = 0;
  let dispatched = 0;
  for (const item of view.items) {
    if (item.lifecycle === "dispatched") {
      dispatched += 1;
      continue;
    }
    if (isDispatchable(view, item)) dispatchable += 1;
    /* **The order of these two matters, and it is not arbitrary.** An item can
       be both unauthorised and waiting on Greg; counting it twice would make the
       parts exceed the whole, and a reader adding the numbers up would find the
       queue longer than it is. Needing Greg is reported in preference because it
       is the actionable half. */
    else if (item.needsGreg) needsGreg += 1;
    else unauthorized += 1;
  }
  return {
    dispatchable,
    needsGreg,
    unauthorized,
    dispatched,
    done: view.settled.filter((i) => i.lifecycle === "done").length,
    dropped: view.settled.filter((i) => i.lifecycle === "dropped").length,
  };
}

/** What went out in one window. */
export type Window = {
  readonly days: number;
  /** Items dispatched in the window. */
  readonly dispatched: number;
  /** Items that finished in the window. */
  readonly done: number;
};

/**
 * What the queue has actually done, per window — **measured on the queue
 * itself**, from its own events.
 *
 * Not from the fleet's session log, which is the mistake the header is about:
 * an item's `dispatched` event is the event being predicted, so counting those
 * measures the right population.
 */
export type Throughput = {
  readonly windows: readonly Window[];
  /** Every dispatch this queue has ever recorded. The sample a future estimate would use. */
  readonly dispatchesEver: number;
  /** Every completion. */
  readonly completionsEver: number;
  /**
   * Whether there is yet enough of this queue's own history to say anything
   * about duration — and, while there is not, the sentence saying so.
   *
   * **A separate field rather than a number the caller compares**, so that the
   * page cannot accidentally render a confident figure by forgetting a `<`.
   */
  readonly duration: { readonly kind: "not-enough"; readonly why: string };
};

/** How many completions it would take before a duration is worth computing. */
export const ENOUGH_COMPLETIONS = 8;

function touchTimes(items: readonly IdeaItem[], kind: "dispatched" | "done"): number[] {
  const times: number[] = [];
  for (const item of items) {
    for (const touch of item.history) {
      if (touch.kind !== kind) continue;
      const ms = Date.parse(touch.at);
      if (!Number.isNaN(ms)) times.push(ms);
    }
  }
  return times;
}

export function throughput(view: QueueView, nowMs: number, windowsDays: readonly number[] = WINDOWS_DAYS): Throughput {
  const all = [...view.items, ...view.settled];
  const dispatches = touchTimes(all, "dispatched");
  const completions = touchTimes(all, "done");

  const windows = windowsDays.map((days) => {
    const from = nowMs - days * DAY_MS;
    return {
      days,
      dispatched: dispatches.filter((t) => t >= from && t <= nowMs).length,
      done: completions.filter((t) => t >= from && t <= nowMs).length,
    };
  });

  return {
    windows,
    dispatchesEver: dispatches.length,
    completionsEver: completions.length,
    duration: {
      kind: "not-enough",
      why:
        completions.length === 0
          ? "nothing has been through this queue yet, so there is nothing to time. That is the ordinary " +
            "state of a new queue, not a fault — the counts above are the honest answer."
          : `${completions.length} completion${completions.length === 1 ? "" : "s"} so far; it takes about ` +
            `${ENOUGH_COMPLETIONS}, grouped by size, before a duration would mean anything. Until then the ` +
            "counts above are the honest answer.",
    },
  };
}

/**
 * What can be said about one item's wait.
 *
 * Four arms, and none of them is a duration. **Naming which kind of "I cannot
 * say" this is** follows the house rule
 * ([fleet-dashboard-modes.md](../../docs/project/fleet-dashboard-modes.md)): a
 * reading nobody could take must never render as a confident value, and the
 * several ways of having nothing to say must not collapse into one. *Running*,
 * *waiting on you*, and *nobody has approved it* send a reader to three
 * different actions; "unknown" sends them nowhere.
 */
export type ItemWait =
  | { readonly kind: "ahead"; readonly ahead: number; readonly why: string }
  | { readonly kind: "running"; readonly session: string | null; readonly why: string }
  | { readonly kind: "needs-greg"; readonly waitingOn: string | null; readonly why: string }
  | { readonly kind: "not-authorized"; readonly why: string };

export function itemWait(view: QueueView, item: IdeaItem): ItemWait {
  if (item.lifecycle === "dispatched") {
    return {
      kind: "running",
      session: item.dispatchedTo,
      why: "this one is already running, so there is nothing left to wait for",
    };
  }
  if (item.needsGreg) {
    return {
      kind: "needs-greg",
      waitingOn: item.metadata.waitingOn,
      why: "waiting on an answer rather than on a slot, and no rate can predict when that arrives",
    };
  }
  if (item.authority.kind !== "authorized" || item.authority.revision !== item.revision) {
    return {
      kind: "not-authorized",
      why:
        item.authority.kind === "proposed"
          ? "a proposal — it is not waiting for a slot because nothing has authorised it yet"
          : "edited since it was authorised, so it needs a fresh yes before it is waiting for anything",
    };
  }
  let ahead = 0;
  for (const other of view.items) {
    if (other.id === item.id) break;
    if (isDispatchable(view, other)) ahead += 1;
  }
  return {
    kind: "ahead",
    ahead,
    why:
      ahead === 0
        ? "next in line — nothing authorised and unblocked is ahead of it"
        : `${ahead} item${ahead === 1 ? "" : "s"} ahead of it and ready to go`,
  };
}
