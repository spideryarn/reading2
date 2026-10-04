/**
 * **The shelf's topics as the route answers them since 2026-10-03: a tree a
 * model named, kept up to date by itself.** docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md
 * § Greg's answer, and v1; docs/project/shelf-terms.md.
 *
 * Greg's priorities for this, in his order: new articles are always included;
 * then cost; then latency; and it should need no thought from the reader.
 *
 * ## One request, in order
 *
 * 1. **The fallback answer**: today's phrase pills (src/shelf-topics.ts, asked
 *    not to refresh its scores — that call is no longer made).
 * 2. **The stored tree**, if there is one and the shelf has `MIN_WORKS`. Its
 *    memberships are cut to the articles in this request's scope, an exact copy
 *    of a filed work takes that work's topics, and topics with nothing in view
 *    are left out. If that leaves any, they are the answer, broad first, and
 *    the response says how many articles in view are still waiting to be
 *    sorted (`sorting`).
 * 3. **What is due** (`whatIsDue`), decided over the whole shelf, active and
 *    archived, from counts of works:
 *    - a **re-think** — no tree yet; the prompt version, the model or the
 *      reader's profile changed; the shelf has grown or shrunk by
 *      `CHANGE_SHARE` (and `CHANGE_MIN` works) since the last one; or the
 *      works that fit no topic have grown by `UNPLACED_MIN` and
 *      `UNPLACED_SHARE` of the shelf since then. **Only up to `MAX_WORKS`**:
 *      above it a re-think is not attempted (see that constant).
 *    - else **filing** every work not yet in the tree, at any size.
 *    A re-think reads every work, so it sorts the new ones too.
 * 4. **One claim, then everything is read again.** What is due was decided
 *    from a read made before the claim, and another request may have written
 *    in between. Under the claim nobody else can, so the shelf and the row are
 *    re-read and the decision made again from those; the first read only
 *    decided whether to try (GPT Sol, v1 review, finding 3).
 * 5. **Then the allowance**, as the scores had.
 * 6. **The answer goes first**; the route awaits `refresh` after sending, so
 *    the spend lands in the request's own collector against the reader.
 * 7. **The write is fenced** by the claim. A failure counts and backs off, and
 *    the stored tree stays in use.
 * 8. **After a re-think, arrivals are drained**: the shelf is read once more
 *    and anything added while the re-think ran is filed in the same handler,
 *    rather than waiting for the browser to ask again.
 *
 * **Freshness is never a hash of the prompt.** A re-think is shown the previous
 * labels so it keeps them where they still fit, and a hash over that prompt
 * would make every answer stale the moment it landed.
 *
 * ## What may be logged from this file
 *
 * Counts, durations, the model, which job ran and an error's class. **Never** a
 * title, a gist, a profile, a topic label or key.
 */

import { createHash } from "node:crypto";

import type {
  AllowanceTaken,
  FetchAllowanceStore,
  RatePolicy,
  ShelfTermsStore,
  StoredTopicSet,
  TopicSetResult,
  TopicShelfArticle,
} from "./store/contracts.js";
import { errorFields, log } from "./log.js";
import { SHELF_TOPICS_MODEL } from "./models.js";
import { normaliseProfileText } from "./profile.js";
import {
  fileWorks,
  granularityOf,
  NAME_MAX,
  realCalls,
  rethink,
  TOPIC_CALL_TIMEOUT_MS,
  TOPIC_SET_PROMPT_VERSION,
  type TopicCalls,
  type TopicWork,
} from "./shelf-terms/model-topics.js";
import { ALLOWANCE_RETRY_MS, defaultShelfTopicsDeps, shelfTopics } from "./shelf-topics.js";
import { fetchAllowanceStore, readerStore, shelfTermsStore } from "./store/index.js";
import type { LibraryTermsResponse } from "./types.js";

const logger = log("model");

/** Below this many distinct works nothing is asked and no tree is shown, as the phrase row has always had it. */
export const MIN_WORKS = 8;

/**
 * **The largest shelf a re-think is attempted on in v1.** Above it, a level
 * would be named from a sample of its works and the rest filed into those
 * names, and two things go wrong (GPT Sol, v1 review, findings 1 and 2): a
 * subject with a handful of articles among a thousand is unlikely to be in the
 * sample and so never gets a name, which is exactly Greg's *Buddhism and
 * carpentry* case; and the dozens of calls it takes can outlast the claim's
 * lease and the function's time limit. So a bigger shelf keeps the tree it
 * has, with new works still filed into it, or the phrase row if it never had
 * one. Naming from every chunk and a re-think that can be resumed are the
 * queued next stage (plan 261003f § Deferred).
 */
