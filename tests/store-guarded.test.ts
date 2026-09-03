/**
 * **Every Postgres store is wrapped, and this asks the objects rather than the code.**
 *
 * ## What went wrong, so the test says why it exists
 *
 * `guardDbStore` in src/store/db-errors.ts stops a failed Drizzle query carrying
 * its bound parameters out of the store. Its own header argues — at length, and
 * correctly — that *a guard you have to remember to apply is a guard that is
 * missing from the store somebody adds next year*. It then left the applying to
 * whoever wired a store up.
 *
 * On 2026-08-27 that bill came due on the homepage. Three Postgres stores are
 * selected **outside** src/store/index.ts, each for a good and separately
 * documented reason (index.ts imports fs.ts, which imports half the app, and
 * `npm run check` gates on import cycles). All three were selected raw:
 *
 * - src/jobs.ts             → `pgJobStore`
 * - src/upload-records.ts   → `pgUploadStore`
 * - src/store/revisions.ts  → `pgLifecycle`
 *
 * The third of those no longer exists. `pgLifecycle` and the whole
 * `RevisionLifecycle` seam it was selected into were deleted on 2026-09-01,
 * never having had a production caller — docs/plans/260831b-finish-the-database-move.md
 * § Stage 4. Two raw selections were fixed and the third was demolished, so
 * what stops a fourth is (2) below rather than any of the objects in (1).
 *
 * The first one failed against a production database that was four migrations
 * behind, and the shelf rendered the whole `select … from "spideryarn"."jobs"`
 * — column list, `where`, and the owner's uuid — in red under the Add box.
 *
 * ## Why this is three tests and not one
 *
 * The fix moved the guard from the *selection* to the *export*, so the guard
 * travels with the store. That closes today's hole. It does not close the hole
 * one level up, which is somebody adding a fourth `STORE === "postgres" ?`
 * selection over an unguarded object — so:
 *
 * 1. the objects themselves are asked whether they are wrapped (the brand),
 * 2. the source is scanned for a selection whose Postgres branch is not,
 * 3. and the two errors that must cross a guard *intact* are proved to.
 *
 * (3) is the half a coverage test would miss. `guardDbStore` replaces what it
 * does not recognise, and two of the things it did not recognise are load-bearing
 * control flow: `advanceJob` answers *busy* on `instanceof StaleAttemptError`,
 * and a scrubbed copy would have become a 500 — under `postgres`, under
 * contention, and nowhere else. GPT Sol caught that before it shipped; this is
 * what stops it coming back.
 *
 * Needs no database: nothing here executes a query.
 *
 * See src/store/db-errors.ts, docs/postmortems/, docs/reusable/silent-success.md.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ChatConflict } from "../src/chat.js";
import { ProductRefused } from "../src/store/artifacts.js";
import { MissingAttempt } from "../src/store/contracts.js";
import { guardDbStore, isGuardedStore } from "../src/store/db-errors.js";
import { CheckpointRequestError } from "../src/store/checkpoints.js";
import { StaleAttemptError } from "../src/store/jobs.js";
import { IllegalTransition } from "../src/store/uploads.js";

/* **No `SPIDERYARN_STORE=postgres` hoisting here any more.** This file used to
   set the flag inside `vi.hoisted` and re-import `src/store/revisions.js`
   underneath it, because the revision lifecycle was the one store selected by
   the flag at *use* rather than guarded at *export*. That store is gone
   (2026-09-01), and every store left below exports one already-guarded object
   and consults no flag — which is what guarding at the export bought.
   tests/db-error-scrub.test.ts still explains the hoisting trick if it is ever
   needed again. */

/* --------------------------------------------------- 1. the stores, asked -- */

