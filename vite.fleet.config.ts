/**
 * The build for the fleet dashboard's browser client.
 *
 *     npx vite build --config vite.fleet.config.ts
 *
 * Output: `tools/fleet/web/dist/`, containing `index.html` and an `assets/`
 * directory. `tools/fleet/server.ts` serves that directory as static files at
 * `/`, and answers `/api/state` beneath it.
 *
 * ## Deliberately its own config, sharing nothing with vite.config.ts
 *
 * That file is the product's, and it is not a build this tool can borrow. It
 * mounts the `/api` dev middleware, refuses to boot when Postgres does not
 * answer, reads `.env.local`, resolves a Sentry build stamp and aliases `@/` to
 * `src/web`. Every one of those is a dependency on the product being installed
 * and configured — and the fleet dashboard's whole point is that it runs on the
 * box, spans repos, and must work with the product's server absent
 * (docs/project/overseer-direction.md § Principles: *this is not
 * Spideryarn*). Two small configs that share nothing are simpler than one that
 * has to be told which half of itself to be.
 *
 * ## Three settings that are not defaults for a reason
 *
 * **`base: "./"`.** Asset URLs come out relative, so `dist/` works served from
 * `/` today and from `/fleet/` if it is ever put behind a path. Absolute
 * `/assets/…` would silently 404 in the second case, and the page would render
 * unstyled rather than fail.
 *
 * **`emptyOutDir: true`.** `dist/` sits inside `root`, so vite would clean it
 * anyway; saying it means a rename of a chunk cannot leave the old one behind
 * to be served by a stale `index.html` in somebody's browser cache.
 *
 * **No `server` block.** There is no dev server for this client: it is built,
 * and `tools/fleet/server.ts` serves the build. A tool read over Tailscale from
 * a phone gains nothing from HMR, and a second long-running vite on a box that
 * already carries a dozen is a cost with no payer.
 *
 * ## The build stamp
 *
 * The roadmap's runtime record of 2026-09-08 found that **no client build
 * revision was reported anywhere**: the bundle carried nothing but vite's
 * content hash in a filename, so nobody could say whether the page on a phone
 * was built from the code the server was running. So the checkout observed
 * when this config loaded (`tools/fleet/build-stamp.ts`) goes two places:
 * compiled in as `__FLEET_BUILD__`, which says what bundle a TAB is running,
 * and written as `dist/build-stamp.json`, which says what bundle is on DISK now
 * and which a running server re-reads. docs/plans/260910f D3.
 *
 * It is an observation — a HEAD sha and a git status — not proof of which
 * bytes went into the bundle; `StartRevision` in `tools/fleet/wire.ts` says
 * what `dirty` does and does not mean. And because it is taken once, when the
 * config loads, **`--watch` is refused**: vite reuses one resolved config
 * across watch rebuilds, so every rebuild would carry the first build's stamp.
 * Run `npm run build:fleet` once per build.
 */
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { BUILD_STAMP_FILE, buildStamp } from "./tools/fleet/build-stamp.js";

/** Paths relative to THIS FILE, not to `process.cwd()`. Which tree is being
 *  built is a fact about where this config sits, not about where the command
 *  was typed — the same argument vite.config.ts makes about its watch list. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Taken once, at config load, so the compiled-in and the written stamp are the same object. */
const stamp = buildStamp(here("."));

/**
 * Writes the stamp beside `index.html`, as part of the bundle rather than after it.
 * And refuses `--watch`: vite keeps one resolved config across watch rebuilds, so
 * every rebuild would carry the FIRST build's stamp over new code.
 */
function emitBuildStamp(): Plugin {
  return {
    name: "fleet-build-stamp",
    configResolved(config) {
      if (config.build.watch) {
        throw new Error(
          "vite.fleet.config.ts refuses watch mode: the build stamp is taken once at config load, so a watch rebuild would carry the first build's stamp; run `npm run build:fleet` per build",
        );
      }
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: BUILD_STAMP_FILE, source: `${JSON.stringify(stamp, null, 2)}\n` });
    },
  };
}

export default defineConfig({
  root: here("./tools/fleet/web"),
  base: "./",
  plugins: [react(), tailwindcss(), emitBuildStamp()],
  define: {
    __FLEET_BUILD__: JSON.stringify(stamp),
  },
  build: {
    outDir: here("./tools/fleet/web/dist"),
    emptyOutDir: true,
    /* No source maps. Nothing uploads them anywhere, and the box is short of
       disk more often than anyone here is short of a stack trace. */
    sourcemap: false,
  },
});
