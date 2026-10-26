/**
 * **Which papers cite this article**, for Reception's *Cited by* and *Where
 * it sits*' *After it* — one `GET /api/citers/:slug`, and, only when the
 * reader presses *After it*'s *About "keyword"*, one `GET
 * /api/citers/:slug?about=topic` (plan 261025h, decision 10; `askTopic`).
 * Nothing else.
 *
 * **It can never start the paid search.** There is no job here, no `useAutoRun`
 * and no POST: the list comes from OpenAlex, costs no money (only a share of
 * OpenAlex's free daily allowance: a title search, plan 261011q, spends some on
 * every ask), and is fetched and
 * cached apart from the stored Debate. That is why it is its own hook rather
 * than a field on `useReception`, whose automatic run is the dearest press in the
 * app to make by accident (src/web/useReception.ts).
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * **Asked once per article, the first time it is wanted** — when Reception or
 * *Where it sits* is on screen — and kept while the band stays mounted, so going to Claims and
 * back asks nothing. `retry` is the *Try again* beside the one outcome worth
 * trying again.
 *
 * **Every failure of the request is `unavailable`.** The route answers each of
 * its own outcomes with a 200; anything else (a dropped connection, a 5xx, a
 * session that lapsed, a 200 that is not one of those outcomes) is, to the
 * reader, the same "we could not get it just now", with the same button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { OPENALEX_WORK_ID } from "../citer-link.js";
import type { Citer, CitersResult } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useOrderedRead } from "./useOrderedRead.js";

export interface UseCiters {
  /** The answer, or `null` while it is being fetched (or has not been wanted yet). */
  result: CitersResult | null;
  /** Ask again, after `unavailable`. */
  retry(): void;
  /**
   * ***About "keyword"*'s answer** (`GET /api/citers/:slug?about=topic`, plan
   * 261025h, decision 10): `undefined` until the reader has pressed the toggle,
   * `null` while it is being fetched, then the answer — `filteredBy` set when
   * it is the filtered list, absent when the server fell back to the plain one.
   */
  topic: CitersResult | null | undefined;
  /**
   * **The toggle's press**: ask for the topic view the first time, and keep the
   * answer for the rest of the band's life, as the plain list is kept. Never
   * called on open (GPT Sol's S1-F5).
   */
  askTopic(): void;
  /** Ask for the topic view again, after it failed. */
  retryTopic(): void;
}

/**
 * **The plain list alone**, for Reception's *Cited by*, which has no keyword
 * view: the toggle is *After it*'s (WhereItSitsPanel.tsx § `AfterIt`).
 */
export type CitersRead = Pick<UseCiters, "result" | "retry">;

const UNAVAILABLE: CitersResult = { kind: "unavailable" };

/** Validate the fields the row renders before it reaches React. */
function isCiter(value: unknown): value is Citer {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.openalexId === "string" &&
    typeof row.title === "string" &&
    Array.isArray(row.authors) && row.authors.every((name) => typeof name === "string") &&
    typeof row.authorCount === "number" && typeof row.citedByCount === "number" &&
    (row.doi === undefined || typeof row.doi === "string") &&
    (row.year === undefined || typeof row.year === "number") &&
    (row.venue === undefined || typeof row.venue === "string") &&
    (row.kind === undefined || typeof row.kind === "string");
}

/** The matched record the panel names and links after a title search. */
function isTarget(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return typeof target.openalexId === "string" && OPENALEX_WORK_ID.test(target.openalexId) &&
    typeof target.title === "string";
}

/** OpenAlex's keyword for the work, and how many citers match it once known; `null` for anything else. */
function asTopic(value: unknown): { keyword: string; count?: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const topic = value as Record<string, unknown>;
  if (typeof topic.keyword !== "string" || topic.keyword.trim() === "") return null;
  const count = typeof topic.count === "number" && Number.isFinite(topic.count) && topic.count >= 0 ? topic.count : undefined;
  return { keyword: topic.keyword, ...(count !== undefined ? { count } : {}) };
}

/**
 * **Is this one of the route's answers?** The panel switches exhaustively on
 * `kind` and maps over `citers`, so a 200 carrying anything else (an older
 * server, a proxy's page, a test stub's `{}`) would throw while drawing and
 * take the whole Debate band with it. Checked once here, as far as the panel
 * reads: the kind, and for a list its four numbers, its date and that the list
 * is one, including each row's rendered fields. String bounds and citer-row
 * identifier shapes remain the server parser's job.
 */
