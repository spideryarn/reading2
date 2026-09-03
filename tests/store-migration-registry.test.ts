/**
 * **The registry is complete, and every verdict in it names a file that
 * exists** — [store-migration-registry.ts](store-migration-registry.ts), stage
 * A of docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * ## What a green run here does not mean
 *
 * The plan is explicit and it is worth repeating at the top of the guard rather
 * than the bottom: **the manifest is a ledger, not the protection.** These
 * cases can prove that every mechanically discovered candidate has an entry and
 * a reason. **They cannot prove a single verdict is right.** The real
 * protection against a wrong classification is the per-suite mutation evidence
 * from stage B and the assertion inventory in stage G, and nothing here
 * substitutes for either. If somebody classifies `store-parity.test.ts` as
 * collateral and deletes it, every case below stays green.
 *
 * ## Why the fourth case runs a fourteen-second subprocess
 *
 * Because the alternative is a guard that shares its discovery mechanism with
 * the thing it guards, which is the failure this repo keeps meeting
 * (docs/reusable/silent-success.md). The registry was built from a *dynamic*
 * witness — which files executed a condemned function. Policing it with the
 * same list would prove only that a JSON file and a TypeScript file were copied
 * from each other. So the static universe is **re-derived live**, by running
 * [`scripts/store-migration-candidates.ts`](../scripts/store-migration-candidates.ts)
 * — a transitive import-graph walk over ~1,200 files, a completely different
 * route to the answer — and every file it says can reach a condemned module
 * must be either in the registry or recorded by the dynamic witness as having
 * run and touched nothing. A file in neither is a **hole**, and the failure
 * names it.
 *
 * Caching that would defeat it: a cached answer is a claim about the tree as it
 * was, and the whole reason this case exists is that the tree moves. Fourteen
 * seconds is the price of the guard being about today.
 *
 * ## Three positive controls, because absence is what a broken detector
 * produces
 *
 * Two of these cases assert on set *differences*, and an empty difference is
 * what both "nothing is wrong" and "I read nothing" look like. So each of the
 * three inputs is checked for having found something first — the witness's
 * `touched` map, its `ranAndTouchedNothing` list, and the walk's own reaching
 * count. Without those, deleting the body of the witness JSON turns this file
 * green.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STORE_MIGRATION, TEST_LANES } from "./store-migration-registry.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Only the fields this file reads. The witness carries more. */
interface Witness {
  readonly touched: Readonly<Record<string, readonly string[]>>;
  readonly ranAndTouchedNothing: readonly string[];
  readonly unresolved: readonly string[];
  readonly knownBlindSpots: readonly string[];
}

const witness = JSON.parse(
  readFileSync(path.join(REPO, "tests/store-migration-witness.json"), "utf8"),
) as Witness;

/** One report per test file the walk could reach a condemned module from. */
interface StaticReport {
  readonly file: string;
  readonly bucket: string;
}

/**
 * Run witness 1 and read back what it found.
 *
 * The local `tsx` rather than `npx tsx`: `npx` resolves over the network when
 * it misses, and a guard that can hang on a registry lookup is a guard that
 * gets skipped. Output goes to a temp file rather than to stdout so that a
 * script which starts printing progress cannot break the parse.
 */
function staticUniverse(): { reaching: ReadonlySet<string>; reports: StaticReport[] } {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "store-candidates-")), "static.json");
  execFileSync(
    path.join(REPO, "node_modules/.bin/tsx"),
    [path.join(REPO, "scripts/store-migration-candidates.ts"), "--out", out],
    { cwd: REPO, stdio: "pipe", timeout: 150_000 },
  );
  const reports = (JSON.parse(readFileSync(out, "utf8")) as { reports: StaticReport[] }).reports;
  /* `type-only` edges are erased at compile time, so nothing executes across
     them — the script lists them and deliberately does not count them as a
     reach. Counting them here would manufacture ~45 holes that cannot exist. */
  return {
    reaching: new Set(reports.filter((r) => r.bucket !== "type-only").map((r) => r.file)),
    reports,
  };
}

