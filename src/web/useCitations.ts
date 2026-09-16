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
 * ## Two hooks since 2026-09-16, not one
 *
 * This said *"Mounted by `CitationsBand` alone, never hoisted: nothing outside
 * the band reads the list (no marks in the prose in v1)"*. That parenthesis is
 * what changed: the citations are now marked in the prose in every mode
 * (SPIDERYARN-READING2-3M), so a reader who never opens the band needs the
 * list. `CitationsRead` below carries the whole argument — what moved up, what
 * deliberately did not, and why the one write that crosses the seam is
 * `applyFound` rather than a refetch.
 *
 * The half that did *not* move is the half the old sentence was really about:
 * `useAutoRun`'s owner still dies with the band, so a press cannot be spent
 * after the reader has left it. src/web/useQuotes.ts § QuotesRead is the same
 * split, one feature earlier, with the two bugs that hoisting everything would
 * have been.
 *
 * docs/project/citations.md, docs/plans/260911g-citations-mode.md,
 * docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Citations, CitationsResponse, CitedWork, FindCitationResponse, Job } from "../types.js";
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
  /** The run in flight was started automatically. `UseTimeline.automatic`. */
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

/**
 * **The opening read, split off from the band's hook so the prose can have it
 * too** — `useQuotesRead`'s shape, for `useQuotesRead`'s reason, one feature
 * later; and that one is `useGlossaryRead`'s, one feature before it.
 *
 * The citations are marked in the prose in **every** mode since 2026-09-16
 * (docs/plans/260916b-…, SPIDERYARN-READING2-3M), so the list is needed by a
 * reader who never opens the band. What crosses that seam is the *read*, plus
 * the one narrow write below, and nothing else:
 *
 * | | mounted by | what it is |
 * |---|---|---|
 * | `useCitationsRead` | `OwnedReader`, always | one `GET /api/citations/:slug` |
 * | `useCitations` | `CitationsBand`, in citations mode | the job poll, the auto-run, the verbs, `find` |
 *
 * **Hoisting the whole hook instead would be two bugs**, and neither is
 * hypothetical — both were found on the quotes version of this move, by a GPT
 * Sol review on 2026-09-08. `useStepJob` subscribes through `useJobs`, and a
 * subscriber cannot *wake* the job engine but does hold it to its eight-second
 * idle cadence once anything has started it. And `useAutoRun`'s owner lives for
 * the *hook's* mount, so an owner mounted up here could claim a Citations
 * press, watch the reader leave the band, and spend the token when the GET
 * finally settled — against `activation.ts`'s rule that a press belongs to the
 * band on screen.
 *
 * **The GET is unconditional, and the experimental switch does not gate it.**
 * Citations mode is behind that switch, so the tempting saving is to skip this
 * request for readers who cannot see the mode. It does not work: `CitationsBand`
 * has to read the list somehow, so either it keeps a read of its own — two
 * states, two requests — or it refreshes this one and the prose marks appear
 * anyway. And it reads the contract backwards:
 * docs/project/experimental-features.md says the switch hides *controls*, not
 * that an existing `?mode=citations` URL half-works. GPT Sol, 2026-09-16.
 *
 * ## An always-mounted read is not an always-fresh read
 *
 * The opening GET happens once, and **every later revalidation belongs to the
 * band**: its mount `reload`, and its job-completion `refresh`. So a list
 * written while the band was closed — a job that finished after the reader left
 * it, another tab, a CLI run with no job row at all — does not reach the prose
 * until the band is opened again or the page is reloaded.
 *
 * **Named rather than fixed**, because the glossary and the quotes have exactly
 * this gap and both say so, and matching the established pattern beats inventing
 * a third one here. It is a **staleness** gap and not a disagreement: the panel
 * and the prose read the same `CitationsRead`, so they are stale together and
 * can never show different lists.
 */
