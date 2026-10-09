/**
 * **The public shelf's topic pills, kept up to date by the site.**
 *
 * The same coordinator as every reader's shelf (src/shelf-topic-sets.ts §
 * `shelfTopicSet`), given deps that say what is different here:
 *
 * - **The shelf is the public listing** (src/store/public-library.ts §
 *   `readPublicCards`), the very cards a stranger is shown. No reader profile.
 * - **Each card is its own work.** A reader's tree groups exact copies by a
 *   hash their phrase pass fills in; the site cannot fill hashes in other
 *   people's articles, and two readers sharing one article are already two
 *   cards on the page. So every card gets a hash of its own and there is
 *   nothing to fill.
 * - **It runs as the site account** (src/site-account.ts): its stored row, its
 *   allowance, and its line in the ledger — `runAsOwner` for the first two and
 *   `withSpendAttribution` for the third, with no article, or the request's
 *   spend scope would book the call to the sharing reader.
 * - **A re-think runs by itself only up to `PUBLIC_RETHINK_AUTO_MAX` cards.**
 *   Filing a new card into the tree is one bounded call at any size, about a
 *   hundredth of a cent; a whole re-think is about a tenth of a cent at 20 and
 *   half a cent by 45. Past 20 it waits for an administrator's Rebuild on
 *   /admin, which says when one is due.
 * - **An article gone from the listing makes a re-think due**, because a label
 *   may have been worded from its title; until then the page withholds every
 *   topic (src/public-library-topics.ts).
 *
 * Triggered by the requests that change the listing — share and un-share,
 * archive and restore, delete — after their answer is sent and before the
 * handler returns, so the spend lands inside the request. A stranger's
 * request never comes here.
 *
 * Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md;
 * Greg's answer "q-p5h2a7 A", 2026-10-09; the cost is investigation 261008a.
 */
import { withSpendAttribution } from "./ai-spend.js";
import { errorFields, log } from "./log.js";
import { SHELF_TOPICS_MODEL } from "./models.js";
import { type OwnerId, runAsOwner } from "./owner.js";
import { realCalls } from "./shelf-terms/model-topics.js";
import {
  type DuePolicy,
  MAX_WORKS,
  type ShelfTopicSetDeps,
  shelfTopicSet,
  whatIsDue,
  worksOf,
} from "./shelf-topic-sets.js";
import { SITE_OWNER_ID } from "./site-account.js";
import { fetchAllowanceStore, shelfTermsStore } from "./store/index.js";
import { readPublicCards } from "./store/public-library.js";
import type { StoredTopicSet, TopicShelfArticle } from "./store/contracts.js";
import type { LibraryTermsResponse, PublicShelfTopicsStatus } from "./types.js";

const logger = log("model");

/**
 * **The largest public shelf a re-think runs on by itself.** Measured, not
 * guessed: about 0.1 of a cent at 20 cards, so about 0.2 with a retried call,
 * against Greg's half-cent bar; one of two runs at 45 was already over it.
 * Raise it only by measuring at 30–40 (investigation 261008a).
 */
export const PUBLIC_RETHINK_AUTO_MAX = 20;

/** What runs by itself: capped, and an un-shared article forces a rebuild. */
export const AUTOMATIC: DuePolicy = { rethinkUpTo: PUBLIC_RETHINK_AUTO_MAX, rethinkWhenGone: true };
/** What an administrator's Rebuild may run: a reader's own cap. */
export const BY_HAND: DuePolicy = { rethinkUpTo: MAX_WORKS, rethinkWhenGone: true };

const SITE = SITE_OWNER_ID as OwnerId;

/** The listing as the coordinator's shelf: one work per card. */
export async function publicTopicShelf(): Promise<TopicShelfArticle[]> {
  const { cards } = await readPublicCards();
  return cards.map(({ articleId, entry }) => ({
    articleId,
    slug: entry.slug,
    archived: false,
    title: entry.title,
    gist: entry.gist,
    /* Its own, so `worksOf` makes every card a work and nothing waits on a fill. */
    textHash: `card:${articleId}`,
  }));
}

const NO_ANSWER: LibraryTermsResponse = {
  terms: [],
  scope: { articles: 0, works: 0, skipped: 0 },
  pending: 0,
  chosenBy: "program",
  refreshing: false,
};

