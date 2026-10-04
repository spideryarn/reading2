/**
 * The quiz, as the reading view sees it: the questions, whether they still
 * describe the article, the one thing you can ask for, and one answer at a time
 * being marked.
 *
 * The read half is `GET /api/quiz/:slug`; the write half is a **job**, because
 * writing a dozen questions is a model call over the whole article and takes
 * the better part of a minute (docs/project/ingest-queue.md). Both halves are
 * `useTimeline`'s, unchanged, and this file would be nearly a copy of it if it
 * stopped there.
 *
 * What is not a copy is the third half: **marking**.
 *
 * ## A mark is not a conversation, and this is not `useChat`
 *
 * One question, one answer, one reply. No thread, no history, no retry-and-edit
 * machinery, no `chat_threads` row. Greg, 2026-08-31: *"Unlike the default
 * freeform sub-mode, Quiz doesn't need to be a conversation - it's just a
 * question then answer."* `ChatPanel` is right there and reusing it looks free;
 * two-thirds of what it does is history, and history is the thing this feature
 * does not have.
 *
 * Nothing is stored, either. A reload starts the quiz fresh — the questions
 * persist because they are an artefact, and the answers do not persist at all.
 * So `answered` and `reply` below are session state and nothing else reads them.
 *
 * ## The terminal contract, which is the whole of why `mark` is careful
 *
 * *"Streamed and stateless"* is not a contract. A provider or a socket can stop
 * cleanly without finishing, and that looks **exactly** like finishing. So the
 * server sends zero or more `delta` frames and then exactly one terminal frame
 * — `done` or `error` — and this hook **ticks a question answered only on
 * `done`**. A stream that simply stops produces neither frame, leaves `status`
 * on `"marking"` → `"failed"`, and the reply stays visibly incomplete and
 * retryable. tests/quiz-mark-stream.test.ts is that case and nothing else.
 *
 * One live request per attempt: `mark` refuses to start a second while one is
 * running, and aborts the old one when the reader moves to another question or
 * the panel goes.
 *
 * See docs/plans/260831al-review-quiz-sub-mode.md and src/quiz.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, Quiz, QuizQuestionId, QuizResponse, QuizVerdict } from "../types.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useAutoRun } from "./useAutoRun.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { readAnswerStream } from "./lib/sse.js";
import { type FreshReads, useFreshReads, useRewriteHold } from "./rewrite-hold.js";

type QuizStatus = "loading" | "none" | "ready" | "error";

/**
 * **What a mark says when it stops with no reason of its own** — the two stops
 * `readAnswerStream` (lib/sse.ts) has no words from the server for.
 *
 * The terminal contract itself is that function's: zero or more `delta` frames,
 * then exactly one `done` or `error`, and anything else that ends the body is a
 * failure — including the body simply ending, which a provider or a socket that
 * stops cleanly makes look **exactly** like finishing. `mark` below had its own
 * copy of the loop (`readMark`) until 2026-10-04; an `error` frame whose data
 * was `null` was a `TypeError` in it. The sentences stayed here because they
 * are the quiz's, pinned in tests/quiz-mark-stream.test.tsx.
 */
const MARK_STOPS = {
  stopped: "The mark stopped before it was finished.",
  /* **The case a mocked complete transcript cannot reach.** The body ended
     cleanly with no terminal frame in it — a provider that stopped, an instance
     that was killed, a proxy that closed. */
  ended: "The reply stopped arriving before it was finished. Nothing was lost — try again.",
};

/**
 * Where one attempt at one question has got to.
 *
 * A single value rather than a `marking` boolean beside a `failed` string, for
 * `StepJob.failed`'s reason: two fields is two fields an edit can set one of.
 * `"done"` is the only one that means the question was answered, and it is
 * reached from exactly one place — the `done` frame.
 */
export type MarkStatus = "idle" | "marking" | "done" | "failed";

