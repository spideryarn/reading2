import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleApi } from "./src/routes.js";
import { loadEnvLocal } from "./src/env.js";

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
      },
    ],
    server: { port: 5273, open: true },
  };
});
