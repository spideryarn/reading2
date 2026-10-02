/**
 * **The shelf's topics, from `GET /api/library/terms`**, and the keys in the URL
 * that may be applied to them.
 *
 * The server chooses the topics every time it is asked, from phrase lists it
 * stores once per article revision — and it fills missing lists within a time
 * budget, answering `pending > 0` while some articles are still unread. So this
 * hook **asks again while anything is pending**: the server always does at
 * least one article per request, so the loop cannot spin
 * (docs/plans/260928a-shelf-facet-terms.md § Filling it).
 *
 * It asks again, too, when the **scope** changes (`?archived=1` widens it to
 * active + archived) and when the **set of articles** changes — a job
 * finishing, an archive, a restore — which the caller hands in as `shelfKey`.
 *
 * **A response for a question nobody is asking any more is dropped**: every
 * request is aborted by the effect's cleanup, and a body that escaped the abort
 * is checked against the same signal before it is stored. Same two halves as
 * useLibrarySearch.ts, for the same reason.
 *
 * **A failure is no topics, not an empty list.** An empty `terms` means "this
 * shelf has none" and the row says why; a failed request means nothing is
 * known, and the row is simply not drawn.
 *
 * docs/project/shelf-terms.md.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryEntry, LibraryTermsResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { chosenTopics, topicMembers } from "./shelf-narrow.js";

/** How long to wait before asking again while articles are still being read. */
export const PENDING_RETRY_MS = 400;

/**
 * **How long to wait before asking again while the model is choosing**
 * (`refreshing: true`), and how many times. The server answers with the
 * program's list — or the model's older pick — at once and then spends 6–20 s
 * on the model; asking again after that shows the new pick without a reload.
 * Bounded, so a refresh that never lands costs this shelf four more requests
 * and then nothing: the next load shows whatever was stored.
 * docs/project/shelf-terms.md.
 */
export const REFRESHING_RETRY_MS = 8_000;
export const REFRESHING_RETRIES = 4;

export interface ShelfTermsState {
  /** The last answer, or `null` before the first and after a failure. */
  data: LibraryTermsResponse | null;
  /**
   * Whether `data` answers the question being asked now — this scope, this set
   * of articles, nothing left pending. Only then is it safe to conclude that a
   * key missing from it is gone for good.
   */
  settled: boolean;
  /**
   * A question is out and nothing — neither a body nor a failure — has come
   * back for it. The Topics row draws a spinner in its place while this is
   * true (report a4xsg3). A failure is an answer, so it never spins for ever;
   * and a `null` shelfKey is no question at all (the archive's own wait says
   * "Loading archived…" in its own line, Sol on plan 260930j).
   */
  loading: boolean;
}

/**
 * What identifies the shelf the topics were chosen over: every article's slug
 * and current revision, sorted, and the archived list's too when it is in
 * scope. The title and gist ride beside it because either can change without a
 * new revision (a reader rename is article state), and both are model input.
 *
 * `null` means "do not ask yet" — the shelf has not loaded, or the archive is
 * in scope and its list has not arrived. Asking then would be answered, and then
 * asked again the moment the list lands.
 *
 * `revisionId` is optional only for shelf rows cached before it was added. The
 * visible model inputs and derived scalars are the fallback for one of those
 * old rows; a fresh server response always carries the id.
 */
export function shelfKeyOf(
  articles: readonly LibraryEntry[] | null,
  archived: readonly LibraryEntry[] | null | undefined,
  archivedInScope: boolean,
): string | null {
  if (!articles) return null;
  if (archivedInScope && !archived) return null;
  const part = (list: readonly LibraryEntry[]) =>
    list
      .map((a) =>
        JSON.stringify([
          a.slug,
          a.revisionId ?? null,
          a.title,
          a.gist ?? null,
          a.words,
          a.blocks,
          a.parts,
          a.sections,
        ]),
      )
      .sort()
      .join(",");
  return archivedInScope && archived ? `${part(articles)}|${part(archived)}` : part(articles);
}

