/**
 * **The client half of Hidden text's Opus check** — plan
 * docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md.
 *
 * `useMirror`'s shape, copied rather than improved: one button, one run at a
 * time, aborted when the article changes, and a run's `"done"` reached
 * from the `done` frame and from nowhere else — a body that simply stops is a
 * failure, because a stream can end by stopping and that looks exactly like
 * finishing (docs/project/comments.md § streaming). src/web/useMirror.ts says
 * each of those at length.
 *
 * **Held by `RefereeBand`, beside the scan**, not by the Hidden text panel: the
 * answer is about the scan's rows, and switching chips must not throw it away
 * (or the referee pays again).
 *
 * **Kept since 2026-10-09** (docs/plans/261009a-save-hidden-text-opinions.md):
 * the server saves each finished answer, and this hook reads it back when the
 * article opens, so a reload shows the same lines. A failed read is silent —
 * the button still works, and there is nothing the referee could do about it.
 *
 * A `delta` carries a character count and no text, because nothing is shown
 * until the whole answer has been validated on the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { StoredHiddenCheck } from "../referee-hidden-check-types.js";
import { apiFetch, failure } from "./lib/api.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export type HiddenCheckStatus = "idle" | "running" | "done" | "failed";

export interface HiddenCheckApi {
  status: HiddenCheckStatus;
  /** Characters of the model's answer so far: 0 while it is still reading. */
  chars: number;
  /** The finished check — this visit's, or the one kept from before — or `null`. */
  result: StoredHiddenCheck | null;
  error: string | null;
  /** Ask Opus. Refuses to start a second while one runs. */
  ask(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Check every field the panel reads before treating a transport value as an answer. */
function isResult(value: unknown): value is StoredHiddenCheck {
  if (!isObject(value) || !Array.isArray(value.judgments) ||
      typeof value.checkedAt !== "string" || Number.isNaN(Date.parse(value.checkedAt)) ||
      (value.saved !== undefined && value.saved !== false) ||
      !isCount(value.unanswered) || !isCount(value.notSent) || value.notSent > value.unanswered ||
      typeof value.model !== "string") return false;
  return value.judgments.every((judgment: unknown) => {
    if (!isObject(judgment) || !isObject(judgment.row)) return false;
    const row = judgment.row;
    return typeof row.key === "string" &&
      Array.isArray(row.paths) && row.paths.every((p: unknown) => typeof p === "string") &&
      isCount(row.count) && row.count > 0 && isCount(row.totalPaths) &&
      row.totalPaths >= row.paths.length && row.totalPaths <= row.count &&
      (judgment.verdict === "probably-harmless" || judgment.verdict === "worth-a-look") &&
      typeof judgment.reason === "string" && judgment.reason.trim() !== "";
  });
}

/** Zero or more `delta`, then exactly one `done` or `error`; anything else is a failure. */
async function readRun(
  body: ReadableStream<Uint8Array>,
  onChars: (chars: number) => void,
): Promise<StoredHiddenCheck> {
  for await (const event of readEvents(body, { stallMs: STREAM_STALL_MS })) {
    if (event.name === "delta") {
      const chars = (event.data as { chars?: unknown } | null)?.chars;
      if (typeof chars === "number") onChars(chars);
      continue;
    }
    if (event.name === "done") {
      /* Checked rather than cast: a `done` from a server that has moved on
         must not crash the panel or draw an unknown verdict as harmless. */
      if (isResult(event.data)) return event.data;
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
  const [result, setResult] = useState<StoredHiddenCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* A ref, so a second press in the same frame cannot buy a second call. */
  const live = useRef<AbortController | null>(null);
  /* The read of the kept answer, so a press can cancel it: the run's answer is newer. */
  const reading = useRef<AbortController | null>(null);

  useEffect(() => {
    setStatus("idle");
    setChars(0);
    setResult(null);
    setError(null);
    /* The kept answer, if there is one. */
    const read = new AbortController();
    reading.current = read;
    void (async () => {
      try {
        const r = await apiFetch(url(slug), { signal: read.signal });
        if (!r.ok) return;
        const check = ((await r.json()) as { check?: unknown } | null)?.check;
        if (read.signal.aborted || !isResult(check)) return;
        setResult(check);
        setStatus("done");
      } catch {
        /* Silent: see the header. */
      }
    })();
    return () => {
      read.abort();
      live.current?.abort();
      live.current = null;
    };
  }, [slug]);

  const ask = useCallback(() => {
    if (live.current) return;
    reading.current?.abort();
    const control = new AbortController();
    live.current = control;
    setStatus("running");
    setChars(0);
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
