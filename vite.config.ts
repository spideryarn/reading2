import { fileURLToPath } from "node:url";
import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleApi } from "./src/routes.js";
import { loadEnvLocal } from "./src/env.js";
import { errorFields, log } from "./src/log.js";

/**
 * One process, one command (`npm run dev`). The API is mounted as dev middleware
 * rather than as a separate server so there's nothing to run in a second
 * terminal while the ideas are still moving — see src/routes.ts for the routes
 * themselves, and for the seam a standalone server slots into later.
 */
const apiMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  handleApi(req, res).then(
    (handled) => {
      if (!handled) next();
    },
    (err: Error) => {
      // handleApi answers its own expected failures; reaching here means a bug,
      // and a hung request would look exactly like a slow model call.
      //
      // It also means handleApi's own `finally` never ran, so this is the only
      // line the request will ever get — hence the stack, and hence logging
      // before answering rather than after: `res.end` is the last thing that
      // can go wrong, and losing the reason to it would be the worst trade
      // here.
      // The path without its query string, the same as `handleApi` does and for
      // the same reason: this writes it into the message as well as the object,
      // and redaction matches key paths, never text. A `?token=…` here would be
      // unredactable in both places. See docs/project/logging.md.
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
        name: "spideryarn-api",
        // Block body, not an arrow-with-expression: configureServer treats a
        // returned value as a post-hook, and `.use()` returns the connect app.
        configureServer(server) {
          server.middlewares.use(apiMiddleware);
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
        configurePreviewServer(server) {
          server.middlewares.use(apiMiddleware);
        },
      },
    ],
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