export const MAX_WORKS = NAME_MAX;

/** A re-think is due when the shelf's size has moved by this share since the last one… */
export const CHANGE_SHARE = 0.25;
/** …and by at least this many works. */
export const CHANGE_MIN = 5;
/** Or when this many more works fit no topic than did at the last re-think… */
export const UNPLACED_MIN = 5;
/** …and they are this share of the shelf. */
export const UNPLACED_SHARE = 0.1;
/** The most works one request files. More wait for the next request; a shelf this far behind is rare. */
export const FILE_MAX = 200;

/**
 * How long a claim holds. A re-think is several calls deep (the 172-work eval
 * took 126 seconds); ten minutes leaves room, and a process that died costs
 * one lease.
 */
export const TOPIC_SET_LEASE_MS = Math.max(10 * 60 * 1000, TOPIC_CALL_TIMEOUT_MS * 3);

/**
 * How long before the lease ends a re-think's widening pass must be finished
 * (`RethinkOptions.deadline`). A re-think that would run past it fails and
 * backs off with the stored tree kept, rather than writing after another
 * request may have claimed the row. The naming calls before it have no such
 * limit yet; the write is fenced by the claim either way.
 */
export const RETHINK_DEADLINE_MARGIN_MS = 30_000;

/**
 * How much work one reader may cause: the scores' numbers, with the longer
 * lease. A filing or a re-think each count once, however many calls it makes.
 * With `MAX_WORKS` a re-think is at most about two cents (measured: $0.02 at
 * 172 works), so the worst day is under a dollar for one reader and about $60
 * across everyone.
 */
export const TOPIC_SET_RATE_POLICY: RatePolicy = {
  fills: 12,
  windowMs: 60 * 60 * 1000,
  concurrency: 2,
  leaseMs: TOPIC_SET_LEASE_MS,
  daily: { fills: 40, globalFills: 3_000, windowMs: 24 * 60 * 60 * 1000 },
};

export interface ShelfTopicSetDeps {
  store: ShelfTermsStore;
  allowance: FetchAllowanceStore;
  /** Today's phrase pills for this scope, never refreshing anything. */
  fallback: (archived: boolean) => Promise<LibraryTermsResponse>;
  /** Fill the exact-copy hashes over active + archived; returns how many remain. */
  fillHashes: () => Promise<number>;
  readProfile: () => Promise<string | null>;
  /** False: no key — the stored tree or the fallback, and no claim, no call. */
  hasKey: () => boolean;
  calls: TopicCalls;
  model: string;
}

export interface ShelfTopicSetAnswer {
  response: LibraryTermsResponse;
  /** The work this request claimed, to be awaited after the response is sent. Never throws. */
  refresh: (() => Promise<void>) | null;
}

/** One distinct work: exact copies of one text, newest first. */
export interface ShelfWork {
  /** The newest copy's article id; what the model's answer is keyed by. */
  id: string;
  articles: TopicShelfArticle[];
}

/** The shelf as distinct works. An article with no stored text hash is its own work. */
export function worksOf(shelf: readonly TopicShelfArticle[]): ShelfWork[] {
  const byKey = new Map<string, ShelfWork>();
  for (const a of shelf) {
    const key = a.textHash ? `h:${a.textHash}` : `a:${a.articleId}`;
    const found = byKey.get(key);
    if (found) found.articles.push(a);
    else byKey.set(key, { id: a.articleId, articles: [a] });
  }
  return [...byKey.values()];
}

const asTopicWork = (w: ShelfWork): TopicWork => {
  const a = w.articles[0]!;
  return { id: w.id, title: a.title, gist: a.gist };
};

/** What a stored tree remembers of the profile it was made with: its hash, or `""` for none. */
export function profileHashOf(profile: string | null): string {
  const tidy = normaliseProfileText(profile);
  return tidy ? createHash("sha256").update(tidy).digest("hex") : "";
}

/** A work's stored topics: the first of its copies that is in the tree, or `undefined` when none is. */
function filedTopics(work: ShelfWork, members: Record<string, string[]>): string[] | undefined {
  for (const a of work.articles) {
    const ids = members[a.articleId];
    if (ids) return ids;
  }
  return undefined;
}