describe("the stores selected outside src/store/index.ts", () => {
  /**
   * Imported directly, which is the whole point: these are the exact objects
   * `src/jobs.ts` and `src/upload-records.ts` get, so a future edit that hands
   * back a raw store fails here rather than in production.
   *
   * No `SPIDERYARN_STORE` needed — these modules export one object each and do
   * not consult the flag. That is what guarding at the export bought.
   */
  it("hand out a guarded job store", async () => {
    const { pgJobStore } = await import("../src/store/pg-jobs.js");
    expect(isGuardedStore(pgJobStore)).toBe("jobs");
  });

  it("hand out a guarded upload store", async () => {
    const { pgUploadStore } = await import("../src/store/pg-uploads.js");
    expect(isGuardedStore(pgUploadStore)).toBe("uploads");
  });

  /**
   * The checkpoint store is a **factory**, not a singleton, so the guard has to
   * be applied to what it returns rather than to an export — and the object a
   * caller gets is the only thing that can be asked. Nothing calls it yet
   * (landing D does), which is why the assertion is here: "nothing calls it" is
   * a fact about the wiring that expires the moment somebody wires it up, and
   * the person wiring it up reads the call site, not the module header.
   *
   * Constructing one touches no database — `getDb()` is called inside the
   * methods — so this needs no connection.
   */
  it("hand out a guarded checkpoint store, per article", async () => {
    const { createPgCheckpointStore } = await import("../src/store/checkpoints-pg.js");
    const store = createPgCheckpointStore({
      /* Its own uuid rather than the all-zeros one, which
         tests/store-checkpoints.test.ts already declares — `tests/fixture-ids.test.ts`
         refuses an id claimed by two files, and it caught this. No row is ever
         inserted under it (nothing here calls a method), so an exemption in that
         guard's `NOT_A_ROW` would also have been legal; a distinct literal
         leaves no hole for a later file to hide in. */
      articleId: "00000000-0000-4000-8000-0000000c4eca",
      /* `CheckpointArticleRef` carries the slug too — it is what `read` and
         `write` assert their caller against. Nothing here calls either, so any
         name does; it is spelt out rather than left off because leaving it off
         is what made `npm run typecheck` red while all 186 tests were green. */
      slug: "guarded-checkpoint-store",
    });
    expect(isGuardedStore(store)).toBe("checkpoints");
  });
});

/**
 * **And every other Postgres store, by the name its log lines print.**
 *
 * The discovery test in section 2 reads the *source* for `= guardDbStore(`; this
 * reads the **objects**, which is the only thing that can say a store really
 * arrived wrapped, and it is the only place the seam names are written down as
 * an assertion. They are not decoration: `guardDbStore` builds every diagnostic's
 * `where` as `<seam>.<method>`, so `reader.loadArticle` is what somebody greps
 * for, and a rename here is a rename of the log.
 *
 * Fifteen of these were wrapped at the *selection* in src/store/index.ts until
 * 2026-09-03, which meant the guard depended on that one file remembering.
 * `pgArticleReader` is the sharpest case: src/store/pg-shelf.ts imports it
 * directly and never goes near index.ts.
 *
 * Imported one module at a time rather than through src/store/index.ts, which
 * would drag in the filesystem store and half the app for no gain. No database:
 * every one of these calls `getDb()` inside its methods.
 */
describe("every Postgres store, asked for the seam it was guarded under", () => {
  const seams: ReadonlyArray<readonly [string, string, string]> = [
    ["../src/store/pg.js", "pgArticleReader", "reader"],
    ["../src/store/pg-chat.js", "pgChatStore", "chat"],
    ["../src/store/pg-searches.js", "pgSearchStore", "searches"],
    ["../src/store/pg-comments.js", "pgCommentStore", "comments"],
    ["../src/store/pg-shelf.js", "pgShelfStore", "shelf"],
    ["../src/store/pg-shelf.js", "pgLibrarySearch", "library"],
    ["../src/store/pg-reader.js", "pgReaderStore", "reader-profile"],
    ["../src/store/pg-source.js", "pgSourceStore", "source"],
    ["../src/store/pg-referee-criteria.js", "pgRefereeCriteriaStore", "referee-criteria"],
    ["../src/store/pg-referee-claims.js", "pgRefereeClaimsStore", "referee-claims"],
    ["../src/store/pg-lookups.js", "pgGlossaryLookupStore", "glossary-lookup"],
    ["../src/store/pg-admin.js", "pgAdminStore", "admin"],
    ["../src/store/pg-visibility.js", "pgVisibilityStore", "visibility"],
    ["../src/store/pg-feedback.js", "pgFeedbackStore", "feedback"],
    ["../src/store/realtime-sessions-pg.js", "pgRealtimeSessionStore", "realtime-sessions"],
  ];

  for (const [module, name, seam] of seams) {
    it(`${name} is guarded as "${seam}"`, async () => {
      const exports = (await import(module)) as Record<string, unknown>;
      expect(isGuardedStore(exports[name])).toBe(seam);
    });
  }
});

