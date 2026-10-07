/**
 * **The client half of Hidden text's Opus check** — plan
 * docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md.
 *
 * `useMirror`'s shape, copied rather than improved: one button, one run at a
 * time, nothing stored, aborted when the article changes, and `"done"` reached
 * from the `done` frame and from nowhere else — a body that simply stops is a
 * failure, because a stream can end by stopping and that looks exactly like
 * finishing (docs/project/comments.md § streaming). src/web/useMirror.ts says
 * each of those at length.
 *
 * **Held by `RefereeBand`, beside the scan**, not by the Hidden text panel: the
 * answer is about the scan's rows, and switching chips must not throw it away
 * (or the referee pays again). A reload forgets it.
 *
 * A `delta` carries a character count and no text, because nothing is shown
 * until the whole answer has been validated on the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { HiddenCheckResult } from "../referee-hidden-check-types.js";
import { apiFetch, failure } from "./lib/api.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export type HiddenCheckStatus = "idle" | "running" | "done" | "failed";

export interface HiddenCheckApi {
  status: HiddenCheckStatus;
  /** Characters of the model's answer so far: 0 while it is still reading. */
  chars: number;
  /** The finished check, or `null`. */
  result: HiddenCheckResult | null;
  error: string | null;
  /** Ask Opus. Refuses to start a second while one runs. */
  ask(): void;
}

/** Zero or more `delta`, then exactly one `done` or `error`; anything else is a failure. */
async function readRun(
  body: ReadableStream<Uint8Array>,
  onChars: (chars: number) => void,
): Promise<HiddenCheckResult> {
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "delta") {
      const chars = (event.data as { chars?: unknown } | null)?.chars;
      if (typeof chars === "number") onChars(chars);
      continue;
    }
    if (event.name === "done") {
      const data = event.data as Partial<HiddenCheckResult> | null;
      /* Checked rather than cast: a `done` from a server that has moved on
         would otherwise draw as "Opus checked none of these". */
      if (data && Array.isArray(data.judgments) && typeof data.unanswered === "number") {
        return data as HiddenCheckResult;
      }
      throw new ReaderFacingError("The check finished with an answer this page could not read. Try again.");
    }
    if (event.name === "error") {
      const message = (event.data as { error?: unknown } | null)?.error;
      throw new ReaderFacingError(
        typeof message === "string" && message ? message : "The check stopped before it was finished.",
      );
    }
  }
  throw new ReaderFacingError("The check stopped arriving before it was finished. Nothing was lost — try again.");
}

const url = (slug: string) => `/api/referee/hidden-check/${encodeURIComponent(slug)}`;

export function useHiddenCheck(slug: string): HiddenCheckApi {
  const [status, setStatus] = useState<HiddenCheckStatus>("idle");
  const [chars, setChars] = useState(0);
  const [result, setResult] = useState<HiddenCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* A ref, so a second press in the same frame cannot buy a second call. */
  const live = useRef<AbortController | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — a new slug is a different document, and the old answer is about the old one's rows
  useEffect(() => {
    setStatus("idle");
    setChars(0);
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
    setChars(0);
    setResult(null);
    setError(null);

    void (async () => {
      try {
        const r = await apiFetch(url(slug), { method: "POST", signal: control.signal });
        if (!r.ok || !r.body) throw await failure(r);
        const run = await readRun(r.body, setChars);
        if (control.signal.aborted) return;
        setResult(run);
        setStatus("done");
      } catch (e) {
        if (control.signal.aborted) return;
        setError(describeFetchFailure(e as Error));
        setStatus("failed");
      } finally {
        if (live.current === control) live.current = null;
      }
    })();
  }, [slug]);

  return { status, chars, result, error, ask };
}