/**
 * **The stored tree as the wire's terms, for the articles in view.** Broad
 * first (depth, then how many articles, then label). A topic with no article
 * in view is left out; `within` names the parent only when the parent is in
 * the answer too.
 */
export function termsFromSet(
  result: TopicSetResult,
  works: readonly ShelfWork[],
  inView: (a: TopicShelfArticle) => boolean,
): LibraryTermsResponse["terms"] {
  const slugs = new Map<string, string[]>(result.topics.map((t) => [t.id, []]));
  for (const w of works) {
    const ids = filedTopics(w, result.members);
    if (!ids) continue;
    for (const a of w.articles) if (inView(a)) for (const id of ids) slugs.get(id)?.push(a.slug);
  }
  const shown = result.topics.filter((t) => (slugs.get(t.id)?.length ?? 0) > 0);
  const keyOfId = new Map(shown.map((t) => [t.id, t.key]));
  return shown
    .map((t) => ({ t, articles: slugs.get(t.id) ?? [] }))
    .sort(
      (a, b) =>
        a.t.depth - b.t.depth ||
        b.articles.length - a.articles.length ||
        (a.t.label < b.t.label ? -1 : a.t.label > b.t.label ? 1 : a.t.key < b.t.key ? -1 : a.t.key > b.t.key ? 1 : 0),
    )
    .map(({ t, articles }) => {
      const within = t.parent ? keyOfId.get(t.parent) : undefined;
      return {
        key: t.key,
        label: t.label,
        articles: articles.map((slug) => ({ slug })),
        granularity: granularityOf(t.depth),
        ...(within ? { within } : {}),
      };
    });
}

/** Put the stored tree into the fallback response for this view, if it has anything to show. */
function applyStoredSet(
  response: LibraryTermsResponse,
  fallback: LibraryTermsResponse,
  stored: StoredTopicSet | null,
  shelf: readonly TopicShelfArticle[],
  works: readonly ShelfWork[],
  archived: boolean,
): void {
  /* This may be the second application, after exact-copy grouping changed.
     Begin from the phrase answer so falling below eight, or losing every
     visible stored topic, cannot leave the first model projection behind. */
  response.terms = fallback.terms;
  response.scope = fallback.scope;
  response.pending = fallback.pending;
  response.chosenBy = fallback.chosenBy;
  response.refreshing = fallback.refreshing;
  if (fallback.sorting === undefined) delete response.sorting;
  else response.sorting = fallback.sorting;
  /* Below eight works the row behaves as it always has, even with a tree
     stored from when the shelf was larger. */
  if (!stored?.result || works.length < MIN_WORKS) return;
  const inView = (a: TopicShelfArticle) => archived || !a.archived;
  const terms = termsFromSet(stored.result, works, inView);
  if (terms.length === 0) return;
  const viewed = works.filter((w) => w.articles.some(inView));
  response.terms = terms;
  response.chosenBy = "model";
  /* The model reads every article, so nothing is skipped; `pending` stays the
     phrase program's, whose reading also finds the exact copies. */
  response.scope = { articles: shelf.filter(inView).length, works: viewed.length, skipped: 0 };
  const sorting = viewed
    .filter((w) => !filedTopics(w, stored.result!.members))
    .reduce((n, w) => n + w.articles.filter(inView).length, 0);
  if (sorting > 0) response.sorting = sorting;
  else delete response.sorting;
}

/** What this request should do, from counts alone. */
export type Due = { kind: "nothing" } | { kind: "rethink" } | { kind: "file"; works: ShelfWork[] };

/**
 * **Is a re-think due, or filing, or nothing?** Pure, and decided from counts
 * of works.
 *
 * One known gap, kept because closing it needs the works that were unplaced
 * at the last re-think to be stored by name: if as many unplaced works are
 * deleted as new ones fail to fit, the two totals match and the unplaced
 * trigger does not fire. The size trigger still does in time.
 */
