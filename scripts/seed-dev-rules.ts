/**
 * The decisions in `npm run db:seed-dev` that are worth testing on their own.
 *
 * Pure — no network, no filesystem, no database — so
 * [`tests/seed-dev-rules.test.ts`](../tests/seed-dev-rules.test.ts) can drive
 * every state without a Postgres running, and so importing this file does
 * nothing. `scripts/db-seed-dev.ts` does its work at import time, and a test that
 * imported *that* would seed a database rather than read a rule. This is the
 * fourth file split out for that reason —
 * [`seed-accounts.ts`](seed-accounts.ts), [`db-reown-rules.ts`](db-reown-rules.ts)
 * and [`gjd-remote-env.ts`](gjd-remote-env.ts) are the others.
 */

/**
 * The articles the dev shelf gets, and **three of the corpus's five**.
 *
 * The other two are in [`tests/fixtures/data-root/`](../tests/fixtures/data-root/README.md)
 * to be *refused*, which is exactly wrong for a shelf somebody is meant to open:
 *
 * - **`constitution`** is the negative fixture. Its `labels.json` deliberately
 *   carries no `sourceHash`, so `publishRevision` has nothing to check the tree
 *   against and correctly refuses it. Seeding it would either throw or — worse,
 *   under `publish: "try"` — leave an unpublished row that the next run tries
 *   again, for ever.
 * - **`noema-mythology-of-conscious-ai`** publishes perfectly well — an earlier
 *   version of this comment called it unpublishable and that was simply wrong
 *   (GPT Sol, 2026-09-02). It is excluded for a weaker but real reason: it has no
 *   `raw.json` at all, so there is no original source behind it, and "view the
 *   original" on a shelf article that has none is a strange first impression.
 *   That absence is what `store-parity` keeps it for.
 *
 * `writes`, `todo` and `openai-huggingface` are ordinary published articles: 19,
 * 10 and 95 blocks. "A few example fixture articles" is three, and the list is
 * here rather than inline so the test can assert the two exclusions by name — a
 * corpus that grew a sixth article and quietly joined this list is the drift
 * worth catching.
 */
export const DEV_SHELF_SLUGS = ["writes", "todo", "openai-huggingface"] as const;

/** Corpus slugs this must never seed, and why, for the test to hold us to. */
export const NEVER_SEEDED: Readonly<Record<string, string>> = {
  constitution: "the negative fixture — no labels.sourceHash, so publishRevision refuses it",
  "noema-mythology-of-conscious-ai": "no raw.json, so no original source behind the article",
};

/**
 * What the database already holds for one slug.
 *
 * **`readable` is the article route's own question, not the shelf's.**
 * `pgArticleReader.loadArticle(slug)` throws unless there is a current revision
 * *and* a tree *and* at least one `revision_blocks` row — which is exactly what
 * `GET /api/article/<slug>` requires.
 *
 * The first version of this asked `listArticles()` instead, and GPT Sol showed
 * why that is not the same question: the library read trusts the **cached**
 * `block_count` column, so a revision whose block rows have gone still appears on
 * the shelf. The seed would skip it, exit 0, and the article would 404 when
 * opened. A card is not an article.
 */
export interface SlugRow {
  ownerId: string;
  readable: boolean;
  /**
   * `articles.archived_at is not null` — the reader put this card away.
   *
   * **Reported, never a reason to skip.** It was a skip branch of its own until
   * Sol pointed out that treating `archived_at` as proof of health lets an
   * archived-and-broken article exit green while it is absent from *both*
   * shelves. A healthy archived article is skipped because it is `readable`; a
   * broken one is reloaded, and republishing preserves the archive state.
   */
  archived: boolean;
}

export type SlugAction = "load" | "skip" | "refuse";

export interface SlugPlan {
  slug: string;
  action: SlugAction;
  /** One line, printed, so a run says what it did about each slug and why. */
  why: string;
}

