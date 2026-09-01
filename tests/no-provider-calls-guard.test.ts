/**
 * **The guard that stops a test spending money, watched failing.**
 *
 * [`tests/setup/provider-guard.ts`](setup/provider-guard.ts) is a guard
 * whose success is the *absence* of something, which is the shape
 * [silent-success.md](../docs/reusable/silent-success.md) says never to trust on
 * its own: a guard that has quietly stopped being loaded looks exactly like a
 * repo where nothing calls out. So every claim it makes is asserted here as an
 * observed event —
 *
 * - it is installed at all (drop `setupFiles` from `vitest.config.ts` and this
 *   file goes red on its first assertion — which is only true because this test
 *   imports `provider-guard.ts`, which installs nothing, rather than the
 *   `no-provider-calls.ts` switch, which does. The first draft got that the
 *   wrong way round and passed with the config gutted);
 * - `vitest.config.ts` still names it (rename the file without editing the
 *   config and this goes red too, on the machine that did the rename rather
 *   than on somebody else's, later);
 * - a real provider request is refused, and the refusal is **recorded** — the
 *   record is the measurement, since an error that did not happen and an error
 *   that was caught are the same observation from outside;
 * - a refusal the test swallows still fails the test, via the backstop;
 * - a request to anything that is not a provider is left alone, because a guard
 *   that took the whole network out would be turned off within the week;
 * - it knows it is gone when a test assigns over `globalThis.fetch`, and it is
 *   back for the next test in the file. The boolean version answered *yes* for
 *   a wrapper that had been replaced, which is the guard telling you it is there
 *   while it is not (GPT Sol, 2026-09-01);
 * - and the pattern that must keep working — a `beforeEach` that stubs `fetch`
 *   and never unstubs — still reaches the stub in every test, not the restored
 *   guard.
 *
 * Nothing here spends money: the whole point is that the request is refused
 * before `fetch` is reached, and the assertions are on the record of that.
 *
 * ## What this file cannot tell you
 *
 * **Whether `PROVIDER_HOSTS` is complete.** The obvious test — iterate the
 * register and assert each host is refused — reads the same list the guard
 * reads, so a provider nobody added is invisible to it, and it is named for what
 * it actually proves (the matcher) rather than for what a reader would like it
 * to prove. Two tests below say something about the register itself: a literal
 * four-host expectation, which catches shrinkage, and a scan of `src/`, `evals/`
 * and `scripts/` for absolute URLs whose path is one a provider charges for,
 * which catches a new provider host written down as a literal. Neither can see a
 * host that arrives as a dependency's default base URL — `api.anthropic.com` and
 * `api.voyageai.com` are in the register and in no source file — so **no honest
 * test here proves the register is complete.** It is a tripwire; the limits are
 * listed in `tests/setup/provider-guard.ts` § *Not covered*.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertNoRefusedProviderCalls,
  providerGuardInstalled,
  providerHostOf,
  takeRefusedProviderCalls,
} from "./setup/provider-guard.js";
import { PAID_ENDPOINT_PATHS, PROVIDER_HOSTS } from "../src/spend-declarations.js";

const ROOT = path.resolve(import.meta.dirname, "..");
/** The file `setupFiles` names. Its absence from the config is the failure. */
const SETUP = "tests/setup/no-provider-calls.ts";
/** Where the machinery lives, and what the refusal message points at. */
const GUARD = "tests/setup/provider-guard.ts";

/** A URL that would cost real money if it were ever sent. */
const PAID = "https://openrouter.ai/api/v1/chat/completions";

