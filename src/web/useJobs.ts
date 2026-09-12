/**
 * The ingest queue, as a React surface sees it.
 *
 * **The polling and the driving are not here any more.** They moved to
 * src/web/jobEngine.ts on 2026-09-01, because a mount is the wrong owner for
 * them: the browser is the only thing that advances a job on Vercel, and
 * `App()` is a chain of early returns, so whether an import kept moving
 * depended on whether the route the reader happened to open mounted this hook
 * from `Library`, `AddPage` or `useStepJob`. On `/profile`, `/design`,
 * `/admin` and the landing page it did not, and the import stopped. Read that
 * file for the design; this one is the subscription over it, plus the actions.
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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Job, StepName } from "../types.js";
import { jobEngine, send } from "./jobEngine.js";
import { uploadEngine } from "./uploadEngine.js";
import { statusOf } from "./lib/api.js";

/**
 * *There is nothing to queue: this upload is already this article.*
 *
 * `article` rather than `slug`, because a `Job` carries a `slug` of its own and
 * the two answers arrive on the same wire — a key that only one of them can
 * have is what makes `"article" in answer` a narrowing rather than a guess.
 */
export interface AlreadyAnArticle {
  article: string;
}

export interface UseJobs {
  jobs: Job[];
  /** False until the first poll lands, so the UI can tell "none" from "don't know yet". */
  loaded: boolean;
  /**
   * The most recent thing that went wrong — an action or a poll — or null.
   *
   * **Shared, and not durable.** The engine's poll owns this as much as the
   * actions do, and a successful poll clears it, so it answers *"is anything
   * wrong right now"* and not *"why did that fail"*. See `lastFailure` below
   * for the second question, which is the one a button asks.
   */
  error: string | null;
  /**
   * Consecutive failed `POST /api/jobs/:id/advance` calls, per job id.
   *
   * **The one thing on here that no poll can tell you.** `drive` catches a
   * failed advance, waits, and retries for ever without a word — so a job
   * whose advance route keeps answering 500 sits at `running` while every
   * status poll looks perfectly healthy, which is
   * docs/reusable/silent-success.md happening inside the loop built to prevent
   * a stalled ingest. The engine has counted this since the refactor; nothing
   * rendered it until stage 5, and a count nobody can see is not a warning.
   *
   * Reset by any successful advance and dropped when the job goes terminal or
   * leaves the list, so it is always *right now* rather than a tally. Ask
   * `driverStalled` (src/job-state.ts) rather than comparing it yourself —
   * that is where the threshold and its reasoning live.
   */
  driverFailures: Readonly<Record<string, number>>;
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
   * **Per subscriber, and it stayed that way through the engine refactor.**
   * `error` and `loaded` and `jobs` became engine state; this did not, because
   * it means *why did the last thing **I** pressed fail* — two panels can each
   * have pressed a different button. Cleared by the next action of this
   * subscriber's that succeeds, and by nothing else.
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
   *
   * **Three answers, and the third is why this is not `Promise<Job | null>`.**
   * Reloading `/add/upload/<id>` long after the import finished finds an upload
   * that is still claimed and a job record that retention has taken away, and
   * the true thing to say then is *this file is already that article* — see
   * `queueAnUpload` in src/routes.ts. Null is still a failure, with the reason
   * in `error`.
   */
  addUpload(uploadId: string): Promise<Job | AlreadyAnArticle | null>;
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
 * **Where the tab's job engine begins and ends.** Called once, by `App`.
 *
 * Not inside `App` itself. Testing it there means either rendering the whole
 * app behind a router — `tests/public-network-trace.test.tsx` does, and it is a
 * three-hundred-line harness — or copying the effect into the test, which is
 * what `tests/job-engine-session.test.tsx` did. GPT Sol's note on that copy is
 * right: it stays green while the original drifts, and the original is an
 * effect whose *dependency array* is the whole contract. Out here it can be
 * rendered as itself (tests/job-session-effect.test.tsx). That `App` still
 * calls it is a separate fact, pinned behaviourally by the one `GET /api/jobs`
 * a signed-in reader makes in that network trace.
 *
 * @param readerId `user.id`, or null when nobody is signed in. **The id, not a
 *   truthy user**: a public job carries no `ownerId`, so the engine cannot work
 *   out for itself that the list it holds belongs to the reader who just signed
 *   out — the key is the only thing that knows. The cleanup is not a Stop; the
 *   durable job is left as it is and reconciled when its owner comes back.
 * @param accessToken the current JWT, or null. **A separate effect on purpose.**
 *   Putting the token in the first effect's dependencies would tear the whole
 *   session down and rebuild it on every hourly refresh — fencing an `/advance`
 *   mid-flight and dropping the job list — to achieve nothing. What a new token
 *   is actually for is `resume`: the one way out of an authentication pause
 *   that costs the reader nothing. Supabase re-emits `SIGNED_IN` whenever a tab
 *   regains focus (useSession.ts), so this must depend on the token *string*
 *   and not on the session object, or it would fire on every alt-tab.
 */
export function useJobSession(readerId: string | null, accessToken: string | null): void {
  useEffect(() => {
    if (!readerId) return;
    jobEngine.start(readerId);
    /* **The upload engine is bound here too**, and for the same reason rather
       than for convenience: it is the other tab-level singleton that outlives
       every mount, and it holds a reader's filename and their bytes. Left
       unbound, signing out mid-transfer leaves one reader's upload in a
       singleton that then posts `/api/jobs` as whoever signs in next. GPT Sol,
       reviewing docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md.

       Not in the token effect below: a refreshed token must not tear down a
       transfer, which is exactly the mistake the comment above warns about for
       the job list. */
    uploadEngine.start(readerId);
    return () => {
      jobEngine.stop();
      uploadEngine.stop();
    };
  }, [readerId]);

  useEffect(() => {
    if (!readerId || !accessToken) return;
    jobEngine.resume();
    /* **And the upload engine, which fails differently.** A job whose
       `/advance` is refused 401 is retried by the poller for ever; a queue POST
       happens once and then sits `failed`. So a reader whose session lapsed
       during a long upload had their file safely in Storage and an ingest
       nobody would ever queue — recoverable only by going back to the page and
       pressing Try again. `resume` there retries a 401 queue phase and nothing
       else. GPT Sol, 2026-09-03, finding 5. */
    uploadEngine.resume();
  }, [readerId, accessToken]);
}

/**
 * @param onFinished called once per job that reaches `done` **after this
 *   subscriber began observing**, so the caller can reload whatever that job
 *   changed. The library list, in practice: an article appears on the shelf the
 *   instant its last step succeeds, with no reload and no "it'll show up
 *   eventually". A job that was already done when this hook arrived is never
 *   announced.
 * @param options.idle whether being mounted keeps the engine's eight-second
 *   idle poll going. Defaults to yes, which is right for a surface somebody is
 *   *watching* the queue on — the shelf, a mode's band. `false` for one mounted
 *   everywhere that only needs its own job: it still sees every change and every
 *   completion, and a running job is still polled every second, but at rest it
 *   costs nothing. `jobEngine.subscribeQuietly`; the arc is why it exists.
 */
export function useJobs(
  onFinished?: (job: Job) => void,
  options: { idle?: boolean } = {},
): UseJobs {
  /* Two stable method references, never an arrow built here: a fresh function
     per render makes `useSyncExternalStore` unsubscribe and resubscribe on
     every render. */
  const subscribe = options.idle === false ? jobEngine.subscribeQuietly : jobEngine.subscribe;
  const snapshot = useSyncExternalStore(subscribe, jobEngine.getSnapshot);

  /**
   * **Where this subscriber started watching, captured during its first
   * render** — and the render is the point.
   *
   * This used to be a `Set` of already-announced ids, seeded in the effect.
   * That is a bug the refactor would have introduced rather than kept: the
   * engine now polls whether or not any component is mounted, so a job can
   * reach `done` **between this component's render and its subscription
   * effect**, and a Set seeded in the effect would baseline that real
   * completion away as history. A cursor taken at render cannot: everything
   * past it is news by definition. GPT Sol, 2026-09-01, reviewing the plan.
   *
   * `useState`'s lazy initialiser rather than a ref assignment, so Strict
   * Mode's double render cannot take two different readings — both run in the
   * same synchronous pass, before anything can arrive.
   */
  const [openedAt] = useState(() => jobEngine.completionCursor());
  const cursor = useRef(openedAt);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  /* No dependency array on purpose. A completion always changes the job list,
     so it always causes a render here; draining after every commit is what
     closes the render-to-effect window the cursor exists for. It is a number
     comparison against an almost always empty list. */
  useEffect(() => {
    const drained = jobEngine.drainCompletions(cursor.current);
    cursor.current = drained.cursor;
    for (const job of drained.jobs) finishedRef.current?.(job);
  });

  /**
   * Act, then poll at once rather than waiting out the interval.
   *
   * Returns what the action returned, or null if it threw. It used to return
   * nothing, which was fine while every caller only wanted the side effect;
   * `run` below wants the job it just created, and a second POST helper beside
   * this one would be a second place that knows how a failed action is
   * reported.
   *
   * **Two records of the same failure, on purpose.** `error` is engine state
   * and is shared with the poll, which clears it on its next success —
   * including the poll this function's own `finally` starts, one line later.
   * `lastFailure` is a ref only this subscriber's actions touch, so it survives
   * that. See `lastFailure` on the interface for what was going wrong before it
   * existed.
   *
   * A success is also the "explicit successful recovery" that lifts an
   * authentication pause: the engine stopped because the server said no, and
   * this is the server saying yes.
   *
   * **Fenced to the session it started in.** The engine fences its own polls
   * and advances by keeping the generation in a local; an action is fired from
   * here, so the epoch has to travel with it. Without that, an add that reader
   * A pressed just before signing out resolves inside reader B's engine and
   * clears B's error, lifts B's auth pause and pokes B's queue. `lastFailure`
   * is deliberately *not* fenced — it belongs to this subscriber, and a
   * subscriber does not outlive its own tab's mount.
   *
   * **And the status travels with it too**, because a final 401 from an action
   * is the same "stop asking" as a final 401 from a poll, and passing only
   * `err.message` threw away the one field that says which refusal it was.
   */
  const lastFailure = useRef<string | null>(null);
  const act = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    const epoch = jobEngine.epoch();
    try {
      const value = await fn();
      lastFailure.current = null;
      jobEngine.actionSucceeded(epoch);
      return value;
    } catch (err) {
      /* **The server's own words**, kept where no poll can clear them — see
         `lastFailure` on the interface. It held `{ message, blocking }` until
         2026-09-02: the blocking job came out of a 409 that no longer exists,
         and one field with nothing beside it cannot fall out of step with
         itself. */
      lastFailure.current = (err as Error).message;
      jobEngine.actionFailed((err as Error).message, statusOf(err), epoch);
      return null;
    }
  }, []);

  /* Generic in what comes back, because one of the three bodies below is not a
     `Job` — see `addUpload`. `Job` is the default, so the other two read as
     they always did. */
  const post = <T = Job,>(body: unknown) =>
    send<T>("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    jobs: snapshot.jobs,
    loaded: snapshot.loaded,
    error: snapshot.error,
    driverFailures: snapshot.driverFailures,
    lastFailure: () => lastFailure.current,
    add: (url) => act(() => post({ url })),
    addUpload: (uploadId) => act(() => post<Job | AlreadyAnArticle>({ uploadId })),
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
