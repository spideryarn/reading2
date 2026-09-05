/**
 * **The two comment stores, on the operations the placement parity script does
 * not drive: the 409 that refuses a re-score, and `beginAnswer`.**
 *
 * `tests/store-parity-referee.test.ts` walks a placement through `create` and
 * four `patchMark`s and compares both stores step by step. Two things the
 * filesystem store does with a placement are outside that walk, and both were
 * uncovered on 2026-09-01:
 *
 * 1. **`create` refusing a re-score.** A second POST under a stored id carrying
 *    a *different* placement is not a retry, and the store answers 409 rather
 *    than overwriting a judgement the referee already made. `sameMark` in
 *    src/comments.ts is the filesystem half and the `same` expression in
 *    `pgCommentStore.create` is the other; they are two hand-written copies of
 *    one rule, which is the arrangement that drifts. Rewriting `sameMark` to
 *    `return true` left the whole comment-facing suite green.
 * 2. **`beginAnswer` carrying the placement across.** The Postgres store cannot
 *    lose it — its `beginAnswer` is an `UPDATE … SET` naming the answer columns
 *    and nothing else. The filesystem store **rebuilds the row field by field**,
 *    which is what keeps the answer path away from the anchor and is also
 *    exactly how a new field comes to be dropped by a retry: the comment above
 *    those two lines says `tools` and `stance` went missing that way before.
 *    Deleting them left the whole comment-facing suite green too.
 *
 * A **new file** rather than more of `store-parity-referee.test.ts`, which was
 * being edited by another session while this was written, and whose fixture is
 * an article the library can see. This one's article has **no current
 * revision**, so `listArticles` inner-joins it away — the trick
 * `store-comments.test.ts` uses and explains — and the slug starts `test-`, so
 * `completeArticles` in `store-parity.test.ts` skips the directory by name.
 *
 * ## What it compares, and what it deliberately does not
 *
 * The wire form after every step, `JSON.parse(JSON.stringify(…))` — the
 * discipline `store-parity.test.ts` sets out and `store-parity-referee.test.ts`
 * repeats. Two fields come off **by name** rather than being left for
 * `JSON.stringify` to drop, because dropping one side would compare "absent"
 * against a real value and pass by accident:
 *
 * - `createdAt`, because `CommentStore` has no clock seam. `create` takes a
 *   slug and an input and each store reads its own clock, so two runs cannot
 *   produce the same timestamp. That it survives `beginAnswer` is asserted
 *   positively below instead.
 * - `attempt`, which the two stores are *supposed* to disagree about: Postgres
 *   mints a uuid fence and the filesystem store has none, deliberately and
 *   permanently — `CommentStore.beginAnswer` in src/store/contracts.ts. It is
 *   also not wire form: the route holds it and no client ever sees it.
 *
 * `patchMark` is not driven here. It has an owner and a script of its own in
 * `store-parity-referee.test.ts`, and a second copy would be a second thing to
 * keep in step.
 *
 * ## The one state that has to be doctored, and why
 *
 * `beginAnswer` answers only a **terminal** row, and nothing in either store can
 * still produce one: `create` makes `status: "none"`, and `patch` since
 * 2026-09-01 will not write an answer onto a row `beginAnswer` never claimed.
 * The rows this stands in for were written by the explanation path retired on
 * 2026-08-28 and are still in the database. So the status — one column, one
 * value, the same value on both sides — is set out of band, exactly as
 * `legacyAnswered` does in `store-comments.test.ts`. Everything else about the
 * row, the placement included, is written by the real `create`.
 *
 * ## Skips loudly when there is no database
 *
 * `pgReady` says so on stderr and `REQUIRE_POSTGRES=1` turns the skip into a
 * failure — docs/project/testing.md § When a skip is not acceptable.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CommentIdTaken, NotAnExplanation } from "../src/comments.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articles,
  blockIdentities,
  comments as commentsTable,
  refereeCriteria,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { CommentStore } from "../src/store/contracts.js";
import { fsCommentStore } from "../src/store/fs.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import type { Comment } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-comments-parity";
const DIR = path.join(ROOT, "data", SLUG);
const COMMENTS_FILE = path.join(DIR, "comments.json");
const ARTICLE_ID = "00000000-0000-4000-8000-00000000cf10";
const BLOCK_ID = "spya-cmppar";
/**
 * The criterion the placement names.
 *
 * A real row, because `comments_criterion_fk` points at `referee_criteria` and
 * a placement naming a criterion that is not there is refused by the database.
 * That is the constraint working, not a fixture to route around — and the
 * filesystem store has no such constraint, so the two agreeing about a
 * placement that is legal on both sides is part of what is checked.
 */
