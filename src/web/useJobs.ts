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

/** While something is running. Fast enough to feel live, slow enough to be free. */
const BUSY_MS = 1000;

/** While nothing is. Still polling, because another tab or a CLI run may add one. */
const IDLE_MS = 8000;

function isBusy(jobs: Job[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export interface UseJobs {
  jobs: Job[];
  /** False until the first poll lands, so the UI can tell "none" from "don't know yet". */
  loaded: boolean;
  error: string | null;
  add(url: string): Promise<void>;
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
    // `await` rather than returning `act`'s promise: this one is declared as
    // `Promise<void>` and always was, and widening it would put a `Job | null`
    // in front of callers who have no use for one.
    add: async (url) => {
      await act(() => post({ url }));
    },
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
