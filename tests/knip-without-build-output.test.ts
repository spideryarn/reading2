/**
 * **Knip inspects source, so it must not need build output.**
 *
 * `vite.api.config.ts` used to read `dist/index.html` at module load, as the guard that stops a
 * stale client shell being compiled into the serverless function. Knip loads that config to
 * discover the Vite graph, so a missing `dist/` (a fresh worktree) or a stale one (after any
 * pull) made it print `Error loading vite.api.config.ts` and exit 1 before anybody had read a
 * finding. The guard is right; where it ran was not —
 * docs/postmortems/260908d-build-only-config-work-runs-during-static-analysis.md.
 *
 * tests/client-shell.test.ts proves the guard refuses when called. This file is the other
 * consumer: the real Knip, over a copy of this repo's tracked files, with a `dist/` the test
 * controls — because the checkout running the suite may have a fresh, stale or absent one of its
 * own. Source directories cannot be symlinks: Knip's glob does not follow them, and a tree of
 * linked directories gives it no source at all — which it reports as every dependency unused and
 * no config error. The copied tree has a real `node_modules/` containing symlinks to each installed
 * entry, so dependency resolution is cheap but Vite's temporary config bundle stays inside the
 * disposable tree rather than leaking through one top-level symlink into the checkout's shared
 * `node_modules/.vite-temp`. Docs, Markdown and the HTML eval fixtures are left out as nothing Knip
 * reads; the copy produced the same 359 findings as the real tree when this was written.
 *
 * **A clean run proves nothing on its own**, so each run must also show the graph is whole: an
 * unused canary at the repo root (what knip.jsonc's `*.{ts,mts,cts}` glob is for) is reported,
 * the production entries are present and not reported, the `@` alias has no unresolved imports,
 * dependencies imported only from source are not reported, and neither are the fonts imported
 * only from CSS.
 *
 * The other half — that a build still refuses a missing or stale shell, and still gets the shell
 * when it matches — is the second `describe` below, through Vite's own `resolveConfig`.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { resolveConfig } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const KNIP = path.join(ROOT, "node_modules", ".bin", "knip");

const CANARY = "scratch-knip-canary.mts";

interface KnipReport {
  issues: Array<Record<string, unknown> & { file: string }>;
}

interface KnipRun {
  stderr: string;
  unusedFiles: string[];
  unusedDependencies: string[];
  unresolvedImports: string[];
}

let tree = "";

beforeAll(() => {
  tree = mkdtempSync(path.join(tmpdir(), "knip-without-build-"));
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0");
  for (const file of tracked) {
    if (!file || file.startsWith("docs/") || file.endsWith(".md")) continue;
    if (file.endsWith(".html") && file !== "index.html") continue;
    const from = path.join(ROOT, file);
    /* Tracked but deleted in this working tree, or a submodule-shaped entry: nothing to copy. */
    if (!statSync(from, { throwIfNoEntry: false })?.isFile()) continue;
    mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
    copyFileSync(from, path.join(tree, file));
  }
  const installed = path.join(ROOT, "node_modules");
  const copiedNodeModules = path.join(tree, "node_modules");
  mkdirSync(copiedNodeModules);
  for (const entry of readdirSync(installed)) {
    /* Vite finds the nearest node_modules and writes its bundled config into .vite-temp there.
       Keep that one local to the disposable tree; everything used for module resolution can be a
       link to the installed entry. */
    if (entry === ".vite-temp") continue;
    symlinkSync(path.join(installed, entry), path.join(copiedNodeModules, entry));
  }
  writeFileSync(path.join(tree, CANARY), "export const nobodyImportsThis = 1;\n");
}, 120_000);

afterAll(() => {
  if (tree) rmSync(tree, { recursive: true, force: true });
});

/** Run Knip in the copied tree. Exit 1 is expected: the repo has advisory findings. */
async function knip(env: NodeJS.ProcessEnv): Promise<KnipRun> {
  const result = await run(KNIP, ["--reporter", "json", "--no-progress"], {
    cwd: tree,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  }).catch((err: { stdout?: string; stderr?: string; code?: number }) => {
    /* Knip exits 1 when it has findings, 2 when it could not run at all. Only the first is an
       answer; the second must fail the test rather than look like an empty report. */
    if (err.code !== 1 || !err.stdout) throw err;
    return { stdout: err.stdout, stderr: err.stderr ?? "" };
  });
  const report = JSON.parse(result.stdout) as KnipReport;
  const names = (key: string) =>
    report.issues.flatMap((issue) => ((issue[key] ?? []) as Array<{ name: string }>).map((i) => i.name));
  return {
    stderr: result.stderr,
    unusedFiles: names("files"),
    unusedDependencies: [...names("dependencies"), ...names("devDependencies")],
    unresolvedImports: names("unresolved"),
  };
}

