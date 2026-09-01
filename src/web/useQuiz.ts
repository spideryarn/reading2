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
import type { Job, Quiz, QuizQuestionId, QuizResponse } from "../types.js";
import { useStepJob } from "./useStepJob.js";
import { apiFetch, readJson } from "./lib/api.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";

type QuizStatus = "loading" | "none" | "ready" | "error";

/**
 * **The terminal contract, in one function.**
 *
 * Zero or more `delta` frames, then exactly one terminal frame — `done` or
 * `error`. Anything else that ends the body is a failure, including the body
 * simply ending, which is the case the whole design is arranged against: a
 * provider or a socket that stops cleanly looks **exactly** like one that
 * finished, and from inside a `for await` the two are the same event.
 *
 * Extracted from `mark` below so that the rule is readable on its own and so
 * that `finished` cannot be set from two places. Returns the whole reply;
 * throws, with whatever partial text arrived carried on the error, otherwise.
 */
class MarkStopped extends Error {
  /** What had arrived before it stopped. The reader has already read it. */
  readonly partial: string;
  constructor(message: string, partial: string) {
    super(message);
    this.name = "MarkStopped";
    this.partial = partial;
  }
}

async function readMark(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<string> {
  let text = "";
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "delta") {
      const piece = (event.data as { text?: unknown }).text;
      if (typeof piece === "string" && piece) {
        text += piece;
        onDelta(text);
      }
      continue;
    }
    if (event.name === "done") {
      const reply = (event.data as { reply?: unknown }).reply;
      /* The server's own whole reply where it sent one, because it is the
         trimmed text and the deltas are not. Falling back to the accumulator
         rather than trusting the field blindly, so a malformed `done` still
         hands back what the reader watched arrive. */
      return typeof reply === "string" && reply.trim() ? reply : text;
    }
    if (event.name === "error") {
      const message = (event.data as { error?: unknown }).error;
      throw new MarkStopped(
        typeof message === "string" && message
          ? message
          : "The mark stopped before it was finished.",
        text,
      );
    }
  }
  /* **The case a mocked complete transcript cannot reach.** The body ended
     cleanly with no terminal frame in it — a provider that stopped, an instance
     that was killed, a proxy that closed. */
  throw new MarkStopped(
    "The reply stopped arriving before it was finished. Nothing was lost — try again.",
    text,
  );
}



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
  status: MarkStatus;
  /** What has arrived so far. Kept on failure — the reader has already read it. */
  reply: string;
  /** Why it stopped badly, if it did. */
  error: string | null;
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
  failed: string | null;
  /** The attempt in front of the reader, or null before they have answered anything. */
  attempt: Attempt | null;
  /** Which questions have been marked to a `done` this session. Never persisted. */
  answered: ReadonlySet<QuizQuestionId>;
  /**
   * Write the questions — the only verb on the artefact. `force` is passed
   * always, for the reason `useIdeas.find` gives: the button is offered beside
   * a list that is current, so an unforced run would skip and the reader would
   * watch a job start and finish having changed nothing.
   */
  write(): Promise<void>;
  cancel(id: string): void;
  /** Mark one answer. Resolves when the stream ends, however it ends. */
  mark(questionId: QuizQuestionId, answer: string): Promise<void>;
  /** Throw away the attempt on screen, so the reader can answer again. */
  clearAttempt(): void;
}

export function useQuiz(slug: string): UseQuiz {
  const [status, setStatus] = useState<QuizStatus>("loading");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answered, setAnswered] = useState<Set<QuizQuestionId>>(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/quiz/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        /* The ordinary case, and here the commonest by some distance: `quiz` is
           off `DEFAULT_INGEST_STEPS`, so most articles have never had questions
           written. This is what the panel's button is for. */
        setQuiz(null);
        setStale(false);
        setOutdated(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<QuizResponse>(res);
      setQuiz(loaded.quiz);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      /* **A failed revalidation must not take the questions away.** `load` is
         not only the opening read — `onFinished` calls it again every time a
         job finishes — and the panel renders under `status === "ready"`, so an
         unconditional `error` here would let a flaky connection blank a list
         that was still perfectly good. Same guard, same reason, as
         useTimeline.ts and useIdeas.ts. */
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The job half — the poll, the running job, and what a refused or dead run
     says to the reader — is src/web/useStepJob.ts, shared with the glossary,
     the summaries, the ideas and the timeline. */
  const queue = useStepJob(slug, "quiz", load);

  const write = useCallback(async () => {
    await queue.start({
      /* **Always forced**, for `useIdeas.find`'s reason: the button is offered
         beside questions that are current, so an unforced run would skip and
         the reader would watch a job start and finish having changed nothing.
         Forcing is safe because this step replaces rather than appends.

         It also mints a new `batchId`, which is deliberate and is why the mark
         route answers 409 rather than falling forward: the reference answers
         have genuinely been rewritten. */
      force: true,
    });
  }, [queue]);

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
          status: "failed",
          reply: "",
          error: "There are no questions loaded to mark this against.",
        });
        return;
      }

      setAttempt({ questionId, status: "marking", reply: "", error: null });

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
          throw new Error(`The server replied ${res.status}.`);
        }
        /* **The reply is what `readMark` returns**, and it returns only on a
           `done` frame. There is no other road to the two lines below, which is
           the whole of the terminal contract as the client keeps it. */
        const reply = await readMark(res.body, (text) =>
          setAttempt({ questionId, status: "marking", reply: text, error: null }),
        );
        setAttempt({ questionId, status: "done", reply, error: null });
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
          status: "failed",
          reply: err instanceof MarkStopped ? err.partial : "",
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
    failed: queue.failed,
    attempt,
    answered,
    write,
    cancel: queue.cancel,
    mark,
    clearAttempt,
  };
}
