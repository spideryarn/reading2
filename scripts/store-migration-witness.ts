/**
 * Which test files **actually execute** a filesystem-store function when the
 * suite runs — witness 2 of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * and the instrument that produces `tests/store-migration-witness.json`.
 *
 * Witness 1 ([store-migration-candidates.ts](store-migration-candidates.ts)) is
 * static: it walks the import graph and answers *which tests could reach* a
 * condemned module. This one is dynamic and answers *which tests did*. The two
 * disagree by a lot in both directions — 192 could, 88 did, and 46 of those 88
 * had no direct import at all — which is the whole reason the manifest has two
 * witnesses rather than one clever predicate
 * (docs/reusable/silent-success.md: a guard that shares its discovery mechanism
 * with the thing it guards agrees with the bug).
 *
 * ## How it measures
 *
 * `vitest.witness.config.ts` derives the three real lanes from
 * `vitest.config.ts` and adds a Vite plugin that swaps each condemned module
 * for a generated wrapper: every export is re-exported through a Proxy that
 * records `module:export` when it is **called**, and `module:export.method`
 * when a method on an exported object is called. `tests/setup/fs-store-witness-setup.ts`
 * writes one JSON line per test file — its path and the sites it reached — and
 * this script runs the suite, aggregates those lines, and buckets every test
 * file on disk.
 *
 * **"Did not report" is kept apart from "did not touch."** A file that failed
 * or skipped before its `afterAll` writes no line, and is `unresolved` rather
 * than assumed clean. `--full` re-runs each unresolved file on its own before
 * giving up on it. That distinction is the point of the whole witness; a bucket
 * that quietly absorbs the files nobody watched is worse than no witness.
 *
 * ## What it cannot see
 *
 * - **Reads.** The proxy observes calls. A test that imports `PATHS` from
 *   `artifacts-fs` and merely reads it executes nothing, and lands in
 *   `ranAndTouchedNothing`. One file is in that class
 *   (`tests/store-artefacts-pg.test.ts`, found by GPT Sol on 2026-09-03); it is
 *   excluded from both buckets by `READ_ONLY_BLIND_SPOTS` below and carries a
 *   registry entry marked `evidence: "static-only"` instead.
 * - **A second module id.** `tests/store-fs-write-chains.test.ts` loads
 *   `ai-calls-fs` as `import("…?copy=2")` and `vi.mock`s `node:fs/promises`, so
 *   the wrapper is not what it gets. That duplication is that file's subject.
 * - **Source read as text.** `tests/slug.test.ts` reads `jobs-fs.ts` as a
 *   string. No import, no call, invisible to both witnesses — the manifest
 *   carries it by hand.
 * - **`src/store/blobs-fs.ts`**, deliberately: it is selected by credentials
 *   rather than by `SPIDERYARN_STORE` and is out of the migration's scope.
 *
 * ## Run it
 *
 *   npx tsx scripts/store-migration-witness.ts --self-check
 *       Twelve named control files, ~1 minute. Asserts that seven positives hit
 *       the sites they hit in the 2026-09-03 measurement — every instrumented
 *       module covered by at least one — that four negatives ran and reported
 *       nothing, and that the read-only blind spot still looks exactly like a
 *       clean file. **Run this before believing any output**: an instrument
 *       that had silently stopped hooking anything would produce an empty
 *       `touched`, which is the one shape that lets the registry test pass
 *       while proving nothing.
 *
 *   npx tsx scripts/store-migration-witness.ts --files tests/jobs.test.ts …
 *       Ad-hoc: run named files and print what each touched. Writes no JSON.
 *
 *   npx tsx scripts/store-migration-witness.ts --full [--out FILE]
 *       The whole suite, instrumented (~12 minutes, and it takes the box's
 *       Postgres lanes with it, so do not run it beside other agents' suites).
 *       Writes to a scratch file unless `--out` says otherwise; overwriting
 *       `tests/store-migration-witness.json` is deliberate and explicit:
 *
 *         npx tsx scripts/store-migration-witness.ts --full --out tests/store-migration-witness.json
 *
 * The measurement has a date on it and the tree moves under it — the run that
 * counted 588 test files was followed ninety minutes later by a walk that saw
 * 597. Re-derive, never inherit; and if a count here disagrees with a count in
 * a plan, the plan is the older one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "./vitest.witness.config.ts";
const VITEST = join(REPO, "node_modules/.bin/vitest");

/** The command that regenerates the JSON, recorded *in* the JSON so it cannot
 *  go missing again — which is exactly what happened to the first instrument. */
