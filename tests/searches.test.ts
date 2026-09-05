/**
 * What is left of `src/searches.ts`: the colour rules, the cap, `loadRuns`, and
 * the staleness question a saved run answers. See docs/project/search.md.
 *
 * **This file used to be the filesystem saved-search store's own suite**, 37
 * cases against `data/<slug>/searches.json`. `beginRun`, `finishRun`,
 * `deleteRun`, `recolourRun`, `update`, `readSearches` and `currentSourceHash`
 * went with the filesystem store on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section). `loadRuns` stayed, because
 * `tests/helpers/seed-reader-state.ts` reads a fixture's file through it to
 * seed `search_runs`; so did the pure half the Postgres store is written
 * against — `MAX_RUNS`, `withRun`, `requireColour`, `isStorableColour`.
 *
 * **Where the rest went**, because a deleted assertion leaves nothing behind to
 * go red:
 *
 * - **Already in `tests/store-searches-pg.test.ts`**: pending-before-the-model,
 *   the three-condition retry reset and its two refusals, the cap dropping the
 *   oldest, the criterion surviving a patch, the answer written over the
 *   pending row, an attempt that is no longer live, and all seven colour cases
 *   (stored, cleared to absent not null, slot 0, a run that is not there, a
 *   retry, a bad colour as a 400).
 * - **Ported there in the same commit**: § *a failure survives being written
 *   down and read back*, both cases. Their subject (`worthRetrying`,
 *   `kindOfMessage`) is alive and the round trip had no Postgres home at all.
 * - **Abolished rather than dropped**: *"does not lose a run to a concurrent
 *   write"* was about the per-process queue; § *never trims the run it just
 *   inserted* and the attempt fence are what SQL puts in its place.
 * - **Dropped, and named**: the four `currentSourceHash` cases — fingerprinting
 *   the `example/` fixture under its own slug and no other, ignoring a
 *   directory that is not a whole article, `readSearches` handing the panel
 *   runs and a fingerprint in one read, and a retried run being re-answered
 *   against today's article. All four are about walking `data/` for
 *   `blocks.json`; `pg-searches.ts` asks its own tables and
 *   `tests/store-searches-pg.test.ts` § *the article a run was answered
 *   against* is the surviving three-case version of the same question. The
 *   fixture-directory rule has no home and cannot have one — there is no
 *   candidate-directory walk left to be wrong about.
 *
 * Deterministic: no network, no model.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isStorableColour,
  loadRuns,
  MAX_RUNS,
  MAX_STORED_COLOUR,
  requireColour,
  withRun,
} from "../src/searches.js";
import { isStale } from "../src/search-stale.js";
import { hashBlocks } from "../src/source-hash.js";
import type { Block, SearchHit, SearchRun } from "../src/types.js";

const SLUG = "test-searches-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const FILE = path.join(DIR, "searches.json");

const HIT: SearchHit = {
  blockId: "spya-k3m9qt",
  quote: "mind is software",
  confidence: 85,
  reasoning: "States the position being rejected.",
};

async function writeSearches(body: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, body, "utf8");
}

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("reading a searches.json", () => {
  it("is empty for an article nobody has searched", async () => {
    expect(await loadRuns(SLUG)).toEqual([]);
  });

  it("refuses a slug that is not a path segment, rather than sanitising one", async () => {
    // A slug becomes a directory name. Refusing is the whole defence; a
    // sanitiser is a thing that can be wrong about one case.
    await expect(loadRuns("../etc")).rejects.toThrow(/Not a valid slug/);
    await expect(loadRuns("..")).rejects.toThrow(/Not a valid slug/);
  });

  it("reads the runs back off the file, and survives one with the key but no runs", async () => {
    await writeSearches(JSON.stringify({ runs: [] }));
    expect(await loadRuns(SLUG)).toEqual([]);

    const run: SearchRun = {
      id: "spya-k3m9qt",
      criterion: "arguments against the main claim",
      createdAt: "2026-08-20T00:00:00.000Z",
      status: "done",
      hits: [HIT],
    };
    await writeSearches(JSON.stringify({ runs: [run] }));
    expect(await loadRuns(SLUG)).toEqual([run]);
  });

  it("throws rather than silently emptying itself when the file will not parse", async () => {
    /* Every saved search for the article is unreadable at once, and a `[]` here
       would look exactly like "you have never searched this" — then the next
       write would make that true. It is also one of the drivers in
       tests/parse-json.test.ts: the log line must name `searches.json` without
       quoting the reader's criterion back into it. */
    await writeSearches("{ not json");
    await expect(loadRuns(SLUG)).rejects.toThrow();
  });
});

describe("the colour the reader picked", () => {
  it("refuses to store anything that is not a small whole number", () => {
    /* The guard the route leans on. Loose on purpose at the top end — the
       server does not know how big the palette is (src/web/hit-colours.ts § the
       seam) — and strict about *kind*, because a float or a string reaches the
       browser as `var(--cat-2.5-rgb)`, which is not an error anywhere and
       simply paints nothing. */
    for (const good of [0, 1, 7, MAX_STORED_COLOUR - 1]) {
      expect(isStorableColour(good)).toBe(true);
    }
    for (const bad of [-1, 2.5, Number.NaN, Infinity, MAX_STORED_COLOUR, "3", null, undefined, {}]) {
      expect(isStorableColour(bad)).toBe(false);
    }
  });

  it("throws for a colour no store would write, and lets `null` through", () => {
    /* `requireColour` is the throwing form, and it is what both Postgres stores
       call before they touch a row — `pg-searches.ts` and
       `pg-referee-criteria.ts` import it from here rather than restating the
       rule, so this is the one place it is stated. `null` is "clear it", not a
       bad value. */
    expect(() => requireColour(null)).not.toThrow();
    expect(() => requireColour(0)).not.toThrow();
    expect(() => requireColour(2.5)).toThrow();
    expect(() => requireColour(-1)).toThrow();
    expect(() => requireColour(MAX_STORED_COLOUR)).toThrow();
  });
});

