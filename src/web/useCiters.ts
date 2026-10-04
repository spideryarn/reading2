/**
 * **Which papers cite this article**, for Reception's *Cited by* — one `GET
 * /api/citers/:slug`, and nothing else.
 *
 * **It can never start the paid search.** There is no job here, no `useAutoRun`
 * and no POST: the list comes from OpenAlex, costs nothing, and is fetched and
 * cached apart from the stored Debate. That is why it is its own hook rather
 * than a field on `useDebate`, whose automatic run is the dearest press in the
 * app to make by accident (src/web/useDebate.ts).
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * **Asked once per article, the first time it is wanted** — when Reception is
 * on screen — and kept while the band stays mounted, so going to Claims and
 * back asks nothing. `retry` is the *Try again* beside the one outcome worth
 * trying again.
 *
 * **Every failure of the request is `unavailable`.** The route answers each of
 * its own outcomes with a 200; anything else (a dropped connection, a 5xx, a
 * session that lapsed, a 200 that is not one of those outcomes) is, to the
 * reader, the same "we could not get it just now", with the same button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CitersResult } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useOrderedRead } from "./useOrderedRead.js";

export interface UseCiters {
  /** The answer, or `null` while it is being fetched (or has not been wanted yet). */
  result: CitersResult | null;
  /** Ask again, after `unavailable`. */
  retry(): void;
}

const UNAVAILABLE: CitersResult = { kind: "unavailable" };

/**
 * **Is this one of the route's answers?** The panel switches exhaustively on
 * `kind` and maps over `citers`, so a 200 carrying anything else (an older
 * server, a proxy's page, a test stub's `{}`) would throw while drawing and
 * take the whole Debate band with it. Checked once here, as far as the panel
 * reads: the kind, and for a list its four numbers, its date and that the list
 * is one. Each citer's own fields are the server's, bounded where they were
 * parsed.
 */
function asCitersResult(value: unknown): CitersResult | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  switch (body.kind) {
    case "no-doi":
    case "not-indexed":
    case "unconfirmed":
    case "unavailable":
    case "too-large":
      return { kind: body.kind };
    case "found":
      return typeof body.count === "number" &&
        typeof body.returned === "number" &&
        typeof body.dropped === "number" &&
        typeof body.capped === "boolean" &&
        typeof body.fetchedAt === "string" &&
        Array.isArray(body.citers)
        ? (value as CitersResult)
        : null;
    default:
      return null;
  }
}

/**
 * @param wanted whether the section is on screen. Nothing is fetched until it
 *   first is.
 */
export function useCiters(slug: string, wanted: boolean): UseCiters {
  /* Kept with the slug it answers, so an article change shows the spinner
     rather than the last article's list while the new one loads. */
  const [answer, setAnswer] = useState<{ slug: string; result: CitersResult } | null>(null);

  const load = useCallback(
    async (current: () => boolean) => {
      let result: CitersResult;
      try {
        const body = await readJson<unknown>(await apiFetch(`/api/citers/${encodeURIComponent(slug)}`));
        result = asCitersResult(body) ?? UNAVAILABLE;
      } catch {
        result = UNAVAILABLE;
      }
      if (current()) setAnswer({ slug, result });
    },
    [slug],
  );

  /* An ordinary `reload` joins a read already in flight, and only the newest
     reply may commit — src/web/useOrderedRead.ts, shared with the artefact
     readers. */
  const { reload } = useOrderedRead(load);

  /* A ref rather than state: React's StrictMode runs this effect twice inside
     one commit, and the second run must find the first one's mark. */
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!wanted || askedFor.current === slug) return;
    askedFor.current = slug;
    void reload();
  }, [wanted, slug, reload]);

  const retry = useCallback(() => {
    setAnswer(null);
    void reload();
  }, [reload]);

  return { result: answer?.slug === slug ? answer.result : null, retry };
}