/**
 * What to do about one slug, given what is already there.
 *
 * ## Skip only what can actually be opened
 *
 * `loadArticleIntoPg` is re-runnable but is **not** a no-op: a second call opens
 * a draft based on the published revision, re-copies every step and publishes a
 * revision 2. Harmless to what a reader sees, and it would accumulate a revision
 * and a full set of `revision_step_runs` on every `npm run setup`. So a seed has
 * to skip.
 *
 * Skipping on the **`articles` row** would be the obvious spelling and it is the
 * dangerous one. `beginRevision` writes that row before there is anything in it
 * (src/store/pg.ts), so a seed that died halfway leaves a slug with
 * `current_revision_id` null. Keyed on the row, every later run would call that
 * "already seeded" and the shelf would stay empty for ever, with each run
 * reporting success — the shape of
 * [silent-success.md](../docs/reusable/silent-success.md).
 *
 * Skipping on the **shelf** was the second version and is subtler: the library
 * read trusts a cached `block_count`, so it says yes to an article the reading
 * route 404s. Hence `readable`, which is the route's own bar.
 *
 * ## Somebody else's slug is reported, not fought over
 *
 * `articles.slug` is globally unique across the whole install
 * ([src/owner.ts](../src/owner.ts)), so a `writes` belonging to another owner
 * cannot be loaded for this one — `publishRevision` raises *"the slug already
 * belongs to another reader"*. On a shared development database that is a live
 * case rather than a hypothesis: this repo's own suite loads all five corpus
 * slugs, and a scratch owner left behind by a test run holds them until somebody
 * clears it.
 *
 * So: say which owner has it, seed the others, and carry on. Neither dying (one
 * stale row would break `npm run setup` for everybody sharing the tree) nor
 * stealing it (a re-own is a decision, and `npm run db:reown` is where it is
 * made).
 */
export function planSlug(slug: string, row: SlugRow | undefined, us: string): SlugPlan {
  /* Lower-cased on both sides. Postgres renders a uuid lower-cased, and a
     constant typed in upper case would compare unequal against our own row and
     be reported as somebody else's article. `db-reown` learned this one from
     GPT Sol (finding 7c) and it is cheap to keep. */
  const mine = row?.ownerId.toLowerCase() === us.toLowerCase();
  if (!row) return { slug, action: "load", why: "not in this database yet" };
  if (!mine) {
    return {
      slug,
      action: "refuse",
      why: `already owned by ${row.ownerId} — leaving it alone (npm run db:reown moves rows)`,
    };
  }
  if (row.readable) {
    return { slug, action: "skip", why: row.archived ? "already here, archived" : "already here" };
  }
  return {
    slug,
    action: "load",
    why: row.archived
      ? "archived and not readable — reloading it; publishing keeps it archived"
      : "present but not readable — a previous seed did not finish, so loading again",
  };
}

/**
 * **The postcondition: is every article we meant to seed actually openable?**
 *
 * This replaced a pair of per-load assertions (`copied.length > 0`,
 * `published === true`). Both were redundant — `loadArticleIntoPg` already
 * throws on a copy that moved nothing, and a default `publish: true` throws on a
 * refusal — and both asked about the *write* when the question worth asking is
 * about the *read*. GPT Sol, 2026-09-02.
 *
 * `expected` is the seeded list minus anything refused for belonging to somebody
 * else. `readable` is the slugs that came back from `loadArticle` — the reading
 * route's own bar, not the shelf's, for the reason on `SlugRow.readable`. A slug
 * in the first and not the second is the whole failure this command exists to
 * prevent: a green run over an article that 404s when opened.
 *
 * Names the slugs rather than counting, because a positive total proves nothing:
 * an account with eleven old articles and three failed fixtures has a perfectly
 * healthy-looking count.
 */
export function unopenable(expected: readonly string[], readable: readonly string[]): string[] {
  const there = new Set(readable);
  return expected.filter((slug) => !there.has(slug));
}

/* `storeVerdict` stood here until 2026-09-05, and it was the last line the seed
   printed: `SPIDERYARN_STORE` defaulted to `files` for a CLI script, so a dev
   server on the default served article reads off `data/` while every row this
   seed wrote to Postgres sat invisible — the seed reporting three articles
   loaded over a shelf that looks empty. Its verdict was the caller's exit code.

   There is one store since 2026-09-05, so the state it warned about cannot
   arise: whatever starts the dev server, it reads what the seed wrote.
   docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
   § F. */
