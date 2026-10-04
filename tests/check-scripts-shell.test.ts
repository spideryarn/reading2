/**
 * **The two shell checks, run for real against a pretend world.**
 *
 * `scripts/check-remote-auth.sh` and `scripts/check-google-redirect.sh` are
 * checks whose own headers are about one thing: a check that passes while
 * measuring nothing. Three more ways they could do that were found on
 * 2026-10-03 (docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md
 * § X13 d, g, h), and each has a case here that was red against the script as
 * it stood:
 *
 * - **g** — the auth check asked jq whether a provider was *truthy*, so the
 *   string `"false"` read as ON, and a `github` key that was simply missing
 *   satisfied the control that says github must be OFF.
 * - **h** — the redirect check pasted the callback into a query string, so one
 *   carrying `?next=a&x=b` was asked about as a shorter address plus a stray
 *   parameter.
 * - **d** — both read their env files with `grep | cut | tr -d '"'`, which
 *   finds no `export X=…` line and leaves single quotes on the value.
 *
 * ## How these run, and why not more simply
 *
 * Both scripts `cd` to their own checkout and read `.env.local` / `.env.prod`
 * there, and `check-google-redirect.sh` takes its client id from nowhere else.
 * So a fake `curl` alone is not a seam: without the file the fake is never
 * reached, and with the developer's real file the test depends on the machine
 * (GPT Sol, PF7, docs/plans/261004b-sweep-clusters-9-15-16-21-plan-review-sol.md).
 *
 * So each case gets a **temporary directory shaped like a checkout**: copies of
 * the real scripts under `scripts/`, dummy env files beside them, and a fake
 * `curl` first on `PATH`. The child's environment is built from nothing rather
 * than inherited, so a `SUPABASE_URL` in the developer's shell cannot answer
 * for the fixture. The real env files are never opened.
 *
 * The scripts are *copied*, not rewritten: what runs is the bytes in
 * `scripts/`.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { parseEnvFile } from "../src/env.js";

const REPO_SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");

/**
 * The fake. It writes down what it was asked, one argument per line with a
 * `--call--` line between calls, and answers from the environment:
 *
 * - with `FAKE_CURL_BODY` set, the contents of that file — the settings body;
 * - otherwise it plays Google: the address a browser would *land* on, which is
 *   what `-w %{url_effective}` prints. Anything naming the control host lands
 *   on the error page with a base64 reason, as Google's does; anything else
 *   lands on the sign-in page.
 */
const FAKE_CURL = `#!/usr/bin/env bash
{
  echo "--call--"
  printf '%s\\n' "$@"
} >> "$CURL_LOG"
if [ -n "\${FAKE_CURL_BODY:-}" ]; then
  cat "$FAKE_CURL_BODY"
  exit 0
fi
case "$*" in
  *not-registered.example*)
    printf 'https://accounts.google.com/signin/oauth/error?authError=%s&client_id=x' "$(printf 'redirect_uri_mismatch' | base64)" ;;
  *)
    printf 'https://accounts.google.com/signin/identifier?continue=x' ;;
esac
`;

type World = {
  dir: string;
  run: (script: string, args?: string[], extraEnv?: Record<string, string>) => { status: number | null; stdout: string; stderr: string };
  /** Every call the fake `curl` received, as its argument list. */
  curlCalls: () => string[][];
};

