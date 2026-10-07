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
 * file is only the parse, the "none yet" branch and the verbs.
 *
 * The third verb is **`investigate`** (plan 260930a): one streamed, billed
 * press about one work, `POST /api/citations/:slug/:id/investigate`, SSE — the
 * glossary's *Check the web* shape. **Since plan 260930d it is also *Look it
 * up***, which had its own verb (`find`, `POST …/find`) until then: the press
 * looks the work up first when the row has no current reading, and that
 * step's answer arrives as a `lookup` frame, applied exactly as `/find`'s
 * answer was (`applyFound`, then a re-read). Its `done` crosses to the read
 * half by `applyInvestigation`, the second narrow write beside `applyFound`.
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
import type {
  CitationInvestigation,
  Citations,
  CitationsResponse,
  CitationWebInfluence,
  CitedWork,
  FindCitationResponse,
  InvestigatedPaper,
  InvestigateStage,
  Job,
  PaperPassage,
} from "../types.js";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepFinished, useStepJob } from "./useStepJob.js";
import { useAutoRun } from "./useAutoRun.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply, ReaderFacingError } from "./lib/reader-facing.js";
import { readAnswerStream } from "./lib/sse.js";

type CitationsStatus = "loading" | "none" | "ready" | "error";

/**
 * What the last press's lookup said, on the row it was pressed on, when it
 * found no page: a result, drawn quietly, above the reading that goes on
 * unconfirmed. A lookup that *failed* stops the press, so it is the press's
 * failure (`InvestigateFailure`), not a note.
 */
export interface FindNote {
  id: string;
  kind: "no-match";
  message: string;
}

/** The part of an *Investigate* answer that has arrived — never on the row. */
export interface InvestigateDraft {
  id: string;
  text: string;
}

/**
 * Why the last *Investigate* stopped, on the row it was pressed on, and what
 * was stored there when it was pressed — so the panel can tell "the previous
 * one is still shown" from "the new one was kept after all"
 * (src/web/CitationInvestigation.tsx § investigationViewOf).
 */
export interface InvestigateFailure {
  id: string;
  message: string;
  previousAt: string | null;
  /** The lookup attached when this press began, to recognise one attached by the failure re-read. */
  previousLookupAt: string | null;
  /**
   * The press's first step found and stored a page before the failure (plan
   * 260930d P-4): the row shows the new lookup, and says the quick check was
   * kept.
   */
  lookupKept: boolean;
}

/**
 * ***Dig deeper*'s state and its one verb** — on the read since 2026-10-04, so
 * the prose's hover card can start one in any mode and say when one is running
 * (report `spya-c2qmbg`, plan 261004b). `useGlossaryRead` carries `look` for
 * the same reason (plan 261002c). The band's hook passes all six through.
 */
export interface CitationDig {
  /** What the last press's lookup said when it found no page — and on which row. */
  findNote: FindNote | null;
  /** The work whose *Investigate* is running, or null. One at a time. */
  investigating: string | null;
  /** Which step that press is on: `finding` the work, then `reading`. Null before the first frame. */
  investigateStage: InvestigateStage | null;
  /** The words so far. **Never on the row**: only `done`, sent after the save, puts one there. */
  investigateDraft: InvestigateDraft | null;
  /** The last *Investigate* that did not end in a stored answer. */
  investigateFailed: InvestigateFailure | null;
  /**
   * ***Investigate*** — plan 260930a, and *Look it up* as its first step since
   * plan 260930d. The lookup's answer is patched onto the row as `/find`'s was
   * (its link fields, only on a searched row, then a re-read attaches the
   * lookup); the streamed answer is kept per row by the server and attached at
   * read time while its context still matches. src/citation-investigate.ts.
   */
  investigate(id: string): Promise<void>;
}

export interface UseCitations extends CitationDig {
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
   * The forced run — the stale banner's button and Metadata's row. It replaces
   * the list, keeping each work's id where its dedupe key still matches.
   * `citations` is in FORCE_ONLY_WHEN_NAMED (src/pipeline.ts), so forcing it
   * does not sweep in the steps before it.
   */
  regenerate(): Promise<void>;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  cancel(id: string): void;
}

