/**
 * Compile the production API to JavaScript, so that Vercel never has to.
 *
 * ## Why this exists
 *
 * Vercel's Node builder finds the TypeScript in this repo and uses it to
 * compile anything under `api/`. This repo is on **TypeScript 7**, whose
 * compiler the builder does not understand — the same story
 * docs/project/linting.md tells about ESLint, which is on TS 7's list of things
 * that lost the API they depended on.
 *
 * The way it fails is the reason this file is a build step rather than a
 * workaround. The deployment log says:
 *
 *     Using TypeScript 7.0.2 (local user-provided)
 *     error TS2688: Cannot find type definition file for 'node'.
 *
 * and then the build **reports success**, uploads a function, and every request
 * to it returns `FUNCTION_INVOCATION_FAILED` with no stack anywhere. A broken
 * artefact that passed is worse than a failed build, and it is
 * docs/reusable/silent-success.md exactly.
 *
 * So `api/` holds one hand-written `.js` file and nothing else. There is no
 * TypeScript for the builder to find, no version of it to disagree with, and
 * what runs in production is compiled by the same tool that compiles the client.
 *
 * ## Why SSR mode, and why everything stays external
 *
 * `build.ssr` targets Node rather than a browser. `external` below is a rule
 * rather than a list — anything that is not a relative path is left as a bare
 * import — which keeps `pg`, `jsdom` and `@anthropic-ai/sdk` out of the bundle.
 * Bundling those is where this would break quietly: jsdom in particular reaches
 * for files by path at runtime. Left external, Vercel's own dependency tracing
 * walks the emitted imports and packages the real packages, which is the thing
 * it is good at.
 */

import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { resolveBuildStamp } from "./scripts/build-stamp.js";
import { readClientShell } from "./scripts/client-shell.js";
import { expectedMigrations } from "./scripts/migration-ledger.js";
import { sentrySourceMaps, sentryUploadEnabled } from "./scripts/sentry-build.js";

/**
 * The two packages that must be bundled rather than left external.
 *
 * `html-encoding-sniffer` is CommonJS and `require()`s `@exodus/bytes`, which is
 * ESM. Node refuses that combination in the deployed function:
 *
 *     ERR_REQUIRE_ESM: require() of ES Module .../@exodus/bytes/encoding-lite.js
 *     from .../html-encoding-sniffer/lib/html-encoding-sniffer.js not supported
 *
 * It does not happen on this laptop, because the Node here is new enough to
 * allow `require()` of an ES module and the one in the function is not. That is
 * the whole reason this list exists rather than a version bump: the difference
 * is in the runtime, not in the code, so nothing local will ever reproduce it.
 *
 * Bundling them resolves the interop at build time, where there is no `require`
 * left to fail. Keep this list as short as it can be — every entry is a package
 * whose own runtime file lookups stop working, which is exactly why `jsdom` and
 * `pg` are not on it.
 */
const BUNDLE_ANYWAY = ["html-encoding-sniffer", "@exodus/bytes"];

/**
 * Which commit this function came from, compiled in rather than read from the
 * environment at request time.
 *
 * `/api/health` reports it as `build`, **alongside** the `commit` it already
 * reports from `process.env.VERCEL_GIT_COMMIT_SHA`. Both are kept because they
 * answer different questions — one says what Vercel believes it deployed, the
 * other says what actually compiled — and the day they disagree is the day
 * worth hearing about. scripts/build-stamp.ts has the rest of the reasoning.
 */
const stamp = resolveBuildStamp();

/**
 * **The built client `index.html`, compiled in — or no build at all.**
 *
 * `/read/<slug>` is served by this function so the `<head>` can be about the
 * article rather than about the app (src/public/page-head.ts), and to do that it
 * needs the real shell: the one with hashed `/assets/….js` in it, not the source
 * `index.html` whose `/src/web/boot.tsx` only Vite's dev server understands.
 *
 * Resolved here, at config evaluation, so that **a stale or missing shell fails
 * the build** rather than being discovered by a reader whose shared link renders
 * a blank page. scripts/client-shell.ts holds the four checks and the reason
 * there is no fallback of any kind; the short version is that the worktree this
 * design came out of had HEAD at one commit and `dist/build.json` at another, so
 * an API build on its own would have compiled a shell from a different version
 * of the client and said nothing.
 *
 * `vercel.json` runs `vite build` before this, so `dist/` is fresh by
 * construction on a deployment. Locally the two are two commands and the order
 * is yours to get right — which is what the commit comparison is for.
 *
 * **There is no such constant in development.** `npm run dev` never loads this
 * config, so `typeof __SPIDERYARN_BUILT_SHELL__` is `"undefined"` there, the
 * function that reads it takes its other branch, and `/read/:slug` keeps the
 * ordinary default head. Same shape as the build stamp above, and the same
 * `typeof` guard on the reading side.
 */
