/**
 * What the SDK actually ends up configured with — not what we asked for.
 *
 * The distinction is the whole point of this file, and it is
 * [silent-success.md](../docs/reusable/silent-success.md) again. Sentry resolves
 * a partial or misshapen `dataCollection` object by filling the missing keys
 * with its **permissive** defaults, so an options object that reads as locked
 * down can produce a client that collects everything, and nothing anywhere says
 * so. Asserting the object we passed would pass in both worlds. These assert
 * `client.getDataCollectionOptions()`, which is the value that governs.
 *
 * The same argument applies to the integration list. `tracesSampleRate: 0` reads
 * as "tracing off" and means "sampling nothing", which the SDK treats as tracing
 * **on**: measured on 10.71.0, no sampling option gives 17 default integrations
 * and `tracesSampleRate: 0` gives 44, including Postgres, Anthropic and OpenAI
 * instrumentation. So there is a test that counts them by name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureFailure,
  flushMonitoring,
  initMonitoring,
  isDeployed,
  resetMonitoringForTests,
} from "../src/monitoring.js";

/**
 * A syntactically valid DSN pointing at nothing.
 *
 * `127.0.0.1` rather than a real host: `initMonitoring` builds a live transport,
 * and the one thing worse than a test that fails is a test that quietly posts
 * somewhere. Nothing here captures, so nothing is sent — this is the belt.
 */
const FAKE_DSN = "https://0123456789abcdef0123456789abcdef@127.0.0.1/1";

/**
 * **Every variable stubbed explicitly, including the ones we want unset.**
 *
 * `vite.config.ts` calls `loadEnvLocal()`, and vitest inherits it — so
 * `.env.local` reaches these tests. A test asserting "no DSN, no Sentry" that
 * simply *assumed* `SENTRY_DSN` was unset would pass on a laptop that has never
 * configured Sentry and fail the day somebody sets one, which is exactly the
 * day it needs to be trustworthy. See docs/project/testing.md.
 */