/* --------------------------------------------------- 2. the static guard -- */

describe("no Postgres store is selected without a guard", () => {
  /**
   * The genre, not the list — docs/plans/260826m-simplification-audit.md, Rule 1.
   *
   * ## What this checks, and what the first version pretended to check
   *
   * The first version split each `STORE === "postgres" ? … : …` into its two
   * branches and inspected the Postgres one. GPT Sol executed that logic and
   * showed it green on four shapes it should have failed:
   * `? fsJobStore : pgJobStore` (the arms the other way round), a nested ternary
   * with one guarded arm, the literal text `guardDbStore(` sitting inside a
   * string, and `'postgres'` in single quotes. It also read no `.tsx` at all.
   * A check that looks stronger than it is, is worse than a coarse one that is
   * honest — so the parser is gone.
   *
   * What is left is coarser and strictly harder to fool. In any statement that
   * consults the flag, **every** identifier that looks like a Postgres store
   * (`pgSomething`) must be one this repo guards at its export, or the statement
   * must wrap it on the spot. Which arm it is on stops mattering, because an
   * unguarded Postgres store has no business being in that statement at all.
   *
   * And the list of guarded names is **read out of the source** rather than
   * written here, which removes the other thing Sol flagged: two hand-kept lists
   * drifting apart, one of them silently vouching for a name that stopped being
   * guarded.
   *
   * A grep rather than a type, for the reason tests/owner-isolation.test.ts
   * gives about its own: no type distinguishes a wrapped store from an unwrapped
   * one at a selection site, and the failure this guards is well-typed code.
   */
  const root = fileURLToPath(new URL("../src/", import.meta.url));

  /** Comments gone — several of these files quote the forbidden shape in prose. */
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /** Every `.ts`/`.tsx` file under `src/`, depth-first. */
  async function sourcesUnder(dir: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}${entry.name}`;
      if (entry.isDirectory()) files.push(...(await sourcesUnder(`${full}/`)));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
    }
    return files;
  }

  /**
   * The names that are `guardDbStore(...)` at the point they are exported,
   * discovered rather than declared.
   */
  async function guardedAtExport(): Promise<Set<string>> {
    const names = new Set<string>();
    for (const file of await sourcesUnder(root)) {
      const code = strip(await readFile(file, "utf8"));
      for (const m of code.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)[^=;]*=\s*guardDbStore\(/g)) {
        /* The group is not optional in the pattern, but `noUncheckedIndexedAccess`
           types every match index as possibly undefined — see typechecking.md. */
        if (m[1]) names.add(m[1]);
      }
    }
    return names;
  }

  /**
   * The statement a match sits in: from the flag to the `;` that ends it, at
   * bracket depth zero so a call or an object literal carries its own along.
   */
  function statementAt(code: string, from: number): string {
    let depth = 0;
    for (let i = from; i < code.length; i += 1) {
      const c = code[i];
      if (c === "(" || c === "{" || c === "[") depth += 1;
      else if (c === ")" || c === "}" || c === "]") depth -= 1;
      else if (c === ";" && depth <= 0) return code.slice(from, i);
    }
    return code.slice(from);
  }

  it("so no statement on the flag names an unguarded Postgres store", async () => {
    const guarded = await guardedAtExport();
    const offenders: string[] = [];

    for (const file of await sourcesUnder(root)) {
      const code = strip(await readFile(file, "utf8"));
      /* Both quote styles, because `'postgres'` is the same selection. */
      for (const match of code.matchAll(/STORE\s*===\s*["']postgres["']/g)) {
        const statement = statementAt(code, match.index);
        /* **Which names this statement wraps, not merely whether it wraps one.**
           Asking `statement.includes("guardDbStore(")` was the last hole Sol's
           shapes got through: `? flag ? guardDbStore(…) : pgRaw : fs` mentions
           the guard once and hands out a raw store on the other arm, and one
           `includes` waved the whole statement past. */
        const wrappedHere = new Set(
          [...statement.matchAll(/guardDbStore\(\s*["'][^"']*["']\s*,\s*([A-Za-z_$][\w$]*)/g)].map(
            (m) => m[1],
          ),
        );
        /* `pgSomething` — the naming this repo uses for every Postgres adapter.
           `pgJobStore` and `pgUploadStore` both match; `fsJobStore` does not,
           which is the point: only a Postgres store has anything to scrub.
           (`pgLifecycle`, the third example this comment used to give, was
           deleted with the revision lifecycle on 2026-09-01.) */
        for (const name of new Set(statement.match(/\bpg[A-Z][\w$]*/g) ?? [])) {
          if (guarded.has(name) || wrappedHere.has(name)) continue;
          offenders.push(`${file.slice(root.length)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * And the discovery above actually found something. A regex that matches
   * nothing produces an empty set, which vouches for nobody and lets every
   * name through — a green test that checked the empty set against the empty
   * set. tests/db-schema.test.ts learned the same lesson about skipping.
   */
  it("and it really did find the guarded exports", async () => {
    const guarded = await guardedAtExport();
    /* **Seventeen, written out.** It was two until 2026-09-03 — the two stores
       from the accident above — while db-errors.ts and docs/project/database.md
       both said *every* Postgres store was wrapped at its export. The other
       fifteen were wrapped at the selection in src/store/index.ts instead, so
       the sentence was true of two and the list said so. It is now true of all
       of them, and the list is the thing that says which.

       Spelt out rather than counted, for the reason the docstring above gives:
       an empty set vouches for nobody, and so does a length. A store that
       stops being guarded has to delete its own name from here, which is a
       line a reviewer sees. */
    expect([...guarded].sort()).toEqual([
      "pgAdminStore",
      "pgArticleReader",
      "pgChatStore",
      "pgCommentStore",
      "pgFeedbackStore",
      "pgGlossaryLookupStore",
      "pgJobStore",
      "pgLibrarySearch",
      "pgReaderStore",
      "pgRealtimeSessionStore",
      "pgRefereeClaimsStore",
      "pgRefereeCriteriaStore",
      "pgSearchStore",
      "pgShelfStore",
      "pgSourceStore",
      "pgUploadStore",
      "pgVisibilityStore",
    ]);
  });
});

/* ------------------------------------------- 3. what must cross intact -- */

describe("the errors the guard must not eat", () => {
  /** A store that throws whatever it is handed, wrapped exactly as a real one is. */
  const throwing = (err: unknown) =>
    guardDbStore("probe", {
      go: async (): Promise<never> => {
        throw err;
      },
    });

  /**
   * The one GPT Sol found before it shipped. `advanceJob` in src/jobs.ts asks
   * `err instanceof StaleAttemptError` to answer *busy, ask again* when the
   * claim moved to another instance mid-step. Scrubbed, that becomes a 500 —
   * under `postgres`, under contention, and nowhere else.
   */
  it("lets a lost claim through as itself", async () => {
    const err = await throwing(new StaleAttemptError("spya-abc123"))
      .go()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleAttemptError);
  });

  /**
   * The fourth entry, which this suite did not cover until GPT Sol pointed out
   * that removing its allowlist line would leave every test here green. It was
   * protected only by tests/store-uploads-parity.test.ts — which skips its whole
   * Postgres half when there is no database, and a skipped test protects
   * nothing. This one needs no database.
   */
  it("lets an illegal transition through as itself", async () => {
    const err = await throwing(new IllegalTransition("pending", "verified"))
      .go()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IllegalTransition);
    expect((err as Error).message).toContain("pending to verified");
  });

  /**
   * The fifth entry, added 2026-08-29 with the checkpoint store
   * (docs/plans/260827aa-delete-the-importer.md § B3). It is here for the reason the
   * fourth one is: the only other coverage lives in a suite whose Postgres half
   * skips itself without a database, and a skipped test protects nothing. This
   * needs none.
   *
   * What it protects is a *diagnosis*. `assertCheckpointRequest` refuses a bad
   * key, the wrong slug and an undeclared namespace, and `checkpointJson`
   * refuses a value that will not serialise — none of which ever reaches the
   * database. Scrubbed, all four become "this app asked its database for
   * something it would not do", the guard logs `database call failed` for a
   * call that was never made, and the one sentence saying which rule was broken
   * is gone.
   */
  it("lets a checkpoint's own refusal through as itself", async () => {
    const err = await throwing(new CheckpointRequestError("\"abc\" is not a usable checkpoint key"))
      .go()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckpointRequestError);
    expect((err as Error).message).toContain("not a usable checkpoint key");
  });

  /**
   * The sixth entry, added 2026-08-30 with the transactional store session
   * (docs/plans/260827aa-delete-the-importer.md § D1b), and found the same way as the
   * fifth: by asking a guarded store what message it actually produced.
   *
   * `checkProduct` (src/store/session.ts) refuses a step's product **before**
   * the commit opens a transaction, so none of its four refusals has been near
   * a database — and the transactional session returns its object through this
   * wrapper. Scrubbed, *"arc returned a product missing arc, so nothing was
   * written"* became *"this app asked its database for something it would not
   * do"*: a false sentence about a real bug, minus the half that says which
   * artefact is missing. It needs no database, which is the point of it being
   * here rather than only in tests/store-pg-session.test.ts.
   */
  it("lets a refused product through as itself", async () => {
    const err = await throwing(new ProductRefused("arc returned a product missing arc"))
      .go()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProductRefused);
    expect((err as Error).message).toContain("missing arc");
  });

  /**
   * **A fenced write that arrived without its fence, and the reason it is here.**
   *
   * `SearchStore.finish`, `CommentStore.patch`, `ChatStore.finish` and
   * `RefereeCriteriaStore.finish` each refuse one, and until 2026-09-03 all four
   * threw a bare `Error`. Through `src/store/index.ts` the store was already
   * guarded, so in production the refusal has always read *"this app asked its
   * database for something it would not do"* — which drops the entire content of
   * it, namely **what the caller forgot**. The two suites covering it passed
   * because they import the adapter directly, back when the adapter's export was
   * unguarded: coverage that existed and proved nothing, exactly as in
   * docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md.
   *
   * Guarding all fifteen at their exports is what made it visible. This test is
   * the cheap pin, and it needs no database.
   */
  it("lets a missing attempt through, naming what the caller forgot", async () => {
    const err = await throwing(new MissingAttempt("SearchStore.finish", "begin()"))
      .go()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingAttempt);
    expect((err as Error).message).toContain("needs the attempt that begin() returned");
    /* **And no slug in it**, which is what lets it onto the allowlist at all:
       src/store/db-errors.ts refuses any candidate whose message can carry a
       URL, and a slug is a URL path segment derived from a title. */
    expect((err as Error).message).not.toMatch(/"[^"]*"/);
  });

  /** The one that was already on the list, kept honest. */
  it("lets a chat conflict through as itself", async () => {
    const err = await throwing(new ChatConflict("thread-1"))
      .go()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatConflict);
  });

  /**
   * And the hazard itself, stated as a test rather than a paragraph: an error
   * that is *not* on the allowlist loses its message. The sentinel is the shape
   * that actually leaked — Drizzle's `params:` line — so a future change that
   * quietly widens the allowlist fails here.
   */
  it("but eats a Drizzle-shaped error, sentinel and all", async () => {
    const leaky = new Error(
      'Failed query: select … from "spideryarn"."jobs" params: SENTINEL-READER-QUOTE',
    );
    const err = (await throwing(leaky)
      .go()
      .catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain("SENTINEL-READER-QUOTE");
    expect(err.message).not.toContain("Failed query");
    expect(err.name).toBe("StoreFailure");
  });

  /**
   * A chosen failure still passes — a 404 for a slug with no article must not
   * become "the database is unavailable".
   */
  it("and passes a failure somebody chose and worded", async () => {
    const chosen = Object.assign(new Error("No such article"), { status: 404 });
    const err = (await throwing(chosen)
      .go()
      .catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("No such article");
  });
});