export interface Attempt {
  questionId: QuizQuestionId;
  /**
   * **The exact answer this mark was computed from**, trimmed as it went to the
   * server.
   *
   * Carried on the attempt rather than left for the panel to remember, because
   * the panel's copy would be a second record of the same fact and the two
   * would drift the first time anything else set an attempt. A mark that is not
   * bound to its answer is the whole of the fifth quiet rule —
   * src/web/QuizPanel.tsx, and `questionId` above binds the other half of it.
   */
  answer: string;
  status: MarkStatus;
  /** What has arrived so far. Kept on failure — the reader has already read it. */
  reply: string;
  /** Why it stopped badly, if it did. */
  error: string | null;
  /**
   * **Whether they got it right — and it is never rendered.**
   *
   * The walk reads this to decide whether the next step carries its premise
   * (src/web/quiz-ladder.ts), and "Where to look again" to decide which sections
   * it names (src/web/quiz-sections.ts). It may select scaffolding and
   * navigation like that; `QuizPanel` must never print the word, a count or a
   * score, or change a line of copy to say how the reader did:
   * docs/project/quiz.md is explicit that quoting a difficulty at a reader
   * hands them a token with nothing behind it, and a verdict is worse — it is
   * the grade the whole marking prompt refuses to give.
   *
   * Absent far more often than not: no verdict when the classifier failed or
   * timed out, when the question was ill-posed, or on any attempt that did not
   * reach `done`. Absence means *show the premise*, which is why nothing here has
   * to treat it as an error.
   */
  verdict?: QuizVerdict;
}

export interface UseQuiz {
  status: QuizStatus;
  quiz: Quiz | null;
  /** The article moved after these were written — blocks, sections or head. */
  stale: boolean;
  /** They predate the current prompt. A different fact from `stale`. */
  outdated: boolean;
  slug: string;
  error: string | null;
  /** The job writing this article's questions, if one is. */
  job: Job | null;
  /** Why the job this session started stopped, if it stopped badly. */
  failed: StepFailure | null;
  /**
   * **The press has gone and the queue has not caught up yet.**
   *
   * A pass-through of `StepJob.starting`, and it was missing from this
   * interface until 2026-09-03 — so `QuizPanel` could not pass it, and between
   * the press and the first poll the panel drew its run button again and
   * invited a second press. `JobProgress` even carried a comment saying the
   * quiz *"watch[es] a job it did not start and has no such gap"*, which was
   * never true: `write` below starts its own.
   */
  starting: boolean;
  /**
   * This tab can see the job on screen and cannot move it. A pass-through:
   * `StepJob.stalled` in src/web/useStepJob.ts carries the reasoning, and
   * src/job-state.ts § Transport health is not a job state carries why it is
   * not on the record.
   */
  stalled: boolean;
  /** The attempt in front of the reader, or null before they have answered anything. */
  attempt: Attempt | null;
  /** Which questions have been marked to a `done` this session. Never persisted. */
  answered: ReadonlySet<QuizQuestionId>;
  /** These were written for a reader profile — `quiz.profileHash != null`. */
  profiled: boolean;
  /** …and the reader's profile has changed since. The server's verdict. */
  profileChanged: boolean;
  /**
   * **A forced run was pressed on the batch still on screen**, and has neither
   * replaced it nor failed. Covers the gap `job`/`starting` do not: a finished
   * job leaves `job` before its re-read lands, and a re-read that fails keeps
   * the old batch *and its old `profileChanged`*, so the badge's Regenerate
   * would offer a second paid rewrite. GPT Sol's plan review of 261002f; the
   * rule, and what releases it, is rewrite-hold.ts's since 2026-10-04.
   */
  rewriting: boolean;
  /** Read again after the profile panel saved — useSimple.ts § `refresh`. Never spends. */
  refresh(): Promise<void>;
  /**
   * **Write the questions if there are none.** The unforced verb — what the
   * automatic run takes, and what the button under the empty state takes, which
   * has to be the same one.
   *
   * Two verbs where there was one, since 2026-09-06, and the difference is the
   * *identity of the request* rather than a convenience: `work_key` is computed
   * from the request including `force`, so an unforced automatic run and a
   * forced press during the same second are two requests, `enqueueOrGet` does
   * not collapse them, and the reader pays twice. Exactly `useIdeas`'
   * `ensure` / `regenerate` split, named the same way.
   */
  ensure(): Promise<void>;
  /**
   * Write them **again**. `force` is passed always, for the reason
   * `useIdeas.regenerate` gives: this is the button offered beside questions
   * that are current, so an unforced run would skip and the reader would watch
   * a job start and finish having changed nothing.
   */
  write(): Promise<void>;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  cancel(id: string): void;
  /** Mark one answer. Resolves when the stream ends, however it ends. */
  mark(questionId: QuizQuestionId, answer: string): Promise<void>;
  /** Throw away the attempt on screen, so the reader can answer again. */
  clearAttempt(): void;
}

