import { fileURLToPath } from "node:url";
import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnvLocal } from "./src/env.js";
import { errorFields, log } from "./src/log.js";
import { missingClientEnv, resolveBuildStamp } from "./scripts/build-stamp.js";
import { sentrySourceMaps, sentryUploadEnabled } from "./scripts/sentry-build.js";

/**
 * One process, one command (`npm run dev`). The API is mounted as dev middleware
 * rather than as a separate server so there's nothing to run in a second
 * terminal while the ideas are still moving — see src/routes.ts for the routes
 * themselves, and for the seam a standalone server slots into later.
 *
 * **`src/routes.js` is imported here, dynamically, and not at the top of this
 * file.** It reaches `src/store/index.ts`, which refuses at module load when
 * the filesystem store is selected in production — rightly, because that store
 * has no owner column. But `vite build` sets `NODE_ENV=production`, so a
 * top-level import made *building the client bundle* boot the server store and
 * trip a guard that is about serving. `npm run build`, a documented gate, then
 * failed on any machine with the default `SPIDERYARN_STORE=files`. The client
 * bundle never consults a store; only a server does, so only a server imports
 * one.
 *
 * Awaited by the hooks below rather than inside the middleware, so the refusal
 * still lands at **server boot**. A store misconfiguration must not first show
 * up as a 500 on somebody's first request.
 */
async function createApiMiddleware(): Promise<Connect.NextHandleFunction> {
  const { handleApi } = await import("./src/routes.js");
  return (req, res, next) => {
    handleApi(req, res).then(
      (handled) => {
        if (!handled) next();
      },
      (err: Error) => {
        // handleApi answers its own expected failures; reaching here means a
        // bug, and a hung request would look exactly like a slow model call.
        //
        // It also means handleApi's own `finally` never ran, so this is the only
        // line the request will ever get — hence the stack, and hence logging
        // before answering rather than after: `res.end` is the last thing that
        // can go wrong, and losing the reason to it would be the worst trade
        // here.
        // The path without its query string, the same as `handleApi` does and
        // for the same reason: this writes it into the message as well as the
        // object, and redaction matches key paths, never text. A `?token=…` here
        // would be unredactable in both places. See docs/project/logging.md.
        const path = (req.url ?? "").split("?")[0] ?? "";
        log("http").error(
          { ...errorFields(err), method: req.method, path, status: 500 },
          `${req.method} ${path} 500`,
        );
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err.message }));
      },
    );
  };
}

/**
 * Resolved once at config time rather than per hook, because three things now
 * need to agree on it: the emitted `build.json`, the `release` compiled into
 * the client bundle, and the release the source-map upload is filed under. The
 * `generateBundle` hook below used to resolve its own and still could — but two
 * calls means two `builtAt` timestamps, and the day they disagree is a day
 * somebody spends on it.
 */
const stamp = resolveBuildStamp();