export function whatIsDue(stored: StoredTopicSet | null, works: readonly ShelfWork[], model: string, profileHash: string): Due {
  if (works.length < MIN_WORKS) return { kind: "nothing" };
  const result = stored?.result;
  const mayRethink = works.length <= MAX_WORKS;
  if (!result) return mayRethink ? { kind: "rethink" } : { kind: "nothing" };

  let unplaced = 0;
  const unfiled: ShelfWork[] = [];
  for (const w of works) {
    const ids = filedTopics(w, result.members);
    if (!ids) unfiled.push(w);
    else if (ids.length === 0) unplaced += 1;
  }
  if (mayRethink) {
    if (result.model !== model || result.promptVersion !== TOPIC_SET_PROMPT_VERSION || result.profileHash !== profileHash) return { kind: "rethink" };
    /* Grown or shrunk: after a hundred works become twenty, the tree describes a shelf that is gone. */
    if (Math.abs(works.length - result.works) >= Math.max(CHANGE_MIN, Math.ceil(result.works * CHANGE_SHARE))) return { kind: "rethink" };
    if (unplaced >= result.unplaced + Math.max(UNPLACED_MIN, Math.ceil(works.length * UNPLACED_SHARE))) return { kind: "rethink" };
  }
  return unfiled.length > 0 ? { kind: "file", works: unfiled.slice(0, FILE_MAX) } : { kind: "nothing" };
}

/** A work's answer, written under every one of its copies. */
function membersByArticle(works: readonly ShelfWork[], topicsOf: (workId: string) => string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of works) {
    const ids = topicsOf(w.id);
    if (!ids) continue;
    for (const a of w.articles) out[a.articleId] = ids;
  }
  return out;
}

const live = (stored: StoredTopicSet | null): boolean => Boolean(stored?.claim && stored.claim.until.getTime() > Date.now());

/** Hand back work taken before `refresh` exists; a failed release gets the fenced failure path once. */
async function releaseClaim(store: ShelfTermsStore, claimId: string, retryAfterMs: number): Promise<void> {
  try {
    await store.releaseTopicSet(claimId, retryAfterMs);
  } catch (err) {
    logger.error({ ...errorFields(err) }, "the shelf's topic claim could not be released; trying its failure path");
    await store.failTopicSet(claimId).catch(() => {});
  }
}

/** Finish the free exact-copy prerequisite, or leave `response` asking the browser to try again. */
async function prepareExactCopies(
  shelf: TopicShelfArticle[],
  response: LibraryTermsResponse,
  deps: ShelfTopicSetDeps,
): Promise<TopicShelfArticle[] | null> {
  if (!shelf.some((a) => a.textHash === null)) return shelf;
  try {
    const pending = await deps.fillHashes();
    if (pending > 0) {
      response.pending = Math.max(response.pending, pending);
      return null;
    }
    const prepared = await deps.store.topicShelf();
    if (prepared.some((a) => a.textHash === null)) {
      /* Defensive: a reported-complete fill that changed nothing must not
         silently waive exact-copy grouping. Ask again rather than spend. */
      response.pending = Math.max(response.pending, 1);
      return null;
    }
    return prepared;
  } catch (err) {
    logger.error({ ...errorFields(err) }, "the shelf's exact-copy hashes could not be prepared");
    return null;
  }
}

/**
 * The reader's answer, and the work to run after it is sent.
 * `deps` is for tests; the route uses `defaultShelfTopicSetDeps()`.
 */
