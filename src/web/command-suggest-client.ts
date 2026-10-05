/**
 * **The command bar asking for a short list from why you are reading** — the
 * one post to `POST /api/command-suggest/:slug`, the reply re-read as
 * carefully as the server read the model (src/command-suggest.ts §
 * `readSuggestAnswer`), and the read that tells the bar whether there is a
 * reason to work from at all. Plan 261005k, Stage 2 (B).
 *
 * Its own module for command-pick-client.ts's reason: the bar's component
 * holds no `fetch`, and the tests that drive the bar stand at the network.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type SuggestAnswer,
  type SuggestRequest,
  commandSuggestPath,
  readFromHash,
  readSuggestAnswer,
} from "../command-suggest.js";
import { PROVIDER_UNREADABLE } from "../messages.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { onProfileSaved, profileGeneration } from "./profile-saved.js";

/** The answer, or the sentence to show under the box. A failure here can always be tried again. */
export type SuggestReply =
  | { readonly ok: true; readonly answer: SuggestAnswer }
  | { readonly ok: false; readonly message: string };

/**
 * Ask once. **Unlike the pick, a failure has its own sentence**: the pick
 * falls back on the bar's own list, and this has no fallback, so the reader is
 * told what happened in the server's words (docs/project/copy.md) and the row
 * is still there to press again.
 */
export async function askForSuggestions(slug: string, request: SuggestRequest, signal: AbortSignal): Promise<SuggestReply> {
  try {
    const json = await readJson<unknown>(
      await apiFetch(commandSuggestPath(slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      }),
    );
    const answer = readSuggestAnswer(json, request);
    return answer === null ? { ok: false, message: PROVIDER_UNREADABLE.message } : { ok: true, answer };
  } catch (err) {
    return { ok: false, message: describeFetchFailure(err as Error) };
  }
}

/**
 * **Whether this article has a reason for reading, as last read**, and the
 * fingerprint of what a suggestion would be written from.
 *
 *  - `unknown`: not read yet. Nothing is offered until the read answers.
 *  - `none`: read, and there is no reason.
 *  - `failed`: the shelf could not be read; show the retry explanation.
 *  - `has`: there is one; `readFrom` is `readFromHash` of both boxes as
 *    stored, the value the server sends with a list.
 */
export type ReasonRead =
  | { readonly state: "unknown" }
  | { readonly state: "none" }
  | { readonly state: "failed" }
  | { readonly state: "has"; readonly readFrom: string };

const UNKNOWN: ReasonRead = { state: "unknown" };

/**
 * Read it for `slug` (`undefined`: nowhere to suggest from, so nothing is
 * read) — **when the bar is mounted, every time it opens, and after every
 * save in this tab** (profile-saved.ts). `usePurpose` in purpose.ts reads once
 * per slug, which is right for a line of text and not enough here (GPT Sol's
 * F3): the bar must stop offering a list written from words the reader has
 * since changed.
 *
 * On mount as well as on opening, so the row is already there when the bar
 * first opens rather than arriving under the reader's Enter. The last answer
 * stands while a newer read is out.
 *
 * `saves` is this tab's save count, handed back so the bar can tell that a
 * save happened while its own request was out.
 *
 * `version()` captures the profile-read ordering when a suggestion starts.
 * `heard(readFrom, version)` adopts its snapshot only if no later read began.
 * The server reads the profile before waiting for the model: a late response
 * cannot overwrite a reopening read made after a save in another tab.
 * `null` says the server successfully read an empty reason.
 */
export function useReasonForReading(
  slug: string | undefined,
  open: boolean,
): { reason: ReasonRead; saves: number; version(): number; heard(readFrom: string | null, version: number): void } {
  const saves = useSyncExternalStore(onProfileSaved, profileGeneration, profileGeneration);
  const [read, setRead] = useState<{ key: string; reason: ReasonRead } | null>(null);
  const asked = useRef<string | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    if (slug === undefined) return;
    const key = `${slug}\n${saves}`;
    /* Shut and already read for this article and these saves: nothing new to learn. */
    if (!open && asked.current === key) return;
    asked.current = key;
    const mine = ++latest.current;
    void apiFetch(`/api/reader?slug=${encodeURIComponent(slug)}`)
      .then((r) => readJson<{ profile?: string | null; purpose?: string | null; purposeFailed?: boolean }>(r))
      .then((body): ReasonRead => {
        /* Failed is not empty: the reader must see why suggestions could
           not be offered, and have a press that retries the server read. */
        if (body.purposeFailed) return { state: "failed" };
        const purpose = typeof body.purpose === "string" && body.purpose !== "" ? body.purpose : null;
        const profile = typeof body.profile === "string" && body.profile !== "" ? body.profile : null;
        return purpose === null ? { state: "none" } : { state: "has", readFrom: readFromHash({ profile, purpose }) };
      })
      .catch((): ReasonRead => ({ state: "failed" }))
      .then((reason) => {
        /* Only the newest read speaks: an older one landing late would put
           back a reason the reader has since cleared. */
        if (mine === latest.current) setRead({ key, reason });
      });
  }, [slug, open, saves]);
  /* A read for another article, or from before a save, says nothing about now. */
  const current = slug !== undefined && read !== null && read.key === `${slug}\n${saves}` ? read.reason : UNKNOWN;
  const heard = useCallback(
    (readFrom: string | null, version: number) => {
      if (slug === undefined || version !== latest.current) return;
      /* Only reads begun before this suggestion may be superseded. */
      latest.current += 1;
      setRead({ key: `${slug}\n${profileGeneration()}`, reason: readFrom === null ? { state: "none" } : { state: "has", readFrom } });
    },
    [slug],
  );
  const version = useCallback(() => latest.current, []);
  return { reason: current, saves, version, heard };
}
