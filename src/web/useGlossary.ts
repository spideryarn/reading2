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
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Glossary, GlossaryEntry, GlossaryResponse, Job } from "../types.js";
import { useJobs } from "./useJobs.js";
import { failure, readJson } from "./lib/api.js";

export type GlossaryStatus = "loading" | "none" | "ready" | "error";

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
  /** A read failure, or the reason the last request could not be started. */
  error: string | null;
  /** The job writing this article's glossary, if one is. Null otherwise. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: string | null;
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

/** Is this job one that would write a glossary? */
function writesGlossary(job: Job): boolean {
  return job.steps.some((s) => s.name === "glossary");
}

export function useGlossary(slug: string): UseGlossary {
  const [status, setStatus] = useState<GlossaryStatus>("loading");
  const [glossary, setGlossary] = useState<Glossary | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState<string | null>(null);
  const [lookFailed, setLookFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/glossary/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        // The ordinary case, not a fault: most articles have no glossary, and
        // this is what the panel's button is for.
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
      setError((err as Error).message);
      setStatus("error");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * `onFinished` rather than watching for a status change: `useJobs` already
   * knows which jobs it has announced and which were merely on the shelf when
   * the mode was opened, so entering the glossary does not refetch once per
   * historical job.
   *
   * **The cost, said out loud**, exactly as the thread page says it: `useJobs`
   * polls the whole job list and never stops, so sitting in glossary mode is
   * one small request every eight seconds. What it buys is that a run started
   * in another tab or from `npm run glossary` shows up here as progress rather
   * than as a button that appears to do nothing. If it ever matters, the fix is
   * an idle switch in `useJobs`, not a private poller here.
   */
  const onFinished = useCallback(
    (job: Job) => {
      if (job.slug === slug && writesGlossary(job)) void load();
    },
    [slug, load],
  );
  const queue = useJobs(onFinished);

  /**
   * The job writing this article's glossary, if one is.
   *
   * Found in the polled list rather than remembered from the click, which is
   * what makes a run started somewhere else show up here as progress.
   * `enqueue` hands back the job already in flight for an identical request, so
   * pressing the button twice cannot start a second one.
   */
  const job = useMemo(
    () =>
      queue.jobs
        .filter((j) => j.slug === slug && writesGlossary(j))
        .find((j) => j.status === "queued" || j.status === "running") ?? null,
    [queue.jobs, slug],
  );

  /**
   * What went wrong, in the two quite different ways it can.
   *
   * `postFailed` is the request never landing: no job exists, so nothing will
   * arrive in the list to explain the silence. `startedId` is the other one,
   * and it is why this is not a boolean — a job that fails leaves the running
   * set, so without it the button would simply reappear as though nothing had
   * happened. Scoped to the job **this session started**, so an old failure
   * from another day is not dug up and presented as news.
   */
  const [postFailed, setPostFailed] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const stopped = useMemo(() => {
    const mine = startedId ? queue.jobs.find((j) => j.id === startedId) : undefined;
    if (!mine) return null;
    if (mine.status === "error") return mine.error ?? "The job failed.";
    if (mine.status === "cancelled") return "Stopped.";
    return null;
  }, [queue.jobs, startedId]);

  const run = useCallback(
    async (force: boolean, useProfile = true) => {
      setStartedId(null);
      const started = await queue.run({
        slug,
        steps: ["glossary"],
        ...(force ? { force: ["glossary" as const] } : {}),
        /* Sent only when it is `false`, so the ordinary request is the same
           bytes it has always been and absent goes on meaning yes. The server
           reads it the same way — src/routes.ts § parseJobRequest. */
        ...(useProfile ? {} : { useProfile: false }),
      });
      setPostFailed(started === null);
      if (started) setStartedId(started.id);
    },
    [queue, slug],
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
      const res = await fetch(`/api/glossary/${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (!res.ok) throw await failure(res);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setGlossary(null);
    setStale(false);
    setOutdated(false);
    setStatus("none");
    await run(false);
  }, [slug, run]);

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
        const res = await fetch(
          `/api/glossary/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/lookup`,
          { method: "POST" },
        );
        const { entry } = await readJson<{ entry: GlossaryEntry }>(res);
        setGlossary((current) =>
          current
            ? { ...current, entries: current.entries.map((e) => (e.id === entry.id ? entry : e)) }
            : current,
        );
      } catch (err) {
        setLookFailed((err as Error).message);
      } finally {
        setLooking(null);
      }
    },
    [slug, looking],
  );

  /* `queue.error` is read here at render and not inside `run`, where it would
     be the value from the render that created the closure — the hook sets it
     during the same `await`, so reading it there gives you the *previous*
     error, or null, which is how a failed request ends up reported as nothing
     at all. Learned on the thread page; the same trap is here. */
  const failed = postFailed ? (queue.error ?? "Couldn't start the job.") : stopped;

  return {
    status,
    glossary,
    stale,
    outdated,
    profiled,
    profileChanged,
    error,
    job,
    failed,
    find,
    more,
    reset,
    cancel: (id) => void queue.cancel(id),
    look,
    looking,
    lookFailed,
  };
}