/**
 * **The opening quiz read, and nothing else** — the GET, its ordering, and the
 * four facts the prose needs. Since 2026-09-30 the questions are drawn in the
 * prose in **every** mode (SPIDERYARN-READING2-6V), so this runs in
 * `OwnedReader` (ArticlePage.tsx) and the band layers `useQuiz` on top of it —
 * the split `useQuotesRead` / `useQuotes` made for the same reason. No job
 * subscription and no activation up here, for the reasons `QuotesRead` gives:
 * a reader who never opens Quiz must not hold the job engine to its idle
 * cadence, nor be able to spend a press after leaving the band.
 * docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md.
 */
export interface QuizRead {
  status: QuizStatus;
  quiz: Quiz | null;
  stale: boolean;
  outdated: boolean;
  /** `UseQuiz.profiled`. */
  profiled: boolean;
  /** `UseQuiz.profileChanged`. */
  profileChanged: boolean;
  /**
   * Which reads the server itself answered, and when each started — what
   * Regenerate's hold asks of a read (rewrite-hold.ts § `FreshReads`). The hold
   * itself was here from 261002f until 2026-10-04 (`held`); it is in that
   * module now, where it also survives a read that is not this one.
   */
  fresh: FreshReads;
  error: string | null;
  /** Repeat only the GET after a failed read — useFaq.ts § `retryRead`. */
  retryRead(): Promise<void>;
  /** Read again, joining a read in flight. `OrderedRead.reload`. */
  reload(): Promise<void>;
  /** Read again because a job has just written a new batch. `OrderedRead.refresh`. */
  refresh(): Promise<void>;
}