/** The coordinator's deps for the public shelf. Call inside `asTheSite`: the store and allowance read the owner. */
export function publicShelfTopicSetDeps(due: DuePolicy): ShelfTopicSetDeps {
  return {
    store: { ...shelfTermsStore, topicShelf: publicTopicShelf },
    allowance: fetchAllowanceStore,
    /* Nobody reads this answer; the public page reads the stored row itself. */
    fallback: async () => NO_ANSWER,
    fillHashes: async () => 0,
    readProfile: async () => null,
    hasKey: () => Boolean(process.env.OPENROUTER_API_KEY),
    calls: realCalls({ model: SHELF_TOPICS_MODEL }),
    model: SHELF_TOPICS_MODEL,
    due,
  };
}

/** Run `fn` as the site: its row, its allowance, and its line in the ledger with no article. */
export function asTheSite<T>(fn: () => Promise<T>): Promise<T> {
  return runAsOwner(SITE, () => withSpendAttribution({ ownerId: SITE_OWNER_ID, articleSlug: null, jobId: null, stepName: null }, fn));
}

/** Seam for tests: the deps a refresh uses. */
let depsFor: (due: DuePolicy) => ShelfTopicSetDeps = publicShelfTopicSetDeps;
export function setPublicShelfTopicDepsForTests(make: ((due: DuePolicy) => ShelfTopicSetDeps) | null): void {
  depsFor = make ?? publicShelfTopicSetDeps;
}

/**
 * **Decide and claim now; do the paid work when the returned function is
 * called.** The split lets a route answer between the two, so the answer can
 * already say the work is under way. Neither half throws: a failure is logged,
 * backs off in the coordinator, and the stored tree stays.
 */
export async function beginPublicShelfTopicsRefresh(due: DuePolicy = AUTOMATIC): Promise<() => Promise<void>> {
  let refresh: (() => Promise<void>) | null = null;
  try {
    refresh = await asTheSite(async () => (await shelfTopicSet(true, depsFor(due))).refresh);
  } catch (err) {
    logger.error({ ...errorFields(err) }, "the public shelf's topics could not be read or claimed");
  }
  const work = refresh;
  return async () => {
    if (!work) return;
    try {
      /* Inside the site's scopes again: the claim, the allowance and the ledger are all its. */
      await asTheSite(async () => {
        await work();
        /* A listing change during a live claim cannot start its own work.
           Reconcile once after finishing, including removals the coordinator's
           arrival drain cannot file away. This uses its own allowance and the
           request's same collector. Bound it to one pass: failures/backoff or
           ongoing churn wait for the next trigger. */
        const followUp = await shelfTopicSet(true, depsFor(due));
        await followUp.refresh?.();
      });
    } catch (err) {
      logger.error({ ...errorFields(err) }, "the public shelf's topics could not be refreshed");
    }
  };
}

/** **Bring the public tree up to date, if anything is due**, and await all of it. Never throws. */
export async function refreshPublicShelfTopics(due: DuePolicy = AUTOMATIC): Promise<void> {
  await (await beginPublicShelfTopicsRefresh(due))();
}

export function statusOf(stored: StoredTopicSet | null, shelf: readonly TopicShelfArticle[], model: string): PublicShelfTopicsStatus {
  const works = worksOf(shelf);
  const result = stored?.result ?? null;
  const listed = new Set(shelf.map((a) => a.articleId));
  const auto = whatIsDue(stored, works, model, "", AUTOMATIC).kind;
  const byHand = whatIsDue(stored, works, model, "", BY_HAND).kind;
  return {
    cards: shelf.length,
    rethoughtAt: result?.rethoughtAt.toISOString() ?? null,
    filed: result ? Object.keys(result.members).filter((id) => listed.has(id)).length : 0,
    withheld: result ? Object.keys(result.members).some((id) => !listed.has(id)) : false,
    rebuildDue: byHand === "rethink" && auto !== "rethink",
    working: Boolean(stored?.claim && stored.claim.until.getTime() > Date.now()),
    autoMax: PUBLIC_RETHINK_AUTO_MAX,
  };
}

/** The status, read as the site. */
export async function publicShelfTopicsStatus(): Promise<PublicShelfTopicsStatus> {
  return asTheSite(async () => {
    const [shelf, stored] = await Promise.all([publicTopicShelf(), shelfTermsStore.readTopicSet()]);
    return statusOf(stored, shelf, SHELF_TOPICS_MODEL);
  });
}
