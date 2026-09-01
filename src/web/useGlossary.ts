/**
 * The glossary, as the reading view sees it: the list, whether it still
 * describes the article, and the three things you can ask for.
 *
 * The read half is `GET /api/glossary/:slug`; the write half is a **job**,
 * because finding the terms is a model call over the whole article and takes
 * tens of seconds (docs/project/ingest-queue.md). So this hook is mostly the
 * same shape as the thread page's state (src/web/Tweets.tsx), lifted into a
 * hook because the glossary lives in a band beside the prose rather than on a
 * page of its own.
 *
 * **Three verbs, and the difference between two of them is the whole feature:**
 *
 *  - `find()` — no glossary yet, or the one there has gone stale. The step's
 *    own freshness check agrees, so an ordinary run does the work.
 *  - `more()` — there is a perfectly good glossary and the reader wants more
 *    terms. `force` is what gets past the freshness check, and forcing this
 *    step *appends* rather than replacing (src/glossary.ts).
 *  - `reset()` — the list is wrong and should be started over. A DELETE, then a
 *    `find()`. Two acts, because "run it again" already means "add more" and a
 *    verb cannot mean both.
 *
 * See docs/project/glossary.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Glossary, GlossaryEntry, GlossaryLookup, GlossaryResponse, Job } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { apiFetch, fetchOk, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";

type GlossaryStatus = "loading" | "none" | "ready" | "error";

/**
 * The glossary read: the list, whether it still describes the article, and the
 * three ways it can change under us.
 *
 * **One fetch per article, owned by `Reader`.** There were two until
 * 2026-08-27 — this hook for the prose's underlines, and `useGlossary` below
 * for the band, fetching the identical URL from `status: "loading"` with
 * nothing shared. So the panel said *"Looking for a glossary…"* while the list
 * it was looking for was on screen, underlined, in the prose behind it. On the
 * Postgres store that second request reads most of the article out of the
 * database to compute one boolean. docs/plans/260827am-glossary-read-latency.md.
 *
 * The split itself was never about the fetch. `useGlossary`'s docstring gives
 * the reason and it is still good: that hook also mounts `useJobs`, which polls
 * for ever, and a reader who never opens the band should not pay for a poller.
 * But the *GET* became universal the day the underlines did (Greg, 2026-08-26),
 * so the band was paying for it twice. Now this hook reads and `useGlossary`
 * layers the jobs and the verbs on top.
 *
 * ## What the band still does on mount, and why it must
 *
 * It **revalidates**, in the background, behind the list already on screen.
 * Not because the list is likely wrong, but because nothing else would notice
 * if it were: `useJobs` treats its first poll as a baseline and deliberately
 * does not announce a job that was already `done` (`if (!first)` in
 * useJobs.ts). So a glossary written in another tab while this band was closed
 * would otherwise never arrive, and the band would show the old list for ever.
 * Found by a GPT Sol review of the plan, which is why "one request for the
 * page's lifetime" is *not* the invariant here. The invariant is that `status`
 * never returns to `loading` once it has been `ready` or `none`.
 *
 * ## Generations, not a flag
 *
 * `live` guards a *slug change*. It cannot order two operations on one slug: a
 * GET issued before a DELETE can land after it and put the list the reader just
 * threw away back on screen. So every fetch takes the generation it started in,
 * and a reply from an older one is dropped. This replaces the `pushed` ref,
 * which was the same idea aimed at a narrower case.
 *
 * **`clear` bumps it and `patchEntry` does not**, which is not an oversight.
 * The list `clear` discards has been deleted, so a reply describing it is news
 * about nothing. But bumping in `patchEntry` would cancel an in-flight reload,
 * and the commonest reason one is in flight is that a job has just finished —
 * so a reader who checked a term at the wrong moment would silently never see
 * the new terms. The opposite risk, a read that started before the lookup was
 * stored landing after it, is repaired by the trailing fetch instead.
 */
