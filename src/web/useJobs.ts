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

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  return readJson<T>(await apiFetch(url, init));
}

/* ------------------------------------------------------------- advancing --

   The browser is what moves a job along. `POST /api/jobs/:id/advance` runs one
   step and returns; this calls it again until there is nothing left. The design
   and the reasons are docs/plans/job-queue-rethink.md § Decided; the short
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
 * A page can mount `useJobs` several times over — the reading view has one for
 * the thread panel, one for the glossary and one for summaries — and every one
 * of them polls the same list and would start its own loop on the same job.
 * They would not corrupt anything (the server turns the losers away with
 * `busy`) but they would be three requests to be told the same thing. One set
 * per tab makes it one loop per job.
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
      const advanced = await send<Advanced>(`/api/jobs/${id}/advance`, { method: "POST" });
      if (advanced.done) return;
      if (advanced.busy) {
        /* Doubling, because the common reason for `busy` on this laptop is that
           the in-process queue owns the whole job — which can be minutes. At a
           flat second that is sixty pointless requests a minute, each one
           logged by the server, to be told the same thing. */
        await wait(backoff);
        backoff = Math.min(backoff * 2, BUSY_CAP_MS);
      } else {
        backoff = BUSY_MS;
      }
    }
  } catch {
    /* Swallowed on purpose, and it is the one `catch` here that does not set an
       error message. A failed advance is not news the reader can act on — the
       poll beside it is making the same request to the same server and will say
       so — and a driver that threw would take the loop with it. Waiting first
       so that a server that is down does not get a request per poll. */
    await wait(IDLE_MS);
  } finally {
    driving.delete(id);
  }
}

export interface UseJobs {
  jobs: Job[];
  /** False until the first poll lands, so the UI can tell "none" from "don't know yet". */
  loaded: boolean;
  error: string | null;
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
    /** A free-text steer, for the steps that take one. Only `summary` does. */
    guidance?: string;
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

        setJobs(body.jobs);
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
             to notice you came back" of docs/plans/ingest-resume.md, and here
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
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), ms);
    };

    pokeRef.current = () => {
      clearTimeout(timer);
      void poll();
    };
    void poll();

    return () => {
      live = false;
      clearTimeout(timer);
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
   */
  const act = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const value = await fn();
      setError(null);
      return value;
    } catch (err) {
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
    add: (url) => act(() => post({ url })),
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
