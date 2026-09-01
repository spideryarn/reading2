/**
 * The ingest queue, as the homepage sees it.
 *
 * Polling, not server-sent events, and that is a decision rather than a
 * shortcut. A job is five steps over one or two minutes, so a one-second poll
 * is at worst a second behind something that changes every twenty — nobody can
 * tell. What it buys is that the client holds no connection: it survives the
 * dev server restarting under it (vite does that on any config change), it is
 * the same three lines against a future standalone server, and there is no
 * reconnect logic to get wrong. See docs/project/ingest-queue.md#why-polling.
 *
 * The queue itself is src/jobs.ts; the routes are in src/routes.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, StepName } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

/** While something is running. Fast enough to feel live, slow enough to be free. */
const BUSY_MS = 1000;

/** While nothing is. Still polling, because another tab or a CLI run may add one. */
const IDLE_MS = 8000;

function isBusy(jobs: Job[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

/* ------------------------------------------------------- nobody is there --

   This loop used to run forever, and the reason it stopped being acceptable is
   arithmetic rather than principle: eight seconds is 450 requests an hour, each
   one waking a React subtree to be told that nothing has changed, in a tab
   whose reader went to lunch. A page left open overnight made about nine
   thousand of them. That is the background CPU this hook was charged with.

   So recurring polls are gated on the tab being visible. Three things about
   that are easy to get wrong, and all three were pointed out by a GPT Sol
   review before any of it was built:

   1. **Pausing the poll must not pause `drive`.** On a serverless host there is
      no long-running worker — the browser is what walks a job through its five
      steps, one HTTP request per step. Gating everything on visibility would
      mean an ingest silently stalls the moment the reader switches tabs, and
      resumes when they come back, which is the opposite of what a queue is
      for. Only the *status GET* pauses. A job already being driven keeps being
      driven, hidden or not, because that is work the reader asked for rather
      than work we invented.

   2. **`poke` cannot simply be dropped while hidden.** An action can complete
      after the tab is backgrounded, and its poke is the thing that discovers
      the job it just created and starts driving it. So a hidden poke still
      makes *one* reconciliation request — it just does not arm the timer
      afterwards.

   3. **Coming back has to be immediate.** Waiting out the remainder of an
      eight-second interval means the reader looks at a stale panel at the one
      moment they are actually looking. `visibilitychange` polls at once.

   `document.visibilityState` rather than the `document.hidden` boolean only
   because the string is what the tests can define over jsdom's prototype
   getter; they are the same fact. */

/** Whether anybody can see this tab right now. Guarded for a non-browser
 *  environment — this module is imported by tests that run in node, where a
 *  missing `document` would throw at import time rather than at use. */
function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
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

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  return readJson<T>(await apiFetch(url, init));
}

/* ------------------------------------------------------------- advancing --

   The browser is what moves a job along. `POST /api/jobs/:id/advance` runs one
   step and returns; this calls it again until there is nothing left. The design
   and the reasons are docs/plans/260826q-job-queue-rethink.md § Decided; the short
   version is that a serverless host has no long-running process, so each step
   has to fit inside a request somebody is waiting on.

   It costs nothing on this laptop, where the in-process queue is still running
   the job: the server answers `busy` and this backs off. See `advanceJob` in
   src/jobs.ts for how the two take turns.
   -------------------------------------------------------------------------- */

/** What `POST /api/jobs/:id/advance` answers. Mirrors `Advanced` in src/jobs.ts. */
interface Advanced {
  job: Job;
  ran: StepName | null;
  busy: boolean;
  done: boolean;
}

/**
 * Job ids this **tab** is already driving. Module scope, not a ref, and that is
 * the point.
 *
 * A page can mount `useJobs` more than once, and every copy polls the same list
 * and would start its own loop on the same job. They would not corrupt anything
 * (the server turns the losers away with `busy`) but they would be two requests
 * to be told the same thing. One set per tab makes it one loop per job.
 *
 * **This used to say "the reading view has one for the thread panel, one for
 * the glossary and one for summaries", and that is not true.** The bands are
 * mutually exclusive — `mode === …` in App.tsx — and the default mode opens no
 * band, so the reading view mounts *none*. (That default was `toc` when this was
 * written, `hierarchy` after the 2026-08-29 rename, and `plain` since 2026-08-31;
 * src/modes.ts § `DEFAULT_MODE` is the one to read. The conclusion survived all
 * three, which is why the sentence no longer names one.) The comment was
 * written when it was true and outlived it. It is called out rather than
 * quietly corrected because it cost real time in 2026-08-27's CPU work: the
 * investigation started from "six pollers on the reading view", which is a
 * quantity this file asserted and nothing measured. A stale comment is a
 * perfectly good reason to believe something false. See
 * docs/project/performance.md.
 */
const driving = new Set<string>();

/** Longest we wait between "somebody else has it" and asking again. */
const BUSY_CAP_MS = 8000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call advance until the job is finished, failed or stopped.
 *
 * **`done` is the only thing that ends it.** Not a status read off the polled
 * list, which is a second account of the same fact and can be a second stale;
 * the server answers the question directly because it has just done the work.
 *
 * Errors do not end it either — they release the id and let the next poll start
 * a fresh loop, which is what turns a dev server restarting under us into a
 * pause rather than an abandoned ingest. The reason is already on screen: the
 * poll below reports it.
 *
 * @param alive false once the hook that started this has unmounted. Another
 *   mounted hook's next poll picks the job up again, because `finally` releases
 *   it — so closing a panel mid-ingest does not stop the ingest.
 */
async function drive(id: string, alive: () => boolean): Promise<void> {
  if (driving.has(id)) return;
  driving.add(id);
  try {
    let backoff = BUSY_MS;
    while (alive()) {
      try {
        const advanced = await send<Advanced>(`/api/jobs/${id}/advance`, { method: "POST" });
        if (advanced.done) return;
        if (advanced.busy) {
          /* Doubling, because the common reason for `busy` on this laptop is
             that the in-process queue owns the whole job — which can be
             minutes. At a flat second that is sixty pointless requests a
             minute, each one logged by the server, to be told the same thing. */
          await wait(backoff);
          backoff = Math.min(backoff * 2, BUSY_CAP_MS);
        } else {
          backoff = BUSY_MS;
        }
      } catch {
        /* **Retried here rather than by exiting**, and that changed on
           2026-08-27 along with the visibility gate above.

           This `catch` used to sit outside the loop: a failed advance waited
           and then gave up, releasing the job, on the reasoning that the status
           poll beside it would notice and start a fresh driver within eight
           seconds. True while that poll ran forever. It does not run while the
           tab is hidden any more — so the thing that restarted the driver was
           the thing that got paused, and one transient rejection (a dev server
           restarting, a dropped connection) left the ingest stopped until the
           reader came back and looked.

           An ingest that stalls only when nobody is watching, and resumes the
           moment they look, is close to the worst bug shape available: every
           attempt to reproduce it succeeds, and it reads as flakiness. The
           driver now owns its own recovery instead of borrowing somebody
           else's, which also makes it correct independently of how the poll is
           scheduled.

           Still no error message, for the original reason: a failed advance is
           not news the reader can act on, and the poll reports the same server
           being down. Waiting first, so a server that is down does not get a
           request per iteration. GPT Sol's finding on the built code. */
        await wait(IDLE_MS);
      }
    }
  } finally {
    driving.delete(id);
  }
}

export interface UseJobs {
  jobs: Job[];
  /** False until the first poll lands, so the UI can tell "none" from "don't know yet". */
  loaded: boolean;
  /**
   * The most recent thing that went wrong — an action or a poll — or null.
   *
   * **Shared, and not durable.** The poll owns this as much as the actions do,
   * and a successful poll clears it, so it answers *"is anything wrong right
   * now"* and not *"why did that fail"*. See `lastFailure` below for the second
   * question, which is the one a button asks.
   */
  error: string | null;
  /**
   * Why the **most recent action** failed, or null if it worked. Read it
   * straight after awaiting the action.
   *
   * A function rather than a field because the value it reads is a ref, and a
   * field would be a snapshot taken at render — which is the wrong instant by
   * exactly the amount that matters. The caller's `await queue.run(...)` has
   * just returned; no render has happened yet, and the message is needed *now*
   * so it can be kept.
   *
   * **This exists because `error` is not durable and three surfaces were
   * reading it as though it were.** A refused POST puts the server's sentence
   * in `error`, and then `act`'s own `finally` pokes the poller — so the very
   * next successful poll, milliseconds later, wipes it. A button rendering
   * `error` shows the reader the truth for one frame and a generic fallback
   * afterwards, and a test with a posed queue cannot see the difference because
   * a posed queue does not poll. `tests/refused-job-reason-survives.test.tsx`
   * is the measure of it taken from outside.
   *
   * Cleared by the next action that succeeds, and by nothing else — in
   * particular not by a poll, which is the whole point.
   */
  lastFailure(): string | null;
  /**
   * Queue a fresh add, and hand back the job so the caller can watch that one.
   *
   * It returned `void` until the add page arrived (AddPage.tsx), on the
   * reasoning — written down here — that no caller had a use for the job. One
   * does now: the page's whole content *is* that job, and picking it out of the
   * list by slug would be a guess, because a second add of the same article
   * hands back the first job rather than making a new one (`enqueue` in
   * src/jobs.ts). Null on failure, with the reason in `error`, the same as
   * `run` below.
   */
  add(url: string): Promise<Job | null>;
  /**
   * Queue a file that has **already been sent to the object store**, by its
   * upload id.
   *
   * `add`'s other half rather than an argument to it, because the two are
   * different requests with different bodies and different failure modes: an
   * upload can be claimed by somebody else, or its grant can have run out, and
   * neither of those is a thing a URL can be. The bytes are long gone by the
   * time this is called — see src/web/upload.ts, which is what sends them.
   */
  addUpload(uploadId: string): Promise<Job | null>;
  /**
   * Run named steps on an article that is already on the shelf, and hand back
   * the job so the caller can watch that one rather than the whole list.
   *
   * `add` cannot do this: it posts `{ url }`, which means *the default ingest
   * steps*, and it throws the response away. The thread page needs both halves
   * — `{ slug, steps: ["tweets"] }`, and the id that comes back — so this is
   * `add`'s sibling rather than a flag on it. See src/web/Tweets.tsx.
   *
   * Null on failure, with the reason in `error`: the caller has nothing useful
   * to do with the exception, and every other action here already reports that
   * way.
   */
  run(request: {
    slug: string;
    steps: StepName[];
    force?: StepName[];
    /**
     * Whether this run should use the reader's profile. Absent means yes.
     *
     * A boolean, never the text: the server resolves who the reader is from its
     * own store, and a client that could supply the string could put arbitrary
     * prose into a prompt that writes an artefact. src/routes.ts §
     * parseJobRequest.
     */
    useProfile?: boolean;
  }): Promise<Job | null>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  forget(id: string): Promise<void>;
}

/**
 * @param onFinished called once per job that reaches `done`, so the caller can
 *   reload whatever that job changed. The library list, in practice: an article
 *   appears on the shelf the instant its last step succeeds, with no reload and
 *   no "it'll show up eventually".
 */
export function useJobs(onFinished?: (job: Job) => void): UseJobs {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which finished jobs we have already told the caller about. A ref rather
  // than state: changing it must not re-render, and it must not go stale inside
  // the poll below, which is created once and never again.
  const announced = useRef(new Set<string>());
  const seeded = useRef(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  /**
   * Poll again, now.
   *
   * A ref rather than a state bump. The obvious spelling of this hook keeps a
   * counter in state and lists it in the effect's dependencies, so incrementing
   * it re-runs the effect — but the counter is then a dependency the effect
   * never reads, and Biome's `useExhaustiveDependencies` says so and offers to
   * remove it. Taking that fix stops the polling dead after the first response,
   * and nothing errors: the panel simply never updates again. So the loop lives
   * inside one mount-effect and this ref is the door into it.
   */
  const pokeRef = useRef<() => void>(() => {});

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    // One request at a time. `poke` fires after every action, and a slow
    // response would otherwise let a second poll overtake the first and write
    // an older answer over a newer one.
    let inFlight = false;
    let again = false;

    const poll = async (): Promise<void> => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const body = await send<{ jobs: Job[] }>("/api/jobs");
        if (!live) return;
        // The first poll is the baseline, not news. `onFinished` means "a job
        // just finished", and reloading the homepage does not make every job
        // that ever succeeded finish again — without this, a remount fires the
        // callback once per historical record and the library refetches once
        // for each of them.
        const first = !seeded.current;
        seeded.current = true;

        // Only when something actually changed — see `sameJobs`. `setLoaded`
        // and `setError` below are already no-ops once settled, because React
        // bails out on an identical value; the array was the one that could
        // not.
        setJobs((prev) => (sameJobs(prev, body.jobs) ? prev : body.jobs));
        setLoaded(true);
        setError(null);
        for (const job of body.jobs) {
          if (job.status === "done" && !announced.current.has(job.id)) {
            announced.current.add(job.id);
            if (!first) finishedRef.current?.(job);
          }
          /* **Including on the first poll**, unlike `onFinished` above. A job
             left unfinished by a closed tab or a restarted server is exactly
             what a fresh page load should pick up — that is the "something has
             to notice you came back" of docs/plans/260826s-ingest-resume.md, and here
             coming back *is* the trigger. `drive` returns immediately if this
             tab already has a loop on that id. */
          if (job.status === "queued" || job.status === "running") {
            void drive(job.id, () => live);
          }
        }
        schedule(isBusy(body.jobs) ? BUSY_MS : IDLE_MS);
      } catch (err) {
        if (!live) return;
        // Keep polling. The usual cause is the dev server restarting, which
        // fixes itself in a second or two — giving up would leave a dead panel
        // that only a page reload brings back.
        setError(
          (err as Error).message === "Failed to fetch"
            ? "Couldn't reach the server — is `npm run dev` still running?"
            : (err as Error).message,
        );
        schedule(IDLE_MS);
      } finally {
        inFlight = false;
        if (again && live) {
          again = false;
          void poll();
        }
      }
    };

    // Rescheduled from each response rather than run on an interval, so a slow
    // response can never stack a second request on top of the first.
    //
    // **And not at all while the tab is hidden.** The clock stops rather than
    // slowing down: a "gentler" hidden interval is still an unbounded loop, and
    // the thing that makes this safe to stop dead is that `visibilitychange`
    // below restarts it the instant anybody looks. Note this only stops the
    // *timer* — a poll already in flight when the reader leaves still lands and
    // still starts `drive` on anything it found, which is point 1 above.
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!visible()) return;
      timer = setTimeout(() => void poll(), ms);
    };

    pokeRef.current = () => {
      clearTimeout(timer);
      void poll();
    };

    /* Both directions, and the leaving one is not redundant. `schedule`
       declines to arm a *new* timer while hidden, but a timer armed a moment
       before the reader switched tabs is already on the clock and will fire —
       one last poll, several seconds into a tab nobody is looking at. Clearing
       it here is the difference between "almost no requests while hidden" and
       none, and the second is the only one of those a test can hold.

       Coming back reconciles at once rather than at the end of whatever was
       left of the interval. `poll` re-arms through `schedule`, which is why
       that is one call and not two. */
    const onVisibility = () => {
      if (visible()) pokeRef.current();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);

    void poll();

    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      pokeRef.current = () => {};
    };
  }, []);

  /**
   * Act, then poll at once rather than waiting out the interval.
   *
   * Returns what the action returned, or null if it threw. It used to return
   * nothing, which was fine while every caller only wanted the side effect;
   * `run` below wants the job it just created, and a second POST helper beside
   * this one would be a second place that knows how a failed action is
   * reported.
   *
   * **Two records of the same failure, on purpose.** `error` is state and is
   * shared with the poll, which clears it on its next success — including the
   * poll this function's own `finally` starts, one line later. `lastFailure` is
   * a ref only the actions touch, so it survives that. See `lastFailure` on the
   * interface for what was going wrong before it existed.
   */
  const lastFailure = useRef<string | null>(null);
  const act = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const value = await fn();
      lastFailure.current = null;
      setError(null);
      return value;
    } catch (err) {
      lastFailure.current = (err as Error).message;
      setError((err as Error).message);
      return null;
    } finally {
      pokeRef.current();
    }
  }, []);

  const post = (body: unknown) =>
    send<Job>("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    jobs,
    loaded,
    error,
    lastFailure: () => lastFailure.current,
    add: (url) => act(() => post({ url })),
    addUpload: (uploadId) => act(() => post({ uploadId })),
    run: (request) => act(() => post(request)),
    cancel: async (id) => {
      await act(() => send(`/api/jobs/${id}/cancel`, { method: "POST" }));
    },
    retry: async (id) => {
      await act(() => send(`/api/jobs/${id}/retry`, { method: "POST" }));
    },
    forget: async (id) => {
      await act(() => send(`/api/jobs/${id}`, { method: "DELETE" }));
    },
  };
}
