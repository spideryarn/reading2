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
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LANES_BEYOND_THE_SCAN,
  OWNER_AUDIT,
  STORE_MIGRATION,
  TEST_LANES,
} from "./store-migration-registry.js";

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

});

/* ------------------------------------------------------------ the lane scan */

/**
 * **Every test file, and the lines of it that are code** — the input to both
 * lane guards below.
 *
 * Comment lines are dropped because prose is full of the words being searched
 * for and a docstring naming a helper is not a call to it. One file over —
 * `store-seams-have-two-implementations` mentions `pgReady` in a paragraph
 * about seams and never calls it — and it was the difference between two of the
 * three counts this plan has argued about. A guard that cannot tell those apart
 * demands a lane for a file that never opens a connection, and the next person
 * deletes the guard.
 *
 * The rule is *lines beginning with `*`, `//` or `/*`*, and not a real comment
 * stripper, deliberately. Every docstring in this repo is JSDoc, so its
 * continuation lines all start with `*`; a general stripper would have to
 * decide whether the `//` in `postgresql://…` opens a comment, and getting that
 * wrong deletes code. **Its failure direction is a false positive** — a
 * trailing `// pgReady()` on a line of code counts — which asks for a lane
 * that is easy to give, rather than silently excusing a file.
 */
function codeLinesOf(file: string): string[] {
  return readFileSync(path.join(REPO, file), "utf8")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
    });
}

/** Every `.test.ts`/`.test.tsx` under `tests/`, repository-relative. */
function allTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(rel);
    }
  };
  walk("tests");
  return out.sort();
}

/** A uuid written out in full. `g` where a line may hold several. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** `const NAME =`, `let NAME =`. The name only. */
const DECLARES = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
/** A call that puts a row in `auth.users`. Both helpers, both spellings. */
const SEED_CALL = /\bseed(?:AuthUser|LocalAccounts)\s*\(/g;

/**
 * `NAME` used where an owner goes.
 *
 * Derived from the **seams** rather than from a list of names somebody thought
 * of — `ownerId:`, `owner_id`, `setRequestOwner(`, `runAsOwner(`, and the two
 * request-identity keys `as:` and `sub:`. A name list (`OWNER`, `ALICE`,
 * `OUTSIDER`, …) would be a second list beside the data, which is how a fixture
 * called `PROPRIETOR` gets missed.
 */
function ownerPosition(name: string): RegExp {
  return new RegExp(
    `(?:owner(?:_?id)?\\s*[:=]|setRequestOwner\\s*\\(|runAsOwner\\s*\\(|\\bas:|\\bsub:)\\s*${name}\\b`,
    "i",
  );
}

/** From the `(` at `open`, the index just past its matching `)`. */
function afterBalanced(code: string, open: number): number {
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === "(") depth++;
    else if (code[j] === ")" && --depth === 0) return j + 1;
  }
  return code.length;
}

/** One fixed owner a file names, and whether the scan can see it seeded. */
interface OwnerSighting {
  /** Lower-case uuid — the identity the foreign key checks. */
  readonly uuid: string;
  /** The constant's name where there is one, else the uuid. For the message. */
  readonly label: string;
  /** The scan resolved this uuid inside a seed call's arguments. */
  readonly seeded: boolean;
}

interface LaneScan {
  /** Files that open a connection of their own: they need a lane. */
  readonly postgres: string[];
  /** file → the fixed owners it names. Only files that name at least one. */
  readonly owners: Map<string, OwnerSighting[]>;
  /** Files containing any seed call at all, for the weakest cross-check. */
  readonly seedsSomething: Set<string>;
}

