/**
 * **Sources › Not cited's read and its press** — `GET /api/related-work/:slug`
 * for the stored answer, and `POST` for the owner's *Search OpenAlex for
 * related work*. Owner-only: `VisitorSourcesBand` never mounts it, so a
 * visitor asks nothing (tests/public-network-trace.test.tsx).
 * docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md.
 *
 * **The GET never searches.** It is first asked when the Not cited chip is on
 * screen, and asked again when the Bibliography read changes,
 * so a work newly recognised there cannot remain in this list. The answer is
 * otherwise kept while the band stays mounted, so the chip has its number on
 * the way back from another chip. **Only `search()` sends the piece's title and opening to
 * OpenAlex** (the plan's F1), and only from the owner's press.
 *
 * **The press is held from the press until its answer is read** (`searching`):
 * a second press while one is out is ignored here as well as disabled on
 * screen, so one press is one search (F8).
 *
 * **A failed search keeps the list already shown.** `unavailable` or
 * `rate-limited` from a POST over a `found` answer is `failed` beside it, not
 * a replacement: *Search again* failing must not take away the list the
 * reader was reading. With nothing found yet it is the answer itself.
 *
 * **Every failure of a request is `unavailable`**, as useCiters.ts: the route
 * answers each outcome with a 200, and anything else (a dropped connection, a
 * 5xx, a 200 that is not one of the outcomes) is the same "not just now".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { OPENALEX_WORK_ID } from "../citer-link.js";
import type { RelatedWork, RelatedWorkResult } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useOrderedRead } from "./useOrderedRead.js";

/** A search's failure that leaves an earlier list on screen. */
export type RelatedWorkFailure = "unavailable" | "rate-limited";

export interface UseRelatedWork {
  /** The answer, or `null` while the first read is out (or the chip has not been shown). */
  result: RelatedWorkResult | null;
  /** A search that failed over a list still shown; `null` otherwise. */
  failed: RelatedWorkFailure | null;
  /** True from a press on *Search* until its answer is read. */
  searching: boolean;
  /** The owner's press: ask OpenAlex. Ignored while a search is out. */
  search(): void;
  /** *Try again*: the search again if a search failed, else the read. */
  retry(): void;
}

const UNAVAILABLE: RelatedWorkResult = { kind: "unavailable" };

const str = (v: unknown): boolean => typeof v === "string";
const optional = (v: unknown, kind: "string" | "number"): boolean => v === undefined || typeof v === kind;

/** The fields the row draws, checked before they reach React. Bounds and shapes are the server's (src/related-work.ts § `relatedWorkOf`). */
function isRelatedWork(value: unknown): value is RelatedWork {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    str(row.openalexId) &&
    OPENALEX_WORK_ID.test(row.openalexId as string) &&
    str(row.title) &&
    Array.isArray(row.authors) &&
    row.authors.every(str) &&
    typeof row.authorCount === "number" &&
    optional(row.doi, "string") &&
    optional(row.year, "number") &&
    optional(row.venue, "string") &&
    optional(row.citedByCount, "number") &&
    optional(row.abstract, "string")
  );
}

/** **Is this one of the route's answers?** The panel switches exhaustively on `kind`, so anything else is `unavailable`. */
export function asRelatedWorkResult(value: unknown): RelatedWorkResult | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  switch (body.kind) {
    case "no-bibliography":
    case "no-query":
    case "not-searched":
    case "unavailable":
    case "rate-limited":
      return { kind: body.kind };
    case "found":
      return Array.isArray(body.works) &&
        body.works.every(isRelatedWork) &&
        typeof body.excluded === "number" &&
        typeof body.bibliographyStale === "boolean" &&
        typeof body.bibliographyCapped === "boolean" &&
        (body.yearLimited === null || typeof body.yearLimited === "number") &&
        typeof body.queryChanged === "boolean" &&
        typeof body.searchedAt === "string"
        ? (value as RelatedWorkResult)
        : null;
    default:
      return null;
  }
}

async function ask(slug: string, method: "GET" | "POST"): Promise<RelatedWorkResult> {
  try {
    const url = `/api/related-work/${encodeURIComponent(slug)}`;
    const body = await readJson<unknown>(await apiFetch(url, method === "POST" ? { method } : {}));
    return asRelatedWorkResult(body) ?? UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

interface Answer {
  slug: string;
  result: RelatedWorkResult;
  failed: RelatedWorkFailure | null;
  /** Whether `result` (or `failed`) came from a search, so *Try again* repeats the right request. */
  fromSearch: boolean;
}

/**
 * @param wanted whether the Not cited chip is on screen. Nothing is read until
 *   it first is.
 * @param bibliographyBasis the current Bibliography object. A new object means
 *   its rows may exclude different works, so the stored search is read again.
 */
export function useRelatedWork(slug: string, wanted: boolean, bibliographyBasis: object | null = null): UseRelatedWork {
  /* Kept with the slug it answers, as useCiters.ts: another article shows the
     wait, never the last article's list. */
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [searchingFor, setSearchingFor] = useState<string | null>(null);

  const load = useCallback(
    async (current: () => boolean) => {
      const result = await ask(slug, "GET");
      if (current()) setAnswer({ slug, result, failed: null, fromSearch: false });
    },
    [slug],
  );
  const { reload, refresh } = useOrderedRead(load);

  /* A ref, because StrictMode runs the effect twice in one commit. */
  const askedFor = useRef<{ slug: string; bibliographyBasis: object | null } | null>(null);
  const article = useRef(slug);
  /* The search in the air, by article: a ref so a double press in one frame is one search. */
  const inFlight = useRef<string | null>(null);
  if (article.current !== slug) {
    article.current = slug;
    askedFor.current = null;
  }
  useEffect(() => {
    if (
      !wanted ||
      (askedFor.current?.slug === slug && askedFor.current.bibliographyBasis === bibliographyBasis)
    )
      return;
    const changed = askedFor.current?.slug === slug;
    askedFor.current = { slug, bibliographyBasis };
    void (changed ? refresh() : reload());
  }, [wanted, slug, bibliographyBasis, reload, refresh]);

  const search = useCallback(() => {
    if (inFlight.current === slug) return;
    inFlight.current = slug;
    setSearchingFor(slug);
    void ask(slug, "POST").then((result) => {
      if (inFlight.current === slug) inFlight.current = null;
      setSearchingFor((s) => (s === slug ? null : s));
      if (article.current !== slug) return;
      setAnswer((prev) => {
        const shown = prev?.slug === slug ? prev.result : null;
        if ((result.kind === "unavailable" || result.kind === "rate-limited") && shown?.kind === "found")
          return { slug, result: shown, failed: result.kind, fromSearch: true };
        return { slug, result, failed: null, fromSearch: true };
      });
    });
  }, [slug]);

  const current = answer?.slug === slug ? answer : null;
  const retry = useCallback(() => {
    if (current?.fromSearch) {
      search();
      return;
    }
    setAnswer(null);
    void reload();
  }, [current?.fromSearch, search, reload]);

  return {
    result: current?.result ?? null,
    failed: current?.failed ?? null,
    searching: searchingFor === slug,
    search,
    retry,
  };
}
