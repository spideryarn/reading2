/**
 * How many lines one homepage load can put in the log — `listArticles` in
 * src/api.ts.
 *
 * **The rule this defends is about shape, not volume:** if the number of lines a
 * piece of code emits grows with the data, the caller says it once instead
 * (docs/project/logging.md § Vercel). Vercel keeps **256 lines per request** and
 * drops the rest, so a walk that logs per directory does not merely make noise —
 * it deletes the end of that request's logs, including whatever else the request
 * wanted to say. The line you needed is the one that got dropped.
 *
 * `describeDir` already aggregates the *incomplete*-directory case. This is the
 * other half: `readJson` warns once per unreadable file, and the shelf calls it
 * three times per directory inside a `Promise.all`.
 *
 * Measured at 300 directories because that is past Vercel's cap, and because the
 * failure is invisible below it — at ten articles a line each looks fine.
 *
 * ## Why a whole copy of the repository
 *
 * `listArticles` walks `path.join(ROOT, "data")` where `ROOT` is derived from
 * `src/api.ts`'s own location, so there is no seam to point it somewhere else.
 * Writing corrupt articles into the real `data/` would work — and would fail
 * `tests/library.test.ts` in a different worker, because that suite calls
 * `listArticles` too and `data/` is shared by every suite at once. A flaky
 * failure attributed to the wrong file is worse than the bug this is about.
 *
 * So the child gets its own `ROOT`: a temporary directory holding a copy of
 * `src/`, the real `package.json`, and a symlink to the real `node_modules`.
 * A few dozen small files, and complete isolation.
 *
 * ## One child, two loads
 *
 * That child is spawned **once for the whole file**, in `beforeAll`, and runs
 * `listArticles()` twice. Every test here asks a question about the log of a
 * homepage load, and two loads answer all three. The reason it matters is in
 * SETUP_MS: what this file costs is compiling `src/api.ts`'s import graph with
 * `tsx`, about 1.08s, and the shelf walk it exists to measure is 19ms of that.
 * A child per test paid the compile four times over to buy ~40ms of the thing
 * under test, and that ratio gets worse every time `src/api.ts` gains an
 * import.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Past Vercel's 256-line ceiling, which is the whole point of the number. */
const DIRS = 300;

/**
 * What the shared setup below is allowed to take — copying `src/`, writing 300
 * directories, and running the one child.
 *
 * **Almost none of that is the shelf**, which is the point of writing the
 * numbers down: the obvious reading of a slow run here, that walking 300
 * directories is slow, is wrong. One child, timed from inside itself, in ms:
 *
 * ```
 * DIRS    boot   import   1st load   2nd load
 *    0   154.9    942.2        6.5        0.3
 *  100   153.4    922.1       10.5        3.4
 *  300   154.2    922.5       19.3        9.9
 * ```
 *
 * ~0.15s to boot node and tsx and ~0.92s to transpile and import
 * `src/api.ts`'s dependency graph — about 1.08s of fixed cost before a single
 * directory is read — against 19ms for the whole walk at the size this file
 * uses, growing 3.19x from 100 directories to 300 where linear is 3x. **The
 * cost is per process, not per article**, which is why there is now one
 * process rather than one per test.
 *
 * So this number is not a performance guard and must not be read as one. At
 * ~0.05ms per directory a real per-directory regression would have to be
 * enormous before it showed up here. The guard against per-directory work is
 * the assertion in the first test, that the line count does not grow with the
 * shelf — and `DIRS` stays at 300 for the same reason, since shrinking it
 * would save ~13ms and cost that test its meaning.
 *
 * The size of the number is for a busy machine, and only that. This suite runs
 * beside others competing for the same cores; at a load average of 331 on 18
 * cores the same child took 13x its idle cost. That is a fact about the
 * machine, not about `src/`.
 */
const SETUP_MS = 180_000;

/**
 * Written to fd 1 by the child after each load, so one child's output can be
 * cut back into one array of lines per load.
 */
const BOUNDARY = "---spideryarn-load-boundary---";

let repo = "";

/**
 * Run `listArticles()` `loads` times **in one child**, and give back the lines
 * it put on fd 1 for each.
 *
 * One child rather than one per load, because the fixed cost above is paid per
 * process: two cold `tsx` starts to prove a property about two shelf walks is
 * ~1.08s of TypeScript compilation to buy ~10ms of the thing under test. Two
 * loads in the same process prove the same property — the names must not move
 * between loads — for half the wall time, and the cost stops growing with
 * `src/api.ts`'s import graph.
 */