export interface CitationsRead {
  status: CitationsStatus;
  citations: Citations | null;
  stale: boolean;
  outdated: boolean;
  error: string | null;
  /** Fetch again **only if nothing is already fetching** — the band's mount. */
  reload(): Promise<void>;
  /** Fetch again **because the list on the server has just changed** — a job finished. */
  refresh(): Promise<void>;
  /**
   * **The one write that crosses this seam**, and it exists because `find`
   * cannot.
   *
   * *Find it on the web* POSTs, so it stays in the band with the poller and the
   * auto-run. But its answer patches the list, and the list now lives up here.
   * The alternative GPT Sol offered — `refresh()` after every successful find —
   * was refused for two reasons: it is a whole extra `GET` after a call the
   * reader is already waiting on, and the F14 condition below would then live
   * nowhere at all.
   *
   * **The link fields only**, never the whole work that came back: it is a
   * snapshot taken before a model call, and a list replaced in the meantime must
   * not have a stale row merged back into it — useGlossary.ts § `patchEntry` is
   * the same lesson. **And only a row that is still a search**, which is the
   * server's own rule (`attachFinds`): a re-run landing inside the find can give
   * the same id a link the article gave, and that always wins. GPT Sol F14;
   * tests/citations-find-late-reply.test.tsx.
   *
   * A read already in flight is the opposite ordering hazard: it may have read
   * the old Scholar row before the POST stored this link, then land afterwards
   * and erase the patch. `applyFound` arms one trailing repair only in that
   * case, through `useOrderedRead.armRefresh`; it does not add an unconditional
   * post-find GET.
   */
  applyFound(id: string, link: Pick<CitedWork, "url" | "linkFrom" | "found">): void;
}

export function useCitationsRead(slug: string): CitationsRead {
  const [status, setStatus] = useState<CitationsStatus>("loading");
  const [citations, setCitations] = useState<Citations | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const { reload, refresh, armRefresh } = useOrderedRead(load);

  /* The opening read. Everything after it goes through `reload`, which does not
     return `status` to `loading` — including `CitationsBand`'s own mount
     effect, which joins this request rather than making a second. */
  useEffect(() => {
    void reload();
  }, [reload]);

  const applyFound = useCallback(
    (id: string, link: Pick<CitedWork, "url" | "linkFrom" | "found">) => {
      /* The POST has already stored this link, but a GET that began before it
         may still be carrying the old searched row. Let that request land — it
         may also carry newly regenerated works — then repair its stale snapshot
         with one trailing read. This is `useGlossaryRead.patchEntry`'s race,
         and `armRefresh` costs nothing when no read is in flight. */
      armRefresh();
      setCitations((current) =>
        current
          ? {
              ...current,
              citations: current.citations.map((w) =>
                w.id === id && w.linkFrom === "search"
                  ? { ...w, url: link.url, linkFrom: link.linkFrom, ...(link.found ? { found: link.found } : {}) }
                  : w,
              ),
            }
          : current,
      );
    },
    [armRefresh],
  );

  return { status, citations, stale, outdated, error, reload, refresh, applyFound };
}

/**
 * The band's half: the jobs, the verbs, and *Find it on the web*.
 *
 * `read` comes from `useCitationsRead` in `OwnedReader` — see its docstring for
 * why the fetch moved up there, and what this hook still has to do on mount.
 */
export function useCitations(slug: string, read: CitationsRead): UseCitations {
  const { status, citations, stale, outdated, error, reload, refresh, applyFound } = read;
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
   * Revalidate on mount, behind whatever is on screen.
   *
   * **Not a refetch for its own sake.** `useStepJob` treats its first poll as a
   * baseline and does not announce a job that had already finished, so a list
   * written **in another tab while this band was closed** has nothing else to
   * bring it in. `reload` joins a request already in flight, so opening the band
   * while `OwnedReader`'s opening GET is outstanding costs nothing, and it never
   * returns `status` to `loading`. `useQuotes` and `useGlossary` do the same
   * three lines the same way, for the same reason.
   */
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
        /* The patch itself is `CitationsRead.applyFound`, up in the read half,
           because that is where the list lives since 2026-09-16 — and its
           docstring carries the two rules that used to be written here: the
           link fields only, and only a row that is still a search. The POST
           stays down here, which is the whole point of the split. */
        const { url, linkFrom, found } = answer.work;
        applyFound(id, { url, linkFrom, ...(found ? { found } : {}) });
      } catch (err) {
        if (slugNow.current !== asked) return;
        setFindNote({ id, kind: "failed", message: (err as Error).message });
      } finally {
        findLive.current = false;
        setFinding(null);
      }
    },
    [slug, applyFound],
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
