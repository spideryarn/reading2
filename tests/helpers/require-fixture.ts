/**
 * "Is the committed fixture corpus really there, and readable?" — for the one
 * suite about to read it.
 *
 * ## Why this throws where `./pg-ready.ts` skips
 *
 * They look like the same helper and they are not, and the difference is the
 * whole reason this file is separate.
 *
 * Postgres may legitimately be absent. A fresh clone with no Docker is a normal
 * machine, so `pgReady` reports a *skip* and the run says so. A committed
 * fixture can never legitimately be absent: it is tracked in git, so if it is
 * missing then either somebody deleted it or the suite is looking in the wrong
 * place, and both of those are bugs. A skip there would be the exact failure
 * this corpus was built to end — the deploy gate's thirteen failures and two
 * hundred cascade-skips, and the ~19 test files that need an article a fresh
 * clone does not have (docs/plans/260901b-committed-fixture-corpus.md).
 *
 * So: **throw**, at module scope, before the suite registers a single test.
 *
 * ## What it borrows from `pg-ready.ts`
 *
 * The conventions there are hard-won and they hold here too:
 *
 * - **checked at module scope**, so the failure arrives before any `beforeAll`
 *   has had a chance to fail for a second reason and bury the first;
 * - **`process.stderr.write`, never `console.warn`** — vitest's console
 *   interception swallows a `console.warn` made at module load, which is how
 *   the "loud skip" family turned out to have been silent the whole time. This
 *   file only writes to stderr on the way to throwing, where the thrown message
 *   is the loud part, but the rule is the same and the reason is the same.
 *
 * ## Why it parses rather than stats
 *
 * `existsSync` waves through a file truncated to nothing, a file half-written
 * by an interrupted copy, and a git-lfs pointer standing in for the real bytes.
 * All three read as "the fixture is there" and then fail somewhere else — a
 * `JSON.parse` inside the code under test, three frames away from the cause. So
 * every JSON part is parsed, and the error names the file that would not.
 *
 * ## What it deliberately does NOT do
 *
 * There is no global check. A focused unit test that never touches the corpus
 * must not be made to depend on it — that is ranked silent failure 4 in the
 * plan, a `globalSetup` that makes the adapters look hermetic while the direct
 * readers stay shared. Call this from the suites that consume fixtures, naming
 * what they consume.
 *
 * ```ts
 * requireFixture("writes", ["blocks.json", "tree.json", "output.blocks.json"]);
 * ```
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where the committed corpus lives.
 *
 * `import.meta.dirname` and not `findRepoRoot`: this file is in `tests/helpers/`
 * and stays there — `src/store/data-root.ts` is on stage 4's deletion list
 * (docs/plans/260831b-finish-the-database-move.md) and the corpus seam must not
 * be built into something scheduled for demolition.
 *
 * The directory is called `data-root` because that is what it is: the thing
 * `SPIDERYARN_DATA_ROOT` points at, with `data/` and `output/` hanging off it.
 * The name makes the temporary coupling to the old store layout visible in the
 * path rather than hidden behind a friendlier word.
 */
export const FIXTURE_ROOT = path.resolve(import.meta.dirname, "..", "fixtures", "data-root");

/**
 * One part of a fixture article.
 *
 * A plain filename means `data/<slug>/<name>`. The two `output.` names mean the
 * files stage 2 and stage 3 write outside the article's directory —
 * `output/<slug>.html` and `output/<slug>.blocks.json` — which several suites
 * need and which no filename inside `data/<slug>/` can express.
 */
export type FixturePart = string;

/** Absolute path of one part, whichever of the two shapes it is. */
export function fixturePath(slug: string, part: FixturePart): string {
  if (part === "output.html") return path.join(FIXTURE_ROOT, "output", `${slug}.html`);
  if (part === "output.blocks.json") {
    return path.join(FIXTURE_ROOT, "output", `${slug}.blocks.json`);
  }
  return path.join(FIXTURE_ROOT, "data", slug, part);
}

/**
 * Assert every named part of `slug` exists and parses, or throw saying which.
 *
 * Call it at module scope, above the `describe`, in every suite that reads the
 * corpus. It returns nothing: the value is the throw.
 */
export function requireFixture(slug: string, parts: readonly FixturePart[]): void {
  if (!parts.length) {
    throw new Error(
      `requireFixture("${slug}", []) asks for nothing, so it can never fail. Name the ` +
        "files the suite actually reads.",
    );
  }

  for (const part of parts) {
    const at = fixturePath(slug, part);
    const shown = path.relative(path.resolve(import.meta.dirname, "..", ".."), at);

    let bytes: Buffer;
    try {
      bytes = readFileSync(at);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(
        `The committed fixture corpus is missing ${slug}/${part}.\n\n` +
          `  expected at: ${shown}\n` +
          `  ${code === "ENOENT" ? "It is not there" : `Could not read it: ${(err as Error).message}`}.\n\n` +
          "  This file is tracked in git, so it cannot be legitimately absent — unlike\n" +
          "  Postgres, which is why this throws where tests/helpers/pg-ready.ts skips.\n" +
          "  Restore it, or rebuild the corpus:\n" +
          "    npx tsx tests/fixtures/data-root/build-corpus.ts\n" +
          "  tests/fixtures/data-root/README.md says what each file is for.",
      );
    }

    if (bytes.byteLength === 0) {
      throw new Error(
        `The committed fixture ${slug}/${part} is empty (0 bytes).\n\n  at: ${shown}\n\n` +
          "  An empty file passes existsSync and then fails somewhere else entirely.\n" +
          "  Rebuild the corpus: npx tsx tests/fixtures/data-root/build-corpus.ts",
      );
    }

    /* Parsed, not stat'd. A truncated JSON file is the case existsSync waves
       through, and the failure it causes surfaces inside the code under test
       rather than here. See the header. */
    if (part.endsWith(".json")) {
      try {
        JSON.parse(bytes.toString("utf8"));
      } catch (err) {
        throw new Error(
          `The committed fixture ${slug}/${part} is not valid JSON: ${(err as Error).message}\n\n` +
            `  at: ${shown}\n\n` +
            "  Most likely truncated — a half-written copy, or a git-lfs pointer standing in\n" +
            "  for the real bytes. Rebuild the corpus:\n" +
            "    npx tsx tests/fixtures/data-root/build-corpus.ts",
        );
      }
    }
  }
}