function asCitersResult(value: unknown): CitersResult | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  switch (body.kind) {
    case "no-doi":
    case "no-match":
    case "not-indexed":
    case "unconfirmed":
    case "unavailable":
    case "too-large":
      return { kind: body.kind };
    case "found": {
      if (
        !(
          (body.via === "doi" || body.via === "title") &&
          isTarget(body.target) &&
          typeof body.count === "number" &&
          typeof body.returned === "number" &&
          typeof body.dropped === "number" &&
          typeof body.capped === "boolean" &&
          typeof body.fetchedAt === "string" &&
          Array.isArray(body.citers) && body.citers.every(isCiter)
        )
      ) {
        return null;
      }
      /* The topic label and the filter are drawn as words on a button and in a
         sentence: a malformed one is dropped, never the list with it. */
      const { topic, filteredBy, ...rest } = body;
      const label = asTopic(topic);
      return {
        ...(rest as Omit<Extract<CitersResult, { kind: "found" }>, "topic" | "filteredBy">),
        ...(label !== null ? { topic: label } : {}),
        ...(typeof filteredBy === "string" && filteredBy.trim() !== "" ? { filteredBy } : {}),
      };
    }
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
      const result = await ask(`/api/citers/${encodeURIComponent(slug)}`);
      if (current()) setAnswer({ slug, result });
    },
    [slug],
  );

  /* ***About "keyword"***: a second read of its own, asked only by the
     toggle's press (`askTopic`), with its own ordering so an article change
     drops a reply still in the air. */
  const [topicAnswer, setTopicAnswer] = useState<{ slug: string; result: CitersResult | null } | null>(null);
  const loadTopic = useCallback(
    async (current: () => boolean) => {
      const result = await ask(`/api/citers/${encodeURIComponent(slug)}?about=topic`);
      if (current()) setTopicAnswer({ slug, result });
    },
    [slug],
  );
  const { reload: reloadTopic } = useOrderedRead(loadTopic);
  const topicAsked = useRef<string | null>(null);
  const askTopic = useCallback(() => {
    /* A settled answer survives leaving and returning to this article, so it
       is still the answer to the press. A `null` answer is only an in-flight
       marker: a slug change invalidates that request below and must allow a
       new press to ask again. */
    if (topicAnswer?.slug === slug && topicAnswer.result !== null) return;
    if (topicAsked.current === slug) return;
    topicAsked.current = slug;
    setTopicAnswer({ slug, result: null });
    void reloadTopic();
  }, [slug, reloadTopic, topicAnswer]);
  const retryTopic = useCallback(() => {
    topicAsked.current = slug;
    setTopicAnswer({ slug, result: null });
    void reloadTopic();
  }, [slug, reloadTopic]);

  /* An ordinary `reload` joins a read already in flight, and only the newest
     reply may commit — src/web/useOrderedRead.ts, shared with the artefact
     readers. */
  const { reload } = useOrderedRead(load);

  /* A ref rather than state: React's StrictMode runs this effect twice inside
     one commit, and the second run must find the first one's mark. */
  const askedFor = useRef<string | null>(null);
  const article = useRef(slug);
  if (article.current !== slug) {
    article.current = slug;
    /* useOrderedRead invalidates the previous article even when this section
       is unwanted. Both ask-once marks must be invalidated at the same time:
       otherwise A -> B -> A can leave the topic mark saying "asked" after
       useOrderedRead has discarded the only request that could answer it. */
    askedFor.current = null;
    topicAsked.current = null;
  }
  useEffect(() => {
    if (!wanted || askedFor.current === slug) return;
    askedFor.current = slug;
    void reload();
  }, [wanted, slug, reload]);

  const retry = useCallback(() => {
    setAnswer(null);
    void reload();
  }, [reload]);

  return {
    result: answer?.slug === slug ? answer.result : null,
    retry,
    topic: topicAnswer?.slug === slug ? topicAnswer.result : undefined,
    askTopic,
    retryTopic,
  };
}

/** One GET of the route, every failure of the request `unavailable`. */
async function ask(url: string): Promise<CitersResult> {
  try {
    return asCitersResult(await readJson<unknown>(await apiFetch(url))) ?? UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}