/**
 * **A syntactic inventory guard, and that is all it claims to be.**
 *
 * GPT Sol reviewed the first version and the correction is worth having at the
 * top rather than the bottom: this finds *the text a file contains*, not the
 * connections it opens. It is genuinely non-vacuous: reviewing it on 2026-09-03
 * Sol re-derived the same inventory independently and audited direct `pg`
 * imports and `getDb()` use without finding an omission. (Its figures are a
 * *dated sample*, not a fact — run the guard for today's; four counts in this
 * plan drifted inside one day, which is why none is written down here.) But the
 * predicate cannot see:
 *
 * - an aliased or namespaced constructor, `new PgPool()` or `new pg.Pool()`;
 * - a helper of its own that opens the connection somewhere else;
 * - a dynamic `import()` of a module that connects;
 * - a transitive `getDb()` three modules down inside application code.
 *
 * **A transitive-import guard is not the answer**, and that is measured rather
 * than assumed: on 2026-09-03 Sol found of the order of a hundred and fifty
 * test files outside the lane map that can *reach* a module importing `pg`,
 * nearly all of them legitimate unit tests that mock it or never execute that
 * path. Widening the net that far would produce a manifest of half the suite
 * and mean nothing.
 *
 * So the semantic backstop belongs in the harness, not here, and it is T-D's:
 * **the unit project must delete or poison `DATABASE_URL` after `.env.local`
 * has loaded**, so a database test that escaped this inventory fails loudly
 * instead of quietly reaching the shared database. Until that lands, an escapee
 * is invisible. Said out loud because an over-claimed guard is worse than a
 * modest one, and this plan has spent a day on exactly that class
 * (docs/reusable/silent-success.md).
 *
 * Run live rather than checked in, for the reason the hole check above gives: a
 * recorded answer is a claim about the tree as it was, and the tree moving is
 * why the guard exists. ~520 file reads, well under a second.
 */
/**
 * Connection-opening **helpers**, named explicitly.
 *
 * A file that imports one of these opens a connection without any of the syntax
 * `opensAConnection` looks for appearing in it. Short and checked:
 * `helpers/pg-ready.ts` builds the probe pool, and `corpus-lock`, `run-lock`
 * and `lock-lifecycle` each hold an advisory lock on a connection of their own.
 *
 * It added nothing when it was written — every file that imported one also
 * called `pgReady(` or built a pool, measured 2026-09-03 — and it was here for
 * the file that did not. **That file arrived the next day.**
 * `a-long-pdf-is-refused-before-it-is-stored` landed from another worktree on
 * 2026-09-04, seeded an owner through `seed-auth-user`, and matched none of the
 * syntax above; T-D's poisoned `DATABASE_URL` is what caught it, by failing its
 * insert. The seeding helpers are named here now so that the *guard* catches
 * the next one instead of a test failure — which is the whole difference
 * between a manifest that is checked and a manifest that is believed.
 *
 * Adding a name here rather than an entry to `LANES_BEYOND_THE_SCAN` is the
 * deliberate direction: that list's own docstring says a long one means the
 * predicate has stopped being a useful approximation, and the answer is a
 * better predicate.
 *
 * **`seed-local-accounts` is deliberately *not* here**, and the reason is the
 * limit of this whole mechanism: it matches a **module**, not an export. That
 * file's connecting export is `seedLocalAccounts`, but it also exports
 * `localAccounts`, which is pure — and `seed-local-accounts.test.ts` imports
 * only the pure one. Listing the module demanded a lane for a test that never
 * opens a connection, which would have put a false claim in the manifest to
 * catch nothing: the connecting export is imported by `tests/setup/` alone, and
 * setup files are not scanned. Measured, 2026-09-04, by watching the guard go
 * red on both files and reading the second one.
 *
 * The same edge remains for `seed-auth-user`: a file importing only its types
 * would be asked for a lane it does not need. That has not happened, its one
 * value export connects unconditionally, and a false positive here is a
 * question rather than a silence — which is the right way round.
 */
const CONNECTING_HELPERS = [
  "pg-ready",
  "corpus-lock",
  "run-lock",
  "lock-lifecycle",
  "seed-auth-user",
];

/**
 * Does this file open a Postgres connection of its own?
 *
 * `pgReady(` with the paren, so a mention is not a call. `new Pool`/`new Client`
 * catches the files that build their own connection instead — including
 * `db-test-create` and `migration-reconciliations`, which an earlier draft
 * missed entirely because they never call `pgReady`. And an
 * `import … from "…/helpers/<name>.js"` for one of the helpers above — matched
 * as an import specifier and **not** as a bare name, because the bare names are
 * in the array right above and a guard that flagged itself was the first thing
 * this predicate did.
 */
