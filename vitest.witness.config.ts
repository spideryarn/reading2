/**
 * The instrument behind witness 2 of docs/plans/260903f — `tests/store-migration-witness.json`.
 *
 * A vitest config used only with `--config`; the committed `vitest.config.ts`
 * is untouched and `npm test` never loads this. It swaps each condemned
 * filesystem-store module for a generated wrapper whose exports record every
 * **call** (see `tests/setup/fs-store-witness.ts`), and adds a setup file that
 * writes one JSON line per test file.
 *
 * **Do not run this by hand** — [`scripts/store-migration-witness.ts`](scripts/store-migration-witness.ts)
 * drives it, aggregates the lines, keeps "did not report" apart from "did not
 * touch", and can prove the instrument still hooks anything before you believe
 * its output. That script is the entry point; this file is its engine.
 *
 * ## It reproduces the lanes, since 2026-09-04
 *
 * The first version ran every test file in **one** project against whatever
 * `DATABASE_URL` said, which is what `npm test` did before 260903e's three
 * projects landed. That was defensible for a one-off measurement taken while
 * the lanes were new, and it is wrong for a re-run taken *after* stage B
 * converts suites to Postgres: those suites are exactly the ones a laneless run
 * would put on the shared database, racing every dev server on the box, and a
 * suite that dies in its setup writes no record at all and is scored
 * `unresolved`. So the projects, their `include` lists, their `globalSetup` and
 * their setup files are now **derived from `vitest.config.ts`** rather than
 * restated, and the witness setup file is appended to each. One manifest, and
 * the instrumented run is the real run with a recorder in it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { type ViteUserConfig, defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const WITNESS = path.join(ROOT, "tests/setup/fs-store-witness.ts");
const WITNESS_SETUP = "./tests/setup/fs-store-witness-setup.ts";

/** The modules this instrument watches. NOT blobs-fs.ts — out of scope,
 *  because it is selected by credentials rather than by `SPIDERYARN_STORE`.
 *  Kept in step with `TARGETS` in scripts/store-migration-candidates.ts and
 *  `INSTRUMENTED` in scripts/store-migration-witness.ts, which asserts it.
 *
 *  **One left, and it is not condemned.** `artifacts-fs` and `data-root` went
 *  on 2026-09-05 with stage G's last adapter group, and `copy-artefacts`
 *  survives: stage D gave it a store-agnostic `ArtifactSource`, so what is left
 *  here is an instrument watching a module nothing is trying to delete. That is
 *  the state tsconfig.json predicted — *"deleted with the filesystem store in
 *  stage G, when there is nothing left to instrument"* — and retiring the
 *  instrument is stage I's, alongside the tombstone, so that stage H still has
 *  a working witness if it needs one. */
const CONDEMNED = [
  "copy-artefacts",
];
const CONDEMNED_PATHS = new Set(CONDEMNED.map((n) => path.join(ROOT, "src/store", `${n}.ts`)));
const BASENAME_RE = new RegExp(`(?:^|/)(${CONDEMNED.join("|")})\\.(?:js|ts)$`);

const PREFIX = "\0fsw:";

/** Every export of a condemned module, so the wrapper can re-export all of
 *  them. All of them declare their exports (`export const …`, `export function
 *  …`), checked 2026-09-04; an `export { … }` list would be **missed and the
 *  wrapper would fail loudly** at the importing test's first named import,
 *  which is the right way round for this to break. */
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
          (n) => `export const ${n} = __wrap(${JSON.stringify(mod)}, ${JSON.stringify(n)}, __orig.${n});`,
        ),
      ];
      return lines.join("\n");
    },
  };
}

type ProjectEntry = NonNullable<NonNullable<ViteUserConfig["test"]>["projects"]>[number];
/** The only shape this file can instrument: an inline project object. A glob
 *  string or a promise means `vitest.config.ts` changed shape and the derivation
 *  below needs re-deriving rather than guessing. */
type ProjectConfig = Extract<ProjectEntry, { test?: unknown }>;

function inlineProject(project: ProjectEntry): ProjectConfig {
  if (typeof project === "string" || typeof project === "function" || project instanceof Promise) {
    throw new Error("vitest.config.ts now declares a project as a glob, a function or a promise; re-derive the witness config.");
  }
  return project as ProjectConfig;
}

/**
 * The base config's projects, each with the recorder plugged in.
 *
 * Nothing here restates a file list, a lane or a setup file: the only edits are
 * **add the plugin** and **append the witness setup**, so a project this file
 * runs differs from the one `npm test` runs in exactly those two ways. The
 * shape is checked rather than assumed — a base config that stopped declaring
 * projects, or a project without the provider guard, means somebody changed the
 * suite's shape and this file needs re-deriving rather than quietly measuring
 * something else.
 */
function instrumentedProjects(): ProjectConfig[] {
  const projects = baseConfig.test?.projects;
  if (!Array.isArray(projects) || projects.length < 3) {
    throw new Error(
      `vitest.config.ts declares ${Array.isArray(projects) ? projects.length : 0} projects; expected the three lanes. Re-derive the witness config.`,
    );
  }
  return projects.map((entry) => {
    const project = inlineProject(entry);
    const test = project.test;
    const setupFiles = test?.setupFiles;
    if (!Array.isArray(setupFiles) || !setupFiles.includes("./tests/setup/no-provider-calls.ts")) {
      throw new Error(
        `project ${String(test?.name)} has no ./tests/setup/no-provider-calls.ts in setupFiles; re-derive the witness config.`,
      );
    }
    return {
      ...project,
      plugins: [...(project.plugins ?? []), witnessPlugin()],
      test: { ...test, setupFiles: [...setupFiles, WITNESS_SETUP] },
    } as ProjectConfig;
  });
}

export default defineConfig({
  ...baseConfig,
  test: { ...baseConfig.test, projects: instrumentedProjects() },
});
