/**
 * **Every DOMPurify hook in this repository is installed by
 * `src/sanitize-policy.ts`, and by nothing else.**
 *
 * That file is the untrusted-HTML seam
 * [security-map.md](../docs/project/security-map.md) names, and the reason it is
 * a *file* rather than a convention is that a hook is invisible from the call
 * site: `purify.sanitize(html, ARTICLE_CONFIG)` reads exactly the same whether
 * one hook is installed on that instance or four.
 *
 * ## The incident, and why the obvious guard would have missed it
 *
 * `0f754742` added a `purify.addHook("afterSanitizeAttributes", …)` to
 * **`src/web/sanitize.ts`** — the browser *binding* — to open external links in
 * a new tab. Nothing a reader could see was wrong, and the feature worked. What
 * broke was the property that makes the sanitiser checkable at all: that the
 * server pass and the client pass produce the same bytes, and that the client
 * pass is a no-op on the server's output.
 * docs/postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md.
 *
 * **The first design of this guard was a lint rule confining the `dompurify`
 * import to the three files that bind it, and GPT Sol killed it on 2026-09-07:
 * `src/web/sanitize.ts` is one of those three.** It holds its own instance
 * (`const purify = DOMPurify(window)`), so the exact line that caused the
 * incident would have been reintroduced with the rule saying nothing, while a
 * harmless `import type` somewhere else would have been refused. A guard that
 * cannot fire on its own incident is worse than none, because it is believed.
 *
 * So the check is on the spelling that actually installs a hook, in every file,
 * with one file excepted — which is the boundary as it is actually written
 * rather than a proxy for it.
 *
 * ## What this is not
 *
 * **Narrow, and the postmortem says so about this shape.** It does not stop a
 * second *config*, or a presentation rule written some other way, and it is
 * ranked below the parity invariant in `tests/sanitize-client.test.ts` — which
 * caught the real incident correctly and immediately. This is the cheap
 * structural half: parity says *the two passes disagree*, and this says *and
 * here is the line*.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installArticlePolicy } from "../src/sanitize-policy.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The one file allowed to install a hook. */
const THE_SEAM = "src/sanitize-policy.ts";

/**
 * The lines of `text` that install a DOMPurify hook.
 *
 * Deliberately a **pure function over text**, so the assertion below has
 * something to be driven with. A guard whose only input is the repository can
 * only ever be watched passing.
 *
 * `\.addHook` and not the bare word: `src/web/sanitize.ts` discusses `addHook`
 * in prose in its own header ("`addHook` appends; it does not replace"), and a
 * comment explaining the rule must not be the thing that breaks it.
 *
 * **Matched over the whole text rather than line by line**, because a call may
 * be split across lines and a per-line scan would miss it — GPT Sol's, with the
 * spelling that does it:
 *
 * ```ts
 * purify.addHook
 * ("afterSanitizeAttributes", handler);
 * ```
 *
 * `?.` is allowed for as well. **What this still does not cover, promised no
 * more widely than it delivers:** `purify["addHook"](…)`, a call through an
 * alias (`const h = p.addHook; h(…)`), and anything computed. Closing those
 * needs an AST and this is a regex; the invariant it enforces is the direct
 * dotted spelling, which is what every DOMPurify example and both real call
 * sites use.
 */
function hookInstallations(text: string): number[] {
  const found: number[] = [];
  const at = /\??\.\s*addHook\s*\(/g;
  for (const hit of text.matchAll(at)) {
    /* The line number is derived from the match's offset rather than tracked in
       a loop, which is what makes the whole-text scan possible at all. */
    found.push(text.slice(0, hit.index).split(/\r?\n/).length);
  }
  return found;
}

describe("hookInstallations — the scanner itself", () => {
  /**
   * **The line from the incident, verbatim**, so this file goes red against the
   * thing it exists to prevent rather than against a paraphrase of it.
   */
  it("finds the line 0f754742 added to the browser binding", () => {
    const incident = [
      "const purify = DOMPurify(window);",
      "installArticlePolicy(purify);",
      'purify.addHook("afterSanitizeAttributes", (node) => {',
      "  const el = node as Element;",
      "});",
    ].join("\n");
    expect(hookInstallations(incident)).toEqual([3]);
  });

  it("finds a hook however it is spaced, and on any instance", () => {
    expect(hookInstallations("dompurify .addHook ('x', f)")).toEqual([1]);
    expect(hookInstallations("const p = mine.addHook(\n)")).toEqual([1]);
    expect(hookInstallations("purify?.addHook('x', f)")).toEqual([1]);
  });

  /**
   * **A call split across lines**, which a per-line scan missed. GPT Sol found
   * it, and the line reported is the one the call *starts* on.
   */
  it("finds a call whose bracket is on the next line", () => {
    expect(hookInstallations(["const a = 1;", "purify.addHook", '("x", f);'].join("\n"))).toEqual([
      2,
    ]);
  });

  /**
   * The spellings this does **not** reach, asserted so the promise in the
   * header above is exactly the promise the code keeps.
   */
  it("does not reach a computed or aliased call, and says so", () => {
    expect(hookInstallations('purify["addHook"]("x", f)')).toEqual([]);
    /* The alias is invisible in both halves: the assignment has no bracket
       after it, and the call has no dot before it. */
    expect(hookInstallations("const h = p.addHook;\nh('x', f);")).toEqual([]);
  });

  /* The controls. Without these the assertion over the tree below is satisfied
     by a scanner that matches nothing at all — which is what a regex typo
     produces, and it looks exactly like a clean repository. */
  it("does not fire on prose about hooks, or on a hook being removed", () => {
    expect(hookInstallations("// `addHook` appends; it does not replace.")).toEqual([]);
    expect(hookInstallations(" * shared with anything else that imports DOMPurify")).toEqual([]);
    expect(hookInstallations("purify.removeAllHooks();")).toEqual([]);
  });
});

describe("the tree", () => {
  /** Tracked source, so an agent's scratch file is not the thing that fails. */
  function trackedSource(): string[] {
    const out = execFileSync("git", ["ls-files", "-z", "--", "src", "api", "scripts", "evals"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    /* Every module extension this repository actually uses. `.mts` and `.mjs`
       were missing from the first version — 26 and six tracked files in these
       roots, so the guard had a hole exactly where the evals live. GPT Sol. */
    return out
      .split("\0")
      .filter((p) => /\.(m?[jt]sx?|tsx)$/.test(p));
  }

  it("installs DOMPurify hooks in exactly one file", () => {
    const files = trackedSource();
    /* The positive control, and it is the one that matters: `git ls-files`
       returning nothing — a moved root, a changed flag — would make every
       assertion below vacuously true over an empty list. */
    expect(files.length, "no tracked source was scanned at all").toBeGreaterThan(200);

    const offenders = files.filter(
      (f) => f !== THE_SEAM && hookInstallations(readFileSync(path.join(ROOT, f), "utf8")).length > 0,
    );
    expect(offenders, "a DOMPurify hook outside the policy — see this file's header").toEqual([]);

    /* And the seam really does install some, so the rule is about a live
       boundary rather than about a spelling nothing uses any more. */
    expect(hookInstallations(readFileSync(path.join(ROOT, THE_SEAM), "utf8")).length).toBeGreaterThan(
      0,
    );
  });

  /**
   * **The policy is reached by being called, not by being imported**, which is
   * why the file above is the boundary. Referenced here so a rename of
   * `installArticlePolicy` cannot leave this test asserting about a file that
   * no longer does the job its name claims.
   */
  it("is the policy the two bindings install", () => {
    expect(typeof installArticlePolicy).toBe("function");
  });
});