const REGENERATE = "npx tsx scripts/store-migration-witness.ts --full --out tests/store-migration-witness.json";

/** The condemned modules still standing, instrumented at method level. Eight
 *  until stage G, 2026-09-05, took `uploads-fs`, `ai-calls-fs` and
 *  `realtime-sessions-fs`. Kept in step with `CONDEMNED` in
 *  vitest.witness.config.ts — `assertConfigAgrees()` checks. */
const INSTRUMENTED = [
  "src/store/fs.ts",
  "src/store/artifacts-fs.ts",
  "src/store/jobs-fs.ts",
  "src/store/copy-artefacts.ts",
  "src/store/data-root.ts",
] as const;

const NOT_INSTRUMENTED = ["src/store/blobs-fs.ts — selected by credentials, out of scope"];

/** Verbatim in the output because both are still true, and because
 *  tests/store-migration-registry.test.ts reads them: a witness that dropped
 *  its own blind spots would be a cleaner-looking lie. */
const KNOWN_BLIND_SPOTS = [
  "RETIRED 2026-09-05, stage G: tests/store-fs-write-chains.test.ts loaded ai-calls-fs under a second module id (import('...?copy=2')) and vi.mocked node:fs/promises, so the instrument could not see it. That duplication was the file's own subject; the file and both modules it was about are deleted. Kept because the dated measurement in tests/store-migration-witness.json still carries the live wording, and tests/store-migration-registry.test.ts asserts the file is now absent.",
  "THE INSTRUMENT RECORDS CALLS, NOT READS. A test that imports a non-function export from a condemned module and merely reads it executes nothing the proxy can observe, so it lands in ranAndTouchedNothing. Found by GPT Sol reviewing stage A, 2026-09-03: tests/store-artefacts-pg.test.ts reads PATHS from artifacts-fs and was filed as touching nothing. A static sweep for runtime imports of a condemned module across all test files found that to be the only member of the class, and it now has a registry entry carrying evidence 'static-only'. THIS IS WHY ranAndTouchedNothing IS NOT PROOF ON ITS OWN, and why the registry's hole check re-derives the static universe on every run rather than trusting this file.",
];

/**
 * Files the instrument watches touch nothing **and that is a false negative**,
 * so they are reported in neither bucket rather than in the clean one.
 *
 * This is the hand-edit the 2026-09-03 measurement carried, written down as
 * code: `ranAndTouchedNothing` went 499 → 498 when the read-only blind spot was
 * found, and `tests/store-migration-registry.test.ts` asserts that this file is
 * absent from that list. A run that silently put it back would flip a verdict
 * the registry depends on.
 */
const READ_ONLY_BLIND_SPOTS: Record<string, string> = {
  "tests/store-artefacts-pg.test.ts": "reads PATHS from artifacts-fs without calling anything — registry evidence: static-only",
};

// ------------------------------------------------------------------- controls

type Control = {
  readonly file: string;
  /** Sites this file reached on 2026-09-03. A control asserts the **subset**,
   *  not equality: gaining a site is a change in the test, losing one is a
   *  change in the instrument or a conversion, and only the second is a
   *  failure worth stopping for. */
  readonly expect: readonly string[];
};

