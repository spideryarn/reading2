/**
 * **The entrypoint guard, and the three spellings of it that were wrong.**
 *
 * `isMain` ([`src/is-main.ts`](../src/is-main.ts)) is the one question every
 * `tsx src/…` module asks at the bottom of the file: *am I the file this process
 * was started with?* Wave 1 wrote down why it is worth testing before anything
 * is moved onto it, and it is the reason this file exists rather than the
 * migration going first:
 *
 * > **A faulty helper makes every CLI silently do nothing.**
 * > — docs/plans/simplification-wave-2.md §2.5
 *
 * Both directions of wrong are silent. Answering `true` when the module was
 * merely imported runs a stage as a side effect of an `import`, which is the one
 * thing the guard exists to prevent. Answering `false` when it *is* the entry
 * file makes `npm run fetch <url>` exit 0 having done nothing, with no message,
 * which is worse — there is nothing to notice.
 *
 * ## Every case here is proved against a broken implementation
 *
 * docs/reusable/silent-success.md: a check nobody has watched fail is not
 * evidence, and a table of inputs run against one correct function is exactly
 * that. So the table below is run against **four** implementations — the real
 * one, and the three spellings that were in this tree on 2026-08-28 — and each
 * broken one is asserted to get a *named* set of rows wrong. If a fix ever made
 * `endsWithGuard` pass, that would mean the row it was supposed to fail on had
 * stopped exercising the bug, and this file goes red rather than quiet.
 */

import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { isMain } from "../src/is-main.js";

/**
 * **The spelling `src/fetch.ts` and `src/toc-flatten.ts` carried**, and that six
 * other files' comments name as wrong without ever having been run against it.
 * Copied character for character rather than paraphrased: a paraphrase of a bug
 * is a different bug.
 */
function endsWithGuard(entry: string): boolean {
  return Boolean(process.argv[1] && entry.endsWith(path.basename(process.argv[1])));
}

/** **The spelling in three `scripts/` files** — a URL built by string concatenation. */
function fileColonGuard(entry: string): boolean {
  return process.argv[1] !== undefined && entry === `file://${process.argv[1]}`;
}

/**
 * **The spelling in `evals/extraction/corpus.mts` and two more**, which reads
 * the URL's `pathname` instead of decoding it. `new URL(…).pathname` is still
 * percent-encoded, so this is the encoding half of the `endsWith` bug on its own.
 */
function pathnameGuard(entry: string): boolean {
  return (
    process.argv[1] !== undefined &&
    new URL(entry).pathname === path.resolve(process.argv[1])
  );
}

/** One run of a guard: the module asking, the argument the process was given. */
interface Case {
  readonly name: string;
  /** The file whose `import.meta.url` is asking. */
  readonly entry: string;
  /** `process.argv[1]`, exactly as a shell would have handed it over. */
  readonly argv: string | undefined;
  readonly expected: boolean;
}