const CRITERION_ID = "spya-crtp23";
/** The comment's id, supplied so both stores store the same one. */
const COMMENT_ID = "spya-cmtp23";
const QUOTE = "halves annotation time";

/** The referee's own placement, at the `against` end. See `negative` below. */
const PLACED_AT = -80;

await pgReady({
  suite: "tests/store-comments-parity.test.ts",
  tables: ["spideryarn.comments", "spideryarn.referee_criteria"],
});

/**
 * The wire form, with the two fields named above removed and any minted id
 * replaced by `#n` in order of first appearance.
 *
 * Lifted from `store-parity-referee.test.ts` rather than reasoned about again.
 * It matters little here — every id in this file is supplied — and it is kept
 * because an ordering bug then shows up as a renumbering, which is a real
 * failure rather than a masked one.
 */
function wire(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === "string") {
    if (!/^spya-[a-z0-9]{6}$/.test(value)) return value;
    const known = seen.get(value);
    if (known) return known;
    const placeholder = `#${seen.size}`;
    seen.set(value, placeholder);
    return placeholder;
  }
  if (Array.isArray(value)) return value.map((v) => wire(v, seen));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== "createdAt" && k !== "attempt")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, wire(v, seen)]),
    );
  }
  return value;
}

/** One step of the script: what it was, what came back, and the list after it. */
interface Step {
  label: string;
  returned: unknown;
  comments: Comment[];
}

/**
 * Set one comment's status out of band — see the header for why there is no
 * other way to reach `beginAnswer`.
 *
 * Passed in beside the store rather than branched on inside the script, so the
 * script itself contains no `if (postgres)` and cannot grow one.
 */
type Doctor = (id: string, status: string) => Promise<void>;

const doctorFiles: Doctor = async (id, status) => {
  const parsed = JSON.parse(await readFile(COMMENTS_FILE, "utf8")) as { comments: Comment[] };
  const found = parsed.comments.find((c) => c.id === id);
  if (!found) throw new Error(`no comment ${id} on disk to doctor`);
  found.status = status as Comment["status"];
  await writeFile(COMMENTS_FILE, JSON.stringify(parsed), "utf8");
};

const doctorPg: Doctor = async (id, status) => {
  const changed = await getDb()
    .update(commentsTable)
    .set({ status })
    .where(and(eq(commentsTable.articleId, ARTICLE_ID), eq(commentsTable.id, id)))
    .returning({ id: commentsTable.id });
  if (changed.length !== 1) throw new Error(`no comment ${id} in Postgres to doctor`);
};

/**
 * A thrown refusal as a value both stores can be compared on.
 *
 * The class name and the `status` the route will answer with, because those are
 * the two things that reach a reader. The message is left out on purpose: it
 * names an id, and the id is the one part of it a store could legitimately
 * spell differently.
 */
async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  try {
    const value = await work();
    return { threw: false, value };
  } catch (err) {
    return {
      threw: true,
      name: (err as Error).name,
      status: (err as { status?: number }).status,
    };
  }
}

