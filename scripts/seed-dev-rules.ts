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
 * `onTheShelf` is the answer to [`onTheShelf()`](../src/store/pg.ts) — the very
 * predicate `listArticles` uses — rather than "an `articles` row exists" or "a
 * revision exists". The caller runs that function, so this rule and the library
 * cannot disagree about what a shelf is; see the note on `planSlug` below.
 */
export interface SlugRow {
  ownerId: string;
  onTheShelf: boolean;
  /**
   * `articles.archived_at is not null` — the reader put this card away.
   *
   * Separate from `onTheShelf` because `listArticles()` answers the *unarchived*
   * shelf, so an archived article is absent from it for a reason that is not
   * "missing". Without this distinction the seed would reload an article
   * somebody deliberately hid, on every single `npm run setup`, and then fail its
   * own postcondition because the reload does not unarchive it.
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
 * ## The predicate is "on the shelf", not "a row exists", and that is the whole rule
 *
 * `loadArticleIntoPg` is re-runnable but is **not** a no-op: a second call opens
 * a draft based on the published revision, re-copies every step and publishes a
 * revision 2. Harmless to what a reader sees, and it would accumulate a revision
 * and a full set of `revision_step_runs` on every `npm run setup`. So a seed has
 * to skip.
 *
 * Skipping on the **`articles` row** would be the obvious spelling and it is the
 * dangerous one. `beginRevision` writes that row before there is anything in it
 * ([src/store/pg.ts](../src/store/pg.ts) § `onTheShelf`), so a seed that died
 * halfway leaves a slug with `current_revision_id` null — invisible on the shelf,
 * present in the table. Keyed on the row, every later run would call that
 * "already seeded" and the shelf would stay empty for ever, with each run
 * reporting success. That is the shape of
 * [silent-success.md](../docs/reusable/silent-success.md), so the unpublished
 * case is a **retry**.
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
  /* Before the shelf test, because an archived article is absent from
     `listArticles()` and would otherwise read as "not loaded". */
  if (row.archived) return { slug, action: "skip", why: "archived — the reader put it away, so leaving it" };
  if (row.onTheShelf) return { slug, action: "skip", why: "already on the shelf" };
  return {
    slug,
    action: "load",
    why: "present but not on the shelf — a previous seed did not finish, so loading again",
  };
}

/**
 * **The postcondition: is every article we meant to put on the shelf on it?**
 *
 * This replaced a pair of per-load assertions (`copied.length > 0`,
 * `published === true`). Both were redundant — `loadArticleIntoPg` already
 * throws on a copy that moved nothing, and a default `publish: true` throws on a
 * refusal — and, more to the point, both asked about the *write* when the
 * question worth asking is about the *read*. GPT Sol, 2026-09-02.
 *
 * `expected` is the slugs this run believes should now be visible: the seeded
 * list, minus any refused for belonging to somebody else, minus any the reader
 * has archived. `shelf` is what `listArticles()` actually returned. A slug in the
 * first and not the second is the whole failure this command exists to prevent —
 * a green run over an empty shelf.
 *
 * Names the slugs rather than counting, because a positive total proves nothing:
 * an account with eleven old articles and three failed fixtures has a perfectly
 * healthy-looking count.
 */
export function missingFromShelf(expected: readonly string[], shelf: readonly string[]): string[] {
  const there = new Set(shelf);
  return expected.filter((slug) => !there.has(slug));
}

/**
 * What to say about `SPIDERYARN_STORE` on the last line, and whether it is good
 * news.
 *
 * **This is the trap the whole command falls into if nobody says anything.**
 * `SPIDERYARN_STORE` defaults to `files` ([src/store/index.ts](../src/store/index.ts)),
 * so a dev server started on a machine that has never set it serves article
 * reads off `data/` — and every row this seed writes to Postgres is invisible in
 * the browser while the seed reports three articles loaded. A check that agrees
 * with the bug, one level up.
 *
 * A warning rather than a refusal, and the reason is that several agents share
 * this one checkout and one dev server: a seed that exited non-zero would break
 * `npm run setup` for whoever set the variable deliberately, and CLAUDE.md's
 * answer to a machine in the wrong state is to say so, not to stop.
 *
 * It cannot be fixed from in here either. The value belongs in `.env.local`,
 * which `gjd-remote push-env` **rebuilds** from the laptop's copy
 * ([scripts/gjd-remote-env.ts](gjd-remote-env.ts)), so a line written on the box
 * would be destroyed by the next push and would have looked fine in between —
 * the same reason `setup-local.ts` only warns about `SPIDERYARN_OWNER_ID`.
 */
export function storeVerdict(store: string | undefined): { ok: boolean; lines: string[] } {
  if (store === "postgres") {
    return { ok: true, lines: ["SPIDERYARN_STORE is postgres, so the dev server reads what this wrote."] };
  }
  return {
    ok: false,
    lines: [
      `SPIDERYARN_STORE is ${store ? `"${store}"` : "unset, which means \"files\""}.`,
      "  The dev server will serve articles off data/ and these rows will be invisible in the",
      "  browser — the seed will have worked and the shelf will look empty. Put",
      "  SPIDERYARN_STORE=postgres in .env.local on the LAPTOP: push-env rebuilds the box's copy",
      "  from that one, so a line added here is destroyed by the next push.",
    ],
  };
}