let root = "";
let cases: Case[] = [];
/** Rows that need a real file on disk, by name, so the symlink row is not fiction. */
const SYMLINK = "a CLI started through a symlink, which Node resolves on one side only";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-is-main-"));
  /* Real directories and real files, because two of the rows are about what the
     filesystem says rather than about string shapes: `realpathSync` returns the
     path unchanged for anything that is not there, which would make the symlink
     row pass against an implementation that does no resolving at all. */
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "a dir"), { recursive: true });
  await writeFile(path.join(root, "src", "fetch.ts"), "", "utf8");
  await writeFile(path.join(root, "scripts", "fetch.ts"), "", "utf8");
  await writeFile(path.join(root, "src", "prefetch.ts"), "", "utf8");
  await writeFile(path.join(root, "a dir", "my fetch.ts"), "", "utf8");
  await writeFile(path.join(root, "src", "real.ts"), "", "utf8");
  await symlink(path.join(root, "src", "real.ts"), path.join(root, "src", "link.ts"));

  const url = (...parts: string[]) => pathToFileURL(path.join(root, ...parts)).href;

  cases = [
    {
      name: "the ordinary run — the entry file asking about itself",
      entry: url("src", "fetch.ts"),
      argv: path.join(root, "src", "fetch.ts"),
      expected: true,
    },
    {
      name: "the same basename in another directory, imported rather than started",
      entry: url("src", "fetch.ts"),
      argv: path.join(root, "scripts", "fetch.ts"),
      expected: false,
    },
    {
      name: "a loaded module whose name merely ends with the started one's",
      entry: url("src", "prefetch.ts"),
      argv: path.join(root, "src", "fetch.ts"),
      expected: false,
    },
    {
      name: "a space in the path, which the URL spells %20",
      entry: url("a dir", "my fetch.ts"),
      argv: path.join(root, "a dir", "my fetch.ts"),
      expected: true,
    },
    {
      name: "a relative argument, which is what a shell usually gives",
      entry: pathToFileURL(path.resolve("src/fetch.ts")).href,
      argv: "src/fetch.ts",
      expected: true,
    },
    {
      name: "an argument routed through .., which resolves to the same file",
      entry: url("src", "fetch.ts"),
      /* Concatenated, not `path.join`, which would normalise the `..` away here
         and hand every guard a clean path — a row that tests nothing while
         reading exactly like a row that does. */
      argv: `${root}/scripts/../src/fetch.ts`,
      expected: true,
    },
    {
      name: SYMLINK,
      entry: url("src", "real.ts"),
      argv: path.join(root, "src", "link.ts"),
      expected: true,
    },
    {
      name: "no argv[1] at all — nothing was started from a file",
      entry: url("src", "fetch.ts"),
      argv: undefined,
      expected: false,
    },
  ];
});

const started = process.argv[1];
afterEach(() => {
  if (started === undefined) process.argv.length = 1;
  else process.argv[1] = started;
});

/** Runs one guard with `process.argv[1]` set to whatever the case says. */
function ask(guard: (entry: string) => boolean, c: Case): boolean {
  if (c.argv === undefined) process.argv.length = 1;
  else process.argv[1] = c.argv;
  return guard(c.entry);
}

describe("isMain", () => {
  it("answers every case correctly", () => {
    const wrong = cases.filter((c) => ask(isMain, c) !== c.expected).map((c) => c.name);
    expect(
      wrong,
      "isMain got these wrong. Both directions are silent: a false `true` runs a stage\n" +
        "as a side effect of an import, and a false `false` makes the command exit 0\n" +
        "having done nothing at all.\n",
    ).toEqual([]);
  });

  /**
   * **The table, proved against the broken state.**
   *
   * Each entry names the rows that spelling gets wrong, in full. `toEqual` on
   * the *set*, not `toContain`: a broken guard that started failing an extra row
   * has changed in a way somebody should look at, and a broken guard that failed
   * nothing would mean the table had stopped exercising the bug — which is the
   * way a table like this dies quietly.
   */
  describe("the guards this replaces, and exactly what each one gets wrong", () => {
    const broken: [string, (entry: string) => boolean, string[]][] = [
      [
        "endsWith(basename) — src/fetch.ts and src/toc-flatten.ts",
        endsWithGuard,
        [
          "the same basename in another directory, imported rather than started",
          "a loaded module whose name merely ends with the started one's",
          "a space in the path, which the URL spells %20",
          SYMLINK,
        ],
      ],
      [
        "`file://` + argv[1] — three scripts/ files",
        fileColonGuard,
        [
          "a space in the path, which the URL spells %20",
          "a relative argument, which is what a shell usually gives",
          "an argument routed through .., which resolves to the same file",
          SYMLINK,
        ],
      ],
      [
        "new URL(url).pathname — evals/extraction/corpus.mts and two more",
        pathnameGuard,
        ["a space in the path, which the URL spells %20", SYMLINK],
      ],
    ];

    for (const [name, guard, expectedWrong] of broken) {
      it(`${name} fails exactly the rows it is here for`, () => {
        const wrong = cases.filter((c) => ask(guard, c) !== c.expected).map((c) => c.name);
        expect(
          wrong,
          `${name} no longer gets the set of rows wrong that this file says it does.\n` +
            "If the list shrank, a row has stopped exercising the bug and proves nothing.\n",
        ).toEqual(expectedWrong);
      });
    }
  });
});
