/**
 * **A failing assertion over a test worker's environment prints no secret.**
 *
 * On 2026-09-10 a red-first run of `expect(<an env dump>)…` printed four real keys into a
 * subagent's context, because every worker held every key in `.env.local`
 * (docs/postmortems/260910d-an-assertion-over-a-whole-environment-prints-every-secret-when-it-fails.md).
 * The fix is `scrubSecrets` (tests/helpers/scrub-secrets.ts), called in each lane's setup. This
 * file is the check that it did something, in the unit lane, where nothing is kept real.
 *
 * **Every assertion here compares names or booleans, never values.** This file reads the real
 * values out of `.env.local` into memory so it can look for them, and a failure message is built
 * from its subject, so no subject below may hold one.
 *
 * Watched red before the lane setups called the scrub: the first three cases named the
 * `.env.local` keys they found in the rendered failure, in the worker, and in a child.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { processError } from "@vitest/utils/error";
import { describe, expect, it, vi } from "vitest";

import { isSecretName } from "../scripts/subagent-cli.js";
import { PINNED, parseEnvFile, pinnedNames } from "../src/env.js";
import {
  keptOnlyIfLocal,
  SCRUBBED_SECRET,
  scrubbedValue,
  scrubSecrets,
  unscrubbedNames,
} from "./helpers/scrub-secrets.js";
import { UNIT_LANE_POISON, UNIT_LANE_STORAGE_POISON } from "./helpers/unit-lane-poison.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

/**
 * The real values of `.env.local`'s secret-named variables, by name. Held in memory to be looked
 * for and never put into an assertion's subject.
 *
 * Values under eight characters are left out: a short value can turn up in a rendering by
 * coincidence, and nothing that short is a credential.
 */
function secretsInEnvLocal(): Map<string, string> {
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return new Map();
  }
  return new Map(
    Object.entries(parseEnvFile(text)).filter(([name, value]) => isSecretName(name) && value.length >= 8),
  );
}

const SECRETS = secretsInEnvLocal();

/** The names whose real value appears somewhere in `text`. */
function leakedInto(text: string): string[] {
  return [...SECRETS].filter(([, value]) => text.includes(value)).map(([name]) => name);
}

/* The constants, not whatever the worker holds now: reading the current values would let a
   miswired setup exempt the very value this file exists to catch. GPT Sol, 2026-09-11. */
const POISONS = [UNIT_LANE_POISON, UNIT_LANE_STORAGE_POISON];

describe("the unit lane's worker environment", () => {
  /* A fresh clone or CI has no `.env.local`, so there is nothing of the file's to find. The
     shell's own secrets are still covered by the next case. */
  it.skipIf(SECRETS.size === 0)(
    "prints no .env.local value when an assertion over the whole environment fails",
    () => {
      /* Both shapes the postmortem measured printing every value: a diff over the object, and a
         "Received" block over the text a stand-in's `env` would have written. */
      const dump = Object.entries(process.env).map(([name, value]) => `${name}=${value}`).join("\n");
      const attempts = [
        () => expect({ ...process.env }).toEqual({}),
        () => expect(dump).toContain("A-LINE-NO-ENVIRONMENT-HAS="),
      ];
      let rendered = "";
      for (const attempt of attempts) {
        try {
          attempt();
        } catch (err) {
          /* The same processing the reporter applies before printing: the message, and the diff
             vitest draws from `actual` and `expected`. */
          const e = processError(err);
          rendered += [e.message, e.diff, e.stack].filter(Boolean).join("\n");
        }
      }
      /* Controls, as booleans. Without them an assertion that never failed, or a rendering that
         left the environment out, would pass the last line vacuously. */
      expect(rendered.length > 0, "the assertion over process.env did not fail").toBe(true);
      expect(rendered.includes("PATH"), "the rendered failure does not show the environment").toBe(true);
      expect(leakedInto(rendered), "names whose real value is in the rendered failure").toEqual([]);
    },
  );

  it("holds the sentinel in every secret-named variable, whichever source set it", () => {
    expect(unscrubbedNames(process.env, POISONS), "secret-named variables holding a real value").toEqual([]);
  });

  it("keeps them scrubbed across vi.resetModules() and a second loadEnvLocal()", async () => {
    vi.resetModules();
    const fresh = await import("../src/env.js");
    fresh.loadEnvLocal();
    expect(unscrubbedNames(process.env, POISONS), "put back by a reloaded loadEnvLocal()").toEqual([]);
  });

  it(
    "keeps them scrubbed in a child that spreads process.env and loads .env.local itself",
    () => {
      /* The child prints NAMES: the secret-named variables still holding something real once its
         own loadEnvLocal() has run, by the same rule as the cases above. */
      const body = `void (async () => {
        const { loadEnvLocal } = await import(${JSON.stringify(path.join(ROOT, "src/env.ts"))});
        const { unscrubbedNames } = await import(${JSON.stringify(path.join(ROOT, "tests/helpers/scrub-secrets.ts"))});
        loadEnvLocal();
        console.log("UNSCRUBBED=" + JSON.stringify(unscrubbedNames(process.env, ${JSON.stringify(POISONS)})));
      })();`;
      const child = spawnSync(TSX, ["-e", body], { env: { ...process.env }, encoding: "utf8" });
      const line = /^UNSCRUBBED=(.*)$/m.exec(child.stdout ?? "")?.[1];
      expect(line !== undefined, `the child printed no UNSCRUBBED= line (status ${child.status})`).toBe(true);
      expect(JSON.parse(line ?? "[]") as string[], "real values in a child after its loadEnvLocal()").toEqual([]);
    },
    60_000,
  );
});