describe("the store-migration registry", () => {
  it("has an entry for every file the dynamic witness watched touch the filesystem store", () => {
    /* The control. An empty or truncated witness would satisfy the assertion
       below without reading anything, and 88 is what the 2026-09-03 run
       measured — this is `at least most of that`, not an exact pin, because the
       witness is expected to be re-run. */
    expect(Object.keys(witness.touched).length).toBeGreaterThan(50);

    const missing = Object.keys(witness.touched).filter((f) => !(f in STORE_MIGRATION));
    expect(missing, `witnessed as touching the filesystem store, with no registry entry`).toEqual(
      [],
    );
  });

  it("names only files that exist on disk", () => {
    const gone = Object.keys(STORE_MIGRATION).filter(
      (f) => !existsSync(path.join(REPO, f)),
    );
    expect(gone, "registry entries whose file has been renamed or deleted").toEqual([]);
    expect(Object.keys(STORE_MIGRATION).length).toBeGreaterThan(50);
  });

  it("gives every entry a reason that somebody actually wrote", () => {
    /* Three separate ways a reason can be worthless, and they need three
       different checks — a length floor cannot see a copy-paste, and a
       duplicate check cannot see `TODO`. */
    const short: string[] = [];
    const placeholder: string[] = [];
    for (const [file, entry] of Object.entries(STORE_MIGRATION)) {
      /* Sixty characters is roughly one clause. Every genuine reason written in
         stage A is several times that; the floor is here to catch a future
         entry added in a hurry, not to grade prose. */
      if (entry.reason.trim().length < 60) short.push(file);
      /* Deliberately a short list of things that are *only* ever placeholders.
         `unknown` was in it for one run and matched "an unknown `questionId` is
         a 404" — a perfectly specific reason. A ban list that catches ordinary
         English trains people to reword good prose, which is worse than the
         placeholder it was guarding against. */
      if (/\b(TODO|TBD|FIXME|n\/a|see above|same as above|classify later)\b/i.test(entry.reason)) {
        placeholder.push(file);
      }
    }
    expect(short, "reasons too short to say anything specific to their file").toEqual([]);
    expect(placeholder, "reasons that defer instead of deciding").toEqual([]);

    /**
     * Exact duplicates only, after collapsing whitespace and case — and that
     * strictness is deliberate rather than lazy.
     *
     * The obvious tighter rule, *no two reasons may be similar*, would be
     * wrong here: eight of these entries are store-parity suites whose honest
     * reasons legitimately share most of their words, because the files
     * legitimately do the same thing to different stores. A similarity
     * threshold would push an author to add distinguishing noise, which is
     * worse than the duplication it removed. What a duplicate check can catch
     * without false positives is the thing that actually happens — a block
     * copied down and the file name changed — and that leaves the text
     * identical.
     */
    const byReason = new Map<string, string[]>();
    for (const [file, entry] of Object.entries(STORE_MIGRATION)) {
      const key = entry.reason.replace(/\s+/g, " ").trim().toLowerCase();
      byReason.set(key, [...(byReason.get(key) ?? []), file]);
    }
    const copied = [...byReason.values()].filter((files) => files.length > 1);
    expect(copied, "entries sharing a reason word for word").toEqual([]);
  });

  it("keeps `evidence` honest about which witness backs each verdict", () => {
    /* `dynamic` is a claim that the instrumented run watched this file execute
       something. If the file is not in `touched`, that claim is false, and the
       field would otherwise decay into decoration. */
    const overclaimed = Object.entries(STORE_MIGRATION)
      .filter(([f, e]) => (e.evidence ?? "dynamic") === "dynamic" && !(f in witness.touched))
      .map(([f]) => f);
    expect(overclaimed, "entries claiming dynamic evidence the witness does not have").toEqual([]);

    const understated = Object.entries(STORE_MIGRATION)
      .filter(([f, e]) => e.evidence === "static-only" && f in witness.touched)
      .map(([f]) => f);
    expect(understated, "entries marked static-only that the witness did watch").toEqual([]);
  });

  it(
    "leaves no file that the import graph can reach and nothing accounts for",
    { timeout: 180_000 },
    () => {
      const { reaching, reports } = staticUniverse();

      /* Controls first. Both differences below are empty when the inputs are
         empty, so an unread witness or a walk that parsed nothing would pass
         silently — which is the exact shape this whole plan exists to stop. */
      expect(reports.length, "the graph walk produced no reports at all").toBeGreaterThan(100);
      expect(reaching.size, "the graph walk found nothing reaching a condemned module")
        .toBeGreaterThan(100);
      expect(
        witness.ranAndTouchedNothing.length,
        "the witness recorded nothing as having run and touched nothing",
      ).toBeGreaterThan(100);

      /* Three ways a static candidate is accounted for, and no fourth:
           - the registry has read it and recorded a verdict;
           - the dynamic witness ran it and it executed nothing condemned, which
             is the categorical exclusion the registry's header states once;
           - the witness could not resolve it, which it lists by name. */
      const accounted = new Set([
        ...Object.keys(STORE_MIGRATION),
        ...witness.ranAndTouchedNothing,
        ...witness.unresolved,
      ]);
      const holes = [...reaching].filter((f) => !accounted.has(f)).sort();

      expect(
        holes,
        "files the import graph says can reach a condemned module, with no registry entry and no " +
          "witness record — classify each, or re-run witness 2 if they are new arrivals",
      ).toEqual([]);
    },
  );

  it("records the blind spots the instrument has, rather than leaving them out", () => {
    /* **Two, and the second is the one that cost something.** The first is
       `store-fs-write-chains`, which loads `ai-calls-fs` under a second module id
       and mocks `node:fs/promises` — the file's own subject, so the instrument
       cannot see it by construction.

       The second was found by GPT Sol reviewing this stage rather than by us
       running it: **the instrument records calls, not reads**, so a test that
       imports a non-function export and merely reads it executes nothing the
       proxy observes. `store-artefacts-pg` reads `PATHS` and was filed under
       "ran and touched nothing". We had told the reviewer there was one blind
       spot; there were two, and the claim was in the JSON.

       This assertion is what stops a future edit quietly dropping either. An
       unexplained absence is indistinguishable from an oversight. */
    expect(witness.knownBlindSpots.join(" ")).toMatch(/store-fs-write-chains/);
    expect(witness.knownBlindSpots.join(" ")).toMatch(/CALLS, NOT READS/);
    expect(existsSync(path.join(REPO, "tests/store-fs-write-chains.test.ts"))).toBe(true);
    /* And the file the second blind spot hid is now classified, not merely
       described — the record and the remedy have to travel together. */
    expect(Object.keys(STORE_MIGRATION)).toContain("tests/store-artefacts-pg.test.ts");
    expect(witness.ranAndTouchedNothing).not.toContain("tests/store-artefacts-pg.test.ts");
  });

  it("has an empty lane map until stage T-C fills it", () => {
    /* Not busywork: it stops somebody guessing lanes in this file before the
       database factory exists, which is the one thing the plan says cannot be
       decided yet. Delete this case in T-C, in the commit that adds the first
       lane — and replace it with T-C's own completeness guard, or the second
       map arrives unpoliced. */
    expect(Object.keys(TEST_LANES)).toEqual([]);
  });
});
