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
 * the panel says *"Searched on …"* — displayed provenance, not automatic
 * staleness. A visitor opening a year-old shared article must be able to see how
 * old the search is without the artefact declaring itself invalid.
 * src/types.ts § `Debate.searchedAt`.
 *
 * See docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md and
 * src/debate.ts.
 */
import { useCallback, useEffect, useState } from "react";
import type { Debate, DebateResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";

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
  cancel(id: string): void;
}

export function useDebate(slug: string): UseDebate {
  const [status, setStatus] = useState<DebateStatus>("loading");
  const [debate, setDebate] = useState<Debate | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The read itself — the parse, the 404 branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is set:
   * false means this reply is about an article, or an artefact, the hook has
   * since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/debate/${encodeURIComponent(slug)}`);
      if (!current()) return;
      if (res.status === 404) {
        /* The ordinary case and by a long way the commonest: nobody has spent
           a web search on this article. This is what the panel's button is
           for. */
        setDebate(null);
        setStale(false);
        setOutdated(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<DebateResponse>(res);
      if (!current()) return;
      setDebate(loaded.debate);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (!current()) return;
      setError((err as Error).message);
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and the panel renders the rows only under
         `status === "ready"`, so an unconditional `error` here would let a flaky
         connection blank a list that cost real money. Only the opening read has
         nothing to fall back on, and the message is shown either way. Same
         guard, same reason, as useTimeline.ts and useIdeas.ts. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     other artefact readers. */
  const { reload, refresh } = useOrderedRead(load);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts. */
  const queue = useStepJob(slug, "debate", refresh);

  /* Two verbs, split on `force`. See the interface above. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  const regenerate = useCallback(async () => {
    await queue.start({ force: true });
  }, [queue]);

  /* **Arrival never POSTs.** `useAutoRun` spends a press and only a press: a
     pasted `?mode=debate`, a Back step and a link from the metadata page all
     mount this hook with nobody having done anything, and this is the most
     expensive step in the app to start by accident. `reload` rather than `load`
     is the way out of a failed read — useAutoRun.ts § A failed read is not an
     answer. */
  const auto = useAutoRun(slug, "debate", status, ensure, reload);

  return {
    status,
    debate,
    stale,
    outdated,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}