export function useQuizRead(slug: string): QuizRead {
  const [status, setStatus] = useState<QuizStatus>("loading");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = useFreshReads();
  const { begin, landed } = fresh;

  /**
   * The read itself — the parse, the 404 branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is
   * set: false means this reply is about an article, or an artefact, the hook
   * has since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    const started = begin();
    try {
      const res = await apiFetch(`/api/quiz/${encodeURIComponent(slug)}`);
      if (!current()) return;
      if (res.status === 404) {
        /* The ordinary case, and here the commonest by some distance: `quiz` is
           off `DEFAULT_INGEST_STEPS`, so most articles have never had questions
           written. This is what the panel's button is for. */
        setQuiz(null);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        landed(started, res, null);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<QuizResponse>(res);
      if (!current()) return;
      /* Derive before publishing: a malformed revalidation keeps the old batch. */
      const profiled = loaded.quiz.profileHash != null;
      setQuiz(loaded.quiz);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null`, as useIdeas.ts: absent (written before 261002f) and `null`
         (written for nobody) both mean no badge. */
      setProfiled(profiled);
      setProfileChanged(loaded.profileChanged);
      landed(started, res, loaded.quiz.batchId);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (!current()) return;
      setError(describeFetchFailure(err as Error));
      /* **A failed revalidation must not take the questions away.** `load` is
         not only the opening read — `onFinished` calls it again every time a
         job finishes — and the panel renders under `status === "ready"`, so an
         unconditional `error` here would let a flaky connection blank a list
         that was still perfectly good. Same guard, same reason, as
         useTimeline.ts and useIdeas.ts. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug, begin, landed]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     seven other artefact readers — this one lost that race until 2026-09-02
     (tests/artefact-read-race.test.tsx). */
  const { reload, refresh } = useOrderedRead(load);

  /* The opening read. Everything after it goes through `reload`, which does not
     return `status` to `loading` — including the band's own mount effect in
     `useQuiz`, which joins this request rather than making a second. */
  useEffect(() => {
    void reload();
  }, [reload]);

  /* The way out of a failed read, and never a generation verb — useFaq.ts §
     `retryRead`. Questions already on screen stay there while a failed
     revalidation is tried again; only the opening error returns to loading. */
  const retryRead = useCallback(async () => {
    setError(null);
    if (quiz === null) setStatus("loading");
    await reload();
  }, [quiz, reload]);

  return {
    status,
    quiz,
    stale,
    outdated,
    profiled,
    profileChanged,
    fresh,
    error,
    retryRead,
    reload,
    refresh,
  };
}

/**
 * The band's half: the job, the verbs and the marks. `read` comes from
 * `useQuizRead` in `OwnedReader` — see `QuizRead` for why the fetch moved up.
 */
export function useQuiz(slug: string, read: QuizRead): UseQuiz {
  const { status, quiz, stale, outdated, profiled, profileChanged, error, reload, refresh } = read;
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answered, setAnswered] = useState<Set<QuizQuestionId>>(() => new Set());

  /* **Revalidate on mount, behind whatever is on screen** — `useQuotes`' reason:
     `useStepJob`'s first poll is a baseline and does not announce a job that had
     already finished, so a batch written in another tab while the band was
     closed has nothing else to bring it in. `reload` joins a read in flight and
     never returns `status` to `loading`. */
  useEffect(() => {
    void reload();
  }, [reload]);

  /* **The ticks go with the batch.** A replacement batch can reuse question ids
     with new meanings, so a tick kept across it would call a question answered
     that nobody has answered. GPT Sol's plan review, 260930i finding 6. */
  const batchId = quiz?.batchId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reset trigger — a new batch
  useEffect(() => {
    setAnswered(new Set());
  }, [batchId]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary,
     the summaries, the ideas and the timeline. */
  const queue = useStepJob(slug, "quiz", refresh, "watches-queue");

  /* **The unforced one.** Two callers, and they must be the same request: the
     automatic run below, and the button under the empty state (`QuizPanel` §
     `run`). See `ensure` on the interface for why that matters. */
  const ensure = useCallback(async () => {
    await queue.start();
  }, [queue]);

  /* **`rewriting`: the hold is not this band's**, so it survives the band
     unmounting while the job runs on — rewrite-hold.ts, which owns what
     releases it. The batch is the identity: a new `batchId` is the replacement. */
  const { rewriting, run: held } = useRewriteHold({
    slug,
    step: "quiz",
    identity: batchId ?? null,
    queue,
    fresh: read.fresh,
    refresh,
  });

  const write = useCallback(async () => {
    await held(() =>
      queue.start({
        /* **Always forced**, for `useIdeas.regenerate`'s reason: the button is
           offered beside questions that are current, so an unforced run would skip
           and the reader would watch a job start and finish having changed
           nothing. Forcing is safe because this step replaces rather than appends.

           It also mints a new `batchId`, which is deliberate and is why the mark
           route answers 409 rather than falling forward: the reference answers
           have genuinely been rewritten. */
        force: true,
      }),
    );
  }, [queue, held]);

  /* **The reader pressed Quiz and there is nothing there — write the questions.**
     `ensure` and not `write`, for the double-charge reason on the interface; and
     `reload` and not `ensure` for the last argument, because a read that failed
     is answered by reading again rather than by spending. useAutoRun.ts § A
     failed read is not an answer.

     The press is minted by Remember's own sub-mode toggle (App.tsx §
     `RememberBand`), not by the `?remember=` setter beside it — Back and Forward
     move that, and retracing your steps must not buy a model call. */
  useAutoRun(slug, "quiz", status, ensure, reload);

  /**
   * **The one live request, so a second submission cannot start a second.**
   *
   * A ref rather than state, because `mark` reads it in the same tick it sets
   * it and a state update would not have landed yet — which is exactly the
   * window a double-click lands in.
   */
  const live = useRef<AbortController | null>(null);

  /** Stop whatever is in flight. Safe to call when nothing is. */
  const abort = useCallback(() => {
    live.current?.abort();
    live.current = null;
  }, []);

  /* **The panel going takes the request with it.** Not politeness: the answer
     is being paid for either way, but a stream nobody is reading holds a socket
     open and the server only learns the reader has gone when the body is
     cancelled — which is what `readEvents`' own `finally` does once this signal
     fires. Same rule for a switch to another question, below. */
  useEffect(() => () => abort(), [abort]);

  const clearAttempt = useCallback(() => {
    abort();
    setAttempt(null);
  }, [abort]);

  const mark = useCallback(
    async (questionId: QuizQuestionId, answer: string) => {
      /* One live request per attempt. A press while one is running is a
         double-click, not a second question. */
      if (live.current) return;
      const controller = new AbortController();
      live.current = controller;

      const batchId = quiz?.batchId;
      if (!batchId) {
        live.current = null;
        setAttempt({
          questionId,
          answer,
          status: "failed",
          reply: "",
          error: "There are no questions loaded to mark this against.",
        });
        return;
      }

      setAttempt({ questionId, answer, status: "marking", reply: "", error: null });

      /* What has arrived so far, held here because the stream reader throws a
         plain sentence and the catch below still owes the reader the half they
         have read — on every stop, a stall included. */
      let partial = "";
      try {
        const res = await apiFetch(`/api/quiz/${encodeURIComponent(slug)}/mark`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId, questionId, answer }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          /* Every refusal is an ordinary JSON error — the route validates
             before it opens the stream, so a stale batch is a 409 with a
             sentence rather than an error frame. `readJson` throws it. */
          await readJson(res);
          throw new ReaderFacingError(`The server replied ${res.status}.`);
        }
        /* **The reply is what `readAnswerStream` returns**, and it returns only
           on a `done` frame. There is no other road to the two lines below,
           which is the whole of the terminal contract as the client keeps it. */
        const { reply, verdict } = await readAnswerStream(
          res.body,
          {
            delta: (text) => {
              partial = text;
              setAttempt({ questionId, answer, status: "marking", reply: text, error: null });
            },
            done: (data) => {
              const sent = data as { reply?: unknown; verdict?: unknown } | null;
              /* **Validated rather than cast**, because this decides whether the
                 next step carries its premise and a stray string would decide it
                 on nonsense. Any other value is absence, which means *show the
                 premise* — the same outcome as the classifier having failed, and
                 a perfectly ordinary one. */
              const verdict: QuizVerdict | undefined =
                sent?.verdict === "right" || sent?.verdict === "wrong" ? sent.verdict : undefined;
              /* The server's own whole reply where it sent one, because it is
                 the trimmed text and the deltas are not. Falling back to what
                 arrived rather than trusting the field blindly, so a malformed
                 `done` still hands back what the reader watched arrive — and is
                 never the "could not read" refusal an `undefined` here means. */
              const whole = sent?.reply;
              return { reply: typeof whole === "string" && whole.trim() ? whole : partial, verdict };
            },
          },
          MARK_STOPS,
        );
        setAttempt({
          questionId,
          answer,
          status: "done",
          reply,
          error: null,
          ...(verdict ? { verdict } : {}),
        });
        setAnswered((was) => {
          const next = new Set(was);
          next.add(questionId);
          return next;
        });
      } catch (err) {
        if (controller.signal.aborted) {
          /* The reader moved on or the panel went. Not a failure, and not
             something to put a message on a screen nobody is looking at. */
          return;
        }
        /* The half that arrived is kept, exactly as chat keeps one: half a mark
           and a reason beats a spinner that turns into nothing, and the reader
           has already read the half. `status: "failed"` is what keeps the
           question un-ticked and the button live. */
        setAttempt({
          questionId,
          answer,
          status: "failed",
          reply: partial,
          error: (err as Error).message,
        });
      } finally {
        if (live.current === controller) live.current = null;
      }
    },
    [quiz?.batchId, slug],
  );

  return {
    status,
    quiz,
    stale,
    outdated,
    slug,
    error,
    job: queue.job,
    failed: rewriting ? null : queue.failed,
    starting: queue.starting,
    stalled: queue.stalled,
    attempt,
    answered,
    profiled,
    profileChanged,
    rewriting,
    refresh,
    retryRead: read.retryRead,
    ensure,
    write,
    cancel: queue.cancel,
    mark,
    clearAttempt,
  };
}
