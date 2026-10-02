/**
 * **The thread's read and its job**, for the Tweets band.
 *
 * Lifted out of the Tweets *page* on 2026-09-29, when the thread stopped being a
 * page of its own and became a mode (Greg, SPIDERYARN-READING2-5A;
 * docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md).
 * The shape is `useFaq`'s: `useOrderedRead` for the ordering, `useStepJob` for
 * the job — and not `useAutoRun` for the first open.
 *
 * **Opening it writes the thread, however the owner arrived** — the one mode
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
 * the rule came across with it (GPT Sol, plan review, 2026-09-29). The one
 * arrival that is *not* intent — the shelf restoring the last view — is closed
 * by `NEEDS_AN_EXPLICIT_PRESS` in last-view.ts, which drops `?mode=tweets` from
 * a restore. src/web/useAutoRun.ts § `useAutoRunOnArrival` has what it spends
 * on and why that is bounded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { THREAD_RECHECK_FAILED } from "../messages.js";
import type { Job, ThreadResponse, TweetThread } from "../types.js";
import { recordLog } from "./log-buffer.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRunOnArrival } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";

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
      try {
        const res = await apiFetch(`/api/tweets/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          setLoaded(null);
          setError(null);
          answered.current = true;
          setStatus("none");
          return;
        }
        const found = await readJson<ThreadResponse>(res);
        if (!current()) return;
        setLoaded(found);
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
        } else {
          setError((err as Error).message);
          setStatus("error");
        }
      }
    },
    [slug],
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
  const regenerate = useCallback(async () => {
    await queue.start({ force: true });
  }, [queue]);

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
    retryRead,
    refresh,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
