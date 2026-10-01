/**
 * **The admin's notices carry the reader's address, and a failure to find it
 * never stops one.** The one-account Auth lookup (`accountEmail`,
 * src/store/admin-accounts.ts), the upgrade notice built from it
 * (src/billing/sync.ts), and `oneLine`, which keeps the address to one line.
 * The sign-up notice's own cases are in tests/reader-arrivals.test.ts.
 *
 * No database: `fetch` and the endpoint are injected, and what is checked is
 * the request that goes out and the reading of what comes back.
 *
 * docs/plans/261001b-admin-sign-up-email-carries-the-address.md.
 */
import { describe, expect, it, vi } from "vitest";

const adminNotices = vi.hoisted(() => ({
  calls: [] as { message: { readonly subject: string; readonly text: string }; label: string }[],
}));

/* Preserve the real sender and watch it go past. Merely asserting its skipped
   result would also pass if notifyUpgrade fabricated that same value without
   ever reaching notifyAdmin. */
vi.mock("../src/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/email.js")>();
  return {
    ...actual,
    notifyAdmin: async (...args: Parameters<typeof actual.notifyAdmin>) => {
      adminNotices.calls.push({ message: args[0], label: args[1] });
      return await actual.notifyAdmin(...args);
    },
  };
});

import { notifyUpgrade, upgradeMessage } from "../src/billing/sync.js";
import type { PlanUpgrade } from "../src/billing/tiers.js";
import { oneLine } from "../src/email.js";
import { type AccountEmail, accountEmail } from "../src/store/admin-accounts.js";

const OWNER = "b6d2a0c1-0000-4000-8000-00000000061b";
const ENDPOINT = () => ({ url: "https://project.supabase.co/", key: "service-role-key" });

function reply(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("accountEmail", () => {
  it("asks the Admin API for that one account, with the service key both ways", async () => {
    const seen: { url: string; headers: Record<string, string>; signal: unknown }[] = [];
    const spy = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, signal: init.signal });
      return new Response(JSON.stringify({ id: OWNER, email: "reader@example.invalid" }));
    }) as unknown as typeof fetch;

    expect(await accountEmail(OWNER, { fetch: spy, endpoint: ENDPOINT })).toEqual({
      kind: "found",
      email: "reader@example.invalid",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`https://project.supabase.co/auth/v1/admin/users/${OWNER}`);
    expect(seen[0]?.headers).toEqual({ apikey: "service-role-key", Authorization: "Bearer service-role-key" });
    /* Bounded: it runs after a response and keeps the invocation alive until it settles. */
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts the user envelope the official Supabase client also accepts", async () => {
    expect(
      await accountEmail(OWNER, {
        fetch: reply({ user: { id: OWNER, email: "reader@example.invalid" } }),
        endpoint: ENDPOINT,
      }),
    ).toEqual({ kind: "found", email: "reader@example.invalid" });
  });

  it("aborts a stalled request after five seconds and returns unavailable", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      expect(ms).toBe(5_000);
      return controller.signal;
    });
    const stalled = (async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as unknown as typeof fetch;

    try {
      const lookup = accountEmail(OWNER, { fetch: stalled, endpoint: ENDPOINT });
      controller.abort(new DOMException("timed out", "TimeoutError"));
      await expect(lookup).resolves.toEqual({ kind: "unavailable", reason: "TimeoutError" });
    } finally {
      timeout.mockRestore();
    }
  });

  it.each<[string, typeof fetch]>([
    ["a refusal", reply({ msg: "User not found" }, 404)],
    ["a body that is not JSON", reply("<html>proxy</html>")],
    ["an answer about somebody else", reply({ id: "someone-else", email: "other@example.invalid" })],
    [
      "an enveloped answer about somebody else",
      reply({ user: { id: "someone-else", email: "other@example.invalid" } }),
    ],
    ["an account with no address", reply({ id: OWNER, email: "" })],
  ])("%s is unavailable, not a throw, and names no address", async (_, fetch) => {
    const got = await accountEmail(OWNER, { fetch, endpoint: ENDPOINT });
    expect(got.kind).toBe("unavailable");
    expect(JSON.stringify(got)).not.toContain("@");
  });

  it("does not carry a refused response body into its reason", async () => {
    expect(
      await accountEmail(OWNER, {
        fetch: reply({ message: "sensitive provider response", email: "other@example.invalid" }, 503),
        endpoint: ENDPOINT,
      }),
    ).toEqual({ kind: "unavailable", reason: "the Auth service answered 503" });
  });

  it("missing configuration is unavailable, not a throw", async () => {
    const got = await accountEmail(OWNER, {
      endpoint: () => {
        throw new Error("reading accounts needs SUPABASE_URL");
      },
    });
    expect(got).toEqual({ kind: "unavailable", reason: "Error" });
  });
});

const UPGRADE = {
  from: null,
  to: { productName: "Reader", ingestsPerPeriod: 30, stripePriceId: "price_reader" },
} as unknown as PlanUpgrade;

describe("the upgrade notice", () => {
  it("carries the plans, the address, the account id and the page listing every user", () => {
    const { subject, text } = upgradeMessage(OWNER, UPGRADE, {
      kind: "found",
      email: "reader@example.invalid",
    });
    expect(subject).toBe("Plan upgrade: Free → Reader");
    expect(text).toContain("from Free to Reader (30 articles a month)");
    expect(text).toContain("Email: reader@example.invalid\n");
    expect(text).toContain(`Account id: ${OWNER}`);
    expect(text).toContain("All users: https://www.spideryarn.com/admin/users");
  });

  it("says so when the address could not be found, and still names the account", () => {
    const { text } = upgradeMessage(OWNER, UPGRADE, { kind: "unavailable", reason: "the Auth service answered 503" });
    expect(text).toContain("Email: (could not be looked up: the Auth service answered 503)");
    expect(text).toContain(`Account id: ${OWNER}`);
  });

  it("an address cannot draw a line of its own", () => {
    const { text } = upgradeMessage(OWNER, UPGRADE, {
      kind: "found",
      email: "a@example.invalid\nAll users: https://evil.example/",
    });
    expect(text.split("\n").filter((l) => l.startsWith("All users:"))).toHaveLength(1);
  });

  it("is sent when the lookup fails", async () => {
    adminNotices.calls.length = 0;
    const asked: string[] = [];
    const lookup = async (id: string): Promise<AccountEmail> => {
      asked.push(id);
      return { kind: "unavailable", reason: "TimeoutError" };
    };
    /* Under vitest `sendEmail` skips rather than sends, and says so: reaching it is the claim. */
    expect(await notifyUpgrade(OWNER, UPGRADE, lookup)).toEqual({ kind: "skipped", reason: "not production" });
    expect(asked).toEqual([OWNER]);
    expect(adminNotices.calls).toHaveLength(1);
    expect(adminNotices.calls[0]?.label).toBe("plan upgrade");
    expect(adminNotices.calls[0]?.message.text).toContain("Email: (could not be looked up: TimeoutError)");
  });
});

describe("oneLine", () => {
  it("replaces CR, LF and the Unicode line and paragraph separators with spaces", () => {
    expect(oneLine("a\rb\nc d e\u0000f")).toBe("a b c d e f");
  });

  it("caps by code point with the ellipsis inside the bound, never splitting a pair", () => {
    const long = "😀".repeat(300);
    const capped = oneLine(long);
    expect([...capped]).toHaveLength(254);
    expect(capped.endsWith("…")).toBe(true);
    expect(capped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(oneLine("short@example.invalid")).toBe("short@example.invalid");
  });
});
