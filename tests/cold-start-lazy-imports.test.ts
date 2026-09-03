/**
 * **What the deployed API loads before a request's clock starts.**
 *
 * `api/index.js` answers every request by `await import`ing one 3.5 MB
 * `api-dist/vercel.js`, and everything that bundle names in a **static** import
 * is initialised before `handleApi` sees the request. A bare `GET /api/library`
 * therefore pays for every one of them — which is why jsdom, pdf-lib and Stripe
 * were moved behind a first-use load on 2026-09-03, worth ~940 ms of a ~2.4 s
 * module import measured paired against the previous build, 15 rounds out of 15
 * in the same direction.
 * docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 4.
 *
 * **Nothing else can notice that being undone.** A `import { JSDOM } from "jsdom"`
 * added back to any of the six modules that parse HTML would be correct, would
 * pass every other test, and would silently put the second-largest dependency in
 * the repo back into the cold start of every request. There is no error and no
 * warning — only a number nobody is looking at
 * ([silent-success.md](../docs/reusable/silent-success.md)). So this reads the
 * emitted bundle's own import statements and names the packages that must not
 * be among them.
 *
 * It is deliberately **not** a "the bundle is fast" test. Timing is the
 * harness's job (scripts/bench-cold-start.ts) and would be flaky here; this
 * asserts the structural property the timing depends on, which is stable.
 *
 * Its companion is tests/pdf-bundle-trace.test.ts, which asks the real Vercel
 * tracer whether these three still *ship* — the other half, and the one that
 * turns "lazy" into an outage if it is wrong.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUNDLE = path.join(ROOT, "api-dist/vercel.js");

/**
 * Packages the API must reach for only when something actually needs them, with
 * the seam that keeps each one out of module scope.
 *
 * Not "every heavy package": drizzle and `@sentry/node-core/light` are on the
 * cold path on purpose — the shelf's own query goes through drizzle, and Sentry
 * has to be up before the code that might fail. They are the floor, and listing
 * them here would be asking for a failure we do not want fixed.
 */
const MUST_NOT_BE_STATIC: Record<string, string> = {
  jsdom: "src/jsdom-lazy.ts",
  "pdf-lib": "`cutPages` in src/pdf-read.ts",
  stripe: "`stripeClient()` in src/billing/stripe.ts",
};

/** Every bare specifier the bundle imports at module scope. */
function staticImportsOf(source: string): string[] {
  const found = new Set<string>();
  /* Anchored at a line start, so `await import("x")` — which is what the lazy
     seams compile to, and what this test must NOT count — cannot match. Two
     patterns because a side-effect `import "x";` has no `from`. */
  for (const re of [/^import\s[\s\S]*?from\s*["']([^"']+)["'];/gm, /^import\s*["']([^"']+)["'];/gm])
    for (const m of source.matchAll(re)) found.add(m[1] as string);
  return [...found];
}

describe("what the API bundle loads at module scope", () => {
  const built = existsSync(BUNDLE);

  it("has a build to inspect", () => {
    /* Separate and never skipped, for the reason tests/pdf-bundle-trace.test.ts
       gives: a silent skip is how a guard stops being a guard. */
    expect(
      built,
      "api-dist/vercel.js is missing — run `npm run build`. Without it the " +
        "assertion below is skipped and checks nothing.",
    ).toBe(true);
  });

  it.skipIf(!built)("keeps jsdom, pdf-lib and Stripe out of the cold start", () => {
    const specifiers = staticImportsOf(readFileSync(BUNDLE, "utf8"));

    /* The parser found *something*, or every assertion below is vacuously true —
       a regex that matches nothing passes forever. drizzle is imported at module
       scope on purpose, so it is the control. */
    expect(
      specifiers,
      "no static imports were found at all — that is a broken parser, not a fast bundle",
    ).toContain("drizzle-orm");

    for (const [pkg, seam] of Object.entries(MUST_NOT_BE_STATIC)) {
      const offenders = specifiers.filter((s) => s === pkg || s.startsWith(`${pkg}/`));
      expect(
        offenders,
        `${pkg} is imported at module scope again, so every request pays for it ` +
          `before it starts. It should be reached through ${seam}.`,
      ).toEqual([]);
    }
  });
});