export interface GlossaryRead {
  status: GlossaryStatus;
  glossary: Glossary | null;
  stale: boolean;
  outdated: boolean;
  profiled: boolean;
  profileChanged: boolean;
  error: string | null;
  /**
   * Fetch again **only if nothing is already fetching** — the band's mount.
   *
   * Never returns `status` to `loading`, which is the point of it, and joins a
   * request already in flight rather than starting a second, so opening the
   * band while `Reader`'s opening GET is outstanding costs nothing.
   *
   * Use this when the question is *"have I got the list yet"*. When the
   * question is *"the list has changed"*, use `refresh`.
   */
  reload(): Promise<void>;
  /**
   * Fetch again **because the list on the server has just changed** — which
   * today means a glossary job finished.
   *
   * The distinction from `reload` is not tidiness, it is a bug GPT Sol found in
   * the first version, where both were the same call:
   *
   *   1. a GET starts, and reads the old glossary;
   *   2. a job finishes and writes a new one;
   *   3. `onFinished` reloads — and *joins the GET from step 1*;
   *   4. that GET lands with the pre-job list;
   *   5. `useJobs` has already announced the job, so nothing ever retries.
   *
   * The new terms then never appear. So a request in flight is not an answer to
   * this question: `refresh` arms a **trailing** fetch that runs after the
   * current one instead of joining it.
   */
  refresh(): Promise<void>;
  /** Empty the list now. `reset()` deletes the artefact and must not go on showing it. */
  clear(): void;
  /**
   * Merge one term's **lookup** into the list — `look()`, without refetching.
   *
   * The lookup only, never the whole entry, and that is a bug fix rather than
   * economy. `lookUpTerm` reads the entry, spends thirty seconds on a model
   * call, and returns *that* entry with the answer attached (src/term-lookup.ts)
   * — so if a glossary job rewrote the term in the meantime, replacing the
   * entry wholesale puts the pre-job name, aliases, scores and blocks back.
   * Nothing is in flight at that moment, so the trailing read does not save us
   * either. Found by GPT Sol reviewing the built code.
   *
   * **The id and the lookup, not the entry**, so that the wrong thing cannot be
   * passed. Taking a whole `GlossaryEntry` and using one optional field of it
   * left a shape the type allowed and this ignored: an entry with no lookup
   * merged nothing while `look()` resolved as though it had worked.
   */
  patchEntry(id: string, lookup: GlossaryLookup): void;
}

