/**
 * The debate, as the reading view sees it: what the open web said about this
 * piece, whether it still describes the article, and the one thing you can ask
 * for.
 *
 * The read half is `GET /api/debate/:slug`; the write half is a **job**, and
 * this one costs more than any of its neighbours — two separately metered
 * model calls that each go out to the open web, up to ~$0.27 a run and rising
 * with the length of the article (src/debate.ts § the spend ceiling).
 *
 * ## Two verbs, like the timeline next door
 *
 * `ensure` and `regenerate`, split on `force`. Debate replaces rather than
 * appends, so running the step again already *is* "search again", and the class
 * of bugs an append path brings — a FORBIDDEN list, "a stale list is not
 * appended to" — does not exist here to be got wrong. No DELETE route.
 *
 * The split matters for the reason useIdeas.ts gives: `work_key` is computed
 * from the request including its `force`, so the automatic run and the button
 * beside the empty state have to make the **identical** unforced request or the
 * reader pays twice. On this step that is the dearest instance of that mistake
 * in the app.
 *
 * ## Two staleness facts, not three, and neither is about the search's age
 *
 * `stale` and `outdated`, and deliberately no `profileChanged`: who is reading
 * does not change what the web said, so the reader profile is not in this
 * stage's stamp at all.
 *
 * **Neither of them is `searchedAt`.** Debate is time-sensitive research and a
 * shared link outlives it, so the artefact carries the day the search ran and
 * the band's (i) says when it was searched — displayed provenance, not automatic
 * staleness. A visitor opening a year-old shared article must be able to see how
 * old the search is without the artefact declaring itself invalid.
 * src/types.ts § `Debate.searchedAt`.
 *
 * See docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md and
 * src/debate.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Debate, DebateResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type FreshReads, useFreshReads, useRewriteHold } from "./rewrite-hold.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

type DebateStatus = "loading" | "none" | "ready" | "error";

export interface UseDebate {
  status: DebateStatus;
  debate: Debate | null;
  /** The article moved after this was searched — blocks, sections or the cited head. */
  stale: boolean;
  /** It predates the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /** The article this band is about. */
  slug: string;
  error: string | null;
  /** The job searching the web about this article, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /**
   * This tab can see the job on screen and cannot move it. A pass-through:
   * `StepJob.stalled` in src/web/useStepJob.ts carries the reasoning.
   */
  stalled: boolean;
  /** The POST has gone and the queue has not seen it yet. `StepJob.starting`. */
  starting: boolean;
  /**
   * The run in flight was started automatically. `UseTimeline.automatic`, and
   * nothing draws it here for the same reason: the reader profile is not in
   * this stage's stamp, so there is no tickbox to replace. It is on the
   * interface so the artefact hooks answer the same questions.
   */
  automatic: boolean;
  /**
   * **Search the web if nobody has** — unforced, for the automatic run and for
   * the button beside the empty state. They have to be the same request, or
   * their `work_key`s differ and the reader pays for two web searches instead
   * of one: useIdeas.ts § `ensure`.
   */
  ensure(): Promise<void>;
  /**
   * **Search it again** — forced, for the button offered beside a debate that
   * is current, where an unforced run would skip. Safe to force because this
   * step replaces rather than appends.
   */
  regenerate(): Promise<void>;
  /**
   * The forced run was pressed on the search still on screen, and has neither
   * replaced it nor failed — every forced control waits. rewrite-hold.ts.
   */
  rewriting: boolean;
  /** Read again, trailing a read in flight — `OrderedRead.refresh`. Never spends. */
  refresh(): Promise<void>;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  cancel(id: string): void;
}

/**
 * **The read half, alone** — the GET, its ordering and nothing else: no job, no
 * poll, no automatic run, so mounting it can never spend (this is the most
 * expensive step in the app to start by accident). Marginalia reads the claim
 * rows through this; `useDebate` layers the job on it, as `useIdeas` does on
 * `useIdeasRead`. docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md.
 */
export interface DebateRead {
  status: DebateStatus;
  debate: Debate | null;
  stale: boolean;
  outdated: boolean;
  error: string | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /** Join a read in flight, or start one. `OrderedRead.reload`. */
  reload(): Promise<void>;
  /** Read again because the list has just changed. `OrderedRead.refresh`. */
  refresh(): Promise<void>;
  /** This read's bookkeeping for the forced verb's hold — rewrite-hold.ts § `FreshReads`. */
  fresh: FreshReads;
}

