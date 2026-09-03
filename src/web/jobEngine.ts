/**
 * **The thing that actually walks an ingest job through its steps.**
 *
 * On Vercel there is no worker: `pump` in src/jobs.ts opens with
 * `if (process.env.VERCEL) return`, and the browser is what calls
 * `POST /api/jobs/:id/advance` once per step. Until 2026-09-01 that loop lived
 * inside `useJobs`, which is mounted from `Library`, `AddPage` and
 * `useStepJob` — and `App()` is a chain of early returns, so **whether an
 * import kept moving depended on whether the page you happened to open mounted
 * one of those three**. `/profile`, `/design`, `/admin` and the landing page
 * mount none of them, and on those the import stopped dead.
 *
 * **Not the reading view**, which is what the first version of this comment
 * said: `useArc` runs on every owned reading view and reaches `useJobs` through
 * `useStepJob`, so clicking from the shelf into an article kept driving. That
 * claim was mount accounting done from memory rather than from the code — the
 * same mistake, in the same file, that made the original bug hard to see in the
 * first place. Check the imports before you write a sentence like it.
 *
 * The justification that survives is the one that did not depend on the count:
 * driving belonged to whichever unrelated feature hook the current route
 * happened to mount, which is working by accident. So the driver cannot belong
 * to a mount. This module is the tab-level service it belongs to instead: one
 * poll timer, one job list, one drive loop per job, for the whole tab,
 * independent of which page is on screen.
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 1.
 *
 * ## A module singleton, not a React provider
 *
 * A provider whose entire purpose is never to unmount is a component doing an
 * imperative service's job. `App` could grow one — React preserving a component
 * at the same position and type is contractual, not accidental, and GPT Sol was
 * right to correct the first version of this plan on that point. The argument
 * that survives is simply that this is **not view state**: it is a background
 * worker with a timer, and dependency injection for it is what
 * `createJobEngine` already buys.
 *
 * ## When it polls
 *
 * `GET /api/jobs` is how the engine discovers work, and the rule has to keep an
 * owner from polling for ever on a page that has nothing to do with the queue:
 *
 * - **while any job is active** — every second, wherever the reader is;
 * - **otherwise, while at least one `useJobs` subscriber is mounted** — every
 *   eight seconds, which is the shelf and the bands, exactly as before;
 * - **otherwise nothing**, until something pokes it.
 *
 * So an owner reading an article with nothing running costs one poll at session
 * start and then silence. `tests/public-network-trace.test.tsx` pins that, and
 * pins the half that did not change: a signed-out visitor polls nothing at all.
 *
 * **`start()` is the only thing that wakes the engine**, and a subscriber alone
 * cannot. It used to be `started || subscribers.size > 0`, which made the
 * signed-out guarantee a property of the router — true only for as long as no
 * visitor route ever mounts `useJobs` — rather than of the engine. GPT Sol,
 * 2026-09-01: *"test compatibility should not define production authentication
 * semantics."* A mounted subscriber still chooses the **cadence**; it does not
 * grant permission to ask.
 *
 * Recurring polls also stop dead while the tab is hidden — see `schedule`.
 */
import type { Job, StepName } from "../types.js";
import { apiFetch, readJson, statusOf } from "./lib/api.js";

/** While something is running. Fast enough to feel live, slow enough to be free. */
const BUSY_MS = 1000;

/** While nothing is. Still polling, because another tab or a CLI run may add one. */
const IDLE_MS = 8000;

/** Longest we wait between "somebody else has it" and asking again. */
const BUSY_CAP_MS = 8000;

/**
 * How many completion events are kept.
 *
 * Events are consumed by cursor, and a subscriber captures its cursor during
 * its **first render** — before it has told the engine anything. So the engine
 * cannot prune by "the lowest cursor anybody holds": the one subscriber whose
 * event would be dropped is precisely the one it does not know about yet. A
 * flat cap is the honest version. Two hundred completions in one session is far
 * past anything a reader does, and falling off the back loses an announcement
 * rather than duplicating one.
 */