const worlds: string[] = [];
afterEach(() => {
  for (const dir of worlds.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function world(files: { envLocal?: string; envProd?: string; settingsBody?: string }): World {
  const dir = mkdtempSync(path.join(tmpdir(), "spya-shell-checks-"));
  worlds.push(dir);
  mkdirSync(path.join(dir, "scripts"));
  mkdirSync(path.join(dir, "bin"));
  /* Every shell file, not a named few: the checks source a shared reader, and a
     list typed here would be a second place that has to know its name. */
  for (const name of readdirSync(REPO_SCRIPTS).filter((n) => n.endsWith(".sh"))) {
    copyFileSync(path.join(REPO_SCRIPTS, name), path.join(dir, "scripts", name));
    chmodSync(path.join(dir, "scripts", name), 0o755);
  }
  writeFileSync(path.join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(path.join(dir, "bin", "curl"), 0o755);
  if (files.envLocal !== undefined) writeFileSync(path.join(dir, ".env.local"), files.envLocal);
  if (files.envProd !== undefined) writeFileSync(path.join(dir, ".env.prod"), files.envProd);
  const log = path.join(dir, "curl.log");
  writeFileSync(log, "");
  const body = path.join(dir, "settings-body.json");
  if (files.settingsBody !== undefined) writeFileSync(body, files.settingsBody);

  return {
    dir,
    run(script, args = [], extraEnv = {}) {
      const r = spawnSync("bash", [path.join(dir, "scripts", script), ...args], {
        encoding: "utf8",
        timeout: 30_000,
        /* Built from nothing. `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and the
           rest are overrides the auth check honours, and inheriting one would
           let the developer's shell answer instead of the fixture. */
        env: {
          PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`,
          CURL_LOG: log,
          ...(files.settingsBody !== undefined ? { FAKE_CURL_BODY: body } : {}),
          ...extraEnv,
        },
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    curlCalls() {
      return readFileSync(log, "utf8")
        .split("--call--\n")
        .slice(1)
        .map((block) => block.replace(/\n$/, "").split("\n"));
    },
  };
}

/* ------------------------------------------------------------------ d -- */

/**
 * One line per spelling a hand-written env file can hold. The expectation is
 * not typed here: it is whatever `parseEnvFile` (src/env.ts) says, because the
 * point of the shared shell reader is that the shell checks and the TypeScript
 * ones stop disagreeing about what a file means.
 */
const SPELLINGS = [
  "# a comment, and a commented-out assignment below",
  "#COMMENTED=no",
  "PLAIN=plain-value",
  "export EXPORTED=exported-value",
  "SINGLE='single quoted'",
  'DOUBLE="double quoted"',
  "export EXPORTED_SINGLE='both at once'",
  "  PADDED  =   padded-value   ",
  "\texport   TABBED\t=\t\"tabbed\"\t",
  "WITH_EQUALS=a=b=c",
  "LONE_QUOTE=ab'",
  "INNER_QUOTE=it's",
  "EMPTY=",
  "TWICE=first",
  "TWICE=second",
  "PREFIX_LONGER=the-longer-name",
  "PREFIX=the-shorter-name",
  "",
].join("\n");

describe("scripts/env-value.sh — one env file reader for the shell checks", () => {
  const expected = parseEnvFile(SPELLINGS);
  const keys = [...Object.keys(expected), "COMMENTED", "ABSENT"];

  it("the fixture exercises every spelling it claims to", () => {
    expect(expected).toMatchObject({
      PLAIN: "plain-value",
      EXPORTED: "exported-value",
      SINGLE: "single quoted",
      DOUBLE: "double quoted",
      EXPORTED_SINGLE: "both at once",
      PADDED: "padded-value",
      TABBED: "tabbed",
      TWICE: "second",
      PREFIX: "the-shorter-name",
    });
    expect(expected.COMMENTED).toBeUndefined();
  });

  it.each(keys)("reads %s the way src/env.ts § parseEnvFile does", (key) => {
    const w = world({ envLocal: SPELLINGS });
    const r = spawnSync("bash", ["-c", '. scripts/env-value.sh && env_value "$1" "$2"', "bash", ".env.local", key], {
      cwd: w.dir,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.replace(/\n$/, "")).toBe(expected[key] ?? "");
  });

  it("answers with nothing, and no error, for a file that is not there", () => {
    const w = world({});
    const r = spawnSync("bash", ["-c", '. scripts/env-value.sh && env_value .env.prod PLAIN'], {
      cwd: w.dir,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" },
    });
    expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});

/* ------------------------------------------------------------------ g -- */

const PROD = "SUPABASE_URL=https://fixture-project.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture\n";

function settings(external: unknown): string {
  return JSON.stringify({ external, disable_signup: false, mailer_autoconfirm: false });
}

describe("scripts/check-remote-auth.sh", () => {
  it("google on, with both controls the right way round, is exit 0", () => {
    const w = world({ envProd: PROD, settingsBody: settings({ email: true, github: false, google: true, apple: false }) });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ {2}email +ON$/m);
    expect(r.stdout).toMatch(/^ {2}github +OFF$/m);
    expect(r.stdout).toMatch(/^ {2}google +ON$/m);
    expect(r.stdout).toContain("all providers on: email, google\n");
    expect(w.curlCalls()).toHaveLength(1);
    const [call = []] = w.curlCalls();
    expect(call).toContain("apikey: sb_publishable_fixture");
    expect(call.at(-1)).toBe("https://fixture-project.supabase.co/auth/v1/settings");
  });

  it("google off is exit 1, and says which error that is", () => {
    const w = world({ envProd: PROD, settingsBody: settings({ email: true, github: false, google: false }) });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^ {2}google +OFF$/m);
    expect(r.stderr).toContain("Google is off on this project");
  });

  /* Each of these was a pass or an ordinary "off" before, and each is a body
     this check cannot read: a provider that is not a boolean, or a control
     whose key is not there to be read. */
  it.each([
    ["google is the string \"false\"", { email: true, github: false, google: "false" }],
    ["google is the string \"true\"", { email: true, github: false, google: "true" }],
    ["email is the string \"true\"", { email: "true", github: false, google: true }],
    ["the github control is missing", { email: true, google: true }],
    ["the email control is missing", { github: false, google: true }],
    ["google is missing", { email: true, github: false }],
    ["github is null", { email: true, github: null, google: true }],
    ["external is a list", ["email", "google"]],
    ["external is a string", "email,google"],
  ])("exits 2, as a broken check, when %s", (_name, external) => {
    const w = world({ envProd: PROD, settingsBody: settings(external) });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(2);
    /* And it must not have printed a verdict on the way to refusing: a line
       saying `google ON` above an exit 2 is the contradiction PF6 named. */
    expect(r.stdout).not.toMatch(/google +ON/);
    expect(r.stdout).not.toMatch(/all providers on/);
    expect(r.stderr).not.toBe("");
  });

  it("does not list a provider as on because its value is a non-empty string", () => {
    const w = world({ envProd: PROD, settingsBody: settings({ email: true, github: false, google: true, apple: "false", azure: 1 }) });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("all providers on: email, google\n");
  });

  it("controls the wrong way round are still exit 2", () => {
    const w = world({ envProd: PROD, settingsBody: settings({ email: true, github: true, google: true }) });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("controls came back the wrong way round");
  });

  it("reads an `export`ed, quoted and padded .env.prod (item d)", () => {
    const w = world({
      envProd: "export SUPABASE_URL='https://fixture-project.supabase.co'\n  SUPABASE_PUBLISHABLE_KEY = \"sb_publishable_fixture\"  \n",
      settingsBody: settings({ email: true, github: false, google: true }),
    });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(0);
    const [call = []] = w.curlCalls();
    expect(call).toContain("apikey: sb_publishable_fixture");
    expect(call.at(-1)).toBe("https://fixture-project.supabase.co/auth/v1/settings");
  });

  it("falls back to SUPABASE_ANON_KEY, and lets the environment override the file", () => {
    const w = world({
      envProd: "SUPABASE_URL=https://fixture-project.supabase.co\nSUPABASE_ANON_KEY='anon-fixture'\n",
      settingsBody: settings({ email: true, github: false, google: true }),
    });
    expect(w.run("check-remote-auth.sh").status).toBe(0);
    expect(w.curlCalls()[0]).toContain("apikey: anon-fixture");
    expect(w.run("check-remote-auth.sh", [], { SUPABASE_URL: "https://other.supabase.co" }).status).toBe(0);
    expect(w.curlCalls()[1]?.at(-1)).toBe("https://other.supabase.co/auth/v1/settings");
  });

  it("with no .env.prod and no environment, says so and never calls curl", () => {
    const w = world({ settingsBody: settings({ email: true, github: false, google: true }) });
    const r = w.run("check-remote-auth.sh");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Need SUPABASE_URL");
    expect(w.curlCalls()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ h -- */

/**
 * The address curl would request, worked out from its arguments the way curl
 * does: under `-G`, every `--data-urlencode name=value` is appended to the URL
 * as `name=<percent-encoded value>`. Without `-G` the URL argument is the
 * request. Either way the answer is parsed as Google would parse it, so the
 * assertion below is about **what Google is asked**, and holds for the old
 * spelling and the new one alike — which is what let it be red first.
 */
function requested(call: string[]): URL {
  const base = call.find((a) => a.startsWith("https://accounts.google.com/"));
  if (!base) throw new Error(`no Google address in: ${JSON.stringify(call)}`);
  if (!call.includes("-G")) return new URL(base);
  const pairs: string[] = [];
  call.forEach((arg, i) => {
    if (arg !== "--data-urlencode") return;
    const data = call[i + 1] ?? "";
    const eq = data.indexOf("=");
    pairs.push(`${data.slice(0, eq)}=${encodeURIComponent(data.slice(eq + 1))}`);
  });
  return new URL(`${base}${base.includes("?") ? "&" : "?"}${pairs.join("&")}`);
}

const LOCAL = "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=fixture-client.apps.googleusercontent.com\nSUPABASE_URL=http://127.0.0.1:54361\n";

describe("scripts/check-google-redirect.sh", () => {
  it("asks Google about the whole callback, query string and all", () => {
    const callback = "https://reader.example/auth/v1/callback?next=a&x=b";
    const w = world({ envLocal: LOCAL, envProd: PROD });
    const r = w.run("check-google-redirect.sh", [callback]);

    const calls = w.curlCalls();
    expect(calls).toHaveLength(2); // the control, then the one asked about
    const asked = requested(calls[1] ?? []);
    expect(asked.searchParams.get("redirect_uri")).toBe(callback);
    expect(asked.searchParams.get("x")).toBeNull();
    expect([...asked.searchParams.keys()].sort()).toEqual(["client_id", "redirect_uri", "response_type", "scope"]);
    expect(asked.searchParams.get("client_id")).toBe("fixture-client.apps.googleusercontent.com");
    expect(asked.searchParams.get("response_type")).toBe("code");
    expect(asked.searchParams.get("scope")).toBe("email");
    expect(asked.origin + asked.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    /* `-L` is the script's own first rule: without it the verdict is read off
       a redirect stub. */
    expect(calls[1]).toContain("-L");

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^REJECTED +https:\/\/not-registered\.example\/cb +\(redirect_uri_mismatch\)$/m);
    expect(r.stdout).toContain(`ACCEPTED  ${callback}`);
  });

  it("with no arguments, probes the control and the two derived callbacks", () => {
    const w = world({ envLocal: LOCAL, envProd: PROD });
    const r = w.run("check-google-redirect.sh");
    expect(r.status).toBe(0);
    expect(w.curlCalls().map((c) => requested(c).searchParams.get("redirect_uri"))).toEqual([
      "https://not-registered.example/cb",
      "http://127.0.0.1:54361/auth/v1/callback",
      "https://fixture-project.supabase.co/auth/v1/callback",
    ]);
  });

  it("reads `export`ed, quoted and padded env files (item d)", () => {
    const w = world({
      envLocal:
        "export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID='fixture-client.apps.googleusercontent.com'\n" +
        '  SUPABASE_URL = "http://127.0.0.1:54399"  \n',
      envProd: "export SUPABASE_URL='https://fixture-project.supabase.co'\n",
    });
    const r = w.run("check-google-redirect.sh");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const asked = w.curlCalls().map(requested);
    expect(asked.map((u) => u.searchParams.get("client_id"))).toEqual(Array(3).fill("fixture-client.apps.googleusercontent.com"));
    expect(asked.map((u) => u.searchParams.get("redirect_uri"))).toEqual([
      "https://not-registered.example/cb",
      "http://127.0.0.1:54399/auth/v1/callback",
      "https://fixture-project.supabase.co/auth/v1/callback",
    ]);
  });

  it("a rejected callback is exit 1, and a control that is not rejected is exit 1 too", () => {
    const w = world({ envLocal: LOCAL, envProd: PROD });
    const rejected = w.run("check-google-redirect.sh", ["https://not-registered.example/another"]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("1 of the URIs you asked about are NOT registered");

    /* A curl that lands everything on the sign-in page: the control says
       ACCEPTED, and the script must refuse to be believed. */
    writeFileSync(path.join(w.dir, "bin", "curl"), "#!/usr/bin/env bash\nprintf 'https://accounts.google.com/signin/identifier?x'\n");
    const blind = w.run("check-google-redirect.sh", ["https://reader.example/cb"]);
    expect(blind.status).toBe(1);
    expect(blind.stderr).toContain("The control was not rejected");
  });

  it("with no client id, says so and never calls curl", () => {
    const w = world({ envLocal: "SUPABASE_URL=http://127.0.0.1:54361\n", envProd: PROD });
    const r = w.run("check-google-redirect.sh");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("No SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID in .env.local");
    expect(w.curlCalls()).toEqual([]);
  });
});