describe("the filesystem and Postgres comment stores agree about a placement", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(articles).where(eq(articles.slug, SLUG));
    /* No `currentRevisionId`, so `listArticles` cannot see it — the header. */
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG });
    await db.insert(blockIdentities).values({ articleId: ARTICLE_ID, blockId: BLOCK_ID });
    await db.insert(refereeCriteria).values({
      articleId: ARTICLE_ID,
      id: CRITERION_ID,
      ownerId: currentOwnerId(),
      kind: "diverging",
      criterion: "Are the controls adequate?",
      poleAgainst: "the controls are inadequate",
      poleFavour: "the controls are adequate",
      scale: "rg",
      status: "done",
    });
    await rm(DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    await getDb().delete(articles).where(eq(articles.slug, SLUG));
    await closeDb();
    await rm(DIR, { recursive: true, force: true });
  });

  /**
   * One placement's life through the two operations `store-parity-referee.test.ts`
   * does not drive.
   *
   * Every step is chosen for something it can break: the repeat proves a
   * double-clicked Save is still harmless once a placement is on the row, the
   * re-score proves a changed number is refused rather than written, the load
   * after it proves the refusal left nothing behind, and `beginAnswer` proves a
   * retry of the model call does not take the referee's judgement with it.
   */
  async function script(comments: CommentStore, doctor: Doctor): Promise<Step[]> {
    const steps: Step[] = [];
    const take = async (label: string, returned?: unknown) => {
      steps.push({ label, returned, comments: await comments.load(SLUG) });
    };

    const made = {
      id: COMMENT_ID,
      blockId: BLOCK_ID,
      quote: QUOTE,
      start: 0,
      body: "no pre-registration is mentioned anywhere",
      criterionId: CRITERION_ID,
      valence: PLACED_AT,
    };

    await take("nothing placed yet");

    await take("place the passage at −80", await comments.create(SLUG, made));

    /* The same Save arriving twice. It has to hand back the row it has — the
       alternative is a second mark over the same words, or an overwrite. */
    await take("the same Save again", await comments.create(SLUG, made));

    /* **A re-score, and it is not a retry.** Same id, same anchor, same words,
       a different number. `create` must refuse: the referee already made this
       judgement, and changing one is `patchMark`'s job. */
    await take(
      "the same comment with a different number",
      await refusal(() => comments.create(SLUG, { ...made, valence: 40 })),
    );

    /* A cleared placement under a stored id is the same refusal, and it is the
       one the `?? undefined` in `sameMark` is about: a stored `-80` against an
       absent field must not compare equal. */
    const { criterionId: _off, valence: _gone, ...unplaced } = made;
    await take(
      "the same comment with the placement taken off",
      await refusal(() => comments.create(SLUG, unplaced)),
    );

    /* Now a legacy explanation, and the only doctored fact in the file. */
    await doctor(COMMENT_ID, "done");
    await take("it is a legacy explanation that has been answered");

    /* **The retry.** Everything the reader owns survives, and the referee's
       placement is theirs and has nothing to do with the model call being
       replaced. */
    await take("retry the model call", (await comments.beginAnswer(SLUG, COMMENT_ID)).comment);

    /* And an id nothing has, so the two stores agree about the 404 as well as
       about the happy path — a shape a happy-path parity test never sees. */
    await take(
      "answer a comment nobody has",
      await refusal(() => comments.beginAnswer(SLUG, "spya-cmtz99")),
    );

    return steps;
  }

  it("walks a placement through create, a repeat, two refusals and a retry", async () => {
    const fromFiles = await script(fsCommentStore, doctorFiles);
    /* Throw away what the filesystem script wrote before the Postgres one runs,
       so the second half starts from the same nothing the first did. */
    await rm(COMMENTS_FILE, { force: true });
    const fromPg = await script(pgCommentStore, doctorPg);

    expect(fromPg, "the two stores produced different numbers of steps").toHaveLength(
      fromFiles.length,
    );
    for (const [i, step] of fromFiles.entries()) {
      expect(wire(fromPg[i]), `comment parity diverged at: ${step.label}`).toEqual(wire(step));
    }

    /* Each store against the literal as well as against the other. Two stores
       that had both dropped the placement would agree perfectly, and the
       comparison above would say nothing at all. The indices are the script's. */
    for (const [name, steps] of [
      ["files", fromFiles],
      ["postgres", fromPg],
    ] as const) {
      const at = (i: number) => steps[i]?.comments[0];

      expect(steps[0]?.comments, `${name} started with a comment already there`).toEqual([]);
      expect(at(1)?.valence, `${name} did not store the placement`).toBe(PLACED_AT);
      expect(at(1)?.criterionId, `${name} did not store the criterion`).toBe(CRITERION_ID);

      /* The two refusals: `CommentIdTaken`, a 409, and the stored row untouched
         after each. A store that answered 409 and wrote anyway would pass a
         test that only looked at the throw. */
      for (const i of [3, 4]) {
        expect(steps[i]?.returned, `${name} did not refuse at step ${i}`).toMatchObject({
          threw: true,
          name: CommentIdTaken.name,
          status: 409,
        });
        expect(at(i)?.valence, `${name} let a refused re-score through`).toBe(PLACED_AT);
        expect(at(i)?.criterionId, `${name} let a refused re-score through`).toBe(CRITERION_ID);
      }

      /* **The retry, and the assertion this file exists for.** */
      const retried = steps[6];
      expect((retried?.returned as Comment | undefined)?.status, `${name} did not claim the row`).toBe(
        "pending",
      );
      expect(
        (retried?.returned as Comment | undefined)?.valence,
        `${name} dropped the referee's placement on a retry`,
      ).toBe(PLACED_AT);
      expect(
        (retried?.returned as Comment | undefined)?.criterionId,
        `${name} dropped the referee's criterion on a retry`,
      ).toBe(CRITERION_ID);
      expect(at(6)?.valence, `${name} dropped the placement from the stored row`).toBe(PLACED_AT);
      expect(at(6)?.criterionId, `${name} dropped the criterion from the stored row`).toBe(
        CRITERION_ID,
      );
      // The reader's own words and their passage came through it too.
      expect(at(6)?.body, `${name} lost the reader's words on a retry`).toBe(
        "no pre-registration is mentioned anywhere",
      );
      expect(at(6)?.quote, `${name} lost the passage on a retry`).toBe(QUOTE);
      /* `createdAt` is dropped from the comparison, so it is checked here: the
         reader asked once, and a retry replaces the attempt rather than the
         question. */
      expect(at(6)?.createdAt, `${name} moved createdAt on a retry`).toBe(at(1)?.createdAt);

      expect(steps[7]?.returned, `${name} did not 404 an unknown id`).toMatchObject({
        threw: true,
        name: NotAnExplanation.name,
        status: 404,
      });
    }
  });

  it("keeps the placement negative, in both stores, against the literal", async () => {
    /* **The one assertion the feature exists for**, and it is separate from the
       walk above so that its failure reads as "the sign went" rather than as
       two long objects to diff.
     *
     * `SearchHit.confidence` is a 0–100 match strength whose validator clamps
     * negatives to zero (`validateHits`, src/search.ts). A placement routed
     * through anything shaped like a confidence arrives as `0` — *"counts
     * neither way"* — with nothing erroring and nothing looking odd, which is
     * the opposite of what the referee said. `Comment.valence` in src/types.ts
     * is written around that failure.
     *
     * Against the literal on each side, not only against each other: two stores
     * that both clamped would agree perfectly. */
    const negative = async (store: CommentStore) => {
      const stored = await store.create(SLUG, {
        id: COMMENT_ID,
        blockId: BLOCK_ID,
        quote: QUOTE,
        start: 0,
        criterionId: CRITERION_ID,
        valence: PLACED_AT,
      });
      const [read] = await store.load(SLUG);
      return { stored, read };
    };

    const fromFiles = await negative(fsCommentStore);
    await rm(COMMENTS_FILE, { force: true });
    const fromPg = await negative(pgCommentStore);

    for (const [name, both] of [
      ["files", fromFiles],
      ["postgres", fromPg],
    ] as const) {
      for (const [where, row] of [
        ["returned", both.stored],
        ["read back", both.read],
      ] as const) {
        expect(row?.valence, `${name}, ${where}: the placement is not −80`).toBe(-80);
        expect(row?.criterionId, `${name}, ${where}: the criterion went`).toBe(CRITERION_ID);
        /* And nothing else on the row is carrying it. A placement that reached
           `start` — an offset, and non-negative by its own CHECK — or any other
           number field would be a different bug with the same symptom. */
        expect(row?.start, `${name}, ${where}: the valence reached the anchor`).toBe(0);
      }
    }

    expect(wire(fromPg)).toEqual(wire(fromFiles));
  });

  it("agrees that an article with no comments has no comments", async () => {
    /* The alarm on everything above. Every comparison in this file would also
       pass if both stores answered "I have never heard of this article", and
       `[]` equals `[]`. This says the two of them start from the same empty. */
    expect(await fsCommentStore.load(SLUG)).toEqual([]);
    expect(await pgCommentStore.load(SLUG)).toEqual([]);
  });
});