/**
 * **The opening read, split off from the band's hook so the prose can have it
 * too** — `useQuotesRead`'s shape, for `useQuotesRead`'s reason, one feature
 * later; and that one is `useGlossaryRead`'s, one feature before it.
 *
 * The citations are marked in the prose in **every** mode since 2026-09-16
 * (docs/plans/260916b-…, SPIDERYARN-READING2-3M), so the list is needed by a
 * reader who never opens the band. What crosses that seam is the *read*, plus
 * the two narrow writes below (`applyFound`, and `applyInvestigation` since
 * plan 260930a), and nothing else:
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
 * The opening GET happens once, and until 2026-10-02 **every later
 * revalidation belonged to the band**: its mount `reload`, and its
 * job-completion `refresh`. So a run that finished after the reader had left
 * the band reached neither the prose nor Marginalia until the band was opened
 * again or the page reloaded. It was named rather than fixed, to match the
 * glossary and the quotes, which had the same gap.
 *
 * **Now the read hears its own step finish**, through `useStepFinished`
 * (useStepJob.ts) — quiet, so it buys no polling and starts nothing. All three
 * reads got the same line on the same day (plan 261002d's follow-up,
 * tests/always-mounted-reads-refresh.test.tsx). Only announced completions are
 * heard: the engine's first list is a baseline (`useStepFinished`'s docstring).
 * What it still cannot hear is
 * a run in **another tab** while this tab's engine is idle, or a CLI run with
 * no job row; those wait for the band's mount `reload` or a page reload. With
 * the band open, both listeners refresh. If no read is outstanding, the first
 * starts a GET and the second arms one trailing GET. If a read is already out,
 * both coalesce into its one trailing read: no extra GET. A glossary lookup
 * landing during a read can arm another repair read (`patchEntry`).
 *
 * It is a **staleness** gap and not a disagreement: the panel and the prose
 * read the same `CitationsRead`, so they are stale together and can never show
 * different lists.
 */
export interface CitationsRead extends CitationDig {
  status: CitationsStatus;
  citations: Citations | null;
  stale: boolean;
  outdated: boolean;
  error: string | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /** Fetch again **only if nothing is already fetching** — the band's mount. */
  reload(): Promise<void>;
  /** Fetch again **because the list on the server has just changed** — a job finished. */
  refresh(): Promise<void>;
  /**
   * **The one write that crosses this seam**, and it exists because `find`
   * cannot.
   *
   * *Find it on the web* POSTed (`POST …/find`, a route deleted on 2026-10-04;
   * since plan 260930d the same answer arrives as Investigate's `lookup`
   * frame), so it stayed in the band with the poller and the auto-run. But
   * its answer patches the list, and the list now lives up here.
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
   * and erase the patch. The caller follows every successful POST with
   * `refresh()`, which trails such a read.
   *
   * ## And the lookup, on its own rule (plan 260929g stage 2)
   *
   * *Look it up* answers with the link half and the `lookup` separately (R-3).
   * Only the link is safe to patch from that reply. The server fingerprints the
   * actual reference and citing-passage text, which `CitedWork` does not carry,
   * so no client comparison can decide whether the lookup is still current.
   * The caller therefore refreshes and lets `attachLookups` be the one authority
   * for attaching it. A found frame first removes the old lookup and
   * investigation, because the server has replaced the find they came from;
   * only that read may put either back. tests/citations-find-late-reply.test.tsx.
   */
  applyFound(id: string, found: FoundPatch): void;
  /** Hide lookup-derived fields while a replacement lookup is in flight. */
  detachDerived(id: string): void;
  /**
   * **The second narrow write**, for *Investigate*'s `done` (plan 260930a):
   * the stored investigation onto the row with that id, and nothing else of
   * it. The caller follows it with `refresh()`, so the server's attach-at-read
   * rule (the context hash) stays the authority, exactly as for *Look it up*;
   * the patch only saves the reader a blank moment between the last word and
   * the read coming back.
   */
  applyInvestigation(id: string, investigation: CitationInvestigation): void;
}