/**
 * Four positives, chosen so that **every module in `INSTRUMENTED` is covered
 * by at least one** — `assertControlsCoverEveryModule()` checks that rather
 * than trusting this comment — and so that the assertions are method-level
 * (`fsJobStore.get`, not merely `jobs-fs`), because a proxy that hooked modules
 * but lost methods would still look busy.
 *
 * **All four now run in the `unit` lane.** The three that ran in
 * `private-postgres` were the three stage G deleted, so this file no longer
 * proves the private lane mints its database under the instrument — nothing
 * else does either, and that is a gap rather than a decision. Counted against
 * `TEST_LANES` on 2026-09-05.
 *
 * **They are a dated choice, not a fixture.** Stage B converts these files one
 * by one, and when it converts one this self-check goes red saying so. That is
 * the correct failure: replace the control with a file that still touches the
 * same module, and if no file does, that module is done.
 */
const POSITIVE_CONTROLS: readonly Control[] = [
  { file: "tests/data-root.test.ts", expect: ["data-root:dataRoot", "data-root:chooseDataRoot", "artifacts-fs:fsLocations"] },
  { file: "tests/jobs-fs-load.test.ts", expect: ["jobs-fs:fsJobStore.get", "jobs-fs:fsJobStore.list", "jobs-fs:reloadForTests"] },
  { file: "tests/artefact-copy.test.ts", expect: ["copy-artefacts:copyArtefacts", "copy-artefacts:readParts", "artifacts-fs:createFsArtifactStore"] },
  /* **Three controls stood here until stage G, 2026-09-05** — for `uploads-fs`,
     `ai-calls-fs` and `realtime-sessions-fs`. They went with the modules they
     controlled, which is the paragraph above happening for the last time on
     each: a control whose module has been deleted has nothing left to prove.
     `assertControlsCoverEveryModule()` is what says the remaining four still
     cover the five that survive. */
  { file: "tests/store-chat-tail-guard.test.ts", expect: ["fs:fsChatStore.begin", "fs:fsChatStore.finish", "fs:fsChatStore.load"] },
];

/**
 * Four negatives. Each must **report**, and report nothing — a negative control
 * that never wrote a line proves the run broke, not that the file is clean, and
 * conflating those two is the failure this witness exists to avoid.
 *
 * `store-selection` is the sharpest of them: its subject is the store flag, so
 * an instrument that hooked on import rather than on call would light it up.
 */
const NEGATIVE_CONTROLS = [
  "tests/store-selection.test.ts",
  "tests/corpus-materialise.test.ts",
  "tests/chat-web-links-prompt.test.ts",
  "tests/note-arrival.test.ts",
];

/** The read-only blind spot, asserted to still look exactly like a clean file.
 *  When this stops being empty the blind spot has closed and the exclusion in
 *  `READ_ONLY_BLIND_SPOTS` should go. */
const BLIND_SPOT_CONTROL = "tests/store-artefacts-pg.test.ts";

// ------------------------------------------------------------------ mechanics

type Records = Map<string, Set<string>>;

function listTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry)) out.push(relative(REPO, full));
    }
  };
  walk(join(REPO, "tests"));
  return out.sort();
}

/** The two module lists must not drift: the config decides what is hooked and
 *  this script decides what the JSON claims was hooked. */
function assertConfigAgrees(): void {
  const config = readFileSync(join(REPO, "vitest.witness.config.ts"), "utf8");
  const start = config.indexOf("const CONDEMNED = [");
  const declared = new Set(
    [...config.slice(start, config.indexOf("]", start)).matchAll(/"([\w-]+)"/g)].map((m) => `src/store/${m[1]}.ts`),
  );
  const missing = INSTRUMENTED.filter((m) => !declared.has(m));
  const extra = [...declared].filter((m) => !INSTRUMENTED.includes(m as (typeof INSTRUMENTED)[number]));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `the two module lists have drifted: vitest.witness.config.ts does not hook ${missing.join(", ") || "—"}, and hooks ${extra.join(", ") || "—"} that this script would not report`,
    );
  }
}

function assertControlsCoverEveryModule(): void {
  const covered = new Set(POSITIVE_CONTROLS.flatMap((c) => c.expect.map((s) => `src/store/${s.split(":")[0]}.ts`)));
  const uncovered = INSTRUMENTED.filter((m) => !covered.has(m));
  if (uncovered.length > 0) {
    throw new Error(`no positive control exercises ${uncovered.join(", ")} — add one, or say why the module has no caller left`);
  }
}

