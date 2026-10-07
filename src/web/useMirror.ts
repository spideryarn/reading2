/**
 * The client half of Mirror — Stage 5b of
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md.
 *
 * One button, one run, nothing stored. `useCriteria.ts` beside it is the
 * complicated one because a criterion is a saved row that can be re-run,
 * deleted, recoloured and streamed into; a Mirror run is none of those. It is
 * `useQuiz`'s `mark` — a stream you wait on once — and the pieces copied are
 * that hook's, deliberately, rather than better ones.
 *
 * ## The terminal contract, which is the whole of why `ask` is careful
 *
 * *Streamed and stateless* is not a contract. A provider or a socket can stop
 * cleanly without finishing, and from inside a `for await` that is
 * indistinguishable from finishing — docs/reusable/silent-success.md, and
 * docs/project/comments.md § streaming. So the server sends zero or more
 * `delta` frames and then **exactly one** terminal frame, `done` or `error`,
 * and this hook reaches `"done"` from the `done` frame and from nowhere else. A
 * body that ends with neither leaves the run `"failed"` and retryable.
 *
 * **That matters more here than almost anywhere else in this app**, because
 * Mirror's correct answer is usually an empty list. A stream that stopped after
 * two bytes and a run that found nothing to raise produce the same thing on
 * screen unless the hook insists on being told which it was.
 *
 * ## A `delta` carries no text, and this hook shows none
 *
 * What the model is streaming is one raw JSON object whose pointers have not
 * been checked yet, so the server sends only how many characters have arrived
 * (src/routes.ts § `runMirror`). All this hook does with it is set `writing`,
 * which is the difference between *waiting* and *being answered* — the one
 * thing streaming buys a call with no incremental extractor behind it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { MirrorResult } from "../referee-mirror-types.js";
import { apiFetch, failure } from "./lib/api.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

/**
 * Where one run has got to.
 *
 * A single value rather than a `running` boolean beside a `failed` string, for
 * `MarkStatus`'s reason in src/web/useQuiz.ts: two fields is two fields an edit
 * can set one of. `"done"` is reached from the `done` frame and nowhere else.
 */
export type MirrorStatus = "idle" | "running" | "done" | "failed";

