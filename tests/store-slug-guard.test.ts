/**
 * **A malformed slug is a 400, from every per-article Postgres store.**
 *
 * Six modules each grew their own `articleIdFor(slug)` — byte-similar, minted by
 * copy — and by 2026-09-03 five of them called `requireSlug` and
 * `src/store/pg-comments.ts` did not. Nothing said so. A malformed slug reaching
 * any comment-store method fell through to a real query and came back as the
 * `notFound` 404 the other five never reach, so the reader was told "there is no
 * such article" about a string that could not name one.
 *
 * That is not a hole — `ownedSlug` still scopes every one of those queries to the
 * reader — but it is **a fix that failed to reach one of six copies**, which is
 * the shape that predicts the seventh. See
 * docs/plans/260903a-improve-the-codebase-sweep.md § T1.2.
 *
 * ## Why this file asks all six rather than the one that drifted
 *
 * A test for `pg-comments.ts` alone would have gone green on the extraction and
 * said nothing about the next module to be written from the same template. What
 * closes the class is the whole family being asked the same question in one
 * place: the seventh store is one line here, and a seventh private copy of the
 * lookup fails this file the moment it forgets the guard.
 *
 * `load` is the entry point every one of them has, and each routes it through
 * `articleIdForOwned` (src/store/pg.ts) before any query. Nothing else about
 * these stores is under test here.
 *
 * ## Watched red, 2026-09-03
 *
 * Before the extraction, with `pg-comments.ts` still holding its own copy:
 *
 * ```
 *   × the Postgres comment store refuses a malformed slug with 400
 *     → expected { status: 404 } to match object { status: 400 }
 * ```
 *
 * The other five passed, which is the drift stated as a test result rather than
 * as a grep.
 *
 * Skips loudly when there is no database — the 404 half of the contract needs a
 * real query to have been possible, or a green tick here would only mean the
 * connection failed. tests/helpers/pg-ready.ts.
 */

import { afterAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { pgChatStore } from "../src/store/pg-chat.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import { pgGlossaryLookupStore } from "../src/store/pg-lookups.js";
import { pgRefereeClaimsStore } from "../src/store/pg-referee-claims.js";
import { pgRefereeCriteriaStore } from "../src/store/pg-referee-criteria.js";
import { pgSearchStore } from "../src/store/pg-searches.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "the per-article Postgres stores' slug guard",
  tables: ["spideryarn.articles"],
});
const when = reachable ? describe : describe.skip;

/**
 * A string `isSlug` refuses, and one a person could plausibly send.
 *
 * The space is the whole point: it is what a pasted title looks like after a URL
 * decoder has had it, so this is the accident rather than an adversarial input.
 */
const MALFORMED = "not a slug";

/** Every store whose reads name an article by slug. Add the seventh here. */
const STORES: readonly (readonly [string, (slug: string) => Promise<unknown>])[] = [
  ["the comment store", (slug) => pgCommentStore.load(slug)],
  ["the chat store", (slug) => pgChatStore.load(slug)],
  ["the search store", (slug) => pgSearchStore.load(slug)],
  ["the referee-claims store", (slug) => pgRefereeClaimsStore.load(slug)],
  ["the referee-criteria store", (slug) => pgRefereeCriteriaStore.load(slug)],
  ["the glossary-lookup store", (slug) => pgGlossaryLookupStore.load(slug)],
];

when("a malformed slug", () => {
  afterAll(async () => {
    await closeDb();
  });

  for (const [name, load] of STORES) {
    it(`is a 400 from ${name}, not a 404`, async () => {
      /* `toMatchObject` on the status rather than on the message: the status is
         what src/routes.ts turns into the reader's answer, and the wording is
         allowed to change without this file having an opinion. A 404 here is the
         drift — the slug reached a query and the query found nothing. */
      await expect(load(MALFORMED)).rejects.toMatchObject({ status: 400 });
    });
  }
});
