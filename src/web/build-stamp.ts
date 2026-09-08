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

/**
 * *"built 7 Sep 2026 from 39282f8"* — what this bundle is, for a reader.
 *
 * **This is the version number, and it is a sha and a date rather than an
 * ordinal.** Greg asked, 2026-09-07, for *"a version number (semver?) as part of
 * the deploy … on tooltip for the Homepage logo"*. Fable's answer, which he
 * took: a deploy cannot honestly carry one. Production is built on Vercel's
 * machine from a push to `main`, `scripts/deploy.ts` has no channel into that
 * build's environment (nothing sets `SPIDERYARN_BUILD_COMMIT` there — only
 * `deploy.ts`'s own local gate worktree uses it), and a release's line in
 * `changelog-versions.ndjson` is written *after* it ships, so a build's own sha
 * is never in the copy of that file it is carrying. The sha is the one fact both
 * ends hold with certainty, so the sha is what this says — and `/changelog`
 * numbers releases from its own line count, where the whole file is in hand
 * (ChangelogPage.tsx § A release is shut, and its number is its line).
 *
 * `null` off a build, which is every test and every `npm run dev`: there is no
 * `define` outside a build (see this file's header), and *"built unknown from
 * unknown"* is worse than a tooltip that simply does not mention it.
 *
 * Formatted in the reader's own zone, unlike `/changelog` — deliberately, and
 * it is the opposite call for the opposite reason. A release's stamp is a fact
 * about when it shipped, the same for everybody. This is a fact about the copy
 * running in *this* browser, so "built yesterday" ought to mean yesterday where
 * the reader is.
 */
export function buildDescription(): string | null {
  const commit = buildCommit();
  const time = buildTime();
  /* **A sha, not merely a non-`"unknown"` string.** The guard was `!== "unknown"`
     and that is not what this sentence promises: `resolveBuildStamp` takes
     `SPIDERYARN_BUILD_COMMIT` at its word, so a build carrying
     `SPIDERYARN_BUILD_COMMIT=release-candidate` — or a malformed
     `VERCEL_GIT_COMMIT_SHA` — produced *"built 7 Sep 2026 from release"*, seven
     characters sliced off a word. False, and in the one place on the page whose
     whole job is to say what this copy actually is. GPT Sol's review, P2.
     Production normally has a real Vercel sha and dev and vitest have nothing at
     all, so this has probably never fired — which is the argument for the guard
     rather than against it. */
  if (commit === null || !/^[0-9a-f]{40}$/.test(commit) || time === null) return null;
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return null;
  const when = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `built ${when} from ${shortCommit(commit)}`;
}