export function useDebateRead(slug: string): DebateRead {
  const [status, setStatus] = useState<DebateStatus>("loading");
  const [debate, setDebate] = useState<Debate | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;
  /**
   * The article the server has said "none yet" for. A failed read after that
   * answer — a failed *Try again* included — ends at `none`, not `error`,
   * so the empty state's button stays (Greg, 2026-10-07; docs/project/mode.md
   * § The artefact, if the mode shows one). Keyed by slug, so one article's
   * answer cannot stand in for another's.
   */
  const saidNoneFor = useRef<string | null>(null);

  /**
   * The read itself — the parse, the "none yet" branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is set:
   * false means this reply is about an article, or an artefact, the hook has
   * since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    const started = begin();
    try {
      /* The header asks for "none yet" as `200 null` rather than a 404, which
         a browser prints in red (`NONE_YET_AS_NULL_HEADER`, src/types.ts). A 404
         is still read the same way, for a server that has not heard of the
         header — the minutes of a deploy. */
      const res = await apiFetch(`/api/debate/${encodeURIComponent(slug)}`, {
        headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
      });
      if (!current()) return;
      const loaded = res.status === 404 ? null : await readJson<DebateResponse | null>(res);
      if (!current()) return;
      if (loaded === null) {
        /* The ordinary case and by a long way the commonest: nobody has spent
           a web search on this article. This is what the panel's button is
           for. */
        setDebate(null);
        setStale(false);
        setOutdated(false);
        landed(started, res, null);
        setError(null);
        saidNoneFor.current = slug;
        setStatus("none");
        return;
      }
      /* Only an explicit `null` means none yet, and a reply without its
         artefact is published nowhere: a `MalformedReply`, so the reader gets
         `PAGE_FAULT` (tests/read-error-matrix.test.tsx) and what is on screen
         stays. */
      if (typeof loaded?.debate !== "object" || loaded.debate === null) {
        throw new MalformedReply("the debate reply has no debate");
      }
      setDebate(loaded.debate);
      landed(started, res, loaded.debate.searchedAt);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      setError(null);
      saidNoneFor.current = null;
      setStatus("ready");
    } catch (err) {
      if (!current()) return;
      setError(describeFetchFailure(err as Error));
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and the panel renders the rows only under
         `status === "ready"`, so an unconditional `error` here would let a flaky
         connection blank a list that cost real money. Only the opening read has
         nothing to fall back on, and the message is shown either way. Same
         guard, same reason, as useTimeline.ts and useIdeas.ts. */
      setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
    }
  }, [slug, begin, landed]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     other artefact readers. */
  const { reload, refresh } = useOrderedRead(load);

  /* The way out of a failed read, and never a generation verb — useFaq.ts §
     `retryRead`. Rows already on screen stay there while a failed
     revalidation is tried again; only the opening error returns to loading. */
  const retryRead = useCallback(async () => {
    setError(null);
    if (debate === null) setStatus("loading");
    await reload();
  }, [debate, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, debate, stale, outdated, error, retryRead, reload, refresh, fresh };
}

export function useDebate(slug: string): UseDebate {
  const read = useDebateRead(slug);
  const { status, reload, refresh } = read;

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts. */
  const queue = useStepJob(slug, "debate", refresh, "watches-queue");

  /* Two verbs, split on `force`. See the interface above. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  /* **The forced verb holds the search it was pressed on** (rewrite-hold.ts),
     as useIdeas.ts § `regenerate` does. `searchedAt` is the identity because it
     is this artefact's only clock (src/types.ts § `Debate.searchedAt`): a
     forced run replaces the search and re-stamps it. */
  const hold = useRewriteHold({
    slug,
    step: "debate",
    identity: read.debate?.searchedAt ?? null,
    queue,
    fresh: read.fresh,
    refresh,
  });
  const held = hold.run;
  const regenerate = useCallback(async () => {
    await held(() => queue.start({ force: true }));
  }, [queue, held]);

  /* **Arrival never POSTs.** `useAutoRun` spends a press and only a press: a
     pasted `?mode=debate`, a Back step and a link from the metadata page all
     mount this hook with nobody having done anything, and this is the most
     expensive step in the app to start by accident. `reload` rather than `load`
     is the way out of a failed read — useAutoRun.ts § A failed read is not an
     answer. */
  const auto = useAutoRun(slug, "debate", status, ensure, reload);

  return {
    status,
    debate: read.debate,
    stale: read.stale,
    outdated: read.outdated,
    slug,
    error: read.error,
    job: queue.job,
    failed: hold.rewriting ? null : queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    rewriting: hold.rewriting,
    refresh,
    retryRead: read.retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
