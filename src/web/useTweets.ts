/**
 * **The thread's read and its job**, for the Tweets band.
 *
 * Lifted out of the Tweets *page* on 2026-09-29, when the thread stopped being a
 * page of its own and became a mode (Greg, SPIDERYARN-READING2-5A;
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md).
 * The shape is `useFaq`'s: `useOrderedRead` for the ordering, `useStepJob` for
 * the job — and not `useAutoRun` for the first open.
 *
 * **Opening it writes the thread, however the owner arrived** — the one view
 * that breaks *a press spends, arriving does not*, and it breaks it on Greg's
 * word rather than by accident:
 *
 * > The Tweets mode should automatically start generating (if it hasn't already
 * > generated) when opened (without having to click a button to kick it off)
 * >
 * > — Greg, 2026-09-12
 *
 * As a page that was `useAutoRunOnArrival` (260915e), because a reload or a
 * pasted link had shown him the button. Becoming a mode did not revoke that, so
 * the rule came across with it (GPT Sol, plan review, 2026-09-29) — and again
 * on 2026-10-03, when the mode became Summary's Thread view and Greg said
 * *"keep all of the tweet thread. Functionality and UI"*
 * (docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md
 * § Decision 6). The one arrival that is *not* intent — the shelf restoring
 * the last view — is closed in last-view.ts § `opensTheThread`, which drops
 * the mode from a restore that would open the thread.
 * src/web/useAutoRun.ts § `useAutoRunOnArrival` has what it spends on and why
 * that is bounded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { THREAD_RECHECK_FAILED } from "../messages.js";
import type { Job, ThreadResponse, TweetThread } from "../types.js";
import { recordLog } from "./log-buffer.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRunOnArrival } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { useFreshReads, useRewriteHold } from "./rewrite-hold.js";

export type TweetsStatus = "loading" | "none" | "ready" | "error";

export interface UseTweets {
  status: TweetsStatus;
  thread: TweetThread | null;
  /** The article moved under this thread. */
  stale: boolean;
  /** The reader's profile changed since it was written. `ThreadResponse.profileChanged`. */
  profileChanged: boolean;
  /**
   * What went wrong with a read — the opening one's message in the `error`
   * status, or, over a thread already on screen, `THREAD_RECHECK_FAILED`'s
   * sentence rather than the browser's own words (docs/project/copy.md).
   */
  error: string | null;
  job: Job | null;
  failed: StepFailure | null;
  stalled: boolean;
  starting: boolean;
  /**
   * A forced run was pressed on the thread still on screen, and has neither
   * replaced it nor failed — every forced control waits. rewrite-hold.ts.
   */
  rewriting: boolean;
  /** Repeat only the GET after a failed read. Never spends. */
  retryRead(): Promise<void>;
  /** Read again after the profile panel saved — useSimple.ts § `refresh`. Never spends. */
  refresh(): Promise<void>;
  /** Write it if nobody has — the automatic run's request, and the empty state's button. */
  ensure(): Promise<void>;
  /** The forced run — the stale banner's button. */
  regenerate(): Promise<void>;
  cancel(id: string): void;
}

export function useTweets(slug: string): UseTweets {
  const [status, setStatus] = useState<TweetsStatus>("loading");
  const [loaded, setLoaded] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;
  /**
   * Whether a read has ever answered for this slug — a thread or a clean 404.
   * Read by the catch, which is a stable callback and cannot see state; after
   * an answer, a failed read keeps what is on screen and says so.
   */
  const answered = useRef(false);
  useEffect(() => {
    answered.current = false;
  }, [slug]);

  /**
   * Fetch the thread. Its own endpoint rather than a field on the article:
   * most articles have none, so carrying one on the article payload would make
   * every reader of every article download a `null`.
   */
  const load = useCallback(
    async (current: () => boolean) => {
      const started = begin();
      try {
        const res = await apiFetch(`/api/tweets/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          setLoaded(null);
          landed(started, res, null);
          setError(null);
          answered.current = true;
          setStatus("none");
          return;
        }
        const found = await readJson<ThreadResponse>(res);
        if (!current()) return;
        setLoaded(found);
        /* `?.`: a null thread is drawn as it always was, not thrown on here. */
        landed(started, res, found.thread?.generatedAt ?? null);
        setError(null);
        answered.current = true;
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        /* **The raw message stops at the console** when a thread is already on
           screen: the commonest failure here is a `TypeError` out of `fetch`,
           which is the browser's words, not ours. And a caught failure reaches
           no global handler, so the log buffer is told the name — never the
           message. src/web/log-buffer.ts. */
        console.error(`[tweets] could not read the thread for ${slug}`, err);
        recordLog({
          kind: "client-error",
          source: "tweets",
          name: err instanceof Error ? err.name : "Error",
        });
        /* **A failed reload must not take the thread away** — `load` runs again
           whenever a job finishes, and only the opening read has nothing to
           fall back on. */
        if (answered.current) {
          setError(THREAD_RECHECK_FAILED.message);
          /* **This read is over, so it is not `loading`.** `retryRead` goes to
             `loading` when nothing is loaded, and after a clean 404 that is
             true *and* `answered` is — so the earlier answer kept the view and
             nothing ended the wait. Only a 404 gets here loading, and `none` is
             what it said.
             docs/postmortems/261004f-a-previous-404-cannot-settle-the-next-failed-retry.md. */
          setStatus((was) => (was === "loading" ? "none" : was));
        } else {
          setError(describeFetchFailure(err as Error));
          setStatus("error");
        }
      }
    },
    [slug, begin, landed],
  );

  /* An ordinary `reload` joins the read in flight, a post-job `refresh` trails
     it, and only the newest reply commits. src/web/useOrderedRead.ts. */
  const { reload, refresh } = useOrderedRead(load);

  useEffect(() => {
    void reload();
  }, [reload]);

  const retryRead = useCallback(async () => {
    setError(null);
    if (loaded === null) setStatus("loading");
    await reload();
  }, [loaded, reload]);

  const queue = useStepJob(slug, "tweets", refresh, "watches-queue");

  /* Two verbs, split on `force`: the automatic run and the empty state's button
     must be the same unforced request, or their `work_key`s differ and the
     reader pays twice. useIdeas.ts § `ensure`. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  /* The thread's clock is its identity: a forced run replaces it and re-stamps it. */
  const hold = useRewriteHold({
    slug,
    step: "tweets",
    identity: loaded?.thread?.generatedAt ?? null,
    queue,
    fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  /* Arrival spends, once per page load — see the header. `reload` is the way
     out of a failed read: useAutoRun.ts § A failed read is not an answer. */
  useAutoRunOnArrival(slug, "tweets", status, ensure, reload);

  return {
    status,
    thread: loaded?.thread ?? null,
    stale: loaded?.stale ?? false,
    profileChanged: loaded?.profileChanged ?? false,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    rewriting: hold.rewriting,
    retryRead,
    refresh,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