beforeEach(() => {
  resetMonitoringForTests();
  vi.stubEnv("SENTRY_DSN", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("SENTRY_FORCE_LOCAL", "");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetMonitoringForTests();
});

describe("with no DSN", () => {
  it("does not start, and nothing throws", async () => {
    /* The property every other test in this repo depends on without saying so:
       with no DSN configured, monitoring is inert, so no test needs a network
       stub and `npm test` cannot post anything anywhere. */
    expect(() => initMonitoring()).not.toThrow();
    expect(() => captureFailure(new Error("boom"))).not.toThrow();
    await expect(flushMonitoring(1)).resolves.toBeUndefined();
  });

  it("captures nothing", async () => {
    const { getClient } = await import("@sentry/node-core/light");
    initMonitoring();
    expect(getClient()).toBeUndefined();
  });
});

describe("with a DSN, deployed", () => {
  beforeEach(() => {
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    /* A DSN alone no longer starts it — see "not on a laptop" below. These
       tests are about the configuration, so they describe a real deployment. */
    vi.stubEnv("VERCEL", "1");
    initMonitoring();
  });

  it("resolves every data-collection category to off", async () => {
    const { getClient } = await import("@sentry/node-core/light");
    const resolved = getClient()?.getDataCollectionOptions();
    expect(resolved).toBeDefined();
    expect(resolved?.stackFrameVariables).toBe(false);
    expect(resolved?.databaseQueryData).toBe(false);
    expect(resolved?.userInfo).toBe(false);
    expect(resolved?.cookies).toBe(false);
    expect(resolved?.urlQueryParams).toBe(false);
    expect(resolved?.httpBodies).toEqual([]);
    expect(resolved?.httpHeaders).toEqual({ request: false, response: false });
    expect(resolved?.genAI).toEqual({ inputs: false, outputs: false });
    expect(resolved?.graphQL).toEqual({ document: false, variables: false });
    expect(resolved?.frameContextLines).toBe(0);
  });

  it("enables exactly three integrations, and none of them collect anything", async () => {
    /* A list rather than a count, and an exact list rather than a subset. The
       failure this catches is an SDK upgrade, or a stray option, quietly adding
       one back — `Console` (which would turn a dependency printing an article
       into a breadcrumb), `ContextLines` (which reads source files off disk),
       `LocalVariables`, `RequestData`, `LinkedErrors`, or anything with `Otel`
       or `Instrumentation` in its name. */
    const { getClient } = await import("@sentry/node-core/light");
    const names = (getClient()?.getOptions().integrations ?? []).map((i) => i.name).sort();
    expect(names).toEqual(["Dedupe", "OnUncaughtException", "OnUnhandledRejection"]);
  });

  it("does not enable tracing", async () => {
    /* `tracesSampleRate: 0` would read as "off" and mean "on, sampling
       nothing" — `hasSpansEnabled` in @sentry/core tests it with `!= null`, and
       `0` is not nullish. The option must be absent, not zero. */
    const { getClient } = await import("@sentry/node-core/light");
    const options = getClient()?.getOptions();
    expect(options?.tracesSampleRate).toBeUndefined();
    expect(options?.tracesSampler).toBeUndefined();
  });

  it("keeps no breadcrumbs", async () => {
    const { getClient } = await import("@sentry/node-core/light");
    expect(getClient()?.getOptions().maxBreadcrumbs).toBe(0);
  });
});

describe("not on a laptop", () => {
  /**
   * The gap this closes: for a while the only condition was "is there a DSN?",
   * and that was true locally purely because nobody had put one in
   * `.env.local`. Copy `.env.prod` across — or add one to debug the
   * integration — and a laptop starts reporting into the production project.
   * docs/plans/worktrees.md makes it worse, copying `.env.local` into every
   * worktree.
   */
  /**
   * **Identity, not presence.** `getClient()` is global to the process and an
   * earlier describe in this file has already built one, so
   * `expect(getClient()).toBeUndefined()` passes or fails on test *order*
   * rather than on behaviour. Asking whether `initMonitoring` replaced the
   * client answers the actual question: did it start?
   */
  it("does not start with a DSN but no deployment", async () => {
    const { getClient } = await import("@sentry/node-core/light");
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    const before = getClient();
    initMonitoring();
    expect(getClient()).toBe(before);
  });

  it("stays inert for capture and flush too, not just init", async () => {
    /* Inert has to mean the whole surface. An init that returns early while
       captureFailure still tried to send would be the same bug, one layer in. */
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    initMonitoring();
    expect(() => captureFailure(new Error("boom"))).not.toThrow();
    await expect(flushMonitoring(1)).resolves.toBeUndefined();
  });

  it("starts on Vercel, which is the whole difference", async () => {
    /* The control. Without this the test above would pass if `initMonitoring`
       were broken outright, and would be proving nothing. */
    const { getClient } = await import("@sentry/node-core/light");
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    vi.stubEnv("VERCEL", "1");
    const before = getClient();
    initMonitoring();
    expect(getClient()).not.toBe(before);
  });

  it("reports on preview deployments, not only production", async () => {
    /* A preview is a real deployment a reader could reach. Gating on
       VERCEL_ENV === "production" would have silenced it. */
    const { getClient } = await import("@sentry/node-core/light");
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const before = getClient();
    initMonitoring();
    expect(getClient()).not.toBe(before);
  });

  it("has an escape hatch for working on this file", async () => {
    const { getClient } = await import("@sentry/node-core/light");
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    vi.stubEnv("SENTRY_FORCE_LOCAL", "1");
    const before = getClient();
    initMonitoring();
    expect(getClient()).not.toBe(before);
  });
});

describe("isDeployed", () => {
  it("says no on a bare laptop", () => {
    expect(isDeployed()).toBe(false);
  });

  it("is not fooled by NODE_ENV, which any local command can set", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDeployed()).toBe(false);
  });

  it("says yes on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(isDeployed()).toBe(true);
  });
});
