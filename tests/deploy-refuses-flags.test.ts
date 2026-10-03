/**
 * `scripts/deploy.ts` itself, run with an argument it must refuse.
 *
 * `parseDeployArgs` is tested as a function in tests/deploy-checks.test.ts. This file asks the
 * other question, the one a function test cannot: that the **script** consults it before it does
 * anything at all. Until 2026-10-03 each of these three spellings ran the gates, applied the
 * remote migrations and pushed to `main` — docs/plans/261003g-deploy-refuses-unknown-flags.md.
 *
 * **What keeps this off production, red or green.** `PATH` leads with a directory of stubs —
 * `git`, `npm`, `npx`, `vercel`, `supabase`, `psql` — that write their name to a log and exit 1.
 * The deploy path's first external step is `git` (`takeLock` → `gitCommonDir`), before any
 * network or database call, so a script that fails to refuse dies at the stub — and the log
 * naming `git` is exactly how these were seen red. A Node preload refuses and logs `fetch`
 * and socket connections before imports run, including Postgres using `.env.prod`. Unlike an
 * environment proxy, it cannot be bypassed by inherited `NO_PROXY` or lowercase proxy keys.
 * The PATH stubs cover the external commands this script uses; they do not sandbox arbitrary
 * new commands or filesystem writes. Do not add a case here the script is *meant* to accept.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDeployArgs } from "../scripts/deploy-checks.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const STUBBED = ["git", "npm", "npx", "vercel", "supabase", "psql"];

let stubs: string;
let touched: string;
let guard: string;

/* Loaded before tsx and the deploy module, so even an import-time connection
   is refused. Socket.connect covers both pg's TCP and TLS connections. */
const NETWORK_GUARD = `
import { appendFileSync } from "node:fs";
import { Socket } from "node:net";
const block = (kind) => {
  appendFileSync(process.env.DEPLOY_TEST_TOUCHED, kind + "\\n");
  throw new Error("deploy refusal test blocked " + kind);
};
globalThis.fetch = async () => block("fetch");
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  /* A unix socket is not the network: tsx talks to itself over one at startup. */
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const local = typeof first === "string" || (first && typeof first === "object" && typeof first.path === "string");
  return local ? connect.apply(this, args) : block("socket");
};
`;

beforeAll(() => {
  stubs = mkdtempSync(path.join(tmpdir(), "deploy-refuses-"));
  touched = path.join(stubs, "touched.log");
  guard = path.join(stubs, "network-guard.mjs");
  writeFileSync(guard, NETWORK_GUARD);
  for (const name of STUBBED) {
    const file = path.join(stubs, name);
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${touched}"\nexit 1\n`);
    chmodSync(file, 0o755);
  }
});

afterAll(() => rmSync(stubs, { recursive: true, force: true }));