describe("scrubSecrets", () => {
  it("replaces every present secret-named value, pins it, and leaves everything else alone", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/bin",
      OPENROUTER_API_KEY: "real-1",
      CLAUDE_CODE_MESSAGING_TOKEN: "real-2",
      DATABASE_URL: "postgres://u:p@h/db",
      KEYBOARD_LAYOUT: "uk",
      [PINNED]: "SUPABASE_URL",
    };
    const scrubbed = scrubSecrets(env);
    expect(scrubbed.sort()).toEqual(["CLAUDE_CODE_MESSAGING_TOKEN", "DATABASE_URL", "OPENROUTER_API_KEY"]);
    expect(env.OPENROUTER_API_KEY).toBe(SCRUBBED_SECRET);
    expect(env.PATH).toBe("/bin");
    expect(env.KEYBOARD_LAYOUT).toBe("uk");
    expect([...pinnedNames(env[PINNED])].sort()).toEqual([
      "CLAUDE_CODE_MESSAGING_TOKEN",
      "DATABASE_URL",
      "OPENROUTER_API_KEY",
      "SUPABASE_URL",
    ]);
  });

  it("leaves a kept name real and off the pin, and invents no absent name", () => {
    const env: NodeJS.ProcessEnv = { SUPABASE_SERVICE_ROLE_KEY: "local", STRIPE_SECRET_KEY: "x" };
    scrubSecrets(env, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"]);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("local");
    expect(env.STRIPE_SECRET_KEY).toBe(SCRUBBED_SECRET);
    expect("SUPABASE_ANON_KEY" in env).toBe(false);
    expect([...pinnedNames(env[PINNED])]).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("keeps a URL's shape and drops the credentials in it, and leaves NO_PROXY alone", () => {
    expect(scrubbedValue("DATABASE_URL", "postgres://u:hunter2@db.example:5432/app?sslkey=x")).toBe(
      "postgres://scrubbed@db.example:5432/app",
    );
    expect(scrubbedValue("HTTPS_PROXY", "http://u:p@proxy.example:3128")).toBe("http://scrubbed@proxy.example:3128/");
    /* Nothing to take out: unchanged, and so not scrubbed or pinned at all. */
    expect(scrubbedValue("HTTPS_PROXY", "http://proxy.example:3128")).toBeUndefined();
    expect(scrubbedValue("NO_PROXY", "localhost,127.0.0.1")).toBeUndefined();
    expect(scrubbedValue("SSH_AUTH_SOCK", "/tmp/ssh-x/agent.1")).toBe(SCRUBBED_SECRET);
    expect(scrubbedValue("GITHUB_TOKEN", "a:b")).toBe(SCRUBBED_SECRET);
  });

  it("keeps a lane's names real only while both of the stack's URLs are on this machine", () => {
    const names = ["SUPABASE_SERVICE_ROLE_KEY"];
    const local = { DATABASE_URL: "postgres://p:p@127.0.0.1:54362/postgres", SUPABASE_URL: "http://127.0.0.1:54361" };
    expect(keptOnlyIfLocal(local, names)).toEqual(names);
    expect(keptOnlyIfLocal({ ...local, SUPABASE_URL: "https://ref.supabase.co" }, names)).toEqual([]);
    expect(keptOnlyIfLocal({ ...local, DATABASE_URL: "postgres://p:p@db.ref.supabase.co/postgres" }, names)).toEqual([]);
    expect(keptOnlyIfLocal({ DATABASE_URL: local.DATABASE_URL }, names)).toEqual([]);
  });
});