export function useShelfTerms({
  archived,
  shelfKey,
}: {
  /** `?archived=1`: topics over active and archived articles. */
  archived: boolean;
  /** From `shelfKeyOf`; `null` holds the request back. */
  shelfKey: string | null;
}): ShelfTermsState {
  const [answer, setAnswer] = useState<{
    data: LibraryTermsResponse | null;
    archived: boolean;
    shelfKey: string;
  } | null>(null);
  /* Bumped to ask again while the server is still reading. State rather than a
     timer that calls the fetch itself, so the one effect below owns every
     request and its cleanup — a second code path that fetched would need its
     own abort. */
  const [round, setRound] = useState(0);
  /* How many times this question has been asked again because the model was
     choosing — per scope and shelf, so a new question starts from zero. A ref:
     it counts requests, and nothing renders from it. */
  const refreshAsks = useRef<{ question: string; count: number }>({ question: "", count: 0 });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is the ask-again trigger — the effect reads nothing from it
  useEffect(() => {
    if (shelfKey === null) return;
    const controller = new AbortController();
    let again: ReturnType<typeof setTimeout> | undefined;
    const question = `${archived ? "all" : "active"}|${shelfKey}`;
    if (refreshAsks.current.question !== question) refreshAsks.current = { question, count: 0 };
    apiFetch(`/api/library/terms${archived ? "?archived=1" : ""}`, { signal: controller.signal })
      .then((r) => readJson<LibraryTermsResponse>(r))
      .then((body) => {
        // Asked for a scope or a shelf that is no longer the one on screen.
        if (controller.signal.aborted) return;
        setAnswer({ data: body, archived, shelfKey });
        if (body.pending > 0) again = setTimeout(() => setRound((n) => n + 1), PENDING_RETRY_MS);
        else if (body.refreshing && refreshAsks.current.count < REFRESHING_RETRIES) {
          refreshAsks.current.count += 1;
          again = setTimeout(() => setRound((n) => n + 1), REFRESHING_RETRY_MS);
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        /* No row rather than a wrong one. Not retried: a failing route would
           otherwise be asked twice a second for as long as the shelf is open. */
        setAnswer({ data: null, archived, shelfKey });
      });
    return () => {
      controller.abort();
      if (again) clearTimeout(again);
    };
  }, [archived, shelfKey, round]);

  return useMemo(() => {
    /* Do not expose yesterday's answer as today's while the replacement is in
       flight. Besides making the row describe the wrong scope, its member sets
       would filter newly loaded archived articles (or a newly finished job)
       against a question that never included them. An absent current answer
       means no topic narrowing, just as it does on the first load. */
    const current =
      shelfKey !== null &&
      answer?.archived === archived &&
      answer.shelfKey === shelfKey
        ? answer
        : null;
    return {
      data: current?.data ?? null,
      settled: !!current?.data && current.data.pending === 0,
      loading: shelfKey !== null && current === null,
    };
  }, [answer, archived, shelfKey]);
}

/**
 * The chosen keys that apply, and the dropping of the ones that no longer can.
 *
 * `?topics=` is read before the topics exist, so nothing is applied until some
 * have loaded (`chosenTopics`) — a stale link cannot flash an empty shelf. A key
 * missing from a **settled** answer is then removed from the URL, with
 * `replace`, because it is a correction rather than something the reader did.
 * Not from an unsettled one: while the server is still reading articles, a
 * topic can be absent now and present in the next answer.
 */
export function useChosenTopics(
  requested: readonly string[],
  state: ShelfTermsState,
  drop: (kept: string[]) => void,
): string[] {
  const terms = state.data?.terms ?? null;
  /* Keyed on the joined string rather than the array, so that a parser handing
     back a fresh array each render cannot make this — and the rows memo and
     the table under it — recompute every render: the shape of
     docs/postmortems/260827e-shelf-render-loop.md. Keys hold no comma. */
  const asked = requested.join(",");
  const chosen = useMemo(
    () => chosenTopics(asked ? asked.split(",") : [], terms),
    [asked, terms],
  );
  useEffect(() => {
    if (!state.settled) return;
    if (chosen.join(",") !== asked) drop(chosen);
  }, [state.settled, chosen, asked, drop]);
  return chosen;
}

/**
 * **The shared topic state the shelf page needs in one call**: the answer, the
 * chosen keys that apply, their member sets for `narrowShelf`, and the scope
 * and titles used by the row's detail.
 *
 * Here rather than inline in Library.tsx so fetching and selection stay one
 * unit. The narrowing and the counts stay on the page: the latter consume the
 * already-narrowed rows, so typing a search does not scan every article twice.
 */
export function useShelfTopics({
  articles,
  archivedList,
  archivedOn,
  requested,
  drop,
}: {
  /** The active shelf, or `null` before it has loaded. */
  articles: readonly LibraryEntry[] | null;
  /** `shelf.archived`: the archived list, or `null` until it has been fetched. */
  archivedList: readonly LibraryEntry[] | null;
  /** `?archived=1`. */
  archivedOn: boolean;
  /** `?topics=`, as the URL has it. */
  requested: readonly string[];
  /** Write the kept keys back, with `replace` — see `useChosenTopics`. */
  drop: (kept: string[]) => void;
}) {
  /* The archived half is in scope only while the switch is on, and only once
     its list has arrived. */
  const inArchive = archivedOn ? archivedList : null;
  const shelfKey = useMemo(
    () => shelfKeyOf(articles, archivedList, archivedOn),
    [articles, archivedList, archivedOn],
  );
  const terms = useShelfTerms({ archived: archivedOn, shelfKey });
  const topics = useChosenTopics(requested, terms, drop);
  const termList = terms.data?.terms;
  const members = useMemo(() => topicMembers(termList ?? [], topics), [termList, topics]);

  /* `inScope` is every slug the topics were chosen over that is on a list
     loaded here — the tooltip's "of 38". */
  const inScope = useMemo(() => {
    const active = articles ?? [];
    const archived = inArchive ?? [];
    return new Set([...active, ...archived].map((e) => e.slug));
  }, [articles, inArchive]);

  /* The shelf entry for a slug on either list loaded — its title for the
     chips' cards and the detail rows (`LibraryEntry.title`, which the server
     has already resolved through the title fallback, library.md), and the
     whole entry for the paper card on a detail row's links (PaperCard.tsx). */
  const entryOf = useMemo(() => {
    const bySlug = new Map<string, LibraryEntry>();
    for (const e of [...(articles ?? []), ...(archivedList ?? [])]) bySlug.set(e.slug, e);
    return (slug: string) => bySlug.get(slug);
  }, [articles, archivedList]);

  return { terms, inArchive, topics, members, inScope, entryOf };
}
