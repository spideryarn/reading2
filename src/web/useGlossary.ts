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
 * **Two verbs, and the difference between them is the whole feature:**
 *
 *  - `find()` — no glossary yet, or the one there has gone stale. The step's
 *    own freshness check agrees, so an ordinary run does the work.
 *  - `more()` — there is a perfectly good glossary and the reader wants more
 *    terms. `force` is what gets past the freshness check, and forcing this
 *    step *appends* rather than replacing (src/glossary.ts).
 *
 * **There was a third, `reset()`** — a DELETE and then a `find()`, for a list
 * the reader wanted rid of, because "run it again" already means "add more" and
 * a verb cannot mean both. Its button went on 2026-09-05 and it went with it;
 * `Foot` in src/web/GlossaryPanel.tsx carries the reasoning.
 * `DELETE /api/glossary/:slug` is still there and still tested, with no caller
 * in the client — kept deliberately, so this is one edit away if the capability
 * is ever wanted back on the Metadata page.
 *
 * See docs/project/glossary.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AskedTermAnswer,
  Citation,
  Glossary,
  GlossaryEntry,
  GlossaryLookup,
  GlossaryResponse,
  Job,
} from "../types.js";
import { ASKED_TERM_REFUSED, parseAskedTerm } from "../asked-term.js";
import { ENDED_UNFINISHED, wentQuiet } from "../messages.js";
import { useAutoRun } from "./useAutoRun.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";
import { readEvents, STREAM_STALL_MS, StreamStalled } from "./lib/sse.js";
import { useHasProfile } from "./useProfile.js";

type GlossaryStatus = "loading" | "none" | "ready" | "error";

/**
 * **The part of an asked term's answer that has arrived — which is never an
 * answer.**
 *
 * Where the server found the term (its `begin` frame: the reader's `term`, the
 * `blockId`, and the article's own characters as `quote`) and the text so far.
 * It lives beside `asked` rather than inside it, so nothing can draw it as a
 * finished answer with provenance and sources: `asked` is set from a `done`
 * frame and from nowhere else. After a failure it stays, under the failure's
 * sentence — the reader has read it, and the server's sentences for a broken
 * stream say *what arrived is real*. docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
 */
export interface AskedTermDraft extends Omit<AskedTermAnswer, "lookup"> {
  text: string;
}

/**
 * **The part of an entry's web lookup that has arrived** — `AskedTermDraft`'s
 * counterpart for *Check the web*, and never on the entry. `id` says which
 * entry it belongs to, because the band draws every entry and only one may
 * show it.
 */
export interface LookDraft {
  id: string;
  text: string;
}

/** A lookup failure stays attached to the entry whose request produced it. */
export interface LookFailure {
  id: string;
  message: string;
}

/** A stored lookup, retained long enough to notice its entry disappearing. */
export interface LookKept {
  id: string;
  name: string | null;
}

/**
 * **The glossary's two streams' terminal contract, in one function** —
 * `readMark` in src/web/useQuiz.ts, for the box and for *Check the web*.
 *
 * An optional `begin`, any number of `delta`, then exactly one `done` or
 * `error`. The result is returned **only** from a `done` that `done` accepts —
 * each caller checks its own shape, because this is the one object that becomes
 * a finished answer on screen and a malformed one is a failure, not an answer
 * with holes in it. An `error` frame throws its sentence, and so does the body
 * simply ending, which is the case the whole design is arranged against — a
 * stream that stops cleanly looks exactly like one that finished. A stall
 * throws `StreamStalled` from `readEvents`, and the caller words it.
 */
async function readGlossaryStream<T>(
  body: ReadableStream<Uint8Array>,
  on: {
    begin?(data: unknown): void;
    delta(text: string): void;
    done(data: unknown): T | undefined;
  },
): Promise<T> {
  let text = "";
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "begin") {
      on.begin?.(event.data);
      continue;
    }
    if (event.name === "delta") {
      const piece = (event.data as { text?: unknown } | null)?.text;
      if (typeof piece === "string" && piece) {
        text += piece;
        on.delta(text);
      }
      continue;
    }
    if (event.name === "done") {
      const result = on.done(event.data);
      if (result === undefined) {
        throw new Error(
          "The answer arrived in a form this page could not read, so it is not shown as finished. " +
            "Trying again starts a fresh answer.",
        );
      }
      return result;
    }
    if (event.name === "error") {
      const message = (event.data as { error?: unknown } | null)?.error;
      throw new Error(typeof message === "string" && message ? message : ENDED_UNFINISHED.message);
    }
  }
  throw new Error(ENDED_UNFINISHED.message);
}

