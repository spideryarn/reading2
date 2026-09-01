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
 *   that took the whole network out would be turned off within the week.
 *
 * Nothing here spends money: the whole point is that the request is refused
 * before `fetch` is reached, and the assertions are on the record of that.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertNoRefusedProviderCalls,
  providerGuardInstalled,
  providerHostOf,
  takeRefusedProviderCalls,
} from "./setup/provider-guard.js";
import { PROVIDER_HOSTS } from "../src/spend-declarations.js";

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

  it("catches every host in the register, and a subdomain of one", () => {
    for (const host of PROVIDER_HOSTS) {
      expect(providerHostOf(`https://${host}/v1/anything`)).toBe(host);
      expect(providerHostOf(new URL(`https://sub.${host}/v1/anything`))).toBe(host);
      expect(providerHostOf(new Request(`https://${host}/v1/anything`))).toBe(host);
    }
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