export async function shelfTopicSet(archived: boolean, deps: ShelfTopicSetDeps): Promise<ShelfTopicSetAnswer> {
  const fallback = await deps.fallback(archived);
  /* `applyStoredSet` is allowed to rebuild this, while `fallback` remains the
     baseline it can faithfully restore after exact-copy grouping changes. */
  const response: LibraryTermsResponse = { ...fallback, scope: { ...fallback.scope } };

  /* Anything below that cannot be read leaves the fallback standing; the
     topics are never worth a 500. */
  let shelf: TopicShelfArticle[];
  let stored: StoredTopicSet | null;
  let profileHash: string;
  try {
    const [s, row, profile] = await Promise.all([deps.store.topicShelf(), deps.store.readTopicSet(), deps.readProfile()]);
    shelf = s;
    stored = row;
    profileHash = profileHashOf(profile);
  } catch (err) {
    logger.error({ ...errorFields(err) }, "the shelf's topic set could not be read");
    return { response, refresh: null };
  }
  let works = worksOf(shelf);
  applyStoredSet(response, fallback, stored, shelf, works, archived);

  if (!deps.hasKey()) return { response, refresh: null };

  /* A null hash means the phrase reader has not reached this article yet.
     Naming or filing now would show exact copies as separate works; once the
     hashes arrived they could then inherit whichever copy's independently
     chosen membership happened to come first. Finish that free prerequisite
     over active **and archived**, then re-read before any paid work. */
  const prepared = await prepareExactCopies(shelf, response, deps);
  if (!prepared) return { response, refresh: null };
  shelf = prepared;
  works = worksOf(shelf);
  /* The grouping itself can make a visible copy inherit an archived copy's
     membership. Rebuild the answer as well as the paid-work decision. Do not
     use array identity as the signal: a test store, or another composition,
     may update and return the same array object. */
  applyStoredSet(response, fallback, stored, shelf, works, archived);

  if (whatIsDue(stored, works, deps.model, profileHash).kind === "nothing") return { response, refresh: null };

  if (live(stored)) {
    response.refreshing = true;
    return { response, refresh: null };
  }

  let claimId: string | null;
  /* The lease begins in the database during `claimTopicSet`, before the
     under-claim reads, allowance and response send. Anchor every later
     deadline no later than that, rather than assuming those steps fit inside
     the widening margin. */
  const claimStarted = Date.now();
  try {
    claimId = await deps.store.claimTopicSet(TOPIC_SET_LEASE_MS);
  } catch (err) {
    logger.error({ ...errorFields(err) }, "the shelf's topic set could not be claimed");
    return { response, refresh: null };
  }
  if (!claimId) {
    /* Lost a race, or inside the backoff. Only a live claim means "ask again". */
    try {
      response.refreshing = live(await deps.store.readTopicSet());
    } catch (err) {
      logger.error({ ...errorFields(err) }, "the shelf's topic claim state could not be read");
    }
    return { response, refresh: null };
  }
  const claim = claimId;

  /* **Under the claim, read it all again and decide again.** */
  let fresh: { works: ShelfWork[]; stored: StoredTopicSet | null; profile: string | null; due: Due };
  try {
    const [s, row, profile] = await Promise.all([deps.store.topicShelf(), deps.store.readTopicSet(), deps.readProfile()]);
    const w = worksOf(s);
    fresh = { works: w, stored: row, profile, due: whatIsDue(row, w, deps.model, profileHashOf(profile)) };
  } catch (err) {
    logger.error({ ...errorFields(err) }, "the shelf's topic set could not be re-read under its claim");
    await releaseClaim(deps.store, claim, 0);
    return { response, refresh: null };
  }
  if (fresh.due.kind === "nothing") {
    /* Somebody did it between our two reads. The client asks once more and sees it. */
    await releaseClaim(deps.store, claim, 0);
    response.refreshing = true;
    return { response, refresh: null };
  }

  let allowance: AllowanceTaken;
  try {
    allowance = await deps.allowance.take("shelf-topics", TOPIC_SET_RATE_POLICY);
  } catch (err) {
    logger.error({ ...errorFields(err) }, "shelf topics allowance could not be read");
    await deps.store.failTopicSet(claim).catch(() => {});
    return { response, refresh: null };
  }
  if (allowance.kind !== "allowed") {
    logger.warn({ refused: allowance.kind, job: fresh.due.kind }, "shelf topics work refused by its allowance");
    await releaseClaim(deps.store, claim, ALLOWANCE_RETRY_MS);
    return { response, refresh: null };
  }

  response.refreshing = true;
  const token = allowance.id;
  const { due } = fresh;

  /** File `todo` into `topics` under `claimId`; hand a refused claim back. */
  const file = async (claimId: string, topics: TopicSetResult["topics"], todo: ShelfWork[], started: number): Promise<void> => {
    const filed = await fileWorks(topics, todo.map(asTopicWork), deps.calls);
    const written = await deps.store.fileIntoTopicSet(claimId, membersByArticle(todo, (id) => filed.get(id)));
    logger.info(
      { job: "file", model: deps.model, ms: Date.now() - started, works: todo.length, written },
      written ? "filed new works into the shelf's topics" : "filed new works, but the claim had moved on",
    );
    /* A refused filing leaves the claim standing (the store cannot tell a
       stale claim from a row with no result). Hand it back, or it would block
       the next ten minutes; fenced, so somebody else's claim is safe. */
    if (!written) await deps.store.releaseTopicSet(claimId, 0);
  };

  const refresh = async (): Promise<void> => {
    const started = Date.now();
    let held: string | null = claim;
    try {
      if (due.kind === "file") {
        await file(claim, fresh.stored?.result?.topics ?? [], due.works, started);
        held = null;
        return;
      }
      const set = await rethink(fresh.works.map(asTopicWork), deps.calls, {
        profile: normaliseProfileText(fresh.profile),
        previous: fresh.stored?.result?.topics ?? [],
        /* Past this another request may claim the row. The margin is for the
           write; time spent after taking the claim was already subtracted by
           anchoring this at `claimStarted`. */
        deadline: claimStarted + TOPIC_SET_LEASE_MS - RETHINK_DEADLINE_MARGIN_MS,
      });
      const unplaced = fresh.works.filter((w) => (set.members.get(w.id) ?? []).length === 0).length;
      const written = await deps.store.writeTopicSet(claim, {
        model: deps.model,
        promptVersion: TOPIC_SET_PROMPT_VERSION,
        profileHash: profileHashOf(fresh.profile),
        topics: set.topics,
        members: membersByArticle(fresh.works, (id) => set.members.get(id) ?? []),
        works: fresh.works.length,
        unplaced,
      });
      held = null;
      logger.info(
        { job: "rethink", model: deps.model, ms: Date.now() - started, works: fresh.works.length, topics: set.topics.length, unplaced, written },
        written ? "re-thought the shelf's topics" : "re-thought the shelf's topics, but the claim had moved on",
      );
      if (!written) return;

      /* **Drain arrivals.** A re-think takes a minute or two; whatever was
         added meanwhile is not in what it wrote. Sort it in now. */
      const after = worksOf(await deps.store.topicShelf());
      const seen = new Set(fresh.works.flatMap((w) => w.articles.map((a) => a.articleId)));
      const arrived = after.filter((w) => !w.articles.some((a) => seen.has(a.articleId))).slice(0, FILE_MAX);
      if (arrived.length === 0) return;
      held = await deps.store.claimTopicSet(TOPIC_SET_LEASE_MS);
      if (!held) return;
      /* The first read only decided whether a drain might be needed. Another
         request can write between it and this second claim, exactly as on the
         main path. Re-read under the claim and file into **that** tree, never
         the one this request wrote before it briefly released the row. */
      const [claimedShelf, claimedRow] = await Promise.all([deps.store.topicShelf(), deps.store.readTopicSet()]);
      const current = claimedRow?.result;
      const todo = current
        ? worksOf(claimedShelf)
            .filter((w) => filedTopics(w, current.members) === undefined)
            .slice(0, FILE_MAX)
        : [];
      if (!current || current.topics.length === 0 || todo.length === 0) {
        await deps.store.releaseTopicSet(held, 0);
        held = null;
        return;
      }
      await file(held, current.topics, todo, Date.now());
      held = null;
    } catch (err) {
      /* The error's class and our own message, never a provider body. */
      logger.error({ ...errorFields(err), job: due.kind, ms: Date.now() - started }, "shelf topics work failed; the next waits for the backoff");
      if (held) await deps.store.failTopicSet(held).catch(() => {});
    } finally {
      await deps.allowance.finish(token).catch(() => {});
    }
  };
  return { response, refresh };
}

/* ------------------------------------------------------------ the wiring -- */

/** The real composition. */
export function defaultShelfTopicSetDeps(): ShelfTopicSetDeps {
  return {
    store: shelfTermsStore,
    allowance: fetchAllowanceStore,
    /* Today's phrase pills with whatever scores are stored, and **no scoring
       refresh**: told there is no key, `shelfTopics` returns before it claims
       anything. The scoring call is not made any more. */
    fallback: async (archived) => (await shelfTopics(archived, { ...defaultShelfTopicsDeps(), hasKey: () => false })).response,
    /* The topic set spans active + archived even when the current view does
       not. This reuses the phrase reader only for its deterministic cache
       fill; its answer is discarded and it is told not to score anything. */
    fillHashes: async () => (await shelfTopics(true, { ...defaultShelfTopicsDeps(), hasKey: () => false })).response.pending,
    readProfile: () => readerStore.readProfile(),
    hasKey: () => Boolean(process.env.OPENROUTER_API_KEY),
    calls: realCalls({ model: SHELF_TOPICS_MODEL }),
    model: SHELF_TOPICS_MODEL,
  };
}
