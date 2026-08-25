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

let repo = "";

/** Every line the child put on fd 1, for one `listArticles()` call. */
function shelfLog(): string[] {
  const body = `void (async () => {
    const { listArticles } = await import(${JSON.stringify(path.join(repo, "src", "api.ts"))});
    // It rejects — every directory is corrupt. The rejection is not what this
    // measures, so it is swallowed here rather than allowed to kill the child
    // before the logger has flushed.
    try { await listArticles(); } catch {}
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
  return child.stdout.split("\n").filter((l) => l.trim() !== "");
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
}, 120_000);

afterAll(() => rm(repo, { recursive: true, force: true }));

describe("one homepage load over a shelf of corrupt articles", () => {
  it("says it once, rather than once per directory", () => {
    const lines = shelfLog();
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
    const line = shelfLog().find((l) => l.includes("could not be read or parsed"));
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
       rather than one, because a single call cannot disagree with itself. */
    const first = shelfLog().find((l) => l.includes("could not be read or parsed"));
    const second = shelfLog().find((l) => l.includes("could not be read or parsed"));
    const files = (l?: string) => (JSON.parse(l ?? "{}") as { files?: string[] }).files;
    // Asserted before the comparison, because two absent lists are equal and
    // that would make this pass on code that logs nothing at all.
    expect(files(first)).toBeDefined();
    expect(files(first)).toEqual(files(second));
  });
});
