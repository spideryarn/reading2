import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import { loadArticle } from "./src/api.js";

/**
 * One process, one command (`npm run dev`). The API is mounted as dev middleware
 * rather than as a separate server so there's nothing to run in a second
 * terminal while the ideas are still moving — see src/api.ts for the seam where
 * a standalone server slots in later.
 */
const apiMiddleware: Connect.NextHandleFunction = async (req, res, next) => {
  const match = req.url?.match(/^\/api\/article\/([\w.-]+)$/);
  if (!match) return next();
  try {
    const article = await loadArticle(decodeURIComponent(match[1]));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(article));
  } catch (err) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: "spideryarn-api",
      configureServer: (server) => server.middlewares.use(apiMiddleware),
    },
  ],
  server: { port: 5273, open: true },
});
