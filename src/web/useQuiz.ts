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
 * ## Each finished mark is kept, and put back
 *
 * Nothing was stored until 2026-10-05, and a reader who left the quiz came
 * back to empty boxes (report spya-e8ujxn). The server now keeps every mark
 * that reaches `done` and `GET /api/quiz/:slug` returns the latest per
 * question as `attempts`
 * (docs/plans/261005b-quiz-answers-are-kept-and-restored.md).
 *
 * **Two records, kept apart, in `useQuizRead`** — which lives above the band,
 * so both outlive it: what the server last said (`fromServer`, replaced by
 * each read that could say) and this visit's own finished marks (`thisVisit`,
 * which no read touches). `kept` is the two merged, the later answer to each
 * question winning, and `answered` is its keys — one source for the tick, the
 * restored box and the restored mark. Why two and not one is on
 * `useQuizRead`.
 *
 * Still not a history: the attempt on screen is one answer and one reply, and
 * whether the reader got it right is not kept anywhere.
 *
 * ## The terminal contract, which is the whole of why `mark` is careful
 *
 * *"Streamed and stateless"* is not a contract. A provider or a socket can stop
 * cleanly without finishing, and that looks **exactly** like finishing. So the
 * server sends zero or more `delta` frames and then exactly one terminal frame
 * — `done` or `error` — and this hook **ticks a question answered only on
 * `done`**. A stream that simply stops produces neither frame, leaves `status`
 * on `"marking"` → `"failed"`, and the reply stays visibly incomplete and
 * retryable. tests/quiz-mark-stream.test.tsx is that case and nothing else.
 *
 * One live request per attempt: `mark` refuses to start a second while one is
 * running, and aborts the old one when the reader moves to another question or
 * the panel goes.
 *
 * See docs/plans/260831al-review-quiz-sub-mode.md and src/quiz.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Job, Quiz, QuizQuestionId, QuizResponse, QuizVerdict } from "../types.js";
import { parseRecallAfterDays, RECALL_AFTER_DAYS } from "../quiz-spacing.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useAutoRun, useAutoRunOnArrival } from "./useAutoRun.js";
import { type StepFailure, useStepFinished, useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply, ReaderFacingError } from "./lib/reader-facing.js";
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
   * **Whether the hidden check thought the answer looked right.**
   *
   * The walk reads this to decide whether the next step carries its premise
   * (src/web/quiz-ladder.ts), and "Where to look again" to decide which sections
   * it names (src/web/quiz-sections.ts), and both Quiz surfaces use it for a
   * deeper green. `QuizPanel` never prints the verdict as a word, count or
   * score:
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
  /**
   * **Put back from a kept answer, not marked just now** — `showKept`.
   *
   * It looks like any other finished mark, and that is the point. The flag is
   * for the one place the distinction matters on screen: after a due answer is
   * revealed beside a new draft, quote the earlier words that the restored
   * mark is about. Verdicts live on `kept`, not restored attempts.
   */
  restored?: true;
  /**
   * Another surface owns the live mark. Kept only long enough to explain why
   * this press did not start a second paid call; when that mark lands, the
   * kept-answer restore may replace this attempt while preserving the draft.
   */
  claimedElsewhere?: true;
  /**
   * **The stored row this mark is**, `quiz_attempts.id`: what *Discuss this in
   * chat* names it by, so the chat is about this mark and no other
   * (`QuizOrigin`; plan 261024i, stage 2). Absent on a mark that was not
   * stored, and on one from a server that did not say.
   */
  attemptId?: string;
  /**
   * **The mark finished and the server could not store it.** It is on screen
   * and in this visit's record, and it will not be there after a reload — the
   * panel says so under the mark. Absent on every mark that was stored.
   */
  notSaved?: true;
}

/**
 * One kept answer, as the panel restores it — a `QuizKeptAnswer` from the
 * server, or a mark that finished this visit.
 */