function opensAConnection(code: string): boolean {
  if (/\bpgReady\s*\(/.test(code)) return true;
  if (/\bnew\s+(Pool|Client)\s*\(/.test(code)) return true;
  return CONNECTING_HELPERS.some((h) =>
    new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*helpers/${h}\\.js["']`).test(code),
  );
}

/**
 * The text of every seed call, plus the `for (` line above it.
 *
 * `for (const id of [OWNER, STRANGER])` immediately above a
 * `seedAuthUser(target, { id, … })` is how three files seed two owners at once,
 * and it is the only indirection followed. One level, and no further: chasing a
 * local `seedOwner()` wrapper is where a regex starts pretending to be a
 * compiler, so `feedback-store` declares its two pairs instead and
 * `OWNER_AUDIT` says why.
 */
function seedWindows(code: string): string[] {
  const windows: string[] = [];
  for (const m of code.matchAll(SEED_CALL)) {
    windows.push(code.slice(m.index, afterBalanced(code, code.indexOf("(", m.index))));
    const lineStart = code.lastIndexOf("\n", m.index) + 1;
    const prevStart = code.lastIndexOf("\n", lineStart - 2) + 1;
    const above = code.slice(prevStart, Math.max(prevStart, lineStart - 1));
    if (/\bfor\s*\(/.test(above)) windows.push(above);
  }
  return windows;
}

/**
 * Every fixed owner one file names, three ways, and each catches what the
 * others miss.
 *
 * 1. a uuid literal on a line that says `owner` — alone this missed `STRANGER`
 *    in `store-uploads-parity`, declared without an `as OwnerId`;
 * 2. a `const NAME = "uuid"` whose name is later used in an owner position —
 *    alone this missed the inline literal in `store-ai-calls`;
 * 3. anything resolvable inside a seed window, which is the only rule that says
 *    something about *seeding* and is also a widening: a row put in
 *    `auth.users` is an owner by definition, which is how
 *    `store-realtime-sessions`' second owner arrives at all.
 */
function ownersIn(lines: string[], code: string): OwnerSighting[] {
  const seedText = seedWindows(code).join("\n");

  /* `const NAME = "uuid"`, so a name used in an owner position can be resolved
     back to the id the foreign key will see. */
  const bound = new Map<string, string>();
  for (const line of lines) {
    const name = DECLARES.exec(line)?.[1];
    const u = name ? line.match(UUID)?.[0] : undefined;
    if (name && u) bound.set(name, u.toLowerCase());
  }

  const found = new Map<string, { label: string; seeded: boolean }>();
  const note = (uuid: string, label: string, seeded: boolean): void => {
    const at = found.get(uuid) ?? { label, seeded: false };
    at.seeded ||= seeded;
    /* Prefer a name over a bare uuid, so the failure message is readable. */
    if (/^[A-Za-z_$]/.test(label) && !/^[A-Za-z_$]/.test(at.label)) at.label = label;
    found.set(uuid, at);
  };

  for (const line of lines) {
    if (!/owner/i.test(line)) continue;
    for (const m of line.matchAll(UUID)) {
      note(m[0].toLowerCase(), DECLARES.exec(line)?.[1] ?? m[0].toLowerCase(), false);
    }
  }
  for (const [name, uuid] of bound) {
    if (ownerPosition(name).test(code)) note(uuid, name, false);
    if (new RegExp(`\\b${name}\\b`).test(seedText)) note(uuid, name, true);
  }
  for (const m of seedText.matchAll(UUID)) note(m[0].toLowerCase(), m[0].toLowerCase(), true);

  return [...found].map(([uuid, o]) => ({ uuid, label: o.label, seeded: o.seeded }));
}

function laneScan(): LaneScan {
  const postgres: string[] = [];
  const owners = new Map<string, OwnerSighting[]>();
  const seedsSomething = new Set<string>();

  for (const file of allTestFiles()) {
    const lines = codeLinesOf(file);
    const code = lines.join("\n");
    if (!opensAConnection(code)) continue;
    postgres.push(file);
    if (seedWindows(code).length > 0) seedsSomething.add(file);
    const found = ownersIn(lines, code);
    if (found.length > 0) owners.set(file, found);
  }
  return { postgres, owners, seedsSomething };
}

describe("the test-lane map", () => {
  it("gives every file that opens its own Postgres connection exactly one lane", () => {
    const { postgres } = laneScan();

    /* The control, first. Both differences below are empty when `postgres` is
       empty, so a scan that read nothing — a moved `tests/` directory, a
       regex edited into never matching — would pass this case in silence.
       Seventy is well under the ninety-odd measured on 2026-09-03 and well
       over anything a broken scan produces. */
    expect(postgres.length, "the lane scan found no Postgres-touching test files").toBeGreaterThan(
      70,
    );

    const unassigned = postgres.filter((f) => !(f in TEST_LANES)).sort();
    expect(
      unassigned,
      "test files that open a Postgres connection and have no lane in TEST_LANES — give each one " +
        "`private-postgres` unless its oracle is state only the shared local stack has",
    ).toEqual([]);

    /* The other direction, which is what catches a lane entry left behind by a
       rename or by a file that stopped touching Postgres. Without it the map
       grows names nothing checks, and a T-D vitest project built from it gets
       an `include` glob matching nothing. */
    const scanned = new Set(postgres);
    const stale = Object.keys(TEST_LANES)
      .filter((f) => !scanned.has(f) && !(f in LANES_BEYOND_THE_SCAN))
      .sort();
    expect(
      stale,
      "TEST_LANES entries the scan does not find — the file was renamed, deleted, or no longer " +
        "opens a database connection. If it really does reach Postgres in a way the scan cannot " +
        "see, declare it in LANES_BEYOND_THE_SCAN with the evidence",
    ).toEqual([]);

    /* **A file cannot be in two lanes, and no assertion here could check it.**
       `TEST_LANES` is an object literal, so two entries for one path is
       TypeScript error 1117 rather than a runtime fact — see the map's own
       docstring, where the control for that is recorded. This line is here so
       that somebody looking for the "or in two" half finds out where it went
       instead of concluding it was forgotten. */
    expect(Object.keys(TEST_LANES).length).toBe(new Set(Object.keys(TEST_LANES)).size);
  });

  it("keeps the exemptions to the scan honest, since they are the one hole in it", () => {
    /* `LANES_BEYOND_THE_SCAN` is the door in the completeness argument above, so
       it needs its own four checks — the shape of exemption that goes wrong is
       one nobody revisits, and every one of these is a way it stops being true
       without anybody editing it.

       No floor on the size, deliberately: **empty is the good state here**, and
       a control that demanded entries would be arguing for the hole. What the
       cases below cannot go vacuous on is each individual entry. */
    const { postgres } = laneScan();
    const seen = new Set(postgres);

    for (const [file, why] of Object.entries(LANES_BEYOND_THE_SCAN)) {
      expect(existsSync(path.join(REPO, file)), `${file} is exempted and does not exist`).toBe(
        true,
      );
      expect(
        TEST_LANES[file],
        `${file} is exempted from the scan and has no lane — the exemption is only meaningful ` +
          "beside the verdict it excuses",
      ).toBeDefined();
      expect(
        seen.has(file),
        `${file} is declared beyond the scan, and the scan now finds it — delete the exemption, ` +
          "the ordinary completeness check covers it",
      ).toBe(false);
      /* `.trim()`, because `why.length` alone accepts forty-one spaces — a
         reason-shaped string that says nothing, which is exactly the way a
         "must carry a reason" control goes vacuous. GPT Sol, 2026-09-04. */
      expect(why.trim().length, `the reason recorded for ${file}`).toBeGreaterThan(40);
    }
  });

  it("keeps at least one suite in each lane, so neither project is a no-op", () => {
    /* A vitest project with an empty file list runs and reports success, which
       is the shape this repo keeps meeting. Both lanes are named here rather
       than counted, because a count cannot say *which* lane emptied.

       **Equality, not `toContain`, and that refuses `unit` on purpose.** A
       Postgres-touching file assigned to the unit lane would need a third case
       in whatever T-D builds its project globs from, and adding one here
       without noticing is how a file ends up in a project that creates no
       database and then fails for a reason nobody can place. If a file really
       does need it, widen this list *and* T-D's projects in the same change. */
    const lanes = new Set(Object.values(TEST_LANES));
    expect(
      [...lanes].sort(),
      "the lanes actually used — `unit` is refused here until T-D's projects can route it",
    ).toEqual(["private-postgres", "shared-services"]);

    /* And the four that must be shared, by name. These are the whole argument
       for two maps rather than one — GPT Sol's counter-example — so a change
       that quietly moves one into the private lane should have to delete this
       line and say why. */
    const shared = Object.entries(TEST_LANES)
      .filter(([, lane]) => lane === "shared-services")
      .map(([file]) => file)
      .sort();
    expect(shared).toEqual([
      "tests/admin-store.test.ts",
      "tests/auth-user-seeding.test.ts",
      "tests/db-test-create.test.ts",
      "tests/seed-admin-signin.test.ts",
    ]);
  });

  it("gives every (file, owner) pair a verdict, and every verdict a pair", () => {
    const { owners, seedsSomething } = laneScan();

    /* Controls, both directions and both about *pairs* rather than files. An
       empty `owners` would excuse everybody; a scan that saw no seed call
       anywhere would accuse everybody. Both are what a regex edited into never
       matching looks like, and both are indistinguishable from a clean tree
       from outside. Floors rather than pins, because the tree moves and this
       plan has been wrong about four counts in a day. */
    const pairs = [...owners].flatMap(([file, list]) => list.map((o) => ({ file, ...o })));
    expect(pairs.length, "the scan found no fixed owner uuid in any Postgres test").toBeGreaterThan(
      15,
    );
    expect(
      pairs.filter((p) => p.seeded).length,
      "the scan resolved no owner inside a seed call, so it can vouch for nobody",
    ).toBeGreaterThan(5);
    expect(seedsSomething.size, "no Postgres test contains a seed call at all").toBeGreaterThan(5);

    /* 1 — every pair has a verdict. This is the one that catches a *new* owner
       arriving, which is the whole point of the map. */
    const unverdicted = pairs
      .filter((p) => OWNER_AUDIT[p.file]?.[p.uuid] === undefined)
      .map((p) => `${p.file} ${p.label} ${p.uuid}`)
      .sort();
    expect(
      unverdicted,
      "fixed owners under the auth.users foreign key with no verdict in OWNER_AUDIT — seed the " +
        "row and record `seeded`, or record `no-row-needed` with what the owner is used for and " +
        "what would change if it started being written under",
    ).toEqual([]);

    /* 2 — and every verdict names a pair the scan still finds. A stale entry is
       worse than a missing one: it reads as a considered decision about an owner
       that has been renamed, re-numbered or deleted, and the next person
       believes it. */
    const seen = new Set(pairs.map((p) => `${p.file}\u0000${p.uuid}`));
    const stale = Object.entries(OWNER_AUDIT)
      .flatMap(([file, byOwner]) => Object.keys(byOwner).map((uuid) => `${file} ${uuid}`))
      .filter((k) => !seen.has(k.replace(" ", "\u0000")))
      .sort();
    expect(
      stale,
      "OWNER_AUDIT entries the scan no longer finds — the constant was renamed, its uuid changed, " +
        "or the file stopped naming a fixed owner",
    ).toEqual([]);

    /* 3 — the two cross-checks the scan can make soundly, and no more.

       `no-row-needed` on an owner the scan *can see* inside a seed call is a
       contradiction: the file seeds it, so the entry is out of date. And
       `seeded` in a file with no seed call anywhere is a claim with nothing
       behind it. Both are one-directional — the scan never concludes a pair is
       unseeded, because `feedback-store` seeds through a wrapper it cannot
       follow — so neither can produce a false accusation. */
    const contradicted = pairs
      .filter((p) => p.seeded && OWNER_AUDIT[p.file]?.[p.uuid]?.kind === "no-row-needed")
      .map((p) => `${p.file} ${p.label}`)
      .sort();
    expect(
      contradicted,
      "declared `no-row-needed` while the file demonstrably seeds them — the verdict is stale",
    ).toEqual([]);

    const unfounded = Object.entries(OWNER_AUDIT)
      .filter(([file, byOwner]) =>
        Object.values(byOwner).some((v) => v.kind === "seeded") && !seedsSomething.has(file),
      )
      .map(([file]) => file)
      .sort();
    expect(
      unfounded,
      "declared `seeded` in a file that contains no seedAuthUser or seedLocalAccounts call",
    ).toEqual([]);

    /* 4 — the reasons. Required on every `no-row-needed`, and on a `seeded`
       the scan could not confirm — which is exactly where a reader has nothing
       else to go on. Where the scan *did* resolve the seed, the code is the
       evidence and a sentence restating it would be noise. */
    const bare: string[] = [];
    for (const [file, byOwner] of Object.entries(OWNER_AUDIT)) {
      const visible = new Set(
        (owners.get(file) ?? []).filter((o) => o.seeded).map((o) => o.uuid),
      );
      for (const [uuid, verdict] of Object.entries(byOwner)) {
        const needsWhy = verdict.kind === "no-row-needed" || !visible.has(uuid);
        if (needsWhy && (verdict.why ?? "").trim().length < 40) bare.push(`${file} ${uuid}`);
      }
    }
    expect(
      bare,
      "verdicts that need a reason and have none — every `no-row-needed`, and every `seeded` the " +
        "scan could not see for itself",
    ).toEqual([]);
  });
});