export function useGlossaryRead(slug: string): GlossaryRead {
  const [status, setStatus] = useState<GlossaryStatus>("loading");
  const [glossary, setGlossary] = useState<Glossary | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Bumped by every mutation and by every fetch. A reply carrying an older
     number than the current one is news about a list that no longer exists. */
  const generation = useRef(0);
  /* The request in flight, so a second caller joins it instead of starting one.
     Cleared in `finally`, including on the throw. */
  const inFlight = useRef<Promise<void> | null>(null);
  /* Somebody asked for fresh data while a request was already out. That request
     may have read the database before the change they are asking about, so it
     is not an answer — one more fetch runs when it lands. A flag rather than a
     queue: two changes during one request still only need one more read. */
  const trailing = useRef(false);
  /* `fetchNow` calls itself to run the trailing fetch, and a `useCallback`
     cannot name itself. */
  const fetchLatest = useRef<() => Promise<void>>(async () => {});

  const fetchNow = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const mine = ++generation.current;
    /* `| undefined`, and declared before it is assigned, so the `finally` below
       can ask whether the entry it is about to clear is still its own. Without
       that check this sequence loses the dedupe: request A is in flight;
       `clear()` nulls the entry; `reload()` starts request B and stores it; A's
       `finally` then nulls B's entry, and the next `reload()` starts a third
       request instead of joining B. Not a correctness bug — the generation
       counter still drops the stale replies — but it is the duplicate request
       this whole change is about, rebuilt in the mechanism meant to prevent it.

       The `undefined` is load-bearing rather than cosmetic: `let run: Promise<void>`
       does not typecheck, because TypeScript cannot see that the `finally` runs
       only after an `await`. GPT Sol found that this change had been made
       without re-running the typechecker. */
    let run: Promise<void> | undefined;
    run = (async () => {
      try {
        const res = await apiFetch(`/api/glossary/${encodeURIComponent(slug)}`);
        if (mine !== generation.current) return;
        if (res.status === 404) {
          /* The ordinary case, not a fault: most articles have no glossary, and
             this is what the panel's button is for. */
          setGlossary(null);
          setStale(false);
          setOutdated(false);
          setProfiled(false);
          setProfileChanged(false);
          setError(null);
          setStatus("none");
          return;
        }
        const loaded = await readJson<GlossaryResponse>(res);
        if (mine !== generation.current) return;
        setGlossary(loaded.glossary);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        /* `!= null` rather than truthiness: the field is `string | null |
           undefined` and only `null` and absent mean "written without one". A
           `!!` here would be right today and wrong the moment somebody stores an
           empty string. */
        setProfiled(loaded.glossary.profileHash != null);
        setProfileChanged(loaded.profileChanged);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (mine !== generation.current) return;
        /* Said out loud, unlike the hook this replaced. That one swallowed a
           failed read because the underlines are an enhancement over the prose
           and nothing rendered the message — but the panel renders it, and it
           is now the same read. The prose simply draws no underlines when there
           are no entries, which is what it already did. */
        setError((err as Error).message);
        /* **A failed revalidation must not take the list away.** The panel
           renders entries only when `status` is `ready`, so setting `error`
           unconditionally meant a reader who opened the band over a perfectly
           good list, on a flaky connection, watched it vanish and be replaced
           by a message — the opposite of "revalidate behind what is on screen".
           Only the opening read has nothing to fall back on. GPT Sol, reviewing
           the built code. The error is shown either way; `GlossaryPanel` puts
           it above the list. */
        setStatus((was) => (was === "loading" ? "error" : was));
      } finally {
        if (inFlight.current === run) inFlight.current = null;
        /* Somebody asked for fresh data while this was out. Only if we are
           still the current generation — a `clear()` since then means this
           article's list is being rebuilt and a read now would race it. */
        if (trailing.current && mine === generation.current) {
          trailing.current = false;
          void fetchLatest.current();
        }
      }
    })();
    inFlight.current = run;
    return run;
  }, [slug]);
  fetchLatest.current = fetchNow;

  /* "The list has changed" — see `refresh` on the interface. A request already
     out may predate the change, so it is not an answer to this. */
  const refresh = useCallback(async (): Promise<void> => {
    if (!inFlight.current) return fetchNow();
    trailing.current = true;
    /* Awaited twice on purpose. The first await is the request already out; its
       `finally` is what launches the trailing one and puts it in `inFlight`, so
       the second await is that. Returning after the first would resolve before
       the refresh this function promised had happened — nothing awaits it
       today, which is exactly why the contract should not be left lying. GPT
       Sol, reviewing the built code. */
    await inFlight.current;
    if (inFlight.current) await inFlight.current;
  }, [fetchNow]);

  /**
   * A new article clears the old one's list — **during render, not in an
   * effect.**
   *
   * React runs child effects before the parent's, and the child here is
   * `GlossaryBand`, whose own mount effect calls `reload()`. So an effect that
   * cleared `inFlight` would clear the request the band had *just* started, and
   * then start a second one — which is the duplicate this whole change is
   * about, rebuilt one layer down. Caught by the dedupe test, which counted 2.
   *
   * This is React's documented way of adjusting state when a prop changes, and
   * the ordering is the reason it is the right one: it happens before any
   * child renders, let alone runs an effect.
   */
  const [readingSlug, setReadingSlug] = useState(slug);
  if (readingSlug !== slug) {
    setReadingSlug(slug);
    generation.current++;
    inFlight.current = null;
    /* An armed refresh belongs to the article we have just left. Leaving it set
       would spend one GET fetching the new article for a change that happened
       in the old one. */
    trailing.current = false;
    setStatus("loading");
    setGlossary(null);
    setStale(false);
    setOutdated(false);
    setProfiled(false);
    setProfileChanged(false);
    setError(null);
  }

  /* The opening read. Everything after it goes through `reload`, which does not
     touch `status` — so the block above is the only place `loading` is ever
     re-entered, and it is entered once per article. */
  useEffect(() => {
    void fetchNow();
    /* Nothing armed survives unmount. Without this, a request outstanding when
       the reader closes the article can finish, find `trailing` set, and launch
       a GET for a page nobody is on. The generation check makes it harmless;
       it is still a request nobody wanted. */
    return () => {
      trailing.current = false;
    };
  }, [fetchNow]);

  const clear = useCallback(() => {
    generation.current++;
    inFlight.current = null;
    trailing.current = false;
    setGlossary(null);
    setStale(false);
    setOutdated(false);
    setProfiled(false);
    setProfileChanged(false);
    /* **Including the error.** It was the one read field left behind, so a
       failed background revalidation followed by a successful reset went on
       showing the old failure above the cleared list — and if the regeneration
       then failed too, indefinitely. GPT Sol, reviewing the built code. */
    setError(null);
    setStatus("none");
  }, []);

  /**
   * **Does not bump the generation**, unlike `clear`, and the asymmetry is the
   * point.
   *
   * A lookup is *stored on the server* (`glossary_lookups`, attached at the
   * read seam in src/store/pg.ts), so a reload landing after this one carries
   * the same answer — there is no local write to protect. Bumping here would
   * instead cancel a reload already in flight, and the commonest reason one is
   * in flight is that a job has just finished, so a reader who checked a term
   * at the wrong moment would silently never see the new terms.
   *
   * The two failures are not equal, which is what settles it: bumping loses
   * terms the reader paid a model call for, permanently. Not bumping risks a
   * read that started *before* the lookup was stored landing after it and
   * blinking the answer out — and **that one is repaired rather than accepted**,
   * which is the half GPT Sol was right to refuse. If a request is in flight
   * when this lands, a trailing read follows it, and the server has the lookup
   * by then.
   */
  const patchEntry = useCallback((id: string, lookup: GlossaryLookup) => {
    if (inFlight.current) trailing.current = true;
    setGlossary((current) =>
      current
        ? {
            ...current,
            /* **The incumbent, plus the lookup** — never the entry that came
               back. See the note on the interface: `lookUpTerm` returns a
               snapshot taken before a thirty-second model call, so its name,
               aliases, scores and blocks may be a regeneration out of date. */
            entries: current.entries.map((e) => (e.id === id ? { ...e, lookup } : e)),
          }
        : current,
    );
  }, []);

  return {
    status,
    glossary,
    stale,
    outdated,
    profiled,
    profileChanged,
    error,
    reload: fetchNow,
    refresh,
    clear,
    patchEntry,
  };
}