export interface KeptAnswer {
  answer: string;
  reply: string;
  /** ISO. The row's `created_at`; this machine's clock only when `saved` is false. */
  answeredAt: string;
  /** False when the server said it could not store this one — `Attempt.notSaved`. */
  saved: boolean;
  /** The row's id, `Attempt.attemptId`; `null` when there is no row to name. */
  attemptId: string | null;
  /**
   * **The hidden check's word on this answer** — from the server, which has
   * stored it since plan 261030c (privacy.md § Quiz answers), or from a mark
   * given this visit. Here so the band and the margin draw the same deeper
   * green for *right* from one place (plan 261029m; 261029i's F1). Absent
   * whenever the check failed or declined, and on answers from before
   * 2026-10-30: never read as wrong.
   */
  verdict?: QuizVerdict;
  /**
   * **Days after `answeredAt` that this question is due again** — the
   * server's schedule over the question's history (src/quiz-spacing.ts), or
   * the neutral three days for an answer it could not schedule.
   */
  recallAfterDays: number;
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
  /**
   * Which questions of this batch have a finished mark — the keys of `kept`,
   * so it includes answers from earlier visits.
   */
  answered: ReadonlySet<QuizQuestionId>;
  /** `QuizRead.kept`: the latest finished answer to each question of this batch. */
  kept: ReadonlyMap<QuizQuestionId, KeptAnswer>;
  /** `QuizRead.keptUnread`. */
  keptUnread: boolean;
  /**
   * **Put the kept answer to this question on screen as its mark.** The panel
   * calls it, with the box, from its one restoring effect. Does nothing when
   * there is no kept answer or a mark is in flight.
   */
  showKept(questionId: QuizQuestionId): void;
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
 * four facts the prose needs. Since 2026-09-30 the questions are drawn beside
 * the prose in **every** mode (SPIDERYARN-READING2-6V) — in Marginalia's column
 * while that column is on screen, and in the prose otherwise — so this runs in
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
  /**
   * **The latest finished answer to each question of the batch on screen** —
   * the server's and this visit's, merged. Empty for a batch nobody has
   * answered, and never carries another batch's or another article's.
   */
  kept: ReadonlyMap<QuizQuestionId, KeptAnswer>;
  /**
   * **The server could not read the kept answers, and we hold none for this
   * batch from an earlier read.** Not the same as having none: the panel says
   * so, and offers the read again.
   */
  keptUnread: boolean;
  /**
   * Record a mark that has just finished — `useQuiz.mark`, on `done`.
   * `answeredAt` is the server's time for the stored row, or `null` when it
   * said the save failed.
   */
  noteMark(
    batchId: string,
    questionId: QuizQuestionId,
    mark: {
      answer: string;
      reply: string;
      answeredAt: string | null;
      attemptId: string | null;
      verdict?: QuizVerdict;
      /** Already through `parseRecallAfterDays`: the server's, or the neutral three days. */
      recallAfterDays: number;
    },
  ): void;
  /**
   * **Claim the right to mark one question**, or `null` when a mark of it is
   * already in flight somewhere on this page. Returns the release.
   *
   * Since plan 261029i the band and the margin each hold a `useQuizMark`, and
   * each one's own guard is a ref nobody else can see. With both on screen the
   * same question could be sent twice, bought twice, and the two results race
   * into `noteMark` (GPT Sol's plan review, F2). This is the one guard both see.
   */
  claimMark(batchId: string, questionId: QuizQuestionId): (() => void) | null;
}

/** One batch's kept answers, and which batch of which article that is. */
interface KeptSet {
  /** `keptKey`, or `null` for "nothing held". */
  readonly key: string | null;
  readonly byQuestion: ReadonlyMap<QuizQuestionId, KeptAnswer>;
  /** False when the server said it could not read them (`attempts: null`). Always true of `thisVisit`. */
  readonly known: boolean;
}

