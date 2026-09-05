/**
 * **Every `tw:` class the client writes must actually compile to a rule.**
 *
 * ## The failure this exists for
 *
 * A Tailwind v4 utility whose theme key is missing emits *nothing*. Not a
 * fallback, not a warning, not a build error — no rule at all. The class stays
 * on the element and the bundle builds, and what the element gets instead is
 * whatever the property's own default is: text *inherits*, a background goes
 * *transparent*, a border colour falls back to *`currentColor`*. All three look
 * plausible, which is the problem.
 *
 * On 2026-09-05 four names were missing from the `@theme inline` bridge in
 * `src/web/tailwind.css` — `--color-ink`, `--color-ink-soft`, `--color-rule`,
 * `--color-surface-raised` — while their siblings `--color-ink-faint` and
 * `--color-rule-strong` were present. Twenty utilities across four files were
 * dead, including the whole visual treatment of `SharedNotice`: it asks for a
 * raised panel with a rule round it and rendered flat, on a page a stranger
 * following a shared link sees first.
 *
 * Nobody noticed for weeks, because there is nothing to notice — the page looks
 * like a page. Two authors *did* notice, in `Tooltip.tsx` and `Library.tsx`,
 * and both wrote a comment explaining the workaround rather than the fix.
 *
 * A fifth was dead for a different reason: `tw:font-inherit` in
 * `SourceLink.tsx`, a utility Tailwind has never had.
 *
 * This is the [silent-success](../docs/reusable/silent-success.md) shape at its
 * purest, and it is the exact complement of `tests/css-tokens.test.ts`. That
 * one catches a *stylesheet* reading a custom property nothing defines; this
 * one catches a *component* writing a utility nothing generates. Between them
 * they cover both directions of the same spelling class.
 *
 * ## Why it drives Tailwind's own machinery rather than pattern-matching
 *
 * The obvious version of this test — regex out the colour-shaped class names,
 * check them against the keys in `@theme inline` — needs a hand-written model
 * of which utilities are colours. `text-sm`, `text-center`, `text-inherit`,
 * `border-t`, `border-collapse`, `border-dotted`, `divide-y`, `outline-none`,
 * `shadow-xs` and `bg-transparent` all live in colour-shaped namespaces and are
 * not colours. That model would be wrong the day it was written and wronger
 * every Tailwind release, and **a test that has to be taught the answer is a
 * test that can be taught the wrong one** — which is how the bug it is meant to
 * catch got in.
 *
 * So every input comes from Tailwind, and `src/web/tailwind.css` is fed in
 * whole rather than reconstructed. A reconstruction is a second copy of the
 * configuration, and the two drift the first time somebody edits one.
 *
 *   - `compile()` returns the `@source` directories the real build scans. The
 *     scanner is pointed at *those*, not at a hard-coded `src/web`, so breaking
 *     the `@source` line breaks this test rather than quietly narrowing it.
 *   - `Scanner` from `@tailwindcss/oxide` produces the candidate list — the
 *     same scanner the build uses, so this test sees what the bundle sees,
 *     including words pulled out of comments, which `tailwind.css`'s own header
 *     explains at length.
 *   - `candidatesToCss` answers, per candidate, whether a rule is produced.
 *   - and one assertion goes through `compiler.build()` itself, because the
 *     three above would all still pass if the `@import "tailwindcss/utilities.css"`
 *     line were deleted and the bundle shipped with no utilities in it at all.
 *     GPT Sol found that hole in this file's first draft, 2026-09-05.
 *
 * ## `compiler.build()` accumulates, and the obvious test shape is a trap
 *
 * Worth knowing before anyone "simplifies" this file. The natural way to avoid
 * the private API below is to ask the compiler one candidate at a time and see
 * whether the output grows. **It does not work: a `Compiler` is incremental and
 * remembers every candidate it has been given**, so the second call already
 * contains the first one's rule and the comparison is against a moving
 * baseline. Measured 2026-09-05: that loop reports *zero* dead candidates on
 * the tree that had five, and takes 16 seconds to do it. It is a green run that
 * checked nothing — the very shape this file exists to prevent.
 *
 * `candidatesToCss` is stateless, which is why it is the one doing the work.
 *
 * ## What this does NOT prove
 *
 * A rule being *generated* is not a rule being *right*. This cannot see whether
 * the colour is legible, whether the layer order lets it win, or whether the
 * class is on the element the author meant. `tests/css-tokens.test.ts` covers
 * the token half and the "text painted in a colour that is not a text colour"
 * half; the cascade only `getComputedStyle` on a real page can answer, and the
 * 2026-08-27 button-reset bug is what happens when nobody asks it.
 *
 * **And it cannot see a class name that is assembled rather than written.**
 * `"tw:text-" + "nonesuch"` is not a candidate, because Oxide is a text scanner
 * and never sees the joined string — so this suite stays green over a class
 * that produces no rule. That is not a gap between the test and the build: the
 * *build* has the identical blind spot, so such a utility genuinely does not
 * exist in production either, and the class is dead in exactly the way this
 * file is about. Which is the argument for never assembling a `tw:` name from
 * pieces. Sol demonstrated it against `pill.ts`, 2026-09-05.
 *
 * ## `__unstable__`
 *
 * It is a private API and a Tailwind upgrade may take it away. That is the
 * price of using the real resolver instead of a copy, and it is the right way
 * round: if the export disappears this file throws at **import time**, before
 * any `it` runs, where a reimplementation would keep passing while quietly
 * meaning less. If you are the one bumping Tailwind and this broke, the
 * replacement is whatever their editor plugin uses to resolve a class name —
 * that is the same question.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { __unstable__loadDesignSystem, compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";

/** The stylesheet entry point — `main.tsx` imports this and nothing else. */
const ENTRY = "src/web/tailwind.css";