export interface MirrorApi {
  status: MirrorStatus;
  /**
   * Has the model started producing output?
   *
   * Not what it is producing — see the header. This is the flag that lets the
   * panel say "answering" rather than "reading", which is the whole of what a
   * `delta` frame is for here.
   */
  writing: boolean;
  /**
   * The finished run, or `null`.
   *
   * **`remarks: []` is a real, complete answer** and must never be treated as
   * an absence — `MirrorResult` says so where the type is declared, and it is
   * the commonest answer this feature has.
   */
  result: MirrorResult | null;
  /** Why the run stopped badly, if it did. */
  error: string | null;
  /** Read my comments back to me. Refuses to start a second while one runs. */
  ask(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === "string";

/** A comment the panel quotes back: `id` to find it, `quote` and `body` to print. */
function isComment(value: unknown): boolean {
  return isObject(value) && typeof value.id === "string" && typeof value.blockId === "string" &&
    typeof value.quote === "string" && isOptionalString(value.body);
}

/**
 * One remark, with what its kind draws. A kind this copy does not know is
 * allowed through — the badge reads it with `ownLabel` — but only with what
 * every non-coverage row reads: the comment it is about and the block to jump to.
 */
function isRemark(value: unknown): boolean {
  if (!isObject(value) || typeof value.kind !== "string" || typeof value.note !== "string" ||
      typeof value.trialTested !== "boolean") return false;
  // Known kinds carry literal evidence flags; accepting the opposite would
  // lend the trial's authority to a kind it never tested. New kinds still use
  // their own boolean, just as their badge uses their own name.
  if ((value.kind === "specificity" || value.kind === "tone" || value.kind === "misunderstanding") &&
      value.trialTested !== true) return false;
  if ((value.kind === "coverage" || value.kind === "placement") && value.trialTested !== false) return false;
  if (value.kind === "coverage") return typeof value.criterion === "string";
  if (typeof value.commentId !== "string" || typeof value.blockId !== "string") return false;
  if (value.kind === "misunderstanding") return typeof value.passage === "string";
  if (value.kind === "placement") {
    return typeof value.passage === "string" && typeof value.valence === "number" &&
      Number.isFinite(value.valence) && isOptionalString(value.criterion);
  }
  return true;
}

function isCoverage(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.asked === true) return isCount(value.criteriaOmitted);
  return value.asked === false && typeof value.reason === "string";
}

/** Check every field the panel reads before treating a transport value as an answer. */
function isResult(value: unknown): value is MirrorResult {
  if (!isObject(value) || !Array.isArray(value.remarks) || !isObject(value.input) ||
      !isCoverage(value.coverage) || !isCount(value.placementsOmitted) ||
      typeof value.model !== "string") return false;
  const input = value.input;
  return Array.isArray(input.comments) && input.comments.every(isComment) &&
    Array.isArray(input.placements) && input.placements.every(isComment) &&
    isCount(input.skippedBookmarks) && value.remarks.every(isRemark);
}

/**
 * **The terminal contract, in one function**, so that `"done"` cannot be set
 * from two places.
 *
 * Zero or more `delta` frames, then exactly one `done` or `error`. Anything
 * else that ends the body is a failure, **including the body simply ending**.
 */
async function readRun(
  body: ReadableStream<Uint8Array>,
  onWriting: () => void,
): Promise<MirrorResult> {
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "delta") {
      onWriting();
      continue;
    }
    if (event.name === "done") {
      /* **Checked rather than cast**, every field `MirrorPanel` reads, the way
         `isResult` in useHiddenCheck.ts checks its own (GPT Sol's C1 and C4 on
         plan 261007l). A `done` from a server that has moved on must not crash
         the panel on a null remark, nor draw blanks that read as a run that
         found nothing. */
      if (isResult(event.data)) return event.data;
      throw new ReaderFacingError("The run finished with an answer this page could not read. Try again.");
    }
    if (event.name === "error") {
      const message = (event.data as { error?: unknown }).error;
      throw new ReaderFacingError(
        typeof message === "string" && message
          ? message
          : "The run stopped before it was finished.",
      );
    }
  }
  /* **The case a mocked complete transcript cannot reach.** The body ended
     cleanly with no terminal frame in it — a provider that stopped, an instance
     that was killed, a proxy that closed. */
  throw new ReaderFacingError("The run stopped arriving before it was finished. Nothing was lost — try again.");
}

const url = (slug: string) => `/api/referee/mirror/${encodeURIComponent(slug)}`;

export function useMirror(slug: string): MirrorApi {
  const [status, setStatus] = useState<MirrorStatus>("idle");
  const [writing, setWriting] = useState(false);
  const [result, setResult] = useState<MirrorResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The run in flight, so a second press cannot start a second call and leaving
   * the mode cancels the one that is out.
   *
   * A ref rather than state: `ask` must be able to read it synchronously on the
   * click, and a state read would be a frame behind — which is exactly long
   * enough for two presses to buy two model calls.
   */
  const live = useRef<AbortController | null>(null);

  // Switching article throws the run away with the comments it was about.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and a new slug is exactly when one referee's remarks stop describing the paper on screen
  useEffect(() => {
    setStatus("idle");
    setWriting(false);
    setResult(null);
    setError(null);
    return () => {
      live.current?.abort();
      live.current = null;
    };
  }, [slug]);

  const ask = useCallback(() => {
    if (live.current) return;
    const control = new AbortController();
    live.current = control;
    setStatus("running");
    setWriting(false);
    setResult(null);
    setError(null);

    void (async () => {
      try {
        const r = await apiFetch(url(slug), { method: "POST", signal: control.signal });
        /* A failure before the stream opens is ordinary JSON — the server reads
           the article, the comments and the criteria before it writes a header.
           A failure after it opens arrives as an `error` frame, or as the body
           ending, and both are `readRun`'s. */
        if (!r.ok || !r.body) throw await failure(r);
        const run = await readRun(r.body, () => setWriting(true));
        if (control.signal.aborted) return;
        setResult(run);
        setStatus("done");
      } catch (e) {
        /* The referee left the mode or changed article. Nothing failed and
           there is nobody to tell. */
        if (control.signal.aborted) return;
        setError(describeFetchFailure(e as Error));
        setStatus("failed");
      } finally {
        setWriting(false);
        if (live.current === control) live.current = null;
      }
    })();
  }, [slug]);

  return { status, writing, result, error, ask };
}
