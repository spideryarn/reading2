/**
 * src/email.ts: what reaches Resend, when nothing may, and that no outcome
 * throws. Every call here injects `fetch` and `env`, so nothing touches the
 * network or reads the real key.
 */
import { describe, expect, it, vi } from "vitest";

import { afterResponse, withAfterResponseTasks } from "../src/after-response.js";
import { DEFAULT_ADMIN_EMAIL, FROM, adminAddress, notifyAdmin, sendEmail } from "../src/email.js";

const PROD = { VERCEL_ENV: "production", RESEND_API_KEY: "re_test_key" };
const EMAIL = { to: "someone@example.com", subject: "Hello", text: "Body text" };

function okFetch(id = "email_123") {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ id }), { status: 200 }));
}

describe("sendEmail", () => {
  it("posts one plain-text email to Resend, with the key and our sender", async () => {
    const fetch = okFetch();
    const result = await sendEmail(EMAIL, "test", { fetch, env: PROD });

    expect(result).toEqual({ kind: "sent", id: "email_123" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: FROM,
      to: ["someone@example.com"],
      subject: "Hello",
      text: "Body text",
    });
  });

  it("sends nothing outside production, even with a key", async () => {
    for (const VERCEL_ENV of [undefined, "preview", "development"]) {
      const fetch = okFetch();
      const result = await sendEmail(EMAIL, "test", {
        fetch,
        env: { VERCEL_ENV, RESEND_API_KEY: "re_test_key" },
      });
      expect(result).toEqual({ kind: "skipped", reason: "not production" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("SPIDERYARN_EMAIL_SEND=1 opts a non-production process in", async () => {
    const fetch = okFetch();
    const result = await sendEmail(EMAIL, "test", {
      fetch,
      env: { SPIDERYARN_EMAIL_SEND: "1", RESEND_API_KEY: "re_test_key" },
    });
    expect(result.kind).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("but never under a test runner", async () => {
    const fetch = okFetch();
    const result = await sendEmail(EMAIL, "test", {
      fetch,
      env: { SPIDERYARN_EMAIL_SEND: "1", NODE_ENV: "test", RESEND_API_KEY: "re_test_key" },
    });
    expect(result).toEqual({ kind: "skipped", reason: "not production" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips, rather than failing, when production has no key", async () => {
    const fetch = okFetch();
    const result = await sendEmail(EMAIL, "test", { fetch, env: { VERCEL_ENV: "production" } });
    expect(result).toEqual({ kind: "skipped", reason: "no RESEND_API_KEY" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns failed, and does not throw, on a non-2xx", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{"name":"validation_error"}', { status: 422 }),
    );
    await expect(sendEmail(EMAIL, "test", { fetch, env: PROD })).resolves.toEqual({
      kind: "failed",
      reason: "Resend answered 422",
    });
  });

  it("returns failed, and does not throw, when fetch itself throws", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("network down");
    });
    await expect(sendEmail(EMAIL, "test", { fetch, env: PROD })).resolves.toEqual({
      kind: "failed",
      reason: "TypeError",
    });
  });
});

describe("notifyAdmin", () => {
  it("goes to hello@ by default", async () => {
    expect(DEFAULT_ADMIN_EMAIL).toBe("hello@spideryarn.com");
    const fetch = okFetch();
    await notifyAdmin({ subject: "S", text: "T" }, "test", { fetch, env: PROD });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.to).toEqual(["hello@spideryarn.com"]);
  });

  it("goes to SPIDERYARN_ADMIN_EMAIL when it is set", async () => {
    expect(adminAddress({ SPIDERYARN_ADMIN_EMAIL: " greg@example.com " })).toBe("greg@example.com");
    expect(adminAddress({ SPIDERYARN_ADMIN_EMAIL: "" })).toBe(DEFAULT_ADMIN_EMAIL);
  });
});

describe("work after a response", () => {
  it("starts only after the response callback and keeps the invocation alive", async () => {
    let responseWritten = false;
    let releaseTask = () => {};
    const taskMayFinish = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    let markStarted = () => {};
    const taskStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    let invocationFinished = false;
    const invocation = withAfterResponseTasks(async () => {
      await afterResponse("test email", async () => {
        markStarted();
        await taskMayFinish;
      });
      responseWritten = true;
      return "answered";
    });
    void invocation.then(() => {
      invocationFinished = true;
    });

    await taskStarted;
    const startedAfterResponse = responseWritten;
    const stayedAliveForTask = !invocationFinished;
    releaseTask();

    await expect(invocation).resolves.toBe("answered");
    expect(startedAfterResponse).toBe(true);
    expect(stayedAliveForTask).toBe(true);
  });

  it("does not let a deferred failure change the answered request", async () => {
    await expect(
      withAfterResponseTasks(async () => {
        await afterResponse("broken test email", async () => {
          throw new Error("provider down");
        });
        return "answered";
      }),
    ).resolves.toBe("answered");
  });
});