/**
 * Resolving the `@import`s `tailwind.css` and its children use: `./styles.css`
 * and the `../../styles/tokens.css` beneath it are relative to the sheet doing
 * the importing, and `tailwindcss/theme.css` and `@fontsource-variable/…` are
 * packages.
 */
const loader = (base: string) => ({
  base,
  async loadStylesheet(id: string, from: string) {
    const path = id.startsWith(".") ? resolve(from, id) : resolve("node_modules", id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  },
  async loadModule(): Promise<never> {
    /* `@plugin` and `@config` — v3 escape hatches this project deliberately
       does not use. Throwing rather than returning an empty module makes a
       future one a loud failure here rather than a silent gap. */
    throw new Error("tailwind.css is not expected to load a JS plugin or config");
  },
});

/**
 * Candidates that correctly produce no CSS.
 *
 * A *category*, not a list of instances: `tw:group` and `tw:peer` are the
 * marker classes the `group-*` / `peer-*` variants read, they are meant to have
 * no rule of their own, and both take an optional `/name` suffix
 * (`tw:group/row`) that a two-entry allow-list would miss the first time
 * somebody wrote one. Sol, 2026-09-05.
 *
 * This is the one place the test can be taught a wrong answer, so widen it only
 * for another genuine non-utility. If a class in a component emits nothing, the
 * fix is the theme or the class.
 */
const MARKER = /^tw:(?:group|peer)(?:\/[^:\s]+)?$/;

let resolves: (candidate: string) => boolean;
let candidates: string[];
let sources: { base: string; pattern: string; negated: boolean }[];

beforeAll(async () => {
  const entry = resolve(ENTRY);
  const css = readFileSync(entry, "utf8");
  const options = loader(dirname(entry));

  /* Two passes over the same stylesheet, because they answer different
     questions: `compile` knows what the build scans and what it emits, and the
     design system can be asked about one candidate without remembering it. */
  const compiler = await compile(css, options);
  const design = await __unstable__loadDesignSystem(css, options);

  sources = compiler.sources;
  resolves = (candidate) => design.candidatesToCss([candidate])[0] !== null;
  candidates = new Scanner({ sources })
    .scan()
    .filter((c) => c.startsWith("tw:"));
});

describe("every tw: utility written in the client compiles to a rule", () => {
  /* The calibration, and it is not ceremony. Two earlier attempts to check this
     class by grepping the built bundle reported "everything missing" — one
     emitted a doubled backslash, the other matched `text-ink` inside
     `text-ink-faint`. A checker never seen to say "present" is not evidence of
     absence, so this asserts in both directions before anything below is
     allowed to mean something. */
  it("resolves utilities that exist and refuses ones that do not", () => {
    expect(resolves("tw:bg-background")).toBe(true);
    expect(resolves("tw:text-ink-faint")).toBe(true);
    expect(resolves("tw:border-rule-strong")).toBe(true);
    expect(resolves("tw:font-prose")).toBe(true);
    expect(resolves("tw:hover:bg-accent")).toBe(true);

    expect(resolves("tw:text-nonesuch")).toBe(false);
    expect(resolves("tw:bg-not-a-token")).toBe(false);
  });

  /* If the scanner comes back empty — a moved directory, a changed API, an
     `@source` edited to point at nothing — every assertion below passes
     vacuously. This is the guard against the green run that checked nothing,
     and it checks the source came from the stylesheet rather than from a
     constant in this file. */
  it("scans the directory the stylesheet points it at", () => {
    expect(sources.map((s) => resolve(s.base, s.pattern))).toEqual([resolve("src/web")]);
    expect(candidates.length).toBeGreaterThan(200);
    expect(candidates).toContain("tw:text-ink-faint");
  });

  it("leaves none of them producing no CSS", () => {
    const dead = candidates.filter((c) => !MARKER.test(c) && !resolves(c));
    expect(dead.sort()).toEqual([]);
  });

  /* **The one assertion that goes through the real build.** Everything above
     asks the design system, which happily resolves candidates for a stylesheet
     that never imports `tailwindcss/utilities.css` — delete that line from
     tailwind.css and the three tests above stay green while the bundle ships
     with no utility rules whatsoever. Sol, 2026-09-05.

     A fresh compiler for isolation: `build()` is incremental and remembers
     every candidate, so a shared one would make this assertion depend on what
     ran before it. (The `beforeAll` compiler has in fact only been asked for
     its `sources` — the per-candidate work goes to the design system — but
     relying on that is relying on the order of the other tests. Sol,
     2026-09-05.) Literal selectors rather than an escaper, because there are
     six of them and a hand-rolled CSS escape is one more thing that can be
     quietly wrong. */
  it("emits the repaired selectors into real compiled CSS", async () => {
    const entry = resolve(ENTRY);
    const compiler = await compile(readFileSync(entry, "utf8"), loader(dirname(entry)));
    const built = compiler.build([
      "tw:bg-background",
      "tw:text-ink",
      "tw:text-ink-soft",
      "tw:border-rule",
      "tw:bg-surface-raised",
      "tw:definitely-not-a-utility",
    ]);

    expect(built).toContain(".tw\\:bg-background"); // the control: already worked
    expect(built).toContain(".tw\\:text-ink {"); // `{` so it cannot match -ink-faint
    expect(built).toContain(".tw\\:text-ink-soft");
    expect(built).toContain(".tw\\:border-rule {"); // nor -rule-strong
    expect(built).toContain(".tw\\:bg-surface-raised");
    expect(built).not.toContain("definitely-not-a-utility");
  });
});