const NOTHING_KEPT: KeptSet = { key: null, byQuestion: new Map(), known: true };

/** A batch id is minted per run of one article's quiz; the slug is belt and braces. */
const keptKey = (slug: string, batchId: string) => `${slug}\n${batchId}`;

/**
 * The server's `attempts`, as a map — **validated rather than cast**, because
 * these go straight into the reader's answer box. Anything that is not a list
 * is `null`: "could not say", which is also what an offline copy saved before
 * 2026-10-05 looks like.
 */
function keptFromServer(attempts: unknown): Map<QuizQuestionId, KeptAnswer> | null {
  if (!Array.isArray(attempts)) return null;
  const out = new Map<QuizQuestionId, KeptAnswer>();
  for (const one of attempts as unknown[]) {
    const { questionId, attemptId, answer, reply, answeredAt, verdict, recallAfterDays } = (one ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof questionId !== "string" ||
      typeof answer !== "string" ||
      typeof reply !== "string" ||
      typeof answeredAt !== "string" ||
      Number.isNaN(Date.parse(answeredAt))
    ) {
      continue;
    }
    /* An attempt id that is not a string is a server from before plan 261024i:
       the answer is still kept, and its Discuss records no origin. */
    out.set(questionId, {
      answer,
      reply,
      answeredAt,
      saved: true,
      attemptId: typeof attemptId === "string" && attemptId !== "" ? attemptId : null,
      /* Stored since plan 261030c. Anything else — absent on an older server
         or an offline copy, or nonsense — is no verdict, which is the
         ordinary answered green, never a wrong. */
      ...(verdict === "right" || verdict === "wrong" ? { verdict } : {}),
      recallAfterDays: parseRecallAfterDays(recallAfterDays),
    });
  }
  return out;
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
   * The article the server has said "none yet" for. A failed read after that
   * answer — a failed *Try again* included — ends at `none`, not `error`,
   * so the empty state's button stays (Greg, 2026-10-07; docs/project/mode.md
   * § The artefact, if the mode shows one). Keyed by slug, so one article's
   * answer cannot stand in for another's.
   */
  const saidNoneFor = useRef<string | null>(null);

  /**
   * **The kept answers, as two records that never write to each other.**
   *
   * - `fromServer` is what the last read that *could say* said about one
   *   batch. A read that answers `attempts: null` leaves it alone when it is
   *   about the same batch — "could not read" is not "none" — and for a batch
   *   we hold nothing for, it records that we do not know (`known: false`).
   * - `thisVisit` is every mark that reached `done` in this tab, stored or
   *   not. Only `noteMark` writes it.
   *
   * **One map seeded by reads and patched by marks was the first design, and
   * it loses answers**: a revalidation that left before a save lands after it
   * and replaces the map with a picture from before the answer existed. Kept
   * apart, that read can only replace what the server said, and the merge
   * below still has the newer answer. It is also what lets a mark whose save
   * failed survive Next and Previous. GPT Sol's plan review of 261005b, F2 and
   * F7.
   *
   * Both carry the batch they are about, so neither needs clearing: a set
   * whose key is not the batch on screen is simply not read.
   */
  const [fromServer, setFromServer] = useState<KeptSet>(NOTHING_KEPT);
  const [thisVisit, setThisVisit] = useState<KeptSet>(NOTHING_KEPT);
  const serverSaid = useRef(fromServer);
  serverSaid.current = fromServer;

  const noteMark = useCallback<QuizRead["noteMark"]>(
    (batchId, questionId, mark) => {
      const key = keptKey(slug, batchId);
      setThisVisit((was) => {
        const byQuestion = new Map(was.key === key ? was.byQuestion : []);
        let answeredAt = mark.answeredAt;
        if (answeredAt === null) {
          /* Not stored, so there is no row's time: this machine's clock — but
             never earlier than an answer we already hold for the question. The
             merge takes the later of two, the other is stamped by the server,
             and a laptop clock a minute slow must not put the reader's older
             answer back over the one they have just been marked on. */
          const held = [
            byQuestion.get(questionId),
            serverSaid.current.key === key ? serverSaid.current.byQuestion.get(questionId) : undefined,
          ].map((one) => (one ? Date.parse(one.answeredAt) + 1 : 0));
          answeredAt = new Date(Math.max(Date.now(), ...held)).toISOString();
        }
        byQuestion.set(questionId, {
          answer: mark.answer,
          reply: mark.reply,
          answeredAt,
          saved: mark.answeredAt !== null,
          attemptId: mark.answeredAt !== null ? mark.attemptId : null,
          ...(mark.verdict ? { verdict: mark.verdict } : {}),
          recallAfterDays: mark.recallAfterDays,
        });
        return { key, byQuestion, known: true };
      });
    },
    [slug],
  );

  /**
   * The read itself — the parse, the "none yet" branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is
   * set: false means this reply is about an article, or an artefact, the hook
   * has since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    const started = begin();
    try {
      /* The header asks for "no questions yet" as `200 null` rather than a
         404, which a browser prints in red on every ordinary page load
         (`NONE_YET_AS_NULL_HEADER`, src/types.ts). A 404 is still read the
         same way, for a server that has not heard of the header — the minutes
         of a deploy. */
      const res = await apiFetch(`/api/quiz/${encodeURIComponent(slug)}`, {
        headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
      });
      if (!current()) return;
      const loaded = res.status === 404 ? null : await readJson<QuizResponse | null>(res);
      if (!current()) return;
      if (loaded === null) {
        /* The ordinary case, and here the commonest by some distance: `quiz` is
           off `DEFAULT_INGEST_STEPS`, so most articles have never had questions
           written. This is what the panel's button is for. */
        setQuiz(null);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setFromServer(NOTHING_KEPT);
        landed(started, res, null);
        setError(null);
        saidNoneFor.current = slug;
        setStatus("none");
        return;
      }
      /* Derive before publishing: a malformed revalidation keeps the old batch. */
      if (!loaded?.quiz || !Array.isArray(loaded.quiz.questions) || typeof loaded.quiz.batchId !== "string") {
        /* A `MalformedReply`, so the reader gets `PAGE_FAULT` like every other
           malformed artefact (tests/read-error-matrix.test.tsx): a reply of
           the wrong shape is this app's bug, not something to "try again". */
        throw new MalformedReply("the quiz reply has no questions");
      }
      const profiled = loaded.quiz.profileHash != null;
      setQuiz(loaded.quiz);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null`, as useIdeas.ts: absent (written before 261002f) and `null`
         (written for nobody) both mean no badge. */
      setProfiled(profiled);
      setProfileChanged(loaded.profileChanged);
      /* With the batch it is about, in the same commit as the batch. */
      const key = keptKey(slug, loaded.quiz.batchId);
      const theirs = keptFromServer(loaded.attempts);
      setFromServer((was) =>
        theirs
          ? { key, byQuestion: theirs, known: true }
          : was.key === key
            ? was
            : { key, byQuestion: new Map(), known: false },
      );
      landed(started, res, loaded.quiz.batchId);
      setError(null);
      saidNoneFor.current = null;
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
      setStatus((was) => (was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"));
    }
  }, [slug, begin, landed]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with
     every other artefact reader — this one lost that race until 2026-09-02
     (tests/artefact-read-race.test.tsx). */
  const { reload, refresh: orderedRefresh } = useOrderedRead(load);
  /**
   * **Two listeners, one read when they hear the same completion.** The
   * always-mounted read hears every announced Quiz completion, while the
   * mounted Quiz band or margin hook also owns the exact job it started. The
   * latter is what catches a very fast job already `done` on the engine's first
   * list; the former is what still hears it after that surface unmounts.
   *
   * Both callbacks run in the same React effect turn for an ordinary
   * completion. Passing `orderedRefresh` to both would make its second call arm
   * a trailing GET. Coalesce only that turn: clear the latch before the real
   * refresh starts, so a genuinely later completion while its GET is in flight
   * still asks `useOrderedRead` for the required trailing read.
   */
  const queuedRefresh = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (queuedRefresh.current) return queuedRefresh.current;
    const next = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        queuedRefresh.current = null;
        void orderedRefresh().then(resolve, reject);
      });
    });
    queuedRefresh.current = next;
    return next;
  }, [orderedRefresh]);
  /* A run that finishes after the reader left the Learn band still reaches the
     questions in the prose. This read was hoisted two days before its three
     siblings were given the line (e039d2acd) and was missed until 2026-10-06.
     useBibliography.ts § An always-mounted read is not an always-fresh read. */
  useStepFinished(slug, "quiz", refresh);

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

  /* **Per question, whichever answer is later.** This visit's wins a tie: it
     is the same row the server will describe on its next read. */
  const batchKey = quiz ? keptKey(slug, quiz.batchId) : null;
  const kept = useMemo(() => {
    const out = new Map<QuizQuestionId, KeptAnswer>();
    if (batchKey === null) return out;
    if (fromServer.key === batchKey) for (const [id, theirs] of fromServer.byQuestion) out.set(id, theirs);
    if (thisVisit.key === batchKey) {
      for (const [id, mine] of thisVisit.byQuestion) {
        const theirs = out.get(id);
        if (!theirs || Date.parse(mine.answeredAt) >= Date.parse(theirs.answeredAt)) out.set(id, mine);
      }
    }
    return out;
  }, [batchKey, fromServer, thisVisit]);
  const keptUnread = batchKey !== null && fromServer.key === batchKey && !fromServer.known;

  /* `claimMark`: a ref, for `live`'s reason in `useQuizMark` — a double press
     lands before any state would. */
  const marking = useRef(new Set<string>());
  const claimMark = useCallback((batchId: string, questionId: QuizQuestionId) => {
    const key = `${batchId}\n${questionId}`;
    if (marking.current.has(key)) return null;
    marking.current.add(key);
    return () => {
      marking.current.delete(key);
    };
  }, []);

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
    kept,
    keptUnread,
    noteMark,
    claimMark,
  };
}

/**
 * The band's half: the job, the verbs and the marks. `read` comes from
 * `useQuizRead` in `OwnedReader` — see `QuizRead` for why the fetch moved up.
 */
/**
 * **Write the questions when the margin is shown and there are none** —
 * Greg, 2026-10-29 (spya-fytjtf): *"let's say the quiz mode does run as one
 * of the default modes whenever you open marginalia mode"*. The relation
 * words' rule (useRelations.ts): `useAutoRunOnArrival`, one unforced attempt
 * per article per page load, whatever put the column there, and only while
 * the notes are on screen (`shown`), so a window too narrow for them buys
 * nothing.
 *
 * **Only `none` runs.** A stale quiz is the band's to rewrite, as it is
 * today, and an outdated one stays: a rewrite mints a new batch, and the
 * answers the reader has given stop showing (quiz.md § Answers are kept).
 * About $0.17–0.24 an article, measured on production's ledger on
 * 2026-10-29 (plan 261029c). Owner only: the one caller is `OwnerMarginFeed`.
 * Quiet, as the relations job is: the column stays open as long as somebody
 * reads, and the read's `refresh` brings the questions in when it finishes.
 */
export function useQuizOnShow(slug: string, read: QuizRead, shown: boolean): void {
  const { status, reload, refresh } = read;
  /* The job hook must refresh too: unlike `useStepFinished`, it reconciles the
     exact job it started even when that job is already done on the engine's
     first list. `useQuizRead.refresh` coalesces the ordinary case where both
     listeners hear the same completion, so this does not add a trailing GET. */
  const queue = useStepJob(slug, "quiz", refresh, "quiet");
  const ensure = useCallback(async () => {
    await queue.start();
  }, [queue]);
  useAutoRunOnArrival(slug, "quiz", shown ? status : "loading", ensure, reload);
}

/** One question's marking, as `useQuizMark` hands it out. */
export interface QuizMark {
  /** `UseQuiz.attempt`. */
  attempt: Attempt | null;
  /** `UseQuiz.showKept`. */
  showKept(questionId: QuizQuestionId): void;
  /** `UseQuiz.mark`. */
  mark(questionId: QuizQuestionId, answer: string): Promise<void>;
  /** `UseQuiz.clearAttempt`. */
  clearAttempt(): void;
}

/**
 * **Marking one answer at a time, and nothing else** — the half of `useQuiz`
 * that the margin needs too (plan 261029i: Greg, spya-jzgrua, *"avoid having
 * to jump away from marginalia mode to the learn mode"*).
 *
 * Its own hook rather than `useQuiz` mounted in the margin, because `useQuiz`
 * re-reads on mount and follows the job queue at its watching cadence, and the
 * margin's mount must cost nothing (marginalia.md). Each caller holds its own
 * attempt and its own live request; what they share is `read`, whose
 * `noteMark` merges a finished mark into the one `kept`, so an answer given in
 * the margin is ticked in the band and the other way round.
 */
/** The part of `QuizRead` marking needs — all the margin's context carries (plan 261029i, Sol F4). */
export type QuizMarkSource = Pick<QuizRead, "quiz" | "kept" | "noteMark" | "refresh" | "claimMark">;

export function useQuizMark(slug: string, read: QuizMarkSource): QuizMark {
  const { quiz, kept, noteMark, refresh, claimMark } = read;
  const [attempt, setAttempt] = useState<Attempt | null>(null);

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

  const showKept = useCallback(
    (questionId: QuizQuestionId) => {
      const one = kept.get(questionId);
      /* A mark in flight owns the attempt; the panel asks only when there is
         none, and this is the same refusal `mark` makes, from the other side. */
      if (!one || live.current) return;
      setAttempt({
        questionId,
        answer: one.answer,
        status: "done",
        reply: one.reply,
        error: null,
        restored: true,
        ...(one.saved ? {} : { notSaved: true as const }),
        ...(one.attemptId !== null ? { attemptId: one.attemptId } : {}),
      });
    },
    [kept],
  );

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

      /* **Not while the same question is being marked elsewhere on the page**
         — the band and the margin both answer since plan 261029i. Said, not
         swallowed: a press that does nothing reads as a dead button. */
      const release = claimMark(batchId, questionId);
      if (!release) {
        live.current = null;
        setAttempt({
          questionId,
          answer,
          status: "failed",
          reply: "",
          error: "This question is already being marked elsewhere on the page. Its mark will be here when it lands.",
          claimedElsewhere: true,
        });
        return;
      }

      setAttempt({ questionId, answer, status: "marking", reply: "", error: null });

      /* What has arrived so far, held here because the stream reader throws
         only an error and the catch below still owes the reader the half they
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
        const { reply, verdict, answeredAt, attemptId, recallAfterDays } = await readAnswerStream(
          res.body,
          {
            delta: (text) => {
              partial = text;
              setAttempt({ questionId, answer, status: "marking", reply: text, error: null });
            },
            done: (data) => {
              const sent = data as {
                reply?: unknown;
                verdict?: unknown;
                answeredAt?: unknown;
                attemptId?: unknown;
                kept?: unknown;
                recallAfterDays?: unknown;
              } | null;
              /* **Stored only if the server gave the row's time and did not
                 say otherwise.** `kept: false` is the save having failed; a
                 `done` with no `answeredAt` at all is a server from before
                 2026-10-05, which stored nothing — and saying "saved" for
                 either would be a promise the next reload breaks. */
              const at = sent?.answeredAt;
              const answeredAt =
                sent?.kept !== false && typeof at === "string" && !Number.isNaN(Date.parse(at))
                  ? at
                  : null;
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
              /* The row's id, only beside a stored row's time. */
              const id = sent?.attemptId;
              const attemptId = answeredAt !== null && typeof id === "string" && id !== "" ? id : null;
              return {
                reply: typeof whole === "string" && whole.trim() ? whole : partial,
                verdict,
                answeredAt,
                attemptId,
                /* Through the same parser as the read's (Sol's F4): a `done`
                   from a server before 261030c has none, and `undefined`
                   would make the question never due. A mark not stored has
                   no history, so the neutral three days. */
                recallAfterDays: answeredAt !== null ? parseRecallAfterDays(sent?.recallAfterDays) : RECALL_AFTER_DAYS,
              };
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
          ...(answeredAt === null ? { notSaved: true as const } : {}),
          ...(attemptId !== null ? { attemptId } : {}),
        });
        /* **The tick, and what Next → Previous puts back** — stored or not: a
           mark the reader watched finish is theirs for this visit either way. */
        noteMark(batchId, questionId, {
          answer,
          reply,
          answeredAt,
          attemptId,
          recallAfterDays,
          ...(verdict ? { verdict } : {}),
        });
        if (answeredAt !== null) {
          /* **Read the quiz again, behind the screen, because the offline copy
             of it is now out of date.** `apiFetch` deliberately does not throw
             the cached `GET /api/quiz/<slug>` away on a mark — answering a
             question must not cost the reader the questions
             (lib/api.ts § `LEAVE_CACHED_RESOURCE_CURRENT`) — so without this a
             reload with no network would bring the quiz back unanswered. A
             successful GET rewrites the copy, with the answer in it. Only
             after a mark that was stored: a failed one changed nothing on the
             server. `refresh` trails a read already out rather than joining
             it, since that one may have left before the save. F1 and F2. */
          void refresh();
        }
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
          error: describeFetchFailure(err as Error),
        });
      } finally {
        release();
        if (live.current === controller) live.current = null;
      }
    },
    [quiz?.batchId, slug, noteMark, refresh, claimMark],
  );

  return { attempt, showKept, mark, clearAttempt };
}

export function useQuiz(slug: string, read: QuizRead): UseQuiz {
  const { status, quiz, stale, outdated, profiled, profileChanged, error, reload, refresh } = read;
  const { kept } = read;
  /* **Derived, not kept** — until 2026-10-05 this was a set of its own, added
     to on `done` and emptied on a new batch. `kept` is scoped to the batch on
     screen already (a replacement batch can reuse question ids with new
     meanings: GPT Sol's plan review, 260930i finding 6), so the tick and the
     restored answer cannot disagree. */
  const answered = useMemo(() => new Set(kept.keys()), [kept]);

  /* **Revalidate on mount, behind whatever is on screen** — `useQuotes`' reason:
     `useStepJob`'s first poll is a baseline and does not announce a job that had
     already finished, so a batch written in another tab while the band was
     closed has nothing else to bring it in. `reload` joins a read in flight and
     never returns `status` to `loading`. */
  useEffect(() => {
    void reload();
  }, [reload]);

  const batchId = quiz?.batchId;

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

     The press is minted by Learn's own sub-mode toggle (App.tsx §
     `LearnBand`), not by the `?learn=` setter beside it — Back and Forward
     move that, and retracing your steps must not buy a model call. */
  useAutoRun(slug, "quiz", status, ensure, reload);

  /* **Marking is `useQuizMark`'s** — the margin answers questions too (plan
     261029i), and it must not take the job subscription above with it. */
  const { attempt, showKept, mark, clearAttempt } = useQuizMark(slug, read);

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
    kept,
    keptUnread: read.keptUnread,
    showKept,
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
