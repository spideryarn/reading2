/**
 * The quotes, as the reading view sees them: the list, whether it still
 * describes the article, and the one thing you can ask for.
 *
 * The read half is `GET /api/quotes/:slug`; the write half is a **job**, because
 * choosing them is a model call over the whole article and takes tens of seconds
 * (docs/project/ingest-queue.md).
 *
 * ## One verb, for the ideas' reason
 *
 * `useGlossary` has `find`, `more` and `reset`, and the difference between the
 * first two is the whole of that feature: running the glossary step again
 * **appends**, so "give me more terms" and "start over" cannot be the same
 * button and `reset` needs a DELETE of its own to mean anything.
 *
 * Quotes replaces. A piece has a dozen lines worth keeping, not forty, so there
 * is nothing to paginate — which means running the step again already *is*
 * "choose them again". No DELETE route, and the class of bugs that comes with
 * an append path does not exist here to be got wrong.
 *
 * **Two verbs since 2026-09-02** — `ensure` and `regenerate` — and the split is
 * `force` rather than append: see useIdeas.ts, which made the same change for
 * the same reason on the same day.
 *
 * ## Two hooks since 2026-09-08, not one
 *
 * `useQuotesRead` is the GET and `useQuotes` is everything else, because the
 * quotes are now marked in the prose in **every** mode and a reader who never
 * opens the band still needs the list. `QuotesRead` below carries the whole
 * argument, including the two bugs that hoisting all of this would have been.
 *
 * ## What this hook carries that its siblings do not
 *
 * `discarded` — what the stage refused to store. Every other panel can report
 * only what it has; this one can say *three suggestions were discarded because
 * their wording could not be verified*, which is the difference between a list
 * that is honestly short and a list that is quietly short. It comes off the
 * artefact rather than out of a log, because a log is invisible to the person
 * the drop happened to. GPT Sol, 2026-08-31.
 *
 * See docs/project/quotes.md and src/quotes.ts.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job, Quotes, QuotesResponse } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

type QuotesStatus = "loading" | "none" | "ready" | "error";

/**
 * **The opening read, split off from the band's hook so the prose can have it
 * too** — `useGlossaryRead`'s shape, for `useGlossaryRead`'s reason, one
 * feature later.
 *
 * The quotes are marked in the prose in **every** mode since 2026-09-08
 * (docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md), so the list
 * is needed by a reader who never opens the band — exactly as the glossary's
 * underlines have been since 2026-08-26. What crosses that seam is the *read*
 * and nothing else:
 *
 * | | mounted by | what it is |
 * |---|---|---|
 * | `useQuotesRead` | `OwnedReader`, always | one `GET /api/quotes/:slug` |
 * | `useQuotes` | `QuotesBand`, in quotes mode | the job poll, the auto-run, the verbs |
 *
 * **Hoisting the whole hook instead would have been two bugs**, and both were
 * found rather than reasoned. `useStepJob` subscribes through `useJobs`, and a
 * subscriber cannot *wake* the job engine but does hold it to its eight-second
 * idle cadence once anything has started it — which is the sentence
 * `GlossaryBand`'s docstring is about. And `useAutoRun`'s owner lives for the
 * *hook's* mount, so an owner mounted up here could claim a Quotes press, watch
 * the reader leave the band, and spend the token when the GET finally settled —
 * against `activation.ts`'s rule that a press belongs to the band on screen.
 * GPT Sol, 2026-09-08.
 *
 * ## An always-mounted read is not an always-fresh read
 *
 * The opening GET happens once, and **every later revalidation belongs to the
 * band**: its mount `reload`, and its job-completion `refresh`. So a list
 * written while the band was closed — a job that finished after the reader left
 * it, another tab, a CLI run with no job row at all — does not reach the prose
 * until the band is opened again or the page is reloaded.
 *
 * **Named rather than fixed, and the reason is that the glossary has exactly
 * this gap and says so** — `useGlossaryRead`'s header, since 2026-08-27:
 * *"a glossary written in another tab while this band was closed would otherwise
 * never arrive"*. Its answer is the same mount `reload`, and matching the
 * established pattern beats inventing a second one here. The honest fix is one
 * thing and it belongs to both: a completion event that does not put a
 * subscriber on the job engine's idle cadence, plus focus revalidation for the
 * CLI case.
 *
 * It is a **staleness** gap and not a disagreement — the panel and the prose
 * read the same `QuotesRead`, so they are stale together and can never show
 * different lists. GPT Sol raised it reviewing the built code, 2026-09-08.
 */
export interface QuotesRead {
  status: QuotesStatus;
  quotes: Quotes | null;
  /** See `UseQuotes.stale` — it means more here than on any sibling panel. */
  stale: boolean;
  outdated: boolean;
  profiled: boolean;
  profileChanged: boolean;
  error: string | null;
  /**
   * Fetch again **only if nothing is already fetching** — the band's mount.
   * Joins a request in flight rather than starting a second, and never returns
   * `status` to `loading`. `useGlossary.ts § GlossaryRead.reload` is the long
   * version.
   */
  reload(): Promise<void>;
  /**
   * Fetch again **because the list on the server has just changed** — a quotes
   * job finished. A trailing fetch rather than a joining one, because a request
   * already in flight read the pre-job list. `useGlossary.ts § refresh` carries
   * the five-step sequence this gets wrong the other way.
   */
  refresh(): Promise<void>;
}