function expectACompleteGraph(result: KnipRun): void {
  expect(result.stderr).not.toMatch(/Error loading/);
  expect(result.unusedFiles).toContain(CANARY);
  for (const entry of ["src/vercel.ts", "api/index.js", "src/web/main.tsx"]) {
    expect(statSync(path.join(tree, entry), { throwIfNoEntry: false })?.isFile()).toBe(true);
    expect(result.unusedFiles).not.toContain(entry);
  }
  for (const dependency of ["react", "pg", "@fontsource-variable/geist", "tailwindcss"]) {
    expect(result.unusedDependencies).not.toContain(dependency);
  }
  /* The repo has one deliberate unresolved prose-shaped fixture, so assert only the alias family
     this stage promises to preserve. A broken `@` alias can leave the entry and dependencies above
     looking healthy while disconnecting the component graph below App.tsx. */
  expect(result.unresolvedImports.filter((name) => name.startsWith("@/"))).toEqual([]);
}

describe("Knip over this repo without a fresh build", () => {
  it("loads every config and sees the whole graph when dist/ is missing", async () => {
    rmSync(path.join(tree, "dist"), { recursive: true, force: true });
    expectACompleteGraph(await knip({ SPIDERYARN_BUILD_COMMIT: "4adcdfd62703b6565a27a03c50f20f8a215f1bd8" }));
  }, 120_000);

  it("loads every config and sees the whole graph when dist/ is from another commit", async () => {
    mkdirSync(path.join(tree, "dist"), { recursive: true });
    writeFileSync(
      path.join(tree, "dist", "index.html"),
      '<!doctype html><html><head></head><body><script type="module" src="/assets/index-abc.js"></script></body></html>',
    );
    writeFileSync(
      path.join(tree, "dist", "build.json"),
      JSON.stringify({ commit: "dea7bf69124150cea647860756d6a9a34f8c1ac3" }),
    );
    expectACompleteGraph(await knip({ SPIDERYARN_BUILD_COMMIT: "4adcdfd62703b6565a27a03c50f20f8a215f1bd8" }));
  }, 120_000);
});

/**
 * **And the build still gets the guard, and the shell.** Moving the read out of module scope
 * is only half right if it moved somewhere a build never goes, or if its `define` stops reaching
 * the bundle — then `builtShell()` in src/public/page.ts sees no constant, returns `null`, and
 * every shared link falls through the API router and 404s. Vite's own `resolveConfig` for a build
 * runs the plugin hooks a real `vite build` runs, without compiling anything.
 */
describe("the API build config, resolved the way vite build resolves it", () => {
  const COMMIT = "7e3d98ef12e5647bce1e2002eb2ce2873b48869f";
  /* What `vite build` makes of the repo's index.html, as tests/client-shell.test.ts derives it. */
  const BUILT = () =>
    readFileSync(path.join(ROOT, "index.html"), "utf8").replace(
      '<script type="module" src="/src/web/boot.tsx"></script>',
      '<script type="module" crossorigin src="/assets/index-CIBahh0D.js"></script>',
    );

  async function resolveApiBuild() {
    vi.stubEnv("SPIDERYARN_BUILD_COMMIT", COMMIT);
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    try {
      /* The last two arguments are the defaults used by Vite's real build path. A direct
         resolveConfig call otherwise uses development, while Vitest supplies NODE_ENV=test. */
      return await resolveConfig(
        { configFile: path.join(tree, "vite.api.config.ts"), logLevel: "silent" },
        "build",
        "production",
        "production",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("refuses to resolve when dist/ is missing", async () => {
    rmSync(path.join(tree, "dist"), { recursive: true, force: true });
    await expect(resolveApiBuild()).rejects.toThrow(/Cannot read the built client shell/);
  }, 60_000);

  it("refuses to resolve when dist/ is from another commit", async () => {
    mkdirSync(path.join(tree, "dist"), { recursive: true });
    writeFileSync(path.join(tree, "dist", "index.html"), BUILT());
    writeFileSync(path.join(tree, "dist", "build.json"), JSON.stringify({ commit: "0f52886a1b2c3d4e5f60718293a4b5c6d7e8f901" }));
    await expect(resolveApiBuild()).rejects.toThrow(/Client shell is not from this build/);
  }, 60_000);

  it("compiles the matching shell and its digest into the build", async () => {
    const html = BUILT();
    mkdirSync(path.join(tree, "dist"), { recursive: true });
    writeFileSync(path.join(tree, "dist", "index.html"), html);
    writeFileSync(path.join(tree, "dist", "build.json"), JSON.stringify({ commit: COMMIT }));
    const config = await resolveApiBuild();
    expect(config.define?.__SPIDERYARN_BUILT_SHELL__).toBe(JSON.stringify(html));
    expect(config.define?.__SPIDERYARN_BUILT_SHELL_SHA256__).toBe(
      JSON.stringify(createHash("sha256").update(html).digest("hex")),
    );
    /* The module-level defines are still there beside them, not replaced by the hook's object. */
    expect(config.define?.__SPIDERYARN_BUILD_COMMIT__).toBe(JSON.stringify(COMMIT));
  }, 60_000);
});