function deploy(args: string[], extraEnv: Record<string, string> = {}) {
  rmSync(touched, { force: true });
  /* An unrelated inherited npm flag must not make a broken argv parser pass
     these tests by refusing for a different reason. Each case supplies its own. */
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
  );
  const env: NodeJS.ProcessEnv = { ...inherited, ...extraEnv, PATH: `${stubs}:${process.env.PATH ?? ""}`, HOME: stubs };
  env.DEPLOY_TEST_TOUCHED = touched;
  delete env.NODE_OPTIONS;
  /* Nothing here should be reachable, and these make sure of it twice. */
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_URL|SUPABASE_|VERCEL_|RESEND_|OPENROUTER_)/.test(key)) delete env[key];
  }
  const r = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(guard).href, "--import", "tsx", "scripts/deploy.ts", ...args],
    { cwd: ROOT, env, encoding: "utf8", timeout: 60_000 },
  );
  return {
    status: r.status,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error?.message ?? ""}`,
    touched: existsSync(touched) ? readFileSync(touched, "utf8") : "",
  };
}

describe("npm run deploy refuses what it does not understand, before it touches anything", () => {
  /* The control: an empty log means nothing unless the fence is known to write to it. */
  it("the fence these run behind really does block, and says so", () => {
    for (const [what, code] of [
      ["fetch", 'await fetch("https://www.spideryarn.com/api/health")'],
      ["socket", '(await import("node:net")).connect(443, "www.spideryarn.com")'],
    ] as const) {
      rmSync(touched, { force: true });
      const r = spawnSync(
        process.execPath,
        ["--import", pathToFileURL(guard).href, "--input-type=module", "-e", code],
        { env: { ...process.env, DEPLOY_TEST_TOUCHED: touched }, encoding: "utf8", timeout: 30_000 },
      );
      expect(r.status, what).not.toBe(0);
      expect(r.stderr, what).toContain(`deploy refusal test blocked ${what}`);
      expect(readFileSync(touched, "utf8"), what).toBe(`${what}\n`);
    }
  });

  it("a mistyped flag", () => {
    const r = deploy(["--verify-onyl"]);
    expect(r.touched).toBe("");
    expect(r.status, r.output).toBe(2);
    expect(r.output).toContain("unknown argument '--verify-onyl'");
  });

  it("a flag npm swallowed because the `--` was dropped", () => {
    /* What npm 11.19.0 leaves behind for `npm run deploy --verify-only`: empty argv and this. */
    for (const key of ["npm_config_verify_only", "npm_config_dry_run"]) {
      const r = deploy([], { [key]: "true" });
      expect(r.touched, key).toBe("");
      expect(r.status, `${key}: ${r.output}`).toBe(2);
      expect(r.output, key).toContain(key);
      expect(r.output, key).toContain("npm run deploy -- --");
    }
  });

  it("--host without --verify-only", () => {
    const r = deploy(["--host", "https://staging.example"]);
    expect(r.touched).toBe("");
    expect(r.status, r.output).toBe(2);
    expect(r.output).toContain("--host only goes with --verify-only");
  });
});

describe("the refusal test's network guard", () => {
  it("blocks fetch and raw database sockets before they can reach a host", () => {
    rmSync(touched, { force: true });
    const r = spawnSync(process.execPath, ["--import", pathToFileURL(guard).href, "--input-type=module", "-e", `
      import { connect } from "node:net";
      import { connect as tlsConnect } from "node:tls";
      for (const attempt of [
        () => fetch("http://127.0.0.1:9/"),
        () => connect({ host: "127.0.0.1", port: 5432 }),
        () => tlsConnect({ host: "127.0.0.1", port: 5432 }),
      ]) {
        try { await attempt(); process.exit(1); }
        catch (err) { if (!err.message.startsWith("deploy refusal test blocked ")) throw err; }
      }
    `], {
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        DEPLOY_TEST_TOUCHED: touched,
        NO_PROXY: "*",
        https_proxy: "http://127.0.0.1:1",
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(r.error, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBeUndefined();
    expect(r.status).toBe(0);
    expect(readFileSync(touched, "utf8")).toBe("fetch\nsocket\nsocket\n");
  });
});

/**
 * The same question asked of **npm itself**, because everything above takes on trust what npm
 * does with a flag it was not meant to have. A probe package whose `deploy` script prints its
 * argv and environment; the real `npm run`; the real parser. This is what goes red when an npm
 * upgrade starts forwarding the flag, renames the variable, or exports a new key of its own on
 * every run — the last of which would otherwise refuse every deploy.
 */
describe("what npm really hands the script", () => {
  let probe: string;
  beforeAll(() => {
    probe = mkdtempSync(path.join(tmpdir(), "deploy-npm-probe-"));
    writeFileSync(
      path.join(probe, "probe.mjs"),
      'const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase().startsWith("npm_config_")));\n' +
        'console.log("PROBE" + JSON.stringify({ argv: process.argv.slice(2), env }));\n',
    );
    writeFileSync(
      path.join(probe, "package.json"),
      JSON.stringify({ name: "probe", version: "1.0.0", private: true, scripts: { deploy: "node probe.mjs" } }),
    );
  });
  afterAll(() => rmSync(probe, { recursive: true, force: true }));

  function npmRunDeploy(...args: string[]) {
    /* Not the test runner's own npm_config_*: what a shell that is not inside `npm test` has. */
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith("npm_")));
    const r = spawnSync("npm", ["run", "deploy", ...args], { cwd: probe, env, encoding: "utf8", timeout: 60_000 });
    expect(r.error, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBeUndefined();
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    const line = r.stdout.split("\n").find((l) => l.startsWith("PROBE"));
    expect(line, `${r.stdout}${r.stderr}`).toBeDefined();
    const seen = JSON.parse((line ?? "").slice("PROBE".length)) as { argv: string[]; env: Record<string, string> };
    return { seen, parsed: parseDeployArgs(seen.argv, seen.env) };
  }

  it("a plain `npm run deploy` is a deploy: npm's own keys are all on the ordinary list", () => {
    const { parsed } = npmRunDeploy();
    expect(parsed).toEqual({ ok: true, mode: { op: "deploy", skipMigrations: false, forcedGates: new Set() } });
  });

  it("with the `--`, the flag arrives and is obeyed", () => {
    expect(npmRunDeploy("--", "--verify-only").parsed).toEqual({ ok: true, mode: { op: "verify", host: null } });
    expect(npmRunDeploy("--", "--dry-run").parsed).toMatchObject({ ok: true, mode: { op: "dry-run" } });
  });

  it.each(["--verify-only", "--dry-run", "--verify-onyl", "--verfiy-only", "--read-only", "--host=https://staging.example", "-n", "--no"])(
    "without it, %s is swallowed — and refused",
    (flag) => {
      const { seen, parsed } = npmRunDeploy(flag);
      expect(parsed.ok, JSON.stringify(seen)).toBe(false);
      if (!parsed.ok) {
        expect(parsed.problem.join("\n")).toContain(
          flag === "-n" || flag === "--no" ? "npm_config_yes" : `npm run deploy -- ${flag.split("=")[0]}`,
        );
      }
    },
  );
});
