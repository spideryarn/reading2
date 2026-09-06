/**
 * **Every `[ai-…]` code written anywhere in `src/` resolves to a `FailureKind`.**
 *
 * ## Why this file exists rather than another case in `messages.test.ts`
 *
 * `tests/messages.test.ts` already holds every invariant about failure codes,
 * and holds them well — but it builds its universe from
 * `import * as messages from "../src/messages.js"`, so **it can only ever check
 * codes that `src/messages.ts` itself exports.** A code minted in another file
 * is not something it fails on; it is something it cannot see.
 *
 * That blind spot had a real occupant for four days. `ai-unusable` is raised by
 * `CLAIMS_UNUSABLE` (src/referee-claims-run.ts) and `ANSWER_UNUSABLE`
 * (src/referee-criteria-run.ts), and was registered nowhere. Both files asked in
 * prose to be registered — twice each — and
 * docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md asked
 * a third time. `referee-criteria-run.ts` even wrote down why none of that would
 * work: *"Skipping the second has no symptom here — `kindOfMessage` returns
 * null, `worthRetrying` says yes, and Retry is the right answer anyway — which
 * is precisely why it would be skipped."*
 *
 * So the point of this file is not the one code. It is that **its universe is
 * derived from the source rather than enumerated by hand**, which is the only
 * kind of guard that could have caught a code in a file nobody thought to list.
 * The same shape as tests/no-raw-nul-bytes.test.ts, and for the same reason.
 * docs/plans/260906h-improve-the-codebase-fourth-sweep.md § One level up.
 *
 * ## Why only the `ai-` family
 *
 * `CODE_KINDS` answers one question — *what kind of failure is this, for a job
 * whose error was stored and read back* — and the `ai-` family is the one that
 * always reaches it, because an `ai-` code means a model call failed inside a
 * step. The other families in the tree deliberately do not: `st-`, `mic-` and
 * `live-` are browser-side and never become a job error, and `fb-`, `cmt-`,
 * `pick-` and `admin-only` are HTTP refusal reasons on a response, which no
 * reader ever sees resolved through `kindOfMessage`. Widening this test to every
 * bracketed code was tried first and is wrong: it fails on all four of those
 * families, on CSS attribute selectors, and on array indices.
 *
 * ## Why it asks `kindOfMessage` rather than reading `CODE_KINDS`
 *
 * Because `kindOfMessage` is what production asks. It has a second branch —
 * `[ai-404]` and friends mint a kind from the status rather than from the map —
 * and a test that read the map directly would report those as unregistered and
 * be wrong. Asking the real resolver means this file cannot disagree with the
 * behaviour it is defending.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_KINDS, kindOfMessage } from "../src/messages.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Every source file git knows about, which is what makes the universe derived.
 *
 * `git ls-files` rather than a glob: a file that is present but untracked is
 * somebody's scratch work and not yet part of the tree's promises, and a glob
 * would also have to re-implement the ignore rules to agree with that.
 */
function sourceFiles(): string[] {
  return execFileSync("git", ["-C", ROOT, "ls-files", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/** Every `[ai-…]` occurrence in the tree, with the site that wrote it. */
function aiCodes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of text.matchAll(/\[(ai-[a-z0-9-]+)\]/g)) {
      const code = match[1];
      if (code === undefined) continue;
      const line = text.slice(0, match.index).split("\n").length;
      const sites = found.get(code) ?? [];
      sites.push(`${file}:${line}`);
      found.set(code, sites);
    }
  }
  return found;
}

describe("every ai- failure code in the tree resolves to a kind", () => {
  /**
   * The positive control, and it is not decoration. A regex that quietly stopped
   * matching — or a `git ls-files` that returned nothing in some future harness —
   * would make the assertion below pass over an empty set, which is
   * docs/reusable/silent-success.md exactly. 36 codes were present when this was
   * written; the bound is deliberately loose, because the number climbing is
   * normal and the number collapsing is the bug.
   */
  it("finds the ai- codes at all", () => {
    const found = aiCodes();
    expect(found.size).toBeGreaterThan(25);
    /* One specific code that must be found, so "the scan ran" is falsifiable by
       content and not only by count. `ai-busy` is the first entry in
       `CODE_KINDS` and is raised in src/ai-call.ts. */
    expect([...found.keys()]).toContain("ai-busy");
  });

  it("resolves every one of them through kindOfMessage", () => {
    const unresolved = [...aiCodes()]
      .filter(([code]) => kindOfMessage(`something went wrong. [${code}]`) === null)
      .map(([code, sites]) => `${code} (${sites.join(", ")})`);

    /* Named in the failure rather than counted, because the fix is to decide
       what kind the code is and add it to `CODE_KINDS` — and whoever sees this
       go red needs the site to make that decision, not a number. */
    expect(unresolved, "ai- codes reaching no kind — register them in CODE_KINDS").toEqual([]);
  });

  /**
   * **The other direction: no entry in the table that nothing can produce.**
   *
   * `tests/messages.test.ts` used to assert this by requiring `CODE_KINDS`'
   * keys to *equal* the codes carried by messages `src/messages.ts` itself
   * mints. That caught an orphan, and it also encoded an assumption that turned
   * out to be false — that every registered code's sentence lives in that one
   * file. `ai-unusable`'s does not, and the equality made registering it
   * impossible without first moving two constants, which is why it went four
   * days unregistered with three written reminders against it.
   *
   * So the direction moved here, where the universe is the **whole tree**
   * rather than one module's exports.
   *
   * **It covers every family, not just `ai-`, and that is the correction GPT
   * Sol made.** The first version of this filtered to `ai-` like the assertion
   * above, which quietly dropped orphan cover for the other 47 entries — a
   * bogus `"jb-orphan": "bug"` would have passed both this file and the
   * loosened assertion in `messages.test.ts`. The claim that the move was
   * "strictly stronger" was therefore false as first written, and is only true
   * in this form.
   */
  it("has nothing in the table that no message ever writes", () => {
    /* The whole of `src/` as one string. A code is a short literal that cannot
       straddle a file boundary, so concatenating is safe and saves 1,400
       separate searches. */
    const all = sourceFiles()
      .map((file) => readFileSync(path.join(ROOT, file), "utf8"))
      .join("\n");

    const orphans = Object.keys(CODE_KINDS).filter((code) => !all.includes(`[${code}]`));

    expect(orphans, "registered in CODE_KINDS but written by no message in src/").toEqual([]);
  });
});