/** What one *Look it up* answer patches, split as the server split it. */
export interface FoundPatch {
  link: Pick<CitedWork, "url" | "linkFrom" | "found">;
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
        /* The header asks for "no list yet" as `200 null` rather than a 404,
           which a browser prints in red on every ordinary page load
           (`NONE_YET_AS_NULL_HEADER`, src/types.ts). A 404 is still read the
           same way, for a server that has not heard of the header — the
           minutes of a deploy. */
        const res = await apiFetch(`/api/citations/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        const loaded = res.status === 404 ? null : await readJson<CitationsResponse | null>(res);
        if (!current()) return;
        if (loaded === null) {
          /* The ordinary case, not a fault: nobody has asked for this
             article's citations yet, and the panel's button is for that. */
          setCitations(null);
          setStale(false);
          setOutdated(false);
          setError(null);
          setStatus("none");
          return;
        }
        /* Only an explicit null means none yet. Validate before publishing so
           a broken revalidation leaves the list already on screen intact. */
        if (!loaded?.citations || !Array.isArray(loaded.citations.citations)) {
          /* A `MalformedReply`, so the reader gets `PAGE_FAULT`, as for every
             other malformed artefact (tests/read-error-matrix.test.tsx). */
          throw new MalformedReply("the citations reply has no list");
        }
        setCitations(loaded.citations);
        setStale(loaded.stale);
        setOutdated(loaded.outdated);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (!current()) return;
        setError(describeFetchFailure(err as Error));
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
  /* A run that finishes after the reader left the band still reaches the prose
     and the margin — § An always-mounted read is not an always-fresh read. */
  useStepFinished(slug, "citations", refresh);

  /* The way out of a failed read, and never a generation verb — useFaq.ts §
     `retryRead`. Works already on screen stay there while a failed
     revalidation is tried again; only the opening error returns to loading. */
  const retryRead = useCallback(async () => {
    setError(null);
    if (citations === null) setStatus("loading");
    await reload();
  }, [citations, reload]);

  /* The opening read. Everything after it goes through `reload`, which does not
     return `status` to `loading` — including `CitationsBand`'s own mount
     effect, which joins this request rather than making a second. */
  useEffect(() => {
    void reload();
  }, [reload]);

  const applyFound = useCallback(
    (id: string, found: FoundPatch) => {
      setCitations((current) =>
        current
          ? {
              ...current,
              citations: current.citations.map((w) => (w.id === id ? patchFound(w, found) : w)),
            }
          : current,
      );
    },
    [],
  );

  const detachDerived = useCallback((id: string) => {
    setCitations((current) =>
      current
        ? {
            ...current,
            citations: current.citations.map((w) => {
              if (w.id !== id) return w;
              const { lookup: _lookup, investigation: _investigation, ...unattached } = w;
              return unattached;
            }),
          }
        : current,
    );
  }, []);

  const applyInvestigation = useCallback((id: string, investigation: CitationInvestigation) => {
    setCitations((current) =>
      current
        ? {
            ...current,
            citations: current.citations.map((w) => (w.id === id ? { ...w, investigation } : w)),
          }
        : current,
    );
  }, []);

  const [findNote, setFindNote] = useState<FindNote | null>(null);

  /**
   * ***Investigate*** one work — plan 260930a, and the glossary's *Check the
   * web* (useGlossary.ts § `look`) nearly line for line, because the server
   * half is `streamTermLookup`'s shape and the promises are the same:
   *
   * - **`done` means stored.** Only the `done` frame, sent after the save,
   *   puts an investigation on the row; the words before it are a draft.
   * - **An `error` does not prove nothing was kept**: a save can succeed and
   *   the frame after it be lost. So a failure after the stream opened reads
   *   the list again, while this run still holds admission, and the panel
   *   draws a stored answer newer than the one at the press instead of the
   *   failure (CitationInvestigation.tsx § investigationViewOf).
   * - **Leaving the article stops the reading, not the investigation.** The
   *   server does not pass the socket's close to the model call, so it
   *   finishes and stores anyway. Another article only aborts this fetch.
   *   **Leaving the band stops nothing**, since 2026-10-04: this state lives on
   *   the read, which outlives the band, so the row has the draft or the
   *   answer when the reader comes back (plan 261004b).
   * - **One at a time**, across the list: each is a paid call, and the
   *   server's allowance runs one per reader at once anyway.
   * - **The `lookup` frame is applied as `/find`'s answer was** (plan 260930d
   *   P-3): a no-match is a quiet note on the row; a found page patches only
   *   the link fields (`applyFound`, and only on a searched row), and a re-read
   *   lets the server attach the lookup by its fingerprint, which the client
   *   cannot check because the row carries block ids, not their text.
   *   tests/citations-find-late-reply.test.tsx.
   * - **A lookup that landed survives a failed reading** (P-4): the failure
   *   records it, and the row says the quick check was kept.
   */
  const investigateLive = useRef<AbortController | null>(null);
  const [investigating, setInvestigating] = useState<string | null>(null);
  const [investigateStage, setInvestigateStage] = useState<InvestigateStage | null>(null);
  const [investigateDraft, setInvestigateDraft] = useState<InvestigateDraft | null>(null);
  const [investigateFailed, setInvestigateFailed] = useState<InvestigateFailure | null>(null);
  /* A regeneration keeps work ids, but those ids must not carry a completed
     press's local failure or no-match into the replacement list. Ordinary
     revalidation keeps the generation and therefore keeps these results.
     Let a live press finish before clearing its notes; never stop its stream. */
  const resultGeneration = useRef(citations?.generatedAt);
  const generation = citations?.generatedAt;
  useEffect(() => {
    if (investigating || resultGeneration.current === generation) return;
    resultGeneration.current = generation;
    setInvestigateFailed(null);
    setFindNote(null);
  }, [generation, investigating]);
  /* What is stored on each row at the moment of a press, read without making
     `investigate` change identity every time the list does. */
  const citationsNow = useRef(citations);
  citationsNow.current = citations;

  const investigate = useCallback(
    async (id: string) => {
      if (investigateLive.current) return;
      const controller = new AbortController();
      investigateLive.current = controller;
      const mine = () => investigateLive.current === controller;
      const previousWork = citationsNow.current?.citations.find((w) => w.id === id);
      const previousAt = previousWork?.investigation?.at ?? null;
      const previousLookupAt = previousWork?.lookup?.at ?? null;
      setInvestigating(id);
      setInvestigateStage(null);
      setInvestigateFailed(null);
      setInvestigateDraft(null);
      setFindNote(null);
      let opened = false;
      let lookupKept = false;

      const receiveStage = (data: unknown) => {
        const stage = (data as { stage?: unknown } | null)?.stage;
        if (stage !== "searching" && stage !== "finding" && stage !== "reading-paper" && stage !== "reading") return;
        setInvestigateStage(stage);
        /* This step may replace the row's lookup. Hide its verdict and
           anything derived from it until a server re-read proves what still
           attaches — even if the lookup frame itself is lost. */
        if (stage === "finding") detachDerived(id);
      };

      const receiveLookup = (data: unknown) => {
        const answer = data as FindCitationResponse | null;
        if (answer?.outcome === "no-match") {
          if (typeof answer.message === "string") setFindNote({ id, kind: "no-match", message: answer.message });
          return;
        }
        if (answer?.outcome !== "found" || !answer.work) return;
        /* Stored by the server before this frame was sent. Patch only the
           link fields, then re-read: `applyFound` above has why. */
        lookupKept = true;
        const { url, linkFrom, found } = answer.work;
        applyFound(id, { link: { url, linkFrom, ...(found ? { found } : {}) } });
        void refresh();
      };

      try {
        const res = await apiFetch(
          `/api/citations/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/investigate`,
          { method: "POST", signal: controller.signal },
        );
        if (!res.ok || !res.body) {
          /* The 404 and the allowance's 429/503 are decided before the
             stream opens, so they are JSON and `readJson` throws their
             sentence. Nothing was stored. */
          await readJson(res);
          throw new ReaderFacingError(`The server replied ${res.status}.`);
        }
        opened = true;
        const investigation = await readAnswerStream(res.body, {
          delta: (text) => {
            if (mine()) setInvestigateDraft({ id, text });
          },
          done: (data) => {
            const got = (data as { investigation?: unknown } | null)?.investigation;
            return isInvestigation(got) ? got : undefined;
          },
          other: (name, data) => {
            if (!mine()) return;
            if (name === "stage") receiveStage(data);
            if (name === "lookup") receiveLookup(data);
          },
        });
        if (mine()) {
          setInvestigateDraft(null);
          applyInvestigation(id, investigation);
          void refresh();
        }
      } catch (err) {
        if (controller.signal.aborted || !mine()) return;
        /* **The whole draft goes**, not just its tail: a cut-off answer left
           on screen under an error reads as the answer (plan 260930a § No
           quotes from sources — a stop replaces the whole streamed text). */
        setInvestigateDraft(null);
        setInvestigateFailed({
          id,
          message: describeFetchFailure(err as Error),
          previousAt,
          previousLookupAt,
          lookupKept,
        });
        if (opened) await refresh();
      } finally {
        if (mine()) {
          investigateLive.current = null;
          setInvestigating(null);
          setInvestigateStage(null);
        }
      }
    },
    [slug, applyFound, detachDerived, applyInvestigation, refresh],
  );

  /* Another article stops reading — useGlossary.ts's
     cleanup for `look`, for the same reason: the old stream's `done` must not
     land on the next article's list, whose ids are the same shape. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slug` is the trigger — the cleanup must run when it changes
  useEffect(
    () => () => {
      investigateLive.current?.abort();
      investigateLive.current = null;
      setInvestigating(null);
      setInvestigateStage(null);
      setInvestigateDraft(null);
      setInvestigateFailed(null);
      setFindNote(null);
    },
    [slug],
  );

  return {
    status,
    citations,
    stale,
    outdated,
    error,
    retryRead,
    reload,
    refresh,
    applyFound,
    detachDerived,
    applyInvestigation,
    findNote,
    investigating,
    investigateStage,
    investigateDraft,
    investigateFailed,
    investigate,
  };
}

/** Safe link fields now; derived attachments only after the fresh server read. */
function patchFound(w: CitedWork, { link }: FoundPatch): CitedWork {
  const { lookup: _lookup, investigation: _investigation, ...unattached } = w;
  /* A link the article gave always wins; only our own rows move. */
  const relink = (w.linkFrom === "search" || w.linkFrom === "web") && link.linkFrom === "web";
  if (!relink) return unattached;
  return { ...unattached, url: link.url, linkFrom: link.linkFrom, ...(link.found ? { found: link.found } : {}) };
}

/**
 * The band's half: the jobs, the verbs, and *Find it on the web*.
 *
 * `read` comes from `useCitationsRead` in `OwnedReader` — see its docstring for
 * why the fetch moved up there, and what this hook still has to do on mount.
 */
export function useCitations(slug: string, read: CitationsRead): UseCitations {
  const {
    status,
    citations,
    stale,
    outdated,
    error,
    reload,
    refresh,
    findNote,
    investigating,
    investigateStage,
    investigateDraft,
    investigateFailed,
    investigate,
  } = read;
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
    retryRead: read.retryRead,
    ensure,
    regenerate,
    cancel: queue.cancel,
    findNote,
    investigating,
    investigateStage,
    investigateDraft,
    investigateFailed,
    investigate,
  };
}

