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
import { useEffect, useMemo, useState } from "react";
import type { LibraryEntry, LibraryTermsResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { chosenTopics, narrowBeforeTopics, topicCounts, topicMembers } from "./shelf-narrow.js";

/** How long to wait before asking again while articles are still being read. */
export const PENDING_RETRY_MS = 400;

export interface ShelfTermsState {
  /** The last answer, or `null` before the first and after a failure. */
  data: LibraryTermsResponse | null;
  /**
   * Whether `data` answers the question being asked now — this scope, this set
   * of articles, nothing left pending. Only then is it safe to conclude that a
   * key missing from it is gone for good.
   */
  settled: boolean;
}

/**
 * What identifies the shelf the topics were chosen over: every article's slug
 * and word count, sorted, and the archived list's too when it is in scope.
 *
 * `null` means "do not ask yet" — the shelf has not loaded, or the archive is
 * in scope and its list has not arrived. Asking then would be answered, and then
 * asked again the moment the list lands.
 *
 * Word counts ride along so that a re-extraction (a new revision, new phrases)
 * refreshes the topics as well as an article arriving or leaving.
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
      .map((a) => `${a.slug}:${a.words}`)
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is the ask-again trigger — the effect reads nothing from it
  useEffect(() => {
    if (shelfKey === null) return;
    const controller = new AbortController();
    let again: ReturnType<typeof setTimeout> | undefined;
    apiFetch(`/api/library/terms${archived ? "?archived=1" : ""}`, { signal: controller.signal })
      .then((r) => readJson<LibraryTermsResponse>(r))
      .then((body) => {
        // Asked for a scope or a shelf that is no longer the one on screen.
        if (controller.signal.aborted) return;
        setAnswer({ data: body, archived, shelfKey });
        if (body.pending > 0) again = setTimeout(() => setRound((n) => n + 1), PENDING_RETRY_MS);
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

  return useMemo(
    () => ({
      data: answer?.data ?? null,
      settled:
        !!answer?.data &&
        answer.archived === archived &&
        answer.shelfKey === shelfKey &&
        answer.data.pending === 0,
    }),
    [answer, archived, shelfKey],
  );
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
 * **Everything the shelf page needs from its topics, in one call**: the answer,
 * the chosen keys that apply, their member sets for `narrowShelf`, and each
 * chip's count by the one formula (shelf-narrow.ts § topicCounts).
 *
 * Here rather than inline in Library.tsx so the page gains one call and not
 * forty lines; the narrowing itself — the `rows` memo — stays on the page,
 * above the cards/table branch, where the search and Unread already were.
 */
export function useShelfTopics({
  articles,
  archivedList,
  archivedOn,
  query,
  unread,
  requested,
  drop,
}: {
  /** The active shelf, or `null` before it has loaded. */
  articles: readonly LibraryEntry[] | null;
  /** `shelf.archived`: the archived list, or `null` until it has been fetched. */
  archivedList: readonly LibraryEntry[] | null;
  /** `?archived=1`. */
  archivedOn: boolean;
  query: string;
  unread: boolean;
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
  const { counts, inScope } = useMemo(() => {
    const active = articles ?? [];
    const archived = inArchive ?? [];
    const narrowing = { query, unread };
    const before = [
      ...narrowBeforeTopics(active, narrowing),
      ...narrowBeforeTopics(archived, narrowing),
    ].map((e) => e.slug);
    return {
      counts: topicCounts(before, topics, termList ?? []),
      inScope: new Set([...active, ...archived].map((e) => e.slug)),
    };
  }, [articles, inArchive, query, unread, topics, termList]);

  /* The card's own title: `LibraryEntry.title`, which the server has already
     resolved through the title fallback (library.md). */
  const titleOf = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const e of [...(articles ?? []), ...(archivedList ?? [])]) bySlug.set(e.slug, e.title);
    return (slug: string) => bySlug.get(slug);
  }, [articles, archivedList]);

  return { terms, inArchive, topics, members, counts, inScope, titleOf };
}