describe("the no-provider-calls guard", () => {
  it("is installed in every test file", () => {
    expect(
      providerGuardInstalled(),
      `The guard is not installed. Check that vitest.config.ts still lists "./${SETUP}" in setupFiles.`,
    ).toBe(true);
  });

  it("is still named by vitest.config.ts", () => {
    /* The run-time check above cannot tell "the config lost it" from "the file
       was renamed and the config followed", and only one of those is fine. This
       one reads the config as text, so a rename that forgets the config fails
       here rather than in six weeks. */
    const config = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    expect(config).toContain("setupFiles");
    expect(config).toContain(SETUP);
  });

  it("refuses a request to a provider, and records it", () => {
    expect(() => fetch(PAID, { method: "POST" })).toThrow(/Refused/);

    const refused = takeRefusedProviderCalls();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      host: "openrouter.ai",
      method: "POST",
      url: PAID,
    });
  });

  it("tells the developer what to do about it", () => {
    let message = "";
    try {
      void fetch(PAID);
    } catch (error) {
      message = (error as Error).message;
    }
    takeRefusedProviderCalls();

    /* Not a spelling test. Each of these is a thing somebody hitting this at
       2am has to be told, and the message has been rewritten once already. */
    expect(message).toContain(PAID);
    expect(message).toContain("paid provider");
    expect(message).toContain("no money was spent");
    expect(message).toContain("vi.stubGlobal");
    expect(message).toContain("allowRealProviderCalls");
    expect(message).toContain(GUARD);
  });

  it("fails a test that swallows the refusal", () => {
    /* The case that matters most, and the one blocking alone does not cover: a
       module under test catches a network error and reports "the model did not
       answer", the test asserts exactly that, and everything is green while a
       machine with the key would have spent money. */
    try {
      void fetch(PAID, { method: "POST" });
    } catch {
      /* Swallowed on purpose, the way production code swallows a network blip. */
    }

    expect(() => assertNoRefusedProviderCalls()).toThrow(/tried to call a paid provider/);
    /* And the throw clears the record, so one swallowed call is reported once. */
    expect(() => assertNoRefusedProviderCalls()).not.toThrow();
  });

  /* **This proves the matcher, not the register.** It iterates the same list
     the guard reads, so a provider host nobody has added to `PROVIDER_HOSTS` is
     invisible to it — change production to call `https://api.somebodyelse.com/…`
     and this stays green. What it does prove is that every form a request can
     arrive in (string, `URL`, `Request`) and a subdomain of a listed host are
     all matched, which is where the matcher could plausibly be wrong. The two
     tests after it are the ones that say anything about the register itself. */
  it("matches every form of a registered host, and a subdomain of one", () => {
    for (const host of PROVIDER_HOSTS) {
      expect(providerHostOf(`https://${host}/v1/anything`)).toBe(host);
      expect(providerHostOf(new URL(`https://sub.${host}/v1/anything`))).toBe(host);
      expect(providerHostOf(new Request(`https://${host}/v1/anything`))).toBe(host);
    }
  });

  it("still refuses the four hosts this repo can actually be billed by", () => {
    /* Written out as literals on purpose. The loop above reads the register, so
       *deleting* a host from it makes that loop smaller and no less green. This
       one goes red instead. It is an oracle for shrinkage only — it cannot know
       about a provider that arrives tomorrow. */
    for (const host of ["openrouter.ai", "api.anthropic.com", "api.openai.com", "api.voyageai.com"]) {
      expect(providerHostOf(`https://${host}/v1/chat/completions`), host).toBe(host);
    }
  });

  it("has a register that covers every paid URL written down in the source", () => {
    /* **The one genuinely independent check here**, and the reason it is worth
       having: it does not read `PROVIDER_HOSTS` to decide what to look for. It
       looks for an absolute URL whose *path* is one a provider charges for —
       `PAID_ENDPOINT_PATHS`, the other half of the register — and then asks
       whether its host is refused. So the mutation GPT Sol named on 2026-09-01,
       "point production at a provider host absent from the register", fails
       here rather than passing quietly.

       What it cannot see, and this is most of the surface:
       - a base URL a dependency supplies. `api.anthropic.com` and
         `api.voyageai.com` are in the register and appear in no source file:
         the SDKs default to them. A scan of our own text was never going to
         find those, which is why they are in the literal list above instead.
       - a URL built by concatenation, or read out of an environment variable —
         `src/messages-stream.ts` does exactly this.
       - a paid path nobody has written down yet (`/v1/responses`,
         `/v1/messages`).
       It narrows the circle. It does not close it. */
    const ls = (args: string[]) =>
      execFileSync("git", ["ls-files", "-z", ...args, "--", "src", "evals", "scripts"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      })
        .split("\0")
        .filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f));
    const files = [...ls(["--cached"]), ...ls(["--others", "--exclude-standard"])];
    expect(files.length, "git listed no source files, so this test proved nothing").toBeGreaterThan(
      50,
    );

    const unguarded: string[] = [];
    for (const file of files) {
      for (const raw of readFileSync(path.join(ROOT, file), "utf8").match(
        /https?:\/\/[^\s"'`<>)\\]+/g,
      ) ?? []) {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          continue;
        }
        if (!PAID_ENDPOINT_PATHS.some((p) => url.pathname.startsWith(p))) continue;
        if (providerHostOf(raw)) continue;
        unguarded.push(`${file}: ${raw}`);
      }
    }

    expect(
      unguarded,
      `These URLs charge money and their host is not in PROVIDER_HOSTS, so tests may call them for free:\n${unguarded.join("\n")}`,
    ).toEqual([]);
  });

  it("leaves everything that is not a provider alone", () => {
    for (const url of [
      "http://127.0.0.1:54321/rest/v1/articles",
      "http://localhost:5173/api/articles",
      "https://example.com/some-article",
      /* The near-misses a substring match would get wrong in both directions. */
      "https://openrouter.ai.evil.example/v1/chat/completions",
      "https://notopenrouter.ai/v1",
      "/api/articles",
    ]) {
      expect(providerHostOf(url), url).toBeNull();
    }
  });

  /* ------------------------------------------------------------------ *
   * The wrapper's identity, and what happens when a test replaces it.
   * ------------------------------------------------------------------ */

  /* These two run in order and the second depends on the first. That is
     deliberate and it is the only way to observe the property: the hole was
     never inside one test, it was the *next* test in the file inheriting a
     `globalThis.fetch` that somebody had swapped out and not put back. */
  it("knows it is gone when a test replaces globalThis.fetch outright", async () => {
    expect(providerGuardInstalled()).toBe(true);

    const replacement = (async () => new Response("{}")) as typeof fetch;
    globalThis.fetch = replacement;

    /* The boolean version of this answered `true` here, which is the finding.
       Identity cannot: the thing in the global is not the thing we installed. */
    expect(providerGuardInstalled()).toBe(false);

    /* And this is the limit, asserted rather than left to be assumed: for the
       rest of *this* test the guard is not in the way, so a replacement that
       delegated to the real network would reach it. Nothing here delegates. */
    await expect(fetch(PAID)).resolves.toBeInstanceOf(Response);
    expect(takeRefusedProviderCalls()).toEqual([]);
  });

  it("is back in place for the next test in the file, which is the whole point", () => {
    expect(
      providerGuardInstalled(),
      "the test above replaced globalThis.fetch and never put it back; the after-each should have",
    ).toBe(true);
    expect(() => fetch(PAID)).toThrow(/Refused/);
    takeRefusedProviderCalls();
  });

  it("steps aside for a test that stubs fetch itself", () => {
    /* Dozens of tests already do this and they must keep working. The stub is
       stronger than the guard, not weaker: nothing it returns came off a wire. */
    const stub = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", stub);
    try {
      void fetch(PAID, { method: "POST" });
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(takeRefusedProviderCalls()).toEqual([]);
    /* And the guard is back afterwards. */
    expect(() => fetch(PAID)).toThrow(/Refused/);
    takeRefusedProviderCalls();
  });
});

/**
 * **The pattern the restore must not break**, and dozens of files use it: a
 * `beforeEach` puts a stub in the global and nothing ever unstubs it. If the
 * after-each restore were to win over that, every one of those files would go
 * red in its second test.
 */
describe("a file whose beforeEach stubs fetch", () => {
  const stub = vi.fn(async () => new Response("{}", { status: 200 }));
  beforeEach(() => {
    stub.mockClear();
    vi.stubGlobal("fetch", stub);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaches the stub in the first test", async () => {
    await fetch(PAID, { method: "POST" });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(takeRefusedProviderCalls()).toEqual([]);
  });

  it("still reaches the stub in the second, rather than the restored guard", async () => {
    await fetch(PAID, { method: "POST" });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(takeRefusedProviderCalls()).toEqual([]);
  });
});