function runLoads(loads: number): string[][] {
  const body = `void (async () => {
    const { writeSync } = await import("node:fs");
    const { listArticles } = await import(${JSON.stringify(path.join(repo, "src", "api.ts"))});
    for (let i = 0; i < ${loads}; i++) {
      // It rejects — every directory is corrupt. The rejection is not what this
      // measures, so it is swallowed here rather than allowed to kill the child
      // before the logger has flushed. Swallowed per load, so one rejection
      // does not cost us the loads after it.
      try { await listArticles(); } catch {}
      /* fs.writeSync to fd 1, and NOT console.log: the logger is a pino
         destination with sync: true, which writes straight to the descriptor,
         while process.stdout is asynchronous over a pipe. Two mechanisms means
         the boundary can land on the wrong side of the lines it separates, and
         a boundary that moves would silently hand the second load's warning to
         the first. Same call, same ordering. */
      writeSync(1, ${JSON.stringify(`${BOUNDARY}\n`)});
    }
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  // Neither the suite's own LOG_LEVEL nor NODE_ENV=test may decide what this
  // measures: "test" makes the logger silent, which would make a wall of 300
  // lines and a clean single line indistinguishable — both zero.
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";

  const child = spawnSync(TSX, ["-e", body], { cwd: repo, env, encoding: "utf8" });
  if (child.status !== 0) {
    throw new Error(`shelf child exited ${child.status}:\n${child.stderr}`);
  }

  /* One boundary written per load, so one more chunk than loads. Checked rather
     than sliced blind: a child that died half way through would otherwise hand
     back fewer loads than were asked for, and comparing a load against itself —
     or against nothing — is how this test would pass while measuring one call. */
  const chunks = child.stdout.split(BOUNDARY);
  if (chunks.length !== loads + 1) {
    throw new Error(
      `expected ${loads} completed loads, saw ${chunks.length - 1}:\n${child.stdout}\n${child.stderr}`,
    );
  }
  return chunks.slice(0, loads).map((c) => c.split("\n").filter((l) => l.trim() !== ""));
}

/**
 * The two loads, from the single child, shared by all three tests below.
 *
 * Every test here asks a question about the log of a homepage load, and two
 * loads answer all three of them: the first two tests are about what one load
 * says, and the last is about the two agreeing. So the file pays for one cold
 * `tsx` start rather than four.
 */
let loads: string[][] = [];

/** One of the shared loads, or a clear failure if the child never produced it. */
function load(i: number): string[] {
  const lines = loads[i];
  if (!lines) throw new Error(`no load ${i}: the shared child in beforeAll did not produce one`);
  return lines;
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "spideryarn-shelf-"));
  await cp(path.join(ROOT, "src"), path.join(repo, "src"), { recursive: true });
  await cp(path.join(ROOT, "package.json"), path.join(repo, "package.json"));
  await symlink(path.join(ROOT, "node_modules"), path.join(repo, "node_modules"));

  /* Malformed from the first byte, which is what a truncated write and a
     half-finished ingest both look like — and the shape that makes `readJson`
     throw rather than return null. Named with a fixed width so that sorting
     them is the same as ordering them by number, which is what the determinism
     assertion below relies on being able to state. */
  await Promise.all(
    Array.from({ length: DIRS }, async (_unused, i) => {
      const name = `art-${String(i).padStart(4, "0")}`;
      await mkdir(path.join(repo, "data", name), { recursive: true });
      await writeFile(
        path.join(repo, "data", name, "blocks.json"),
        "not json, and the rest of this line stands in for the article",
        "utf8",
      );
    }),
  );

  /* The one child, for the whole file. It is here rather than in each test
     because the cost is the cold `tsx` start and not the shelf walk (see
     SETUP_MS), so paying it once is the difference between this file costing
     one compile of `src/` and costing four. Two loads, which is what the last
     test needs; the other two read the first of them. */
  loads = runLoads(2);
}, SETUP_MS);

afterAll(() => rm(repo, { recursive: true, force: true }));

describe("one homepage load over a shelf of corrupt articles", () => {
  it("says it once, rather than once per directory", () => {
    const lines = load(0);
    /* The ceiling is deliberately loose. Pinning an exact count would make this
       a test of today's line-by-line wording, which is not the property — the
       property is that the number does not grow with the shelf. 300 directories
       producing single figures proves that; 300 producing 300 is the bug. */
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("still names the corrupt files, rather than going quiet", () => {
    // Bounding the count by dropping the warning would pass the test above and
    // be strictly worse than the bug: a corrupt artefact is a real problem and
    // this line is what makes it findable.
    const line = load(0).find((l) => l.includes("could not be read or parsed"));
    expect(line, "no line mentioned the unreadable artefacts at all").toBeDefined();

    const obj = JSON.parse(line ?? "{}") as { count?: number; files?: string[]; of?: number };
    expect(obj.count).toBe(DIRS);
    // A capped list, not the whole shelf: the names are what make it actionable,
    // but all of them would be a line that grows with the library, and a long
    // line is the one most likely to be truncated by whatever collects it.
    expect(obj.files?.length).toBeLessThanOrEqual(5);
    expect(obj.files?.length).toBeGreaterThan(0);
  });

  it("names the same files on every load", () => {
    /* The names used to be whichever async reads happened to resolve first, so
       the same broken shelf accused different directories on different loads —
       and a name that moves is one you cannot search for twice. Two real loads
       rather than one, because a single call cannot disagree with itself.

       Both loads come from one child. What has to be the same across the two
       calls is the sorted list of names, and sorting does not care which
       process it happens in — so a second cold `tsx` start bought nothing here
       and cost a hundred times the shelf walk it was there to repeat. Verified
       rather than assumed: with the `sort` in `listArticles` removed, two loads
       in one process still disagree, and this test still goes red. */
    const warning = (lines: string[]) =>
      lines.find((l) => l.includes("could not be read or parsed"));
    const files = (l?: string) => (JSON.parse(l ?? "{}") as { files?: string[] }).files;
    // Asserted before the comparison, because two absent lists are equal and
    // that would make this pass on code that logs nothing at all.
    expect(files(warning(load(0)))).toBeDefined();
    expect(files(warning(load(1)))).toBeDefined();
    expect(files(warning(load(0)))).toEqual(files(warning(load(1))));
  });
});