/**
 * A `done` frame's investigation, checked field by field — the one object that
 * becomes a kept answer on screen, so a malformed one is a failure, not an
 * answer with holes in it (useGlossary.ts § isGlossaryLookup).
 */
function isInvestigation(data: unknown): data is CitationInvestigation {
  const i = data as Partial<CitationInvestigation> | null | undefined;
  return (
    !!i &&
    typeof i.answer === "string" &&
    i.answer.trim() !== "" &&
    Array.isArray(i.sources) &&
    i.sources.every((s) => !!s && typeof (s as { url?: unknown }).url === "string") &&
    typeof i.extractsRead === "number" &&
    typeof i.longestExtractWords === "number" &&
    (i.matchedHost === null || typeof i.matchedHost === "string") &&
    typeof i.at === "string" &&
    /* Absent on an answer from before plan 261001a stage 3; when present, whole. */
    (i.paper === undefined || isInvestigatedPaper(i.paper)) &&
    /* Absent when the press kept no influence (plan 261003m stage 2); when present, whole. */
    (i.influence === undefined || isWebInfluence(i.influence))
  );
}

/**
 * **A web influence, whole or not at all** — a number within 0–1, the page's
 * words, an http(s) address and a version. It feeds the bar, the threshold and
 * the order, so a malformed one fails the frame rather than drawing a bar from
 * a string or a link to anything but a web page.
 */
