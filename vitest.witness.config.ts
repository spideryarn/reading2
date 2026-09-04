/**
 * TEMPORARY — witness 2 of docs/plans/260903f stage A. Throwaway vitest config
 * used with `--config`; the committed vitest.config.ts is untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const ROOT = "/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag";
const WITNESS = path.join(ROOT, "tests/setup/fs-store-witness.ts");

/** The condemned filesystem-store modules. NOT blobs-fs.ts — out of scope. */
const CONDEMNED = [
  "fs",
  "artifacts-fs",
  "jobs-fs",
  "uploads-fs",
  "ai-calls-fs",
  "realtime-sessions-fs",
  "copy-artefacts",
  "data-root",
];
const CONDEMNED_PATHS = new Set(
  CONDEMNED.map((n) => path.join(ROOT, "src/store", `${n}.ts`)),
);
const BASENAME_RE = new RegExp(`(?:^|/)(${CONDEMNED.join("|")})\\.(?:js|ts)$`);

const PREFIX = "\0fsw:";

function exportNames(source: string): string[] {
  const names = new Set<string>();
  const re =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    if (name) names.add(name);
  }
  return [...names];
}

function witnessPlugin(): Plugin {
  return {
    name: "fs-store-witness",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.startsWith(PREFIX)) return source;
      if (importer?.startsWith(PREFIX)) return null;
      if (!BASENAME_RE.test(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return null;
      const clean = resolved.id.split("?")[0] ?? resolved.id;
      if (!CONDEMNED_PATHS.has(clean)) return null;
      return PREFIX + clean;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const real = id.slice(PREFIX.length);
      const mod = path.basename(real, ".ts");
      const src = readFileSync(real, "utf8");
      const names = exportNames(src);
      const lines = [
        `import * as __orig from ${JSON.stringify(real)};`,
        `import { wrap as __wrap } from ${JSON.stringify(WITNESS)};`,
        ...names.map(
          (n) =>
            `export const ${n} = __wrap(${JSON.stringify(mod)}, ${JSON.stringify(n)}, __orig.${n});`,
        ),
      ];
      return lines.join("\n");
    },
  };
}

/**
 * The base config's shape is checked rather than assumed, because this file
 * copies half of it. **It changed on 2026-09-04**: `vitest.config.ts` now
 * declares three projects (unit / private-postgres / shared-services) and the
 * provider guard is one entry in each project's `setupFiles`, so the old
 * whole-line needle stopped matching. The needle is now the path, which is the
 * part this file actually depends on.
 *
 * **What this config does NOT reproduce is the lanes**: it runs every test file
 * in one project against whatever `DATABASE_URL` says, which is what `npm test`
 * did before T-D. That is fine for an instrumented one-off measuring which
 * modules a run touches, and wrong for anything you would call a verdict — a
 * Postgres suite run this way is on the shared database, racing the box.
 */
const base = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
if (!base.includes('"./tests/setup/no-provider-calls.ts"')) {
  throw new Error("vitest.config.ts changed shape; re-derive the witness config");
}

export default defineConfig({
  root: ROOT,
  plugins: [witnessPlugin()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/web", `file://${ROOT}/`)) },
  },
  test: {
    environment: "node",
    isolate: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: [
      "./tests/setup/no-provider-calls.ts",
      "./tests/setup/fs-store-witness-setup.ts",
    ],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