describe("withRun — which run a begin produces", () => {
  /* The decision itself, with no store under it. `pgSearchStore.begin` runs it
     and `tests/store-searches-pg.test.ts` drives all three of its branches
     through SQL; these two say what the branch *names* mean, which is what a
     store reads to decide between an `UPDATE` and an `INSERT`. Both branches
     produce `pending`, so a store reading `run.status` to work it out would get
     it wrong — see the docstring. */
  const at = "2026-08-20T00:00:00.000Z";

  it("mints when the id is free, and says so", () => {
    const { runs, run, kind } = withRun([], "arguments against the main claim", undefined, at);
    expect(kind).toBe("minted");
    expect(run.status).toBe("pending");
    expect(runs).toHaveLength(1);
  });

  it("resets a failed run of the same question in place, keeping its createdAt", () => {
    /* The three-condition retry rule this file carries a postmortem for
       (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md):
       same id, same criterion, and the stored run FAILED. `createdAt` is kept
       because it is still the search the reader asked for; only the attempt is
       new. */
    const failed: SearchRun = {
      id: "spya-k3m9qt",
      criterion: "arguments against the main claim",
      createdAt: at,
      status: "error",
      error: "the model fell over",
      hits: [],
    };
    const { runs, run, kind } = withRun(
      [failed],
      "arguments against the main claim",
      "spya-k3m9qt",
      "2026-08-21T00:00:00.000Z",
    );
    expect(kind).toBe("reset");
    expect(runs).toHaveLength(1);
    expect(run.id).toBe("spya-k3m9qt");
    expect(run.createdAt).toBe(at);
    expect(run.status).toBe("pending");
    expect("error" in run).toBe(false);
  });

  it("keeps at most MAX_RUNS, oldest first", () => {
    // The oldest end, deliberately: the searches you come back to are the ones
    // you ran recently.
    let runs: SearchRun[] = [];
    for (let i = 0; i < MAX_RUNS + 3; i++) {
      ({ runs } = withRun(runs, `criterion ${i}`, undefined, at));
    }
    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs[0]?.criterion).toBe("criterion 3");
    expect(runs[MAX_RUNS - 1]?.criterion).toBe(`criterion ${MAX_RUNS + 2}`);
  });
});

/**
 * A saved search is an answer about the article **as it was**.
 *
 * Re-extract the piece and the hits point into a text that has moved: blocks
 * the model cited may be gone, and the ones that remain may say something else.
 * Nothing about that has a symptom — the panel lists the same passages, the
 * marks land wherever the quotes still match, and the reader has no way to know
 * they are looking at an answer to an older version of the question.
 *
 * So the run records the fingerprint of the blocks it was answered against,
 * exactly as a tweet thread, a glossary and a set of summaries already do
 * (src/source-hash.ts). Same hash, same word for it, one definition of
 * "current" for the whole article.
 *
 * The fingerprint is now taken by `pg-searches.ts` from its own tables rather
 * than by walking `data/` for a `blocks.json`, so what is left here is the
 * comparison — `isStale` (src/search-stale.ts), which is what the panel asks.
 */
describe("a saved search knows which article it answered", () => {
  const ONE: Block[] = [
    {
      id: "spya-k3m9qt",
      tag: "p",
      kind: "text",
      text: "He rejects the idea that mind is software running on wet hardware.",
      words: 12,
      html: "<p>He rejects the idea that mind is software running on wet hardware.</p>",
      gistable: true,
    },
  ];
  /** The same article after a re-extraction that changed the words. */
  const TWO: Block[] = [{ ...ONE[0]!, text: "A thermostat has no interior.", words: 5 }];

  /** A run from before runs recorded what they were answered against. */
  const OLD_RUN: SearchRun = {
    id: "spya-k3m9qt",
    criterion: "saved last week",
    createdAt: "2026-08-20T00:00:00.000Z",
    status: "done",
    hits: [HIT],
  };

  const answered: SearchRun = { ...OLD_RUN, sourceHash: hashBlocks(ONE) };

  /**
   * The bug, stated as the lie it tells: the article moves underneath a saved
   * run and the run goes on presenting itself as an answer about this article.
   */
  it("stops claiming to be current once the article moves underneath it", () => {
    expect(hashBlocks(ONE)).not.toBe(hashBlocks(TWO));
    expect(isStale(answered, hashBlocks(TWO))).toBe(true);
  });

  it("is not out of date while the article has not moved", () => {
    // The other half, and the one that stops "say it is stale" being the fix.
    // A banner on every saved search is the same amount of information as no
    // banner at all.
    expect(isStale(answered, hashBlocks(ONE))).toBe(false);
  });

  it("counts a run written before we recorded this as out of date", () => {
    // The honest answer for every search saved before 2026-08-26: we do not
    // know, and "cannot tell" has to fall on the side that says so.
    expect(isStale(OLD_RUN, hashBlocks(ONE))).toBe(true);
  });

  it("counts an article nobody could fingerprint as out of date too", () => {
    // The same rule, the other way round — `loadGlossary` in src/store/pg.ts
    // reaches for it in the same words: "Unknown counts as stale: the honest
    // answer, and the safe way round to be wrong."
    expect(isStale({ sourceHash: "0123456789abcdef" }, undefined)).toBe(true);
  });
});