function isWebInfluence(data: unknown): data is CitationWebInfluence {
  const w = data as Record<string, unknown> | null | undefined;
  return (
    !!w &&
    typeof w === "object" &&
    typeof w.value === "number" &&
    Number.isFinite(w.value) &&
    w.value >= 0 &&
    w.value <= 1 &&
    isText(w.quote) &&
    isText(w.sourceUrl) &&
    /^https?:\/\//i.test(w.sourceUrl) &&
    (w.sourceTitle === undefined || typeof w.sourceTitle === "string") &&
    isText(w.version)
  );
}

const PAPER_BEARS = new Set<unknown>(["supports", "partly", "context"]);
const PAPER_MATCHED_BY = new Set<unknown>(["doi", "arxiv", "title-author"]);
const PAPER_UNREADABLE_WHY = new Set<unknown>([
  "invalid-url",
  "blocked",
  "refused",
  "not-found",
  "site-error",
  "network",
  "timeout",
  "too-large",
  "not-a-document",
  "paywall-or-empty",
  "scan",
  "damaged",
]);

const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function isPaperPassage(data: unknown): data is PaperPassage {
  const p = data as Partial<PaperPassage> | null | undefined;
  return !!p && isText(p.chunk) && isCount(p.page) && isText(p.text) && PAPER_BEARS.has(p.bears);
}

