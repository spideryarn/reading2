/**
 * **No authored file contains a raw NUL byte, because the tools that read this
 * repo disagree about what to do with one.**
 *
 * A composite key wants a separator that cannot appear in the data, and `\0` is
 * the right choice for that. The hazard is not the byte, it is *writing it as a
 * byte* instead of as the escape: a template literal joining two halves with the
 * two-character escape, and one joining them with a literal `0x00`, produce the
 * identical string, and only the second one makes text tools treat the whole
 * file as binary.
 *
 * **What that costs depends on which `grep` you have, which is the worst
 * possible answer.** Measured on 2026-09-05 against the same file:
 *
 * | | result |
 * |---|---|
 * | ugrep 7.8.4 (this box's `grep`) | no output, exit 1 — *identical to no match* |
 * | GNU grep 3.11 | `binary file matches`, exit 0 — no `file:line`, easy to miss |
 *
 * So an agent grepping this tree cannot know from the output whether a file was
 * searched or skipped, and on this machine a hit is indistinguishable from an
 * absence. Every audit this repo runs on itself is a grep: the periodic sweep in
 * docs/reusable/improve-the-codebase.md, the rename hunt in
 * docs/reusable/rename-or-move.md, and any agent asking "who calls this?". That
 * is docs/reusable/silent-success.md exactly. `git grep` and `rg` read these
 * files correctly throughout, which is the cheap cross-check when a zero
 * surprises you.
 *
 * **This is the third time.** `src/store/import.ts` had one, and it "cost twenty
 * minutes of believing a function did not exist"
 * (docs/plans/260826e-postgres-storage-implementation.md); it was fixed and
 * nothing was left behind to stop the next. Four more were found on 2026-09-03
 * and written up as a trap to document rather than a thing to fix
 * (docs/plans/260903j-illustrated-415-and-one-click-paint.md); the sentence was
 * never landed, and by 2026-09-05 the count had grown to five —
 * `evals/hierarchy-structure/run.ts` acquired one *after* that write-up, and
 * acquired it in `evals/` because the 2026-09-03 pass looked only at `src/`.
 *
 * So the fix is this test rather than a paragraph. Nobody has to know the rule:
 * the escape and the byte behave identically, so the only way to notice you
 * picked the wrong one is a check that reads the bytes.
 *
 * ## Why it is a denylist of binary rather than an allowlist of text
 *
 * The first version of this file listed the globs it wanted — `src/**`,
 * `tests/**`, and so on. Review found it silently missing 14 `.mts`, nine
 * `.mjs`, every `.sql`, `.html`, `.sh`, `.toml` and `.json`, and — the previous
 * generation of the same mistake — all of `docs/`, which is where the plan
 * describing this very finding had by then acquired a NUL of its own.
 *
 * **An allowlist of text is the same shape as the bug.** It fails silently and
 * in the direction of checking less, and every new authored extension starts
 * outside it. So the list is inverted: every file git tracks is checked, and
 * only the extensions that are *genuinely* binary are named below. A new kind of
 * source file is covered on the day it arrives, by nobody's decision.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The only files allowed to contain a zero byte: real binary assets. Verified
 * exhaustive on 2026-09-05 — of 3,162 tracked files, exactly 78 contain a NUL
 * and every one of them has one of these extensions.
 *
 * Captured model output (`evals/**` `.raw.json`) is deliberately **not** here.
 * Those are text, they are meant to be whatever the model sent, and none of them
 * has ever contained a NUL — so they are checked like everything else, and the
 * day one does is a day worth hearing about.
 */
const BINARY = new Set(["png", "jpg", "jpeg", "svg", "webm", "pdf", "ico", "woff", "woff2", "ttf"]);

/**
 * Everything git tracks, **plus everything untracked that is not ignored** —
 * which still excludes `node_modules/` and build output, because `.gitignore`
 * already names them, without this file repeating the list.
 *
 * The untracked half is not an extra. Both files that acquired a NUL while this
 * test was being written were brand new — the test itself, and the plan
 * documenting the finding — and a tracked-only check would have seen neither
 * until after the commit it was supposed to prevent.
 */
function authoredFiles(): string[] {
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const out = execFileSync("git", args, { encoding: "buffer" });
  return out
    .toString("utf8")
    .split("\0")
    .filter((f) => f !== "");
}

const CHECKED = authoredFiles().filter((f) => {
  const ext = f.includes(".") ? f.slice(f.lastIndexOf(".") + 1).toLowerCase() : "";
  return !BINARY.has(ext);
});

describe("no authored file carries a raw NUL byte", () => {
  it("finds every file a text search would read differently from the rest", () => {
    /* Over bytes, not over a decoded string. Reading as utf8 and looking for the
       decoded character would work today but describes the wrong property: what
       divides the tools is the byte. */
    const offenders = CHECKED.filter((file) => {
      /* A tracked path can be absent in a partial checkout, and a submodule
         entry is a directory. Neither is an offence. */
      try {
        if (!statSync(file).isFile()) return false;
      } catch {
        return false;
      }
      return readFileSync(file).includes(0);
    }).sort();

    expect(
      offenders,
      "these files contain a literal 0x00. `grep` then either skips them silently " +
        "or reports them without a line number, depending on its implementation. " +
        "Write the escape rather than the byte — the string value is identical. " +
        "If a file here is genuinely binary, add its extension to BINARY above.",
    ).toEqual([]);
  });

  it("still covers every kind of authored file", () => {
    /* The first version of this test asserted a total file count, and review
       showed that guards nothing: `docs/` alone is 1,220 files, so every code
       glob could vanish and the count would still pass. A witness per group is
       what actually fails when coverage shrinks. */
    const witnesses = [
      "src/routes.ts",
      "src/web/App.tsx",
      "src/web/styles.css",
      "tests/doc-links.test.ts",
      "scripts/deploy.ts",
      "evals/hierarchy-structure/run.ts",
      "api/index.js",
      "package.json",
      "biome.jsonc",
      "AGENTS.md",
      "docs/project/architecture.md",
      "vite.config.ts",
    ];
    const covered = new Set(CHECKED);
    expect(witnesses.filter((w) => !covered.has(w))).toEqual([]);
  });
});
