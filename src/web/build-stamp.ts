/**
 * What the running client says about itself: the commit that compiled this
 * bundle, and when it was compiled.
 *
 * Both values are written in at build time by the `define` block in
 * `vite.config.ts`, from the stamp `scripts/build-stamp.ts` resolves — the same
 * one that goes into `dist/build.json` and into the Sentry release. The
 * serverless function has a stamp of its own, from a second call to the same
 * resolver in vite.api.config.ts, and reports it from `/api/health`: the two
 * agree on the commit by construction and differ on `builtAt` by however long
 * the first build took. Read that file for why a compiled-in stamp beats
 * reading `process.env.VERCEL_GIT_COMMIT_SHA` when the request arrives.
 *
 * **`typeof`, not a plain read, and this module exists so that is written
 * once.** There is no `define` outside a build — vitest does not replace these
 * identifiers, and neither does the dev server, whose served modules still
 * carry the bare names (checked on 2026-09-04 against this repo's own `npm run
 * dev`, Vite 8.2.2, by fetching this very module from it). A bare reference
 * would be a `ReferenceError` on the first line of the app rather than the
 * honest answer, which is that nothing built this. Three call sites had their
 * own copy of the guard and their own `declare`; now they import.
 *
 * The answer these give is about **the bundle this browser is running**, which
 * after a deploy is not necessarily the newest one until the tab is reloaded.
 * That is the right fact for a crash report to carry, and the useful one on
 * /admin — see AdminPage.tsx § BuildStampLine.
 */

declare const __SPIDERYARN_BUILD_COMMIT__: string;
declare const __SPIDERYARN_BUILD_TIME__: string;

/** The stamp the release and the source maps went up under, if this is a build. */
export function buildCommit(): string | null {
  return typeof __SPIDERYARN_BUILD_COMMIT__ === "string" ? __SPIDERYARN_BUILD_COMMIT__ : null;
}

/** ISO 8601 — when this bundle was compiled, if this is a build. */
export function buildTime(): string | null {
  return typeof __SPIDERYARN_BUILD_TIME__ === "string" ? __SPIDERYARN_BUILD_TIME__ : null;
}

/**
 * The first seven characters, which is what `git rev-parse --short` and
 * Vercel's dashboard both show — and the floor `sameCommit` will compare
 * against, so a sha printed here can be pasted back into a check.
 */
export function shortCommit(commit: string): string {
  return commit === "unknown" ? commit : commit.slice(0, 7);
}