export interface UseQuotes {
  status: QuotesStatus;
  quotes: Quotes | null;
  /**
   * The article moved after these were chosen.
   *
   * **It means more here than on any sibling panel.** A stale glossary entry is
   * a definition that still reads correctly; a stale quote carries a block id
   * that may be gone *and* words that may no longer be in the piece. This is
   * the one band whose staleness can make it false rather than merely dated,
   * which is why the panel puts the banner above the list.
   */
  stale: boolean;
  /** They predate the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /** These were chosen with a reader profile at all. */
  profiled: boolean;
  /** ...and that profile is no longer the reader's. */
  profileChanged: boolean;
  hasProfile: boolean;
  /** The article this band is about — carried alongside `hasProfile`, as the ideas do. */
  slug: string;
  error: string | null;
  /** The job choosing this article's quotes, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /**
   * This tab can see the job on screen and cannot move it. A pass-through:
   * `StepJob.stalled` in src/web/useStepJob.ts carries the reasoning, and
   * src/job-state.ts § Transport health is not a job state carries why it is
   * not on the record.
   */
  stalled: boolean;
  /** The POST has gone and the queue has not seen it yet. `StepJob.starting`. */
  starting: boolean;
  /** The run in flight was started automatically. `UseIdeas.automatic`. */
  automatic: boolean;
  /**
   * **Choose the quotes if none have been** — unforced, for the automatic run
   * and for the button beside the empty state. They have to be the same
   * request, or their `work_key`s differ and the reader pays twice:
   * useIdeas.ts § `ensure`.
   */
  ensure(useProfile?: boolean): Promise<void>;
  /**
   * **Choose them again** — forced, for the button offered beside a list that
   * is current, where an unforced run would skip. Safe to force because this
   * step replaces rather than appends, and `quotes` is in
   * FORCE_ONLY_WHEN_NAMED with `useStepJob` naming the step.
   */
  regenerate(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

export function useQuotesRead(slug: string): QuotesRead {
  const [status, setStatus] = useState<QuotesStatus>("loading");
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The read itself — the parse, the 404 branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is
   * set: false means this reply is about an article, or an artefact, the hook
   * has since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/quotes/${encodeURIComponent(slug)}`);
      if (!current()) return;
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have none, and this is
        // what the panel's button is for.
        setQuotes(null);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<QuotesResponse>(res);
      if (!current()) return;
      setQuotes(loaded.quotes);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null` rather than truthiness: the field is `string | null |
         undefined` and only `null` and absent mean "chosen without one". */
      setProfiled(loaded.quotes.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (!current()) return;
      setError((err as Error).message);
      /* **A failed revalidation must not take the list away.** `load` is not
         only the opening read — `onFinished` below calls it again every time a
         job finishes — and the panel renders the list only under
         `status === "ready"`, so an unconditional `error` here would let a flaky
         connection blank a list that was still perfectly good. Only the opening
         read has nothing to fall back on. The message is shown either way. Same
         guard, same reason, as useIdeas.ts and useGlossary.ts. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     seven other artefact readers — this one lost that race until 2026-09-02
     (tests/artefact-read-race.test.tsx). */
  const { reload, refresh } = useOrderedRead(load);

  /* The opening read. Everything after it goes through `reload`, which does not
     return `status` to `loading` — including `QuotesBand`'s own mount effect,
     which joins this request rather than making a second. */
  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, quotes, stale, outdated, profiled, profileChanged, error, reload, refresh };
}

/**
 * The band's half: the jobs, the verbs, and the two facts only a signed-in
 * owner of *this* article has.
 *
 * `read` comes from `useQuotesRead` in `OwnedReader` — see its docstring for why
 * the fetch moved up there and what this hook still has to do on mount.
 */
export function useQuotes(slug: string, read: QuotesRead): UseQuotes {
  const { status, quotes, stale, outdated, profiled, profileChanged, error, reload, refresh } = read;
  const hasProfile = useHasProfile(slug);

  /**
   * Revalidate on mount, behind whatever is on screen.
   *
   * **Not a refetch for its own sake**, and the glossary learnt this from a GPT
   * Sol review rather than from first principles: `useStepJob` treats its first
   * poll as a baseline and does not announce a job that had already finished, so
   * a list written **in another tab while this band was closed** has nothing
   * else to bring it in — the panel would show the old quotes for ever.
   *
   * `reload` joins a request already in flight, so opening the band while
   * `OwnedReader`'s opening GET is outstanding costs nothing, and it never
   * returns `status` to `loading`. See `useGlossary`, which does the same thing
   * three lines the same way.
   */
  useEffect(() => {
    void reload();
  }, [reload]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary, the
     summaries and the ideas.

     `refresh`, not `reload`: a finished job has just written a new list, and a
     request already in flight read the old one. `QuotesRead.refresh` has the
     sequence this gets wrong the other way. */
  const queue = useStepJob(slug, "quotes", refresh);

  /* Two verbs, split on `force`. See the interface above, and useIdeas.ts. */
  const ensure = useCallback(
    async (useProfile = true) => {
      await queue.start({ useProfile });
    },
    [queue],
  );
  const regenerate = useCallback(
    async (useProfile = true) => {
      await queue.start({ force: true, useProfile });
    },
    [queue],
  );

  /* `reload` is the way out of a failed read — useAutoRun.ts § A failed read is
     not an answer, and useIdeas.ts says why it is `reload` and not `load`. */
  const auto = useAutoRun(slug, "quotes", status, ensure, reload);

  return {
    status,
    quotes,
    stale,
    outdated,
    profiled,
    profileChanged,
    hasProfile,
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