export interface UseGlossary {
  status: GlossaryStatus;
  glossary: Glossary | null;
  /** The article moved after the list was written. Said out loud, never worked around. */
  stale: boolean;
  /** The list predates the current prompt. A different fact from `stale`, with its own sentence. */
  outdated: boolean;
  /**
   * This list was written from a reader profile, and whether that profile is
   * still the one they have.
   *
   * A third fact with a third sentence, like `outdated` beside `stale`. It
   * matters most here of the five: a profile changes which terms get an entry
   * at all and what `difficulty` means, so a stale one is a threshold slider
   * filtering on somebody the reader no longer is.
   * docs/project/reader-profile.md.
   */
  profiled: boolean;
  profileChanged: boolean;
  /**
   * The reader has a profile that applies to **this article** — either half.
   *
   * Resolved here rather than in the panel because the slug is here, and the
   * question needs it: a reader who has written only "why you're reading this
   * one" has a profile as far as every prompt is concerned. src/web/useProfile.ts.
   */
  hasProfile: boolean;
  /**
   * The article this band is about — carried alongside `hasProfile` because
   * the same question needs it. The profile panel shows the *per-article* half
   * ("why you're reading this one") and links to the page that edits it, and
   * neither is possible without knowing which article. docs/plans/260830c-profile-panel.md.
   */
  slug: string;
  /** A read failure, or the reason the last request could not be started. */
  error: string | null;
  /** The job writing this article's glossary, if one is. Null otherwise. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: string | null;
  /**
   * The job that **refused** this run — an ingest already holding the article.
   * `StepJob.blocking` in src/web/useStepJob.ts carries the reasoning.
   */
  blocking: Job | null;
  /**
   * This tab can see the job on screen and cannot move it. Pass-through, like
   * `blocking` above — `StepJob.stalled` in src/web/useStepJob.ts carries the
   * reasoning, and src/job-state.ts § Transport health is not a job state
   * carries why it is not on the record.
   */
  stalled: boolean;
  /**
   * Write the list. `useProfile` defaults to true; pass false for a plain one.
   *
   * The flag rides on the *action* rather than being panel state, because it is
   * a property of the run and the artefact records what it was run with —
   * `profileHash`, src/profile.ts. Nothing has to remember the reader's choice:
   * the next visit reads it off the file.
   */
  find(useProfile?: boolean): Promise<void>;
  more(useProfile?: boolean): Promise<void>;
  reset(): Promise<void>;
  cancel(id: string): void;
  /** Check one term on the web. Resolves when the answer is in `glossary`. */
  look(id: string): Promise<void>;
  /** The term a lookup is running for, or null. One at a time, on purpose. */
  looking: string | null;
  /** Why the last lookup failed, if it did. Cleared when another is started. */
  lookFailed: string | null;
}

/**
 * The band: the jobs and the verbs, over a read somebody else owns.
 *
 * `read` comes from `useGlossaryRead` in `Reader` — see its docstring for why
 * the fetch moved up there and what the band still has to do on mount.
 */