const shell = readClientShell(fileURLToPath(new URL("./dist", import.meta.url)), stamp.commit);

/**
 * The migrations this build needs the database to have already applied.
 *
 * Stamped in for the same reason as the commit above: read at build time from
 * the `drizzle/` folder that is actually being compiled, so it can only be
 * wrong by the artefact being wrong. `/api/health` reports it beside what it
 * finds in the database, which is what lets anything holding an HTTPS client —
 * the remote box, a deploy check, Greg on his phone — tell whether a deployment
 * and its schema are in step **without a database credential**.
 *
 * **Deliberately not caught.** `expectedMigrations` throws when the journal
 * names a `.sql` file the folder does not have, and a build that swallowed that
 * would stamp in a shorter list and then report itself in step with a database
 * missing the very migration whose file went astray. Failing the build is the
 * cheap end of that; docs/plans/260902a-remote-box-runs-production-migrations-without-a-human-in-the-loop.md.
 */
const migrations = expectedMigrations(fileURLToPath(new URL("./drizzle", import.meta.url)));

export default defineConfig({
  /* The server half of the source-map upload, and the half that is easy to
     forget. `vercel.json` builds the client first and this second, so a plugin
     living only in vite.config.ts would have run before `api-dist/vercel.js.map`
     existed. Same release string as the client, from the same stamp. */
  plugins: sentrySourceMaps(stamp.commit, "./api-dist/**/*.map"),
  /* Constants, not `process.env` lookups, so the value cannot be changed by the
     running environment after the fact — which is the entire point of a stamp.
     Read in src/vercel-health.ts behind a `typeof` guard, because in dev there
     is no define and this module is not the one serving requests. */
  define: {
    __SPIDERYARN_BUILD_COMMIT__: JSON.stringify(stamp.commit),
    __SPIDERYARN_BUILD_TIME__: JSON.stringify(stamp.builtAt),
    __SPIDERYARN_BUILD_SOURCE__: JSON.stringify(stamp.source),
    __SPIDERYARN_BUILD_DEPLOYMENT__: JSON.stringify(stamp.deploymentId),
    __SPIDERYARN_BUILT_SHELL__: JSON.stringify(shell.html),
    /* The digest of the shell **as it was read**, before any head was composed
       into it. Served as `X-Spideryarn-Shell-SHA256`, so the deployed check can
       compare it against the SHA-256 of `GET /index.html` and prove the function
       and the CDN are serving the same build. Hashing the composed output
       instead would make that comparison always fail, and hashing nothing would
       make it always pass. */
    __SPIDERYARN_BUILT_SHELL_SHA256__: JSON.stringify(shell.sha256),
    /* The whole list rather than its digest, because the digest cannot say
       WHICH migration is missing, and a health page that says "out of step" and
       nothing else sends whoever reads it to a database they may not be able to
       reach. Around 3KB of constant; the function is unminified anyway. */
    __SPIDERYARN_EXPECTED_MIGRATIONS__: JSON.stringify(migrations),
  },
  /* `ssr.noExternal`, not just `rollupOptions.external` below. Vite decides what
     an SSR build externalises before Rollup's own `external` hook is consulted,
     so the hook alone left these two as bare imports and the fix did nothing —
     the build succeeded and the function went on failing in exactly the same
     way. Both are set: this one decides, the other documents the rule. */
  ssr: { noExternal: BUNDLE_ANYWAY },
  build: {
    ssr: "src/vercel.ts",
    outDir: "api-dist",
    emptyOutDir: true,
    target: "node22",
    /* Readable on purpose. This code only ever runs on a server, so there are no
       bytes to save, and a stack trace out of production that points at a real
       line is worth more than any of them. */
    minify: false,
    /* Unminified is not the same as mapped. Every module in `src/` is
       concatenated into one `vercel.js`, so a frame says line 12,431 of a file
       nobody wrote — readable, and about the wrong file. The map is what turns
       that back into src/routes.ts. Emitted only when it can be uploaded and
       then deleted; see scripts/sentry-build.ts. */
    sourcemap: sentryUploadEnabled(),
    rollupOptions: {
      external: (id: string) => {
        if (id.startsWith(".") || id.startsWith("/") || id.startsWith("\0")) return false;
        return !BUNDLE_ANYWAY.some((name) => id === name || id.startsWith(`${name}/`));
      },
      output: { format: "esm", entryFileNames: "vercel.js" },
    },
  },
});
