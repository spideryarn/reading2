import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnvLocal } from "./src/env.js";
import { errorFields, log } from "./src/log.js";
import { missingClientEnv, resolveBuildStamp } from "./scripts/build-stamp.js";
import {
  allowListedPorts,
  describePorts,
  parseDevPortEnv,
  portInRange,
  PRIMARY_PORT,
} from "./scripts/worktree-port.js";
import { sentrySourceMaps, sentryUploadEnabled } from "./scripts/sentry-build.js";
import { devWatchIgnored } from "./scripts/worktree-admin.js";

/**
 * What the dev server's file watcher ignores — decided by `devWatchIgnored` in
 * `scripts/worktree-admin.ts`, which is where the reasoning and its test are.
 *
 * The config file's **own location**, not `process.cwd()`: which checkout is
 * being served is a fact about where this file sits, not about where the command
 * was typed.
 */
const WATCH_IGNORED = devWatchIgnored(fileURLToPath(new URL(".", import.meta.url)));

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
      /* **Say so when the dev server is not on an allow-listed port.**
       *
       * This is the other half of dropping `strictPort` (see `server.port`
       * below). Vite falls back to 5274, 5275… when 5273 is taken, which is
       * useful for everything except sign-in — and sign-in's failure is silent
       * and looks like a bug in your own code: Google returns you to the bare
       * site URL instead of `/auth/callback`, so the callback never runs.
       *
       * Hooked on `listening` rather than read from the config, because the
       * config says what was *asked for* and the fallback is precisely the case
       * where those differ. Vite's own logger, so it lands next to the
       * `Local: http://localhost:...` line a person is already looking at.
       *
       * setup-dev.md § And the port has to be 5273, and
       * docs/project/worktrees.md § Ports and the ceiling. */
      {
        name: "spideryarn-port-warning",
        apply: "serve" as const,
        configureServer(server) {
          server.httpServer?.once("listening", () => {
            const address = server.httpServer?.address();
            const actual = typeof address === "object" && address ? address.port : undefined;
            if (actual === undefined) return;
            /* **The config file, not our own range constant.** `DEV_PORT_RANGE`
               is the range we intend the allow-list to cover; this reads what it
               covers today. Trusting the constant left this warning silent on
               5274, where sign-in genuinely does not work — the same silent
               failure it exists to prevent, one level up. */
            let allowed: number[] = [];
            try {
              allowed = allowListedPorts(readFileSync("supabase/config.toml", "utf8"));
            } catch {
              /* No config to read: say nothing rather than cry wolf. */
              return;
            }
            if (allowed.length === 0 || allowed.includes(actual)) return;
            const plan = portInRange(actual)
              ? `  ${actual} is in the range we intend to allow-list but the list has not caught up:\n` +
                `  supabase/config.toml names ${describePorts(allowed)}, and GoTrue bakes it in at start.\n`
              : `  supabase/config.toml names only ${describePorts(allowed)}.\n`;
            server.config.logger.warn(
              `\n  Running on ${actual}, which is NOT on Supabase's redirect allow-list.\n` +
                "  Google sign-in will appear to work and then drop you at the site root —\n" +
                "  the callback never runs. Everything that does not need sign-in is fine.\n" +
                plan +
                `  Free up ${PRIMARY_PORT}, or see docs/project/setup-dev.md.\n`,
              { timestamp: true },
            );
          });
        },
      },
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
      /* **The port, and deliberately NOT `strictPort`.**
       *
       * `supabase/config.toml`'s redirect allow-list names 5273 by number and
       * GoTrue bakes it in at start, so a server on any other port has a Google
       * sign-in that *succeeds* and then drops the reader at the bare site URL
       * with nothing saying why (setup-dev.md § And the port has to be 5273).
       * The obvious fix is `strictPort: true`, and this file had it for an hour.
       *
       * GPT Sol talked me out of it, correctly, and the reason is specific to
       * this tree: a dozen agents share one checkout, so 5273 is often taken —
       * and a fallback server on 5274 is *genuinely useful* for everything that
       * is not sign-in. Especially for server work, because the API middleware
       * is imported at server boot, so an agent cannot rely on a peer's existing
       * 5273 process reflecting their own changes. `strictPort` would take that
       * away and leave them stuck. It belongs here once the port system is whole
       * — see docs/project/worktrees.md § Ports and the ceiling.
       *
       * So: keep the fallback, and kill the *silence* instead. The warning is
       * below, after `listening`, where the port is known rather than guessed.
       *
       * `SPIDERYARN_DEV_PORT` is how a worktree will get its own port. Unset, as
       * it is in the primary, this is `PRIMARY_PORT` — exactly 5273 as before.
       * Set but malformed, it **throws** rather than falling back, because
       * `Number(x) || 5273` on a typo silently turned a worktree into a second
       * server on the primary's port. scripts/worktree-port.ts. */
      port: parseDevPortEnv(process.env.SPIDERYARN_DEV_PORT) ?? PRIMARY_PORT,
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
      /* `.claude/worktrees/**` is a peer's entire checkout. Watching it would
         reload the primary's page on their every keystroke, and Vite *appends*
         this list to its own defaults (`resolveChokidarOptions`), so naming it
         here cannot cost us the node_modules and .git exclusions.

         **And it must not be there when this server is running *inside* one.**
         Chokidar matches these globs against absolute paths, and a worktree's
         absolute path contains `.claude/worktrees/` — so in a worktree the
         pattern meant to exclude the *neighbours* excludes the server's own
         source tree, every file of it. Nothing errors. The page loads, the app
         works, and every edit made after the server started is invisible to it:
         the module graph is never invalidated, so Vite keeps transforming and
         serving the version it read at boot. An agent then measures its own
         change in a browser and finds it did not happen, which is exactly the
         shape docs/reusable/silent-success.md collects. Found on 2026-09-02 by
         a browser pass that proved it three ways, `curl` included —
         docs/postmortems/260902a-a-dev-server-that-ignored-its-own-source.md.

         Dropping it there costs nothing: worktrees live under the *primary's*
         `.claude/`, so a worktree has no neighbours of its own inside it.

         The list itself is `devWatchIgnored` in scripts/worktree-admin.ts, so
         that the case nobody can reach from the primary checkout has a test
         rather than a comment. */
      watch: { ignored: WATCH_IGNORED },
    },
  };
});
