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
import type { QueueDepth, QueueItemWait, QueueThroughput, QueueWindow } from "../fleet/wire.js";
import { isDispatchable, type IdeaItem, type QueueView } from "./idea-queue.js";

/** The two windows. Short enough to notice a change, long enough to have anything in it. */
export const WINDOWS_DAYS: readonly number[] = [7, 30];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How deep the queue is, split by why each item is not moving.
 *
 * **The type lives in [`wire.ts`](../fleet/wire.ts)** — it crosses the HTTP
 * boundary, so it has one home there and an alias here, rather than the twin
 * declaration that file's header is about. The argument for the split, and the
 * rule that the four fields partition the rows, is written at `QueueDepth`.
 */
export type Depth = QueueDepth;

export function queueDepth(view: QueueView): Depth {
  /* **THE QUEUE BEING HELD IS ITS OWN CATEGORY, and leaving it out produced a
     page that contradicted itself.** `isDispatchable` is false for every item
     while the file has any problem, so counting "not dispatchable and not
     waiting on Greg" as *unauthorised* made a queue with one bad line report
     `12 not approved` beside twelve rows that were all perfectly approved —
     and `itemWait` went on saying "next in line". GPT Sol's P2-2.
     Authority is now asked directly rather than inferred from the conjunction,
     so each count means what its name says whatever else is wrong. */
  const held = view.problems.length > 0;
  let dispatchable = 0;
  let needsGreg = 0;
  let unauthorized = 0;
  let queueHeld = 0;
  let dispatched = 0;
  for (const item of view.items) {
    if (item.lifecycle === "dispatched") {
      dispatched += 1;
      continue;
    }
    const approved = item.authority.kind === "authorized" && item.authority.revision === item.revision;
    /* **The order of these is not arbitrary**: an item can be several of these
       at once, and counting it twice would make the parts exceed the whole, so
       a reader adding them up would find the queue longer than it is. Each row
       is reported under its most actionable reason — the queue being broken
       first, because until it is fixed nothing else about the row matters, then
       the answer only Greg can give, then the approval only he can grant. */
    if (held) queueHeld += 1;
    else if (item.needsGreg) needsGreg += 1;
    else if (!approved) unauthorized += 1;
    else dispatchable += 1;
  }
  return {
    dispatchable,
    needsGreg,
    unauthorized,
    queueHeld,
    dispatched,
    done: view.settled.filter((i) => i.lifecycle === "done").length,
    dropped: view.settled.filter((i) => i.lifecycle === "dropped").length,
  };
}

/** What went out in one window. Aliased from `wire.ts`. */
export type Window = QueueWindow;

/**
 * What the queue has actually done, per window — measured on the queue itself.
 *
 * Aliased from `wire.ts`, where the argument for `duration` having exactly one
 * arm is written out.
 */
export type Throughput = QueueThroughput;

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
 * What can be said about one item's wait. Aliased from `wire.ts`, where the
 * four arms and the reason they are not collapsed are argued.
 */
export type ItemWait = QueueItemWait;

export function itemWait(view: QueueView, item: IdeaItem): ItemWait {
  /* **THE QUEUE'S OWN CONDITION COMES FIRST.** While the file has a problem
     nothing in it may be dispatched, so "next in line" would be a promise the
     queue cannot keep — and the panel was making it, in the same view as the
     alarm saying otherwise. Sol's P2-2. */
  if (view.problems.length > 0 && item.lifecycle !== "dispatched") {
    return {
      kind: "queue-held",
      why:
        `the queue file has ${view.problems.length} unresolved problem(s), so nothing in it is waiting for a ` +
        `slot — it is waiting for somebody to fix the record`,
    };
  }
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