/** The box's `begin` frame, if it is one: where the server found the term. */
function asFound(data: unknown): Omit<AskedTermAnswer, "lookup"> | undefined {
  const found = data as Partial<AskedTermAnswer> | null;
  return typeof found?.term === "string" &&
    typeof found.blockId === "string" &&
    typeof found.quote === "string"
    ? { term: found.term, blockId: found.blockId, quote: found.quote }
    : undefined;
}

function isAskedTermAnswer(data: unknown): data is AskedTermAnswer {
  const a = data as Partial<AskedTermAnswer> | null;
  return (
    typeof a?.term === "string" &&
    typeof a.blockId === "string" &&
    typeof a.quote === "string" &&
    isGlossaryLookup(a.lookup)
  );
}

/** A finished lookup as the wire carries it — both streams' `done` hold one. */
function isGlossaryLookup(data: unknown): data is GlossaryLookup {
  const l = data as Partial<GlossaryLookup> | null | undefined;
  return (
    typeof l?.answer === "string" &&
    l.answer.trim() !== "" &&
    Array.isArray(l.citations) &&
    l.citations.every(isCitation) &&
    typeof l.searches === "number" &&
    typeof l.model === "string" &&
    typeof l.at === "string"
  );
}

/** One member of the wire's `citations` array, checked before render reads it. */
function isCitation(data: unknown): data is Citation {
  const citation = data as Partial<Citation> | null;
  return (
    typeof citation?.url === "string" &&
    (citation.title === undefined || typeof citation.title === "string")
  );
}

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
 * **The mechanism now lives in [`useOrderedRead`](./useOrderedRead.ts)**, shared
 * with the seven other artefact readers, which had none of it and each lost the
 * race this hook was fixed for
 * (docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md
 * § T2.1). The reasoning stays here, because this is where it was worked out and
 * the glossary is the surface that exercises every verb of it.
 *
 * `live` guards a *slug change*. It cannot order two operations on one slug: a
 * GET issued before a DELETE can land after it and put the list the reader just
 * threw away back on screen. So every fetch takes the generation it started in,
 * and a reply from an older one is dropped — `current()` in `load` below. This
 * replaces the `pushed` ref, which was the same idea aimed at a narrower case.
 *
 * **`patchEntry` deliberately does not discard the generation**, and that is
 * the half of this worth keeping. Discarding would cancel an in-flight reload,
 * and the commonest reason one is in flight is that a job has just finished —
 * so a reader who checked a term at the wrong moment would silently never see
 * the new terms. The opposite risk, a read that started before the lookup was
 * stored landing after it, is repaired by the trailing fetch (`armRefresh`)
 * instead.
 *
 * There was a `clear()` beside it that *did* discard, for the one operation
 * that made a reply news about nothing: `reset()` deleted the list, so a GET
 * issued before the DELETE must not put it back. Both went with the *Start
 * again* button on 2026-09-05 — `Foot` in src/web/GlossaryPanel.tsx. Nothing
 * removes a glossary from the client any more, so `discard` has no caller here;
 * the generation still does its `live`-guarding work on a slug change.
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
   * current one instead of joining it. Both verbs are `useOrderedRead`'s, and
   * dedupe without the trailing read is precisely the bug above rebuilt.
   */
  refresh(): Promise<void>;
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

  /**
   * The read itself. Everything about *ordering* it — the dedupe, the trailing
   * fetch, and which reply is allowed to commit — is `useOrderedRead` below.
   *
   * `current()` after every `await`: false means this reply is about a list the
   * hook has since moved on from — another article — and committing it would put
   * that one back on screen. It also covered a local `clear()` until 2026-09-05;
   * see the note on `patchEntry` below.
   */
  const load = useCallback(
    async (current: () => boolean): Promise<void> => {
      try {
        const res = await apiFetch(`/api/glossary/${encodeURIComponent(slug)}`);
        if (!current()) return;
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
        if (!current()) return;
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
        if (!current()) return;
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
      }
    },
    [slug],
  );

  const { reload, refresh, armRefresh } = useOrderedRead(load);

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
    void reload();
  }, [reload]);

  /**
   * **Does not bump the generation**, and until 2026-09-05 the asymmetry with
   * `clear` was the point. `clear` has gone; the reasoning is what survives.
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
    armRefresh();
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
  }, [armRefresh]);

  return {
    status,
    glossary,
    stale,
    outdated,
    profiled,
    profileChanged,
    error,
    reload,
    refresh,
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
   * Write the list. `useProfile` defaults to true; pass false for a plain one.
   *
   * The flag rides on the *action* rather than being panel state, because it is
   * a property of the run and the artefact records what it was run with —
   * `profileHash`, src/profile.ts. Nothing has to remember the reader's choice:
   * the next visit reads it off the file.
   */
  find(useProfile?: boolean): Promise<void>;
  more(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
  /** Check one term on the web. Resolves when the answer is in `glossary`. */
  look(id: string): Promise<void>;
  /** The term a lookup is running for, or null. One at a time, on purpose. */
  looking: string | null;
  /** Why the last lookup failed, and which entry it belongs to. */
  lookFailed: LookFailure | null;
  /**
   * The lookup as it arrives, or what arrived before it broke — `LookDraft`.
   * **Never on the entry**: only the stream's `done`, sent after the save, is.
   */
  lookDraft: LookDraft | null;
  /** The last lookup this hook saw stored, even if its entry was replaced. */
  lookKept: LookKept | null;
  /**
   * Find a term the reader typed **in the article** and explain the passage it
   * is in — the box at the top of the panel.
   *
   * A reader asked for a search box that would "look for that term and add it
   * to the glossary" (2026-09-04, `[SPIDERYARN-READING2-Y]`). This is the first
   * half; **the second is deferred and nothing is stored**, so the answer lives
   * in this hook's state and goes when the reader leaves the article. The three
   * reasons are on `AskedTermAnswer` in src/types.ts, and the one that decides
   * it is that the glossary document is published with a shared article.
   *
   * Which is why the answer is **not** merged into `glossary` by `patchEntry`:
   * there is no entry to merge it into, and inventing one client-side would put
   * a row on screen that the next reload silently removes.
   */
  ask(term: string): Promise<void>;
  /** True while the box's call is out. One at a time, like `look`. */
  asking: boolean;
  /**
   * The answer as it arrives, or what arrived before it broke. **Never a
   * finished answer** — `AskedTermDraft` says why it is its own field.
   */
  askDraft: AskedTermDraft | null;
  /**
   * The last answer the box got, or null. Never stored, never in the URL.
   * **Set only from the stream's `done` frame.**
   */
  asked: AskedTermAnswer | null;
  /** Why the last one was refused, if it was. Carries a `[gl-ask-…]` code. */
  askFailed: string | null;
  /** Put the box back to empty — the reader's dismiss. */
  clearAsked(): void;
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
  const [lookFailed, setLookFailed] = useState<LookFailure | null>(null);
  const [asking, setAsking] = useState(false);
  const [askDraft, setAskDraft] = useState<AskedTermDraft | null>(null);
  const [asked, setAsked] = useState<AskedTermAnswer | null>(null);
  const [askFailed, setAskFailed] = useState<string | null>(null);

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
  const { reload, refresh, patchEntry } = read;
  useEffect(() => {
    void reload();
  }, [reload]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the ideas and
     the summaries. It carries the reasoning that used to be copied here.
     `refresh`, not `reload`: a finished job has just written a new list, and a
     request already in flight read the old one. See `refresh` on
     `GlossaryRead` for the sequence this gets wrong the other way. This was the
     one thing the copies did *not* agree about — none of the others had a
     trailing fetch to reach for — until 2026-09-02, when all eight moved onto
     src/web/useOrderedRead.ts and all eight now pass `refresh` here. */
  const queue = useStepJob(slug, "glossary", refresh);

  const run = useCallback(
    (force: boolean, useProfile = true) => queue.start({ force, useProfile }),
    [queue],
  );

  /**
   * `find` is already the unforced verb, so it is already `ensure`.
   *
   * The glossary is the one of the five that never needed the 2026-09-02 split:
   * forcing this step **appends** rather than replaces (src/glossary.ts), so a
   * `find` that forced would silently lengthen the reader's list — which is why
   * "find more terms" has always been a second verb here and a `force` flag
   * nowhere else. The automatic run below therefore posts the identical request
   * this button does, without anything having to be changed to make it true.
   */
  const find = useCallback((useProfile = true) => run(false, useProfile), [run]);
  const more = useCallback((useProfile = true) => run(true, useProfile), [run]);

  /* `reload` rather than `refresh`: the way out of a failed read is to read
     again, and `reload` joins a request already in flight rather than making a
     second one. useAutoRun.ts § A failed read is not an answer. */
  const auto = useAutoRun(slug, "glossary", status, find, reload);

  /**
   * Check one term on the web — the panel's "check this" button.
   *
   * **A plain request rather than a job**, unlike everything else here. Finding
   * terms is one call over a whole article and belongs in the queue; checking a
   * single term is a question with a reader waiting on it, which is the shape
   * `useComments` already has. It reuses that call too — see `lookUpTerm` in
   * src/term-lookup.ts.
   *
   * **One at a time**, which is a deliberate limit and not a missing feature:
   * each of these is a model call the reader pays for, and a panel that will
   * fire five because five rows were clicked spends money on a mis-click. The
   * button is disabled while one is running.
   *
   * The answer is merged into the entry in place rather than refetching the
   * list, because a refetch would rebuild every row and lose the reader's
   * selection — and the server has just told us the one thing that changed.
   *
   * ## It streams, and `done` means stored
   *
   * Since 2026-09-10 the words arrive as they are written, into `lookDraft`,
   * and only the `done` frame — which the server sends after the save — puts a
   * lookup on the entry (docs/plans/260910g-stream-glossary-answers-as-they-arrive.md).
   * Two things differ from the box's `ask`:
   *
   * - **A failure reads the list again.** `error` does not prove nothing was
   *   kept: a save can succeed and its read-back fail, or the socket die between
   *   the save and the frame. If it was kept, the re-read puts it on the entry
   *   and `Looked` draws the stored answer instead of the failure.
   * - **Leaving stops the reading, not the lookup.** The server finishes and
   *   saves either way — the panel promises that — so another article or the
   *   band closing only disowns the stream.
   */
  const lookLive = useRef<AbortController | null>(null);
  const [lookDraft, setLookDraft] = useState<LookDraft | null>(null);
  const [lookKept, setLookKept] = useState<LookKept | null>(null);

  const look = useCallback(
    async (id: string) => {
      /* The ref is the admission record, `ask`'s rule: two presses in one tick
         both see `looking` still null. */
      if (lookLive.current) return;
      const controller = new AbortController();
      lookLive.current = controller;
      const mine = () => lookLive.current === controller;
      setLooking(id);
      setLookFailed(null);
      setLookDraft(null);
      setLookKept(null);
      let opened = false;
      try {
        const res = await apiFetch(
          `/api/glossary/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/lookup`,
          { method: "POST", signal: controller.signal },
        );
        if (!res.ok || !res.body) {
          /* The 404 and the two 409s are decided before the stream opens, so
             they are ordinary JSON and `readJson` throws their sentence. */
          await readJson(res);
          throw new Error(`The server replied ${res.status}.`);
        }
        opened = true;
        const done = await readGlossaryStream(res.body, {
          delta: (text) => {
            if (mine()) setLookDraft({ id, text });
          },
          /* `{ entry }`, and only its lookup is used — `patchEntry` says why the
             rest of a snapshot taken before a model call must not be merged. */
          done: (data) => {
            const got = (data as { entry?: Partial<GlossaryEntry> } | null)?.entry;
            return got?.id === id && isGlossaryLookup(got.lookup)
              ? {
                  lookup: got.lookup,
                  name: typeof got.name === "string" && got.name ? got.name : null,
                }
              : undefined;
          },
        });
        if (mine()) {
          setLookDraft(null);
          /* Kept independently of the list. A glossary rewrite can replace the
             entry while the model is answering; `patchEntry` must not put that
             stale entry back, but clearing every trace would silently hide an
             answer the server did store. The panel uses this only when no row
             with `id` remains. */
          setLookKept({ id, name: done.name });
          patchEntry(id, done.lookup);
        }
      } catch (err) {
        if (controller.signal.aborted || !mine()) return;
        setLookFailed({
          id,
          message:
            err instanceof StreamStalled ? wentQuiet(err.seconds).message : (err as Error).message,
        });
        /* See the section above: the answer may be stored anyway. Only once the
           stream had opened — a refusal before it stored nothing.

           **Awaited while this request still owns `lookLive`.** Releasing
           admission first lets a quick retry start a second paid call while
           this read is about to discover that the first answer was stored. If
           that stored answer then lands, `Looked` hides the retry's arriving
           draft behind it. Reconciliation is part of this lookup's lifetime. */
        if (opened) await refresh();
      } finally {
        if (lookLive.current === controller) {
          lookLive.current = null;
          setLooking(null);
        }
      }
    },
    [slug, patchEntry, refresh],
  );

  /**
   * **Another article, or the band going, stops reading the lookup** — not the
   * lookup itself, which the server finishes and stores. Without this the old
   * stream's `done` would be merged into the next article's list, whose ids are
   * a different namespace of the same shape.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slug` is the trigger — the cleanup must run when it changes
  useEffect(
    () => () => {
      lookLive.current?.abort();
      lookLive.current = null;
      setLooking(null);
      setLookDraft(null);
      setLookKept(null);
      setLookFailed(null);
    },
    [slug],
  );

  /**
   * The box at the top of the panel: find a term in the prose and explain it.
   *
   * **The same shape as `look` above, minus the merge**, and the missing merge
   * is the deferral: `lookUpTerm` stores its answer against an entry id and this
   * has no entry to store against. So the answer lives here until the reader
   * leaves. See `ask` on `UseGlossary` for why nothing is persisted.
   *
   * **Refused here on the same rule the server refuses on** —
   * `parseAskedTerm`, one function reaching both halves (src/asked-term.ts) —
   * so an empty box or eighty-one characters costs no request. The sentences
   * are the box's own: the server's three 400s are written for a reader too,
   * but a round trip to be told the box is empty is a round trip nobody needs.
   *
   * `clearAsked` before the request, not after it, so the previous answer does
   * not sit on screen under a spinner belonging to a different term.
   */
  /**
   * **Which question the answer on screen is allowed to be about.**
   *
   * `useOrderedRead`'s generation, in the smallest form the job needs: the box
   * stays editable while the request is out, so a reply can arrive after the
   * reader has typed something else — and an explanation of *attention head*
   * sitting under a box that says *transformer* is the panel asserting something
   * false, which is the whole fault this feature was built beside. Bumped by
   * `clearAsked`, which every keystroke calls. GPT Sol's review of the built
   * code.
   *
   * A ref, not state: it is read inside a callback that outlives its render, and
   * the answer must be the value at the moment the reply lands rather than the
   * one captured when the request left.
   */
  const askGeneration = useRef(0);

  /**
   * **The one live request, so it can be stopped.** A stream nobody is reading
   * holds a socket open, and the server only learns the reader has gone — and
   * stops the paid call — when the body is cancelled, which is what aborting
   * this does. `useQuiz`'s `live`, for the same reason.
   *
   * It is also what `asking` means: a request is live exactly while this holds
   * its controller, so the button comes back the moment the reader disowns one
   * rather than when its reply finally drains.
   */
  const live = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (term: string) => {
      /* The ref is the admission record. React state has not necessarily
         committed between two calls in one tick, so `asking` can still be
         false for both halves of a double submit; `live.current` changes
         synchronously and admits exactly one. `useQuiz.mark` has the same
         guard for the same reason. */
      if (live.current) return;
      const parsed = parseAskedTerm(term);
      if (!parsed.ok) {
        setAsked(null);
        setAskDraft(null);
        /* **The server's own sentence, from the file both halves import.** Not a
           second set of words for the same rule: a reader must not be told two
           different things by one check depending on which side caught it.
           src/asked-term.ts § `ASKED_TERM_REFUSED`. */
        setAskFailed(ASKED_TERM_REFUSED[parsed.fault]);
        return;
      }
      const mine = ++askGeneration.current;
      const current = () => askGeneration.current === mine;
      const controller = new AbortController();
      live.current = controller;
      setAsking(true);
      setAsked(null);
      setAskDraft(null);
      setAskFailed(null);
      try {
        const res = await apiFetch(`/api/glossary/${encodeURIComponent(slug)}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term: parsed.term }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          /* Every refusal — the three `[gl-ask-…]` 409s among them — is decided
             before the server opens the stream, so it is an ordinary JSON error
             and `readJson` throws its sentence. */
          await readJson(res);
          throw new Error(`The server replied ${res.status}.`);
        }
        /* **`asked` is what `readGlossaryStream` returns, and it returns only on a
           `done` frame.** Every other ending throws, so the draft can never be
           promoted by accident. The generation check after each frame, not
           before the request: the reader can type while the words arrive. */
        const answer = await readGlossaryStream(res.body, {
          begin: (data) => {
            const found = asFound(data);
            if (found && current()) setAskDraft({ ...found, text: "" });
          },
          delta: (text) => {
            if (current()) setAskDraft((was) => (was ? { ...was, text } : was));
          },
          done: (data) => (isAskedTermAnswer(data) ? data : undefined),
        });
        if (current()) {
          setAskDraft(null);
          setAsked(answer);
        }
      } catch (err) {
        /* Stopped on purpose — a keystroke, another article, the band closing.
           Not a failure, and nothing to put on a screen that has moved on. */
        if (controller.signal.aborted || !current()) return;
        /* The draft stays: the reader has read it, and the sentence says what
           it is. */
        setAskFailed(
          err instanceof StreamStalled ? wentQuiet(err.seconds).message : (err as Error).message,
        );
      } finally {
        /* **Only if it is still ours.** `clearAsked` hands the box back the
           moment it disowns a request, and a later `ask` may already own
           `live` — so an old request's ending must not switch a newer one's
           spinner off. Guarding on the controller rather than the generation
           is the point: the generation moves on every keystroke, and a
           `finally` guarded by it left the button disabled for the rest of the
           visit in the first version. */
        if (live.current === controller) {
          live.current = null;
          setAsking(false);
        }
      }
    },
    [slug],
  );

  /**
   * Put the box back to nothing, **and stop whatever is in flight.**
   *
   * The bump is the half that is not obvious: with an answer already on screen
   * the `setState`s are the whole of it, but during a request there is nothing
   * on screen to clear and the reply is still coming. The abort is the half
   * streaming added: disowning the reply is not enough when the server is still
   * paying for it.
   */
  const clearAsked = useCallback(() => {
    askGeneration.current += 1;
    live.current?.abort();
    live.current = null;
    setAsking(false);
    setAsked(null);
    setAskDraft(null);
    setAskFailed(null);
  }, []);

  /**
   * **Another article, or the band going, takes the question with it.**
   *
   * The band is not keyed by slug (src/web/reader/Reader.tsx), so this hook
   * outlives an article change: without this, an answer about one piece would
   * sit under the next, and its stream would go on arriving — and being paid
   * for — into a panel about something else. The cleanup runs on both a slug
   * change and unmount.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slug` is the trigger — the cleanup must run when it changes
  useEffect(() => clearAsked, [slug, clearAsked]);

  return {
    status,
    glossary,
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
    find,
    more,
    cancel: queue.cancel,
    look,
    lookDraft,
    lookKept,
    looking,
    lookFailed,
    ask,
    asking,
    askDraft,
    asked,
    askFailed,
    clearAsked,
  };
}