/** One instrumented vitest run over `files` (all of them when empty), appending
 *  its records to `out`. Returns vitest's exit status, which is routinely
 *  non-zero: this tree has failures of its own and a red suite still records. */
function runVitest(files: readonly string[], out: string): number {
  const env: NodeJS.ProcessEnv = { ...process.env, FSW_OUT: out };
  const result = spawnSync(VITEST, ["run", "--config", CONFIG, ...files], {
    cwd: REPO,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  return result.status ?? -1;
}

/** Every line the setup file wrote, unioned per test file. A malformed line is
 *  a hole in the answer, so it throws rather than being skipped. */
function readRecords(out: string): Records {
  const records: Records = new Map();
  if (!existsSync(out)) return records;
  const text = readFileSync(out, "utf8");
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let parsed: { testPath?: unknown; sites?: unknown };
    try {
      parsed = JSON.parse(line) as { testPath?: unknown; sites?: unknown };
    } catch {
      throw new Error(`${out}:${i + 1} is not JSON — concurrent appends were interleaved, and the measurement is incomplete`);
    }
    const { testPath, sites } = parsed;
    if (typeof testPath !== "string" || !Array.isArray(sites)) {
      throw new Error(`${out}:${i + 1} is not a witness record: ${line.slice(0, 120)}`);
    }
    const file = testPath.startsWith("/") ? relative(REPO, testPath) : testPath;
    const already = records.get(file) ?? new Set<string>();
    for (const site of sites) already.add(String(site));
    records.set(file, already);
  }
  return records;
}

/** Records go to the OS temp dir, **not** under `data/`: the filesystem store's
 *  own `listArticles` enumerates the directories in `data/`, so a witness
 *  directory dropped there would read back as an article and break the very
 *  suite the instrument is watching. */
function scratchFile(name: string): string {
  const dir = process.env.SPIDERYARN_WITNESS_DIR ?? join(tmpdir(), "spideryarn-store-witness");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${Date.now()}.jsonl`);
  appendFileSync(file, "", "utf8");
  return file;
}

// ------------------------------------------------------------------ self-check

function selfCheck(): number {
  assertConfigAgrees();
  assertControlsCoverEveryModule();

  const files = [...POSITIVE_CONTROLS.map((c) => c.file), ...NEGATIVE_CONTROLS, BLIND_SPOT_CONTROL];
  const absent = files.filter((f) => !existsSync(join(REPO, f)));
  if (absent.length > 0) {
    console.log(`FAIL  control files no longer on disk: ${absent.join(", ")}`);
    return 1;
  }

  const out = scratchFile("self-check");
  const status = runVitest(files, out);
  const records = readRecords(out);
  const failures: string[] = [];

  console.log("\n=== self-check ===================================================");
  console.log(`vitest exit status ${status} (non-zero is not itself a failure here)\n`);

  for (const { file, expect } of POSITIVE_CONTROLS) {
    const seen = records.get(file);
    if (seen === undefined) {
      failures.push(`${file}: POSITIVE CONTROL DID NOT REPORT — it failed or skipped before afterAll, so it proves nothing`);
      console.log(`  FAIL  ${file}  no record`);
      continue;
    }
    /* `@load` marks a site reached while the module graph was still loading.
       It is the same site; the phase is detail the assertion should not care
       about. */
    const bare = new Set([...seen].map((s) => s.replace(/@load$/, "")));
    const missing = expect.filter((s) => !bare.has(s));
    if (missing.length > 0) {
      failures.push(`${file}: expected ${missing.join(", ")}; saw ${[...seen].join(", ") || "nothing"}`);
      console.log(`  FAIL  ${file}  missing ${missing.join(", ")}`);
    } else {
      console.log(`  ok    ${file}  ${seen.size} sites, ${new Set([...bare].map((s) => s.split(":")[0])).size} modules`);
    }
  }

  for (const file of NEGATIVE_CONTROLS) {
    const seen = records.get(file);
    if (seen === undefined) {
      failures.push(`${file}: NEGATIVE CONTROL DID NOT REPORT — "did not run" is not "did not touch"`);
      console.log(`  FAIL  ${file}  no record`);
    } else if (seen.size > 0) {
      failures.push(`${file}: negative control touched ${[...seen].join(", ")}`);
      console.log(`  FAIL  ${file}  touched ${[...seen].join(", ")}`);
    } else {
      console.log(`  ok    ${file}  reported, touched nothing`);
    }
  }

  const blind = records.get(BLIND_SPOT_CONTROL);
  if (blind === undefined) {
    failures.push(`${BLIND_SPOT_CONTROL}: blind-spot control did not report`);
    console.log(`  FAIL  ${BLIND_SPOT_CONTROL}  no record`);
  } else if (blind.size > 0) {
    console.log(`  NOTE  ${BLIND_SPOT_CONTROL} now touches ${[...blind].join(", ")} — the read-only blind spot has closed; drop it from READ_ONLY_BLIND_SPOTS`);
  } else {
    console.log(`  ok    ${BLIND_SPOT_CONTROL}  reported empty, as the read-only blind spot predicts`);
  }

  /* The control the controls cannot give: method-level detail. A proxy that
     wrapped modules but returned methods unwrapped would satisfy every
     module-level expectation above and record no `export.method` site at all.

     **The floor is a margin above zero, not a census.** It was 10 against seven
     controls; stage G deleted three of those with their modules and the four
     that remain measure 8 (2026-09-05). Set to 5 rather than to 8 on purpose:
     the sentence this prints diagnoses a *collapse* toward zero, and at 8 it
     would fire with that wording for any ordinary edit to a control — which is
     the failure being reported wrongly rather than caught. Losing a control's
     sites is already caught above, by name. */
  const methodSites = [...records.values()].flatMap((s) => [...s]).filter((s) => s.includes("."));
  if (methodSites.length < 5) {
    failures.push(`only ${methodSites.length} method-level sites across all controls — the object proxy has stopped wrapping methods`);
    console.log(`  FAIL  method-level detail: ${methodSites.length} sites`);
  } else {
    console.log(`  ok    method-level detail: ${methodSites.length} sites`);
  }

  console.log(`\nwitness records: ${out}`);
  if (failures.length > 0) {
    console.log(`\nSELF-CHECK FAILED (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log("\nDo not believe a witness whose instrument cannot pass this.");
    return 1;
  }
  console.log(`\nself-check passed: the instrument still hooks all ${INSTRUMENTED.length} modules, at method level.`);
  return 0;
}

// ----------------------------------------------------------------------- full

/** Beyond this, the run itself broke; re-running files one at a time would take
 *  hours and paper over it. */
const MAX_RERUN = 40;

function full(outJson: string): number {
  assertConfigAgrees();
  const records0 = scratchFile("full");
  const status = runVitest([], records0);

  const onDisk = listTestFiles();
  let records = readRecords(records0);
  let unresolved = onDisk.filter((f) => !records.has(f));

  /* The three files that failed or skipped mid-run in the 2026-09-03 pass were
     re-run by hand afterwards, and two of them turned out to touch. Doing it in
     the script is the difference between a measurement and a guess. */
  if (unresolved.length > 0 && unresolved.length <= MAX_RERUN) {
    console.log(`\n=== ${unresolved.length} file(s) did not report; re-running each on its own ===`);
    for (const file of unresolved) {
      console.log(`\n--- ${file}`);
      runVitest([file], records0);
    }
    records = readRecords(records0);
    unresolved = onDisk.filter((f) => !records.has(f));
  } else if (unresolved.length > MAX_RERUN) {
    console.log(`\nWARNING ${unresolved.length} files did not report, which is more than ${MAX_RERUN}: the run broke rather than a few files skipping. Not re-running; fix the run.`);
  }

  const touched: Record<string, string[]> = {};
  const clean: string[] = [];
  for (const file of onDisk) {
    const seen = records.get(file);
    if (seen === undefined) continue;
    if (file in READ_ONLY_BLIND_SPOTS && seen.size === 0) continue; // neither bucket; see the constant
    if (seen.size > 0) touched[file] = [...seen].sort();
    else clean.push(file);
  }

  const payload = {
    what: `Witness 2 for docs/plans/260903f: which test files ACTUALLY reach the filesystem store when the suite runs, as opposed to which ones import one. A measurement with a date on it, not a fact — see the plan's 'Counts are perishable'. Regenerate with: ${REGENERATE}`,
    measured: new Date().toISOString(),
    store: "whatever the tree selects (there is one store since 2026-09-05)",
    instrumentedModules: [...INSTRUMENTED],
    notInstrumented: NOT_INSTRUMENTED,
    unresolved,
    counts: {
      testFilesOnDisk: onDisk.length,
      touchesFilesystemStore: Object.keys(touched).length,
      runsAndTouchesNothing: clean.length,
      unresolved: unresolved.length,
    },
    touched,
    ranAndTouchedNothing: clean,
    knownBlindSpots: KNOWN_BLIND_SPOTS,
  };

  console.log("\n=== witness 2 ====================================================");
  console.log(`vitest exit status ${status} (a red suite still records; check the failures are ones you expect)`);
  for (const [k, v] of Object.entries(payload.counts)) console.log(`  ${k.padEnd(24)} ${String(v).padStart(4)}`);
  for (const [file, why] of Object.entries(READ_ONLY_BLIND_SPOTS)) {
    if (records.get(file)?.size === 0) console.log(`  excluded from both buckets: ${file} — ${why}`);
  }
  if (unresolved.length > 0) console.log(`  unresolved: ${unresolved.join(", ")}`);

  /* The floor tests/store-migration-registry.test.ts keeps, applied here too,
     because the cheapest way to make that guard pass while proving nothing is
     to hand it an empty witness. An instrument that stopped hooking looks
     exactly like a suite that stopped touching. */
  if (Object.keys(touched).length <= 50) {
    console.log(`\nREFUSING TO WRITE: only ${Object.keys(touched).length} files touched the filesystem store. Either the migration is nearly done — in which case say so deliberately and lower the floor in tests/store-migration-registry.test.ts in the same commit — or the instrument stopped hooking. Run --self-check before deciding which.`);
    return 1;
  }

  const outFile = resolve(REPO, outJson);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nwritten: ${outFile}`);
  console.log(`records: ${records0}`);
  return 0;
}

// ---------------------------------------------------------------------- files

function namedFiles(files: readonly string[]): number {
  assertConfigAgrees();
  const out = scratchFile("files");
  const status = runVitest(files, out);
  const records = readRecords(out);
  console.log("\n=== what each file touched =======================================");
  for (const file of files) {
    const seen = records.get(file);
    if (seen === undefined) console.log(`  ${file}\n      DID NOT REPORT (failed or skipped before afterAll) — not the same as touching nothing`);
    else if (seen.size === 0) console.log(`  ${file}\n      ran, touched nothing`);
    else console.log(`  ${file}\n      ${[...seen].sort().join("\n      ")}`);
  }
  console.log(`\nvitest exit status ${status}; records: ${out}`);
  return 0;
}

// ------------------------------------------------------------------------ main

const argv = process.argv.slice(2);
const outFlag = argv.indexOf("--out");
const outJson =
  outFlag >= 0 ? (argv[outFlag + 1] ?? "") : join(tmpdir(), "spideryarn-store-witness", "store-migration-witness.json");
if (outFlag >= 0 && outJson === "") throw new Error("--out needs a path");

if (argv.includes("--self-check")) process.exit(selfCheck());
else if (argv.includes("--full")) process.exit(full(outJson));
else if (argv.includes("--files")) {
  const rest = argv.slice(argv.indexOf("--files") + 1);
  const stop = rest.findIndex((a) => a.startsWith("--"));
  const files = stop === -1 ? rest : rest.slice(0, stop);
  if (files.length === 0) throw new Error("--files needs at least one test file");
  process.exit(namedFiles(files));
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]?.replace(/^\/\*\*?|^ ?\* ?/gm, "") ?? "");
  console.log("Pick one of --self-check, --files <paths…>, --full [--out FILE].");
  process.exit(2);
}