const MAX_COMPLETIONS = 200;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What `POST /api/jobs/:id/advance` answers. Mirrors `Advanced` in src/jobs.ts. */
export interface Advanced {
  job: Job;
  ran: StepName | null;
  busy: boolean;
  done: boolean;
}

/**
 * The two lines every job request makes. Exported because `useJobs` fires the
 * *actions* — an add, a cancel, a retry — and an action is a fetch that belongs
 * beside the card that fires it, not inside the engine.
 */
export async function send<T>(url: string, init?: RequestInit): Promise<T> {
  return readJson<T>(await apiFetch(url, init));
}

function isBusy(jobs: Job[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

/**
 * Whether two job lists say the same thing.
 *
 * Every poll used to call `setJobs(body.jobs)` with a freshly-parsed array, so
 * the identity changed on every response even when the content was identical —
 * and React re-rendered the owning panel 450 times an hour to paint the same
 * pixels. Comparing the serialised form is crude, and it is the right crude:
 * these are small flat records straight out of `JSON.parse`, so key order is
 * the server's and stable, and the alternative is a field-by-field comparison
 * that goes quietly wrong the day somebody adds a field to `Job`.
 */
function sameJobs(a: Job[], b: Job[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** What every subscriber reads. One object, replaced only when something changed. */
export interface JobsSnapshot {
  jobs: Job[];
  /** False until the first poll lands, so the UI can tell "none" from "don't know yet". */
  loaded: boolean;
  /**
   * The most recent thing that went wrong — an action or a poll — or null.
   *
   * **Engine state, and not durable.** It answers *"is anything wrong right
   * now"*, and a successful poll clears it. The other question — *"why did the
   * thing I just pressed fail"* — is `lastFailure` in useJobs.ts, which is a
   * per-subscriber ref precisely because no poll may clear it.
   */
  error: string | null;
  /**
   * Consecutive failed `/advance` calls, per job id, reset by any success and
   * dropped when the job leaves the list or goes terminal.
   *
   * Here because the driver can fail while the poll succeeds: `drive` retries
   * for ever and says nothing, so a job whose `/advance` 500s every time sits
   * confidently at `queued` while every status poll looks healthy. Nothing
   * renders this yet — stage 5 of the plan is the sentence — but the count is
   * the engine's to keep.
   */
  driverFailures: Readonly<Record<string, number>>;
  /**
   * True once a **final** 401 has paused everything.
   *
   * `apiFetch` already refreshes once and retries once, so a 401 that reaches
   * here is the server's settled answer rather than a refresh race. Everything
   * stops and `error` says so; the reader is **not** signed out. It clears on a
   * new session, a reload, or an action that succeeds.
   */
  authFailed: boolean;
}

/** What the engine needs from the world. Injected so a test can be a pure function. */
export interface JobEngineDeps {
  /** `GET /api/jobs` — every job this reader can see. */
  listJobs(): Promise<Job[]>;
  /** `POST /api/jobs/:id/advance` — run one step. */
  advance(id: string): Promise<Advanced>;
  /** Whether anybody can see this tab right now. */
  visible(): boolean;
  /** Subscribe to visibility changes. Returns the unsubscribe. */
  watchVisibility(onChange: () => void): () => void;
}

export interface JobEngine {
  /**
   * Bind the engine to a reader and begin. Idempotent for the same key.
   *
   * **Keyed on `user.id`, not on a truthy user.** A public job carries no
   * `ownerId`, so the engine cannot work out for itself that the list it is
   * holding belongs to the previous reader; the key is the only thing that
   * knows. A different key tears everything down first.
   */
  start(sessionKey: string): void;
  /**
   * Stop scheduling, fence anything in flight, and drop this reader's snapshot.
   *
   * **Not Stop.** The durable job is left exactly as it is: the reader did not
   * cancel it, and it is reconciled when its owner comes back. An `/advance`
   * the server has already admitted may finish.
   */
  stop(): void;
  /** `useSyncExternalStore`'s two halves. Stable references, both of them. */
  subscribe(onChange: () => void): () => void;
  getSnapshot(): JobsSnapshot;
  /**
   * Reconcile now.
   *
   * **Still one request while the tab is hidden**, and that is the invariant
   * most easily lost: an action can complete after the reader switches away,
   * and its poke is what discovers the job it just created. So a hidden poke
   * makes exactly one `GET /api/jobs` — and does not arm the timer afterwards,
   * because `schedule` declines to while hidden.
   */
  poke(): void;
  /** The completion sequence as it stands. Captured by a subscriber's first render. */
  completionCursor(): number;
  /** Completions past `cursor`, and the cursor to hold next. */
  drainCompletions(cursor: number): { jobs: Job[]; cursor: number };
  /**
   * The session fence as a number, to be captured **before** an action's fetch
   * goes out and handed back with its outcome.
   *
   * Polls and advances are fenced because the engine started them and kept the
   * generation in a local. An action is fired by a mounted component, so the
   * engine has no local to keep — and without this the promise reader A started
   * lands in reader B's engine and clears B's error, lifts B's auth pause and
   * pokes B's queue. Found by GPT Sol, 2026-09-01, reviewing the built code.
   */
  epoch(): number;
  /**
   * An action failed: say so, and reconcile.
   *
   * `status` is the HTTP status the rejection carried, or null. A **final** 401
   * from an action pauses the engine exactly as a 401 from a poll does — the
   * status used to be dropped on the floor here, so the one shape that means
   * "stop asking" was the one shape this path could not see.
   */
  actionFailed(message: string, status: number | null, epoch: number): void;
  /** An action succeeded: clear the failure, lift an auth pause, and reconcile. */
  actionSucceeded(epoch: number): void;
  /**
   * Fresh credentials arrived for the same reader — lift an auth pause and
   * reconcile. A no-op when nothing is paused.
   *
   * The other way out of a pause, and the one a reader never has to do
   * anything for: a 401 that outlived `apiFetch`'s own refresh is usually a
   * token that expired while the tab was asleep, and the SDK's next
   * `TOKEN_REFRESHED` is the answer to it. `App` calls this on a new access
   * token for the unchanged reader id — see `useJobSession` in useJobs.ts.
   * Without it the engine stayed paused until the reader pressed something or
   * reloaded the page.
   */
  resume(): void;
  /**
   * **Claim the one automatic attempt this tab session gets at
   * `(slug, step)`.** True the first time; false for ever afterwards.
   *
   * A mode that starts itself when the reader clicks it reverses a decision
   * made on 2026-08-25 — *a button, on demand* — and the reason for that
   * decision is still true: the original version generated on first view, and
   * its effect re-fired on every failure, generating, failing and generating
   * again for as long as the tab stayed open. A button removed that loop
   * structurally. This is what replaces the button as the structural answer,
   * rather than an error flag somebody has to remember to set on every path.
   *
   * **Synchronous, and it inserts before it answers**, so the mark lands before
   * the caller's `await` rather than after it and two effects in one tick
   * cannot both pass. That is the whole of its correctness: a version that
   * checked, posted, and then recorded would be a check-then-act race with
   * `<StrictMode>`'s double-invoked effects.
   *
   * **Not durable, and not a memory of what has been built.** It is one tab's
   * account of what it has already tried, so a reload is one more attempt —
   * deliberately, because a reader who reloads after a failure is asking again.
   * The button beside the empty state is the other retry, and a person pressing
   * it is not a loop.
   *
   * Cleared by `teardown`, so signing into a different account in the same tab
   * does not inherit the first reader's attempts.
   *
   * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2a.
   */
  beginAutoAttempt(slug: string, step: StepName): boolean;
  /**
   * Apply a job list as though a poll had returned it, **without touching the
   * timer**.
   *
   * The engine's own input, exposed. It is what makes the completion-cursor
   * contract testable at all: the case that matters is a job finishing between
   * a subscriber's render and its subscription effect, and that window is one
   * synchronous commit — nothing that goes through a promise can land inside
   * it. See `tests/job-engine-completions.test.tsx`.
   */
  receive(jobs: Job[]): void;
  /** Back to the state a fresh engine is in. For tests of the singleton. */
  reset(): void;
}

const EMPTY: JobsSnapshot = {
  jobs: [],
  loaded: false,
  error: null,
  driverFailures: {},
  authFailed: false,
};

export function createJobEngine(deps: JobEngineDeps): JobEngine {
  let snapshot: JobsSnapshot = EMPTY;
  let started = false;
  let sessionKey: string | null = null;

  /**
   * The session fence.
   *
   * Every request captures it and every callback checks it, so a response in
   * flight from before a `stop()` cannot write into the next reader's snapshot.
   * Monotonic and never reset — including across `reset()`, so a stale reply
   * can never coincide with a live generation.
   */
  let generation = 0;

  const subscribers = new Set<() => void>();
  /**
   * Which job ids this tab is driving, and **which loop is driving each**.
   *
   * A `Set` until 2026-09-01, and that was a bug: `teardown` clears it, so a
   * restarted session legitimately starts a second loop on the same durable
   * job — and when the *old* loop finally woke up and ran its `finally`, it
   * deleted the **new** loop's entry. The next poll then found the id unclaimed
   * and started a third loop for it. The server lease keeps two writers from
   * corrupting anything, so nothing broke visibly; what broke is the invariant
   * this map exists to state, and with it `driverFailures`, which counts per
   * job and cannot mean anything if two loops are incrementing it. Found by GPT
   * Sol, 2026-09-01. Each loop releases only its own token.
   */
  const driving = new Map<string, symbol>();
  let unwatch: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /* One request at a time. `poke` fires after every action, and a slow response
     would otherwise let a second poll overtake the first and write an older
     answer over a newer one. */
  let inFlight = false;
  let again = false;

  /** Whether the engine's first job list has landed — the baseline, not news. */
  let seeded = false;
  /** Done jobs already turned into a completion event, so a repeat emits nothing. */
  const announced = new Set<string>();
  let sequence = 0;
  let completions: { seq: number; job: Job }[] = [];

  /**
   * `(slug, step)` pairs this session has already tried automatically.
   *
   * Session-owned rather than mount-owned, which is the point: it survives a
   * panel unmounting, a mode toggled off and on, and a re-render, so none of
   * those buys a second paid job. See `beginAutoAttempt` on the interface.
   */
  const autoAttempts = new Set<string>();

  /* A bound session, and nothing else. See the header: a mounted subscriber
     picks the cadence, it does not grant permission to ask. With no session the
     engine is asleep — no timer, no listener, and no drive loop. */
  const awake = () => started;

  const emit = () => {
    for (const fn of [...subscribers]) fn();
  };

  const set = (next: Partial<JobsSnapshot>) => {
    const merged = { ...snapshot, ...next };
    if (
      merged.loaded === snapshot.loaded &&
      merged.error === snapshot.error &&
      merged.authFailed === snapshot.authFailed &&
      merged.jobs === snapshot.jobs &&
      merged.driverFailures === snapshot.driverFailures
    ) {
      return;
    }
    snapshot = merged;
    emit();
  };

  const listen = () => {
    if (unwatch) return;
    unwatch = deps.watchVisibility(() => {
      if (deps.visible()) poke();
      else {
        clearTimeout(timer);
        timer = undefined;
      }
    });
  };

  const unlisten = () => {
    unwatch?.();
    unwatch = null;
  };

  /**
   * Arm the next poll — or deliberately do not.
   *
   * Rescheduled from each response rather than run on an interval, so a slow
   * response can never stack a second request on top of the first. And not at
   * all while the tab is hidden: the clock **stops** rather than slowing, since
   * a "gentler" hidden interval is still an unbounded loop, and what makes
   * stopping dead safe is that `visibilitychange` polls the instant anybody
   * looks. Note this stops only the *timer* — a poll already in flight still
   * lands and still starts `drive` on anything it found.
   */
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = undefined;
    if (!awake() || snapshot.authFailed) return;
    if (!deps.visible()) return;
    /* The idle poll is a courtesy to whoever is *looking* at the queue. With
       nothing running and nobody watching, it is a request per eight seconds
       for ever on a reading view, which is what the engine would otherwise
       have cost every owner the moment it stopped being route-scoped. */
    if (!isBusy(snapshot.jobs) && subscribers.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void poll();
    }, ms);
  };

  const noteAuthFailure = (message: string) => {
    clearTimeout(timer);
    timer = undefined;
    set({ authFailed: true, error: message });
  };

  const readable = (err: unknown): string =>
    (err as Error).message === "Failed to fetch"
      ? "Couldn't reach the server — is `npm run dev` still running?"
      : (err as Error).message;

  /**
   * Number every job that has newly reached `done`.
   *
   * **The first list is the baseline, not news.** `onFinished` means "a job just
   * finished", and opening the app does not make every job that ever succeeded
   * finish again — without this, a fresh load fires the callback once per
   * historical record and the library refetches once for each.
   *
   * **This is the client's only completion signal, and it requires a terminal
   * row to stay pollable long enough to be seen.** There is no other way the
   * tab learns a job succeeded: no event, and a job's absence from the list is
   * indistinguishable from "not written yet". So whatever decides how long a
   * finished job survives is deciding whether a completion is ever announced —
   * that is `trimFinished` and `KEEP_FINISHED` in src/jobs.ts, which say the
   * matching sentence at their end. When they deleted a success in the same
   * call that marked it done, every panel waiting on one sat empty for ever:
   * docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md.
   */
  const recordCompletions = (jobs: Job[], first: boolean) => {
    for (const job of jobs) {
      if (job.status !== "done" || announced.has(job.id)) continue;
      announced.add(job.id);
      if (first) continue;
      sequence += 1;
      completions.push({ seq: sequence, job });
    }
    if (completions.length > MAX_COMPLETIONS) {
      completions = completions.slice(-MAX_COMPLETIONS);
    }
  };

  /** Driver health is about jobs that are still going. One that finished, or that
   *  the reader forgot, takes its count with it. */
  const pruneDriverFailures = (jobs: Job[]): Readonly<Record<string, number>> => {
    let failures = snapshot.driverFailures;
    for (const id of Object.keys(failures)) {
      const still = jobs.find((j) => j.id === id);
      if (still && (still.status === "queued" || still.status === "running")) continue;
      const { [id]: _gone, ...rest } = failures;
      failures = rest;
    }
    return failures;
  };

  const apply = (jobs: Job[]) => {
    const first = !seeded;
    seeded = true;

    const kept = sameJobs(snapshot.jobs, jobs) ? snapshot.jobs : jobs;
    recordCompletions(jobs, first);
    set({ jobs: kept, loaded: true, error: null, driverFailures: pruneDriverFailures(jobs) });

    /* **Including on the first list**, unlike the completions above. A job left
       unfinished by a closed tab or a restarted server is exactly what a fresh
       load should pick up — that is the "something has to notice you came back"
       of docs/plans/260826s-ingest-resume.md, and here coming back *is* the
       trigger. `drive` returns immediately if this tab already has that id. */
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "running") void drive(job.id);
    }
  };

  const poll = async (): Promise<void> => {
    /* **The guard belongs here and not only at the callers.** `poke`, `wake`
       and `schedule` each check the pause, and it was still reachable: a poke
       that arrives while the poll that is *about* to 401 is in flight sets
       `again`, and the `finally` below then starts one more poll on the way
       out. If that one succeeded it cleared `error` and left `authFailed` true
       — an engine that has stopped and says nothing, which is the exact shape
       docs/reusable/silent-success.md is about. GPT Sol, 2026-09-01. */
    if (snapshot.authFailed) return;
    if (inFlight) {
      again = true;
      return;
    }
    const mine = generation;
    inFlight = true;
    try {
      const jobs = await deps.listJobs();
      if (mine !== generation) return;
      apply(jobs);
      schedule(isBusy(jobs) ? BUSY_MS : IDLE_MS);
    } catch (err) {
      if (mine !== generation) return;
      if (statusOf(err) === 401) {
        noteAuthFailure(readable(err));
        return;
      }
      /* Keep polling. The usual cause is the dev server restarting, which fixes
         itself in a second or two — giving up would leave a dead panel that
         only a page reload brings back. */
      set({ error: readable(err) });
      schedule(IDLE_MS);
    } finally {
      if (mine === generation) {
        inFlight = false;
        if (again && awake()) {
          again = false;
          void poll();
        } else {
          again = false;
        }
      }
    }
  };

  /**
   * Call advance until the job is finished, failed or stopped.
   *
   * **`done` is the only thing that ends it.** Not a status read off the polled
   * list, which is a second account of the same fact and can be a second stale;
   * the server answers the question directly because it has just done the work.
   *
   * **A transient error does not end it either** — only a final 401 and a 404
   * do, and `noteAdvanceFailure` is where both are named. The `catch` used to
   * sit outside the loop:
   * a failed advance waited and gave up, on the reasoning that the status poll
   * beside it would start a fresh driver within eight seconds. True while that
   * poll ran for ever. It does not run while the tab is hidden — so the thing
   * that restarted the driver was the thing that got paused, and one transient
   * rejection left the ingest stopped until the reader came back and looked. An
   * ingest that stalls only when nobody is watching, and resumes the moment
   * they look, is close to the worst bug shape available.
   *
   * There used to be an `alive()` parameter here, false once the mount that
   * started the loop had gone. **It is deliberately gone**: there is no mount to
   * end any more. What ends a loop now is the session fence, an auth pause, or
   * the engine having nothing left asking it to run at all.
   */
  /** Count a failed advance. False means stop the loop rather than wait. */
  const noteAdvanceFailure = (id: string, err: unknown): boolean => {
    const status = statusOf(err);
    if (status === 401) {
      noteAuthFailure(readable(err));
      return false;
    }
    /* **404 is the one rejection that cannot come good.** `POST
       /api/jobs/:id/advance` answers it only when `advanceJob` finds no row
       (src/routes.ts), and a deleted row does not come back — so retrying is a
       request every eight seconds, for as long as the tab is open, to be told
       the same thing, silently. Retention is one way a driven job vanishes:
       docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md.

       No count, and no clearing of an existing one: `pruneDriverFailures` owns
       that, and drops any entry whose job is no longer going on the next poll.
       Nothing renders a count for a job that is not in the list anyway.

       **Stopping is safe even if the 404 was a lie** — a dev server mid-restart,
       something in front of it answering for the route. `apply` starts a driver
       for every queued or running job in each list it receives, and the `finally`
       in `drive` has released the id by then, so a job that is really still
       going gets a fresh loop on the next poll. That is what makes this
       one-way door a door and not a cliff. */
    if (status === 404) return false;
    set({
      driverFailures: {
        ...snapshot.driverFailures,
        [id]: (snapshot.driverFailures[id] ?? 0) + 1,
      },
    });
    return true;
  };

  /**
   * One turn of the drive loop: advance once, wait if we must, and say what the
   * backoff should be next time. `null` means the loop is over.
   */
  const step = async (id: string, mine: number, backoff: number): Promise<number | null> => {
    try {
      const advanced = await deps.advance(id);
      if (mine !== generation) return null;
      if (snapshot.driverFailures[id]) {
        const { [id]: _ok, ...rest } = snapshot.driverFailures;
        set({ driverFailures: rest });
      }
      if (advanced.done) return null;
      if (!advanced.busy) return BUSY_MS;
      /* Doubling, because the common reason for `busy` on this laptop is that
         the in-process queue owns the whole job — which can be minutes. At a
         flat second that is sixty pointless requests a minute, each one logged
         by the server, to be told the same thing. */
      await wait(backoff);
      return Math.min(backoff * 2, BUSY_CAP_MS);
    } catch (err) {
      if (mine !== generation) return null;
      if (!noteAdvanceFailure(id, err)) return null;
      /* Still no error message, for the original reason: a failed advance is
         not news the reader can act on, and the poll reports the same server
         being down. Waiting first, so a server that is down does not get a
         request per iteration. */
      await wait(IDLE_MS);
      return backoff;
    }
  };

  const drive = async (id: string): Promise<void> => {
    if (driving.has(id)) return;
    /* This loop's own claim on the id. A stale loop from the previous session
       may still be somewhere inside an `await` — see `driving` above. */
    const token = Symbol(id);
    driving.set(id, token);
    const mine = generation;
    try {
      let backoff = BUSY_MS;
      while (mine === generation && awake() && !snapshot.authFailed) {
        const next = await step(id, mine, backoff);
        if (next === null) return;
        backoff = next;
      }
    } finally {
      if (driving.get(id) === token) driving.delete(id);
    }
  };

  /** Fence everything in flight and forget this reader. */
  const teardown = () => {
    generation += 1;
    clearTimeout(timer);
    timer = undefined;
    inFlight = false;
    again = false;
    driving.clear();
    seeded = false;
    announced.clear();
    /* A different reader in the same tab starts with a clean sheet — theirs is
       a different shelf, and one of these pairs may name an article they have
       never seen. See `beginAutoAttempt`. */
    autoAttempts.clear();
    /* The *sequence* stays where it is, so a cursor a subscriber captured under
       the old session can never be met by a new session's event. Only the
       events themselves go. */
    completions = [];
    if (!awake()) unlisten();
    snapshot = EMPTY;
    emit();
  };

  const poke = () => {
    if (snapshot.authFailed) return;
    if (!awake()) return;
    clearTimeout(timer);
    timer = undefined;
    void poll();
  };

  /** Poll now if nothing is already going to. Two subscribers still make one poll. */
  const wake = () => {
    if (!awake() || snapshot.authFailed) return;
    listen();
    if (inFlight || timer !== undefined) return;
    void poll();
  };

  return {
    start(key) {
      if (started && sessionKey === key) return;
      teardown();
      sessionKey = key;
      started = true;
      listen();
      void poll();
    },
    stop() {
      if (!started && snapshot === EMPTY) return;
      started = false;
      sessionKey = null;
      teardown();
    },
    subscribe(onChange) {
      subscribers.add(onChange);
      wake();
      return () => {
        subscribers.delete(onChange);
        if (!awake()) {
          clearTimeout(timer);
          timer = undefined;
          unlisten();
        }
      };
    },
    getSnapshot: () => snapshot,
    poke,
    completionCursor: () => sequence,
    drainCompletions(cursor) {
      return {
        jobs: completions.filter((e) => e.seq > cursor).map((e) => e.job),
        cursor: sequence,
      };
    },
    epoch: () => generation,
    actionFailed(message, status, epoch) {
      if (epoch !== generation) return;
      if (status === 401) {
        noteAuthFailure(message);
        return;
      }
      set({ error: message });
      poke();
    },
    actionSucceeded(epoch) {
      if (epoch !== generation) return;
      set({ error: null, authFailed: false });
      poke();
    },
    resume() {
      if (!started || !snapshot.authFailed) return;
      set({ authFailed: false, error: null });
      poke();
    },
    beginAutoAttempt(slug, step) {
      const key = `${slug} ${step}`;
      if (autoAttempts.has(key)) return false;
      autoAttempts.add(key);
      return true;
    },
    receive: apply,
    reset() {
      started = false;
      sessionKey = null;
      teardown();
    },
  };
}

/** The browser's own wiring. Split out so `createJobEngine` stays pure. */
function browserDeps(): JobEngineDeps {
  return {
    listJobs: async () => (await send<{ jobs: Job[] }>("/api/jobs")).jobs,
    advance: (id) => send<Advanced>(`/api/jobs/${id}/advance`, { method: "POST" }),
    /* `document.visibilityState` rather than the `document.hidden` boolean only
       because the string is what a test can define over jsdom's prototype
       getter; they are the same fact. Guarded for node, where this module is
       imported by tests and a missing `document` would throw at import time. */
    visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    watchVisibility: (onChange) => {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
  };
}

/**
 * The one engine the app runs on. Started and stopped by `App`, keyed on the
 * reader's id; every `useJobs` subscribes to this.
 */
export const jobEngine: JobEngine = createJobEngine(browserDeps());