export function useGlossary(slug: string, read: GlossaryRead): UseGlossary {
  const { status, glossary, stale, outdated, profiled, profileChanged, error } = read;
  const hasProfile = useHasProfile(slug);
  const [looking, setLooking] = useState<string | null>(null);
  const [lookFailed, setLookFailed] = useState<string | null>(null);

  /**
   * Revalidate on mount, behind whatever is on screen.
   *
   * **Not a refetch for its own sake.** `useJobs` below treats its first poll as
   * a baseline and does not announce a job that had already finished, so a
   * glossary written in another tab while this band was closed has nothing else
   * to bring it in — the band would show the old list for ever. Raised by a GPT
   * Sol review of docs/plans/260827am-glossary-read-latency.md, which is why removing
   * this mount fetch entirely was the wrong fix to the duplicate request.
   *
   * `reload` joins a request already in flight, so opening the band while
   * `Reader`'s opening GET is outstanding costs nothing, and it never returns
   * `status` to `loading` — which is the whole point of the change.
   */
  const { reload, refresh, clear, patchEntry } = read;
  useEffect(() => {
    void reload();
  }, [reload]);

  /* A failed DELETE is the band's own error, not the read's — `read.error` is
     about the GET and would be overwritten by the next reload. */
  const [resetFailed, setResetFailed] = useState<string | null>(null);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the ideas and
     the summaries. It carries the reasoning that used to be copied here.
     `refresh`, not `reload`: a finished job has just written a new list, and a
     request already in flight read the old one. See `refresh` on
     `GlossaryRead` for the sequence this gets wrong the other way, and note
     that this is the one thing the four copies did *not* agree about — the
     other three have no trailing fetch to reach for. */
  const queue = useStepJob(slug, "glossary", refresh);

  const run = useCallback(
    (force: boolean, useProfile = true) => queue.start({ force, useProfile }),
    [queue],
  );

  const find = useCallback((useProfile = true) => run(false, useProfile), [run]);
  const more = useCallback((useProfile = true) => run(true, useProfile), [run]);

  /**
   * Throw the list away and find a new one.
   *
   * The DELETE first, and the local state cleared before the job is asked for,
   * so the panel does not go on showing the old list while the new one is being
   * written — which would read as the reset having been ignored.
   *
   * A failed DELETE stops here rather than running anyway. Carrying on would
   * *append* to the list the reader just asked to be rid of, which is the exact
   * opposite of what they pressed.
   */
  const reset = useCallback(async () => {
    try {
      await fetchOk(`/api/glossary/${encodeURIComponent(slug)}`, { method: "DELETE" });
    } catch (err) {
      /* **This is where production stops**, and it is not a bug in this hook:
         deleting a glossary under `postgres` would null a column on a published
         revision, and that table is immutable once published, so the store
         answers 501 on purpose (src/store/index.ts § deleteGlossary). The
         message says so, and the DELETE failing must not fall through to `run`
         — which forces the step, and forcing it *appends*, which is the exact
         opposite of what the reader pressed. */
      setResetFailed((err as Error).message);
      return;
    }
    setResetFailed(null);
    clear();
    await run(false);
  }, [slug, run, clear]);

  /**
   * Check one term on the web — the panel's "check this" button.
   *
   * **A plain request rather than a job**, unlike everything else here. Finding
   * terms is one call over a whole article and belongs in the queue; checking a
   * single term is a question with a reader waiting on it, which is the shape
   * `useComments` already has. It reuses that call too — see `lookUpTerm` in
   * src/api.ts.
   *
   * **One at a time**, which is a deliberate limit and not a missing feature:
   * each of these is a model call the reader pays for, and a panel that will
   * fire five because five rows were clicked spends money on a mis-click. The
   * button is disabled while one is running.
   *
   * The answer is merged into the entry in place rather than refetching the
   * list, because a refetch would rebuild every row and lose the reader's
   * selection — and the server has just told us the one thing that changed.
   */
  const look = useCallback(
    async (id: string) => {
      if (looking) return;
      setLooking(id);
      setLookFailed(null);
      try {
        const res = await apiFetch(`/api/glossary/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/lookup`,
          { method: "POST" },
        );
        const { entry } = await readJson<{ entry: GlossaryEntry }>(res);
        /* The server always attaches one — `lookUpTerm` saves it and then
           returns the entry with it — so its absence is a broken contract
           rather than a case to paper over, and the reader is told. */
        if (!entry.lookup) throw new Error("The lookup came back without an answer.");
        patchEntry(entry.id, entry.lookup);
      } catch (err) {
        setLookFailed((err as Error).message);
      } finally {
        setLooking(null);
      }
    },
    [slug, looking, patchEntry],
  );

  return {
    status,
    glossary,
    stale,
    outdated,
    profiled,
    profileChanged,
    hasProfile,
    slug,
    error: resetFailed ?? error,
    job: queue.job,
    failed: queue.failed,
    blocking: queue.blocking,
    stalled: queue.stalled,
    find,
    more,
    reset,
    cancel: queue.cancel,
    look,
    looking,
    lookFailed,
  };
}