export default defineConfig(() => {
  // Before the server starts, so OPENROUTER_API_KEY is in process.env by the
  // time the first /api/comments POST arrives. See src/env.ts.
  loadEnvLocal();
  return {
    plugins: [
      react(),
      // Tailwind is just another plugin; the API middleware below is untouched.
      // The entry stylesheet is src/web/tailwind.css — read its header before
      // changing how the CSS is wired, the layering there is load-bearing.
      tailwindcss(),
      {
        /**
         * `dist/build.json` — which commit this *client bundle* came from.
         *
         * The serverless function carries the same stamp (vite.api.config.ts)
         * and reports it from `/api/health`. Two stamps rather than one because
         * they are two artefacts from two processes, and the failure worth
         * catching is them disagreeing: a client bundle from an older build
         * served in front of a new function is a working page calling an API
         * that has moved, and every other check on the page passes.
         *
         * A **file**, not a value baked into the JS, so that reading it is a
         * plain fetch rather than parsing a minified bundle — and so that a
         * smoke test asserting it cannot be fooled by finding the string
         * somewhere else in the output.
         *
         * `emitFile` rather than `public/build.json`, because the content is
         * computed per build; a file in `public/` would be whatever was last
         * committed. `apply: "build"` because there is no bundle in dev and
         * nothing serving this then.
         *
         * See scripts/build-stamp.ts for where the commit comes from, and
         * docs/plans/260827v-deploy-pipeline.md § The build stamp.
         */
        name: "spideryarn-build-stamp",
        apply: "build",
        /**
         * **Refuse to build a bundle that can only render a blank page.**
         *
         * `src/web/lib/supabase.ts` throws at module load without these two, so
         * a build that lacks them produces a site that loads nothing and logs
         * nothing — which is what `www.spideryarn.com` was for a few hours on
         * 2026-08-27. And they are compiled in at *build* time, so the mistake
         * cannot be fixed by setting them afterwards: every server-side signal
         * stays green over it, `/api/health` included, because what that
         * endpoint can see is the current project setting rather than what went
         * into the bundle. Absent is conclusive; present is not.
         *
         * **Only on Vercel**, deliberately. A laptop with no `.env.local` should
         * still be able to run `npm run build` to find out whether the code
         * compiles — that is what `scripts/deploy.ts`'s preflight does, with
         * placeholder values — and failing there would turn a useful check into
         * an obstacle. Here the missing variable means a broken deployment, so
         * a failed build is strictly better than a successful one.
         */
        buildStart() {
          if (!process.env.VERCEL) return;
          const missing = missingClientEnv(process.env);
          if (missing.length) {
            this.error(
              `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set on this Vercel ` +
                "project. They are compiled into the client bundle, so a deployment built without " +
                "them is a blank page that reports no error anywhere. Set them and redeploy — " +
                "changing them without a new build changes nothing. See docs/project/deployment.md.",
            );
          }
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build.json",
            source: `${JSON.stringify({ ...stamp, artefact: "client" }, null, 2)}\n`,
          });
        },
      },
      {
        name: "spideryarn-api",
        // `apply: "serve"` is belt-and-braces — both hooks below only ever run
        // for a server anyway. It is here to say that this plugin has no part in
        // a build, which is the mistake the dynamic import above exists to undo.
        apply: "serve" as const,
        // Block body, not an arrow-with-expression: configureServer treats a
        // returned value as a post-hook, and `.use()` returns the connect app.
        // Vite awaits both hooks, so the `await` here is what keeps a store
        // misconfiguration a boot-time refusal rather than a first-request 500.
        async configureServer(server) {
          server.middlewares.use(await createApiMiddleware());
        },
        /* The same API in front of the built bundle, so `vite preview` serves
           something a reader could actually use.
           
           This exists for performance work, and the reason is that **the dev
           server is the wrong thing to measure**. `StrictMode` renders every
           component twice on purpose, `@react-refresh` installs timers of its
           own, and modules arrive unbundled and untranspiled — so a render
           count taken from `npm run dev` is roughly double the real one, and a
           CPU figure is inflated by machinery that never ships. Without this
           hook, `vite preview` has no `/api`, the article never loads, and the
           only measurable thing is the dev server. See
           docs/project/performance.md. */
        async configurePreviewServer(server) {
          server.middlewares.use(await createApiMiddleware());
        },
      },
      /* **Last, and the plugin's own docs are explicit about it.** It works on
         the finished bundle and its maps, so anything running after it edits
         output it has already read. Empty unless the three Sentry variables are
         set — scripts/sentry-build.ts says why it is omitted rather than
         disabled. */
      ...sentrySourceMaps(stamp.commit, "./dist/**/*.map"),
    ],
    /* The commit, compiled into the client bundle so `initClientMonitoring`
       reports the **same release string** the server reports and the source-map
       upload is filed under. Three places, one value: without that, an event
       and its map are filed under different releases, and Sentry shows a
       minified frame while insisting the upload succeeded. */
    define: {
      __SPIDERYARN_BUILD_COMMIT__: JSON.stringify(stamp.commit),
    },
    build: {
      /* `"hidden"` rather than `true`: the maps are emitted and uploaded, but
         the bundle carries no `//# sourceMappingURL` comment pointing at them.
         So if deletion after upload ever fails, a stranger has to guess the
         filename rather than being handed it. Only emitted when there is
         somewhere to upload them to — scripts/sentry-build.ts says why that is
         one decision rather than two. */
      sourcemap: sentryUploadEnabled() ? ("hidden" as const) : false,
    },
    // `@/` -> src/web, matching "paths" in src/web/tsconfig.json. Points at the
    // client directory rather than at src/, because these are browser modules
    // and the node side must not be able to reach them by this name.
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src/web", import.meta.url)) },
    },
    server: {
      port: 5273,
      open: true,
      /* **Do not watch the article store.**
       *
       * `data/` is not source — it is the pipeline's output, and the tests
       * write fixtures into it constantly. Vite's watcher does not know that,
       * so every one of those writes was a full page reload: the log filled up
       * with `page reload data/test-carry-forward/article.html` several times a
       * minute, and a reader with an article open got their page thrown away
       * and rebuilt underneath them. On a 22,000-word article that is 3,600
       * nodes re-parsed and re-rendered, which is a CPU spike a reader can
       * feel, arriving for no reason they can see.
       *
       * It also made this app unmeasurable. A reload resets the counters
       * `Performance.getMetrics` reports, so a window containing one comes back
       * with *negative* CPU — which is at least honest about being wrong. The
       * runs that did not straddle a reload were measuring a page mid-load
       * instead of a page being scrolled.
       *
       * `docs/` and `evals/` are here for the same reason: agents write to them
       * while somebody is reading, and neither is imported by the client. */
      watch: { ignored: ["**/data/**", "**/docs/**", "**/evals/**"] },
    },
  };
});