/**
 * **The paper, checked by state** (plan 261001a stage 3) — each state with
 * exactly the fields it is drawn from, so a row never says *we read the paper*
 * over a missing word count, or *found no passage* over a malformed list.
 */
export function isInvestigatedPaper(data: unknown): data is InvestigatedPaper {
  const p = data as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || !isText(p.readAt)) return false;
  switch (p.state) {
    case "read":
      return (
        isText(p.requestedUrl) &&
        isText(p.finalUrl) &&
        isText(p.host) &&
        isCount(p.words) &&
        isCount(p.sentWords) &&
        Array.isArray(p.chunks) &&
        p.chunks.every(isText) &&
        PAPER_MATCHED_BY.has(p.matchedBy) &&
        isText(p.evidenceSha) &&
        isText(p.selectionVersion) &&
        (p.passages === null ||
          (Array.isArray(p.passages) && p.passages.length <= 3 && p.passages.every(isPaperPassage)))
      );
    case "no-address":
      return true;
    case "unreadable":
      return isText(p.requestedUrl) && isText(p.host) && PAPER_UNREADABLE_WHY.has(p.unreadableWhy);
    case "not-the-full-text":
    case "not-confirmed":
      return isText(p.requestedUrl) && isText(p.finalUrl) && isText(p.host);
    case "identity-conflict":
      return isText(p.requestedUrl) && isText(p.host);
    default:
      return false;
  }
}
