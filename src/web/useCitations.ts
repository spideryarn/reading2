/**
 * The works the piece cites, as the reading view sees them: the list, whether
 * it still describes the article, and the things you can ask for.
 *
 * `useTimeline`'s shape exactly, because the artefact's contract is the
 * timeline's: one model pass over the article, stored once, **replaced** on a
 * re-run (src/citations.ts inherits ids across it), and two staleness facts —
 * no profile is in this stage's stamp, so there is no `profileChanged`.
 *
 * The read half is `GET /api/citations/:slug`; the write half is a **job**
 * (docs/project/ingest-queue.md). The ordering of reads is
 * src/web/useOrderedRead.ts's, the job is src/web/useStepJob.ts's, and pressing
 * the mode with nothing there starts it through src/web/useAutoRun.ts — so this
 * file is only the parse, the 404 branch and the verbs.
 *
 * The third verb is **`find`**, stage 3's *Find it on the web*: one POST for one
 * searched row, `POST /api/citations/:slug/:id/find` (src/citation-find.ts).
 * Not a job — a reader-triggered call answering in seconds, like the glossary's
 * *Check the web* — and **one at a time**, so a second press cannot start a
 * second paid search while the first is out.
 *
 * Mounted by `CitationsBand` alone, never hoisted: nothing outside the band
 * reads the list (no marks in the prose in v1), and `useAutoRun`'s owner has to
 * die with the band so a press cannot be spent after the reader has left it —
 * src/web/useQuotes.ts § QuotesRead has the long version.
 *
 * docs/project/citations.md, docs/plans/260911g-citations-mode.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Citations, CitationsResponse, FindCitationResponse, Job } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";

type CitationsStatus = "loading" | "none" | "ready" | "error";

/**
 * What the last *Find it* said, on the row it was pressed on, when it did not
 * end in a found page. `no-match` is a result, drawn quietly; `failed` is the
 * server's failure sentence (src/messages.ts), drawn as an error.
 */
export interface FindNote {
  id: string;
  kind: "no-match" | "failed";
  message: string;
}

export interface UseCitations {
  status: CitationsStatus;
  citations: Citations | null;
  /** The article moved under this list — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and the current prompt would write this differently. */
  outdated: boolean;
  slug: string;
  error: string | null;
  /** The job finding this article's citations, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /** `StepJob.stalled`: this tab can see the job and cannot move it. */
  stalled: boolean;
  /** `StepJob.starting`: the POST has gone and the queue has not seen it yet. */
  starting: boolean;
  /** The run in flight was started automatically. `UseIdeas.automatic`. */
  automatic: boolean;
  /**
   * **Find them if nobody has** — unforced, for the automatic run and for the
   * button beside the empty state. They have to be the same request or their
   * `work_key`s differ and the reader pays twice: useIdeas.ts § `ensure`.
   */
  ensure(): Promise<void>;
  /**
   * The forced run — the stale and outdated banners' button. It replaces the
   * list, keeping each work's id where its dedupe key still matches.
   * `citations` is in FORCE_ONLY_WHEN_NAMED (src/pipeline.ts), so forcing it
   * does not sweep in the steps before it.
   */
  regenerate(): Promise<void>;
  cancel(id: string): void;
  /** The work whose *Find it* is running, or null. One at a time. */
  finding: string | null;
  /** What the last *Find it* that found nothing, or failed, said — and on which row. */
  findNote: FindNote | null;
  /**
   * **Look for one searched work's own page on the web.** A found page is
   * patched onto that row — its link fields only — and is stored on the
   * server, so a reload shows it too. src/citation-find.ts.
   */
  find(id: string): Promise<void>;
}

export function useCitations(slug: string): UseCitations {
  const [status, setStatus] = useState<CitationsStatus>("loading");
  const [citations, setCitations] = useState<Citations | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState<string | null>(null);
  const [findNote, setFindNote] = useState<FindNote | null>(null);
  /* Admission for `find`, as a ref so two presses in one render cannot both
     get past it. State would let both see `null`. */
  const findLive = useRef(false);
  /* The slug a reply belongs to. A find that returns after the reader has moved
     to another article must not patch that article's list. */
  const slugNow = useRef(slug);
  slugNow.current = slug;

  /**
   * The read itself. `current()` after every `await`, before any state is set:
   * false means this reply is about an article the hook has since moved on
   * from. src/web/useOrderedRead.ts.
   */
  const load = useCallback(
    async (current: () => boolean) => {
      try {
        const res = await apiFetch(`/api/citations/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          /* The ordinary case, not a fault: nobody has asked for this
             article's citations yet, and the panel's button is for that. */
          setCitations(null);
          setStale(false);
          setOutdated(false);
          setError(null);
          setStatus("none");
          return;
        }
        const loaded = await readJson<CitationsResponse>(res);
        if (!current()) return;
        setCitations(loaded.citations);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError((err as Error).message);
        /* **A failed revalidation must not take the list away** — `load` runs
           again every time a job finishes, and only the opening read has
           nothing to fall back on. Same guard as useTimeline.ts. */
        setStatus((was) => (was === "loading" ? "error" : was));
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

  /* `refresh`, not `reload`: a finished job has just written a new list, and a
     request already in flight read the old one. */
  const queue = useStepJob(slug, "citations", refresh, "watches-queue");

  /* Two verbs, split on `force`. useIdeas.ts has why. */
  const ensure = useCallback(async () => {
    await queue.start({});
  }, [queue]);
  const regenerate = useCallback(async () => {
    await queue.start({ force: true });
  }, [queue]);

  const find = useCallback(
    async (id: string) => {
      if (findLive.current) return;
      findLive.current = true;
      const asked = slug;
      setFinding(id);
      setFindNote(null);
      try {
        const res = await apiFetch(
          `/api/citations/${encodeURIComponent(asked)}/${encodeURIComponent(id)}/find`,
          { method: "POST" },
        );
        /* The 404, the 409 and every failed call are JSON errors, and
           `readJson` throws their sentence. */
        const answer = await readJson<FindCitationResponse>(res);
        if (slugNow.current !== asked) return;
        if (answer.outcome === "no-match") {
          setFindNote({ id, kind: "no-match", message: answer.message });
          return;
        }
        /* **The link fields only**, never the whole work that came back: it
           is a snapshot taken before a model call, and a list replaced in the
           meantime must not have a stale row merged back into it —
           useGlossary.ts § patchEntry is the same lesson.
           **And only a row that is still a search** — the server's rule
           (`attachFinds`). A re-run landing inside the find can give the same
           id a link the article gave, and that always wins (GPT Sol F14;
           tests/citations-find-late-reply.test.tsx). */
        const { url, linkFrom, found } = answer.work;
        setCitations((current) =>
          current
            ? {
                ...current,
                citations: current.citations.map((w) =>
                  w.id === id && w.linkFrom === "search"
                    ? { ...w, url, linkFrom, ...(found ? { found } : {}) }
                    : w,
                ),
              }
            : current,
        );
      } catch (err) {
        if (slugNow.current !== asked) return;
        setFindNote({ id, kind: "failed", message: (err as Error).message });
      } finally {
        findLive.current = false;
        setFinding(null);
      }
    },
    [slug],
  );

  /* `reload` is the way out of a failed read — useAutoRun.ts § A failed read
     is not an answer. */
  const auto = useAutoRun(slug, "citations", status, ensure, reload);

  return {
    status,
    citations,
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
    finding,
    findNote,
    find,
  };
}
