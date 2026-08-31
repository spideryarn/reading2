/**
 * **The envelope, not the parameters.** src/feedback.ts.
 *
 * This is the test the plan was rewritten around, and the reason it looks
 * paranoid is that the first version of the design was wrong in a way a gentler
 * test agreed with. `captureFeedback` does **not** go through `beforeSend` —
 * that only runs when `event.type === undefined`, and a feedback event is
 * `type: "feedback"` — so `safeEvent` never sees this path. And building
 * `SendFeedbackParams` field by field is not enough either: `prepareEvent`
 * merges global + isolation + current scope data, so extras, contexts, tags,
 * breadcrumbs and an unreduced `user` all ride along from wherever they were
 * set.
 *
 * So the scope this file hands the SDK is **hostile on purpose** — every marker
 * below was verified to reach the envelope before the two clean scopes went in
 * — and every assertion is made on the **final envelope**, after the SDK has
 * merged everything it is going to merge. A test that captured on a clean scope
 * would pass against the broken design, which is exactly how this got missed.
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md §
 * Building the parameters is not enough.
 */
import {
  addBreadcrumb,
  getCurrentScope,
  getIsolationScope,
  initWithoutDefaultIntegrations,
  setContext,
  setExtra,
  setTag,
  setUser,
} from "@sentry/node-core/light";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSafeEvent } from "../src/monitoring.js";
import type { FeedbackReport } from "../src/store/contracts.js";

/** Every markMirrored the mirror made. */
let mirrored: { id: string; sentryEventId: string | null }[] = [];

vi.mock("../src/store/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/store/index.js")>();
  return {
    ...actual,
    feedbackStore: {
      submit: async () => {
        throw new Error("not used here");
      },
      read: async () => null,
      markMirrored: async (id: string, sentryEventId: string | null) => {
        mirrored.push({ id, sentryEventId });
      },
    },
  };
});

const { mirrorFeedback } = await import("../src/feedback.js");

/* The envelope, as loosely as this file needs to read one: a header, then a
   list of `[itemHeader, payload]` pairs. */
type Envelope = [Record<string, unknown>, [Record<string, unknown>, unknown][]];

let envelopes: Envelope[] = [];

const REPORT: FeedbackReport = {
  id: "spya-k3m9qt",
  reporterEmail: "reader@example.com",
  steps: "Pressed the button on the third paragraph",
  expected: "a gist in the margin",
  actual: "an empty column",
  consented: true,
  routeKind: "read",
  slug: "an-article",
  buildCommit: "abc1234",
  environment: "test",
  requestVercelId: "lhr1::abc-123",
  diagnostics: { version: 1, payload: { device: { language: "en-GB" } } },
  screenshotBytes: 4,
  createdAt: "2026-08-31T12:00:00.000Z",
  mirroredAt: null,
  sentryEventId: null,
};

const USER = { id: "11111111-2222-3333-4444-555555555555", email: "reader@example.com" };

/** Start a client whose transport hands us the envelope instead of the network. */
function startSentry(): void {
  initWithoutDefaultIntegrations({
    dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
    environment: "test",
    release: "abc1234",
    integrations: [],
    maxBreadcrumbs: 0,
    beforeSend: buildSafeEvent,
    transport: () => ({
      send: async (envelope: unknown) => {
        envelopes.push(envelope as Envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
}

/**
 * Everything a scope can carry that must not reach the envelope.
 *
 * Seeded on the **isolation** scope and the **current** scope, because clearing
 * only one of them was tried and leaked: `prepareEvent` merges the isolation
 * scope regardless of which current scope you hand `captureFeedback`.
 */
function seedHostileScopes(): void {
  for (const scope of [getIsolationScope(), getCurrentScope()]) {
    scope.setExtra("articleProse", "Four score and seven years ago our fathers brought forth");
    scope.setContext("provider", { body: "the model echoed the whole article back" });
    scope.setTag("leakyTag", "a-passage-of-somebodys-book");
    scope.addBreadcrumb({ message: "GET /api/library/search?q=my private search", category: "console" });
    scope.setUser({
      id: USER.id,
      email: USER.email,
      username: "a-username-nobody-asked-for",
      ip_address: "203.0.113.7",
    });
  }
  /* The module-level helpers too — the shape a careless call site would use. */
  setExtra("articleProse2", "more of somebody's book");
  setContext("provider2", { body: "and more" });
  setTag("leakyTag2", "still leaking");
  addBreadcrumb({ message: "another console line about an article", category: "console" });
  setUser({ id: USER.id, email: USER.email, username: "second-username", ip_address: "203.0.113.8" });
}

/** The one feedback item out of the envelope. */
function feedbackEvent(envelope: Envelope): Record<string, unknown> {
  const item = envelope[1].find(([header]) => header.type === "feedback");
  if (!item) throw new Error("no feedback item in the envelope");
  return item[1] as Record<string, unknown>;
}

beforeEach(() => {
  envelopes = [];
  mirrored = [];
  getIsolationScope().clear();
  getCurrentScope().clear();
});

afterEach(() => {
  getIsolationScope().clear();
  getCurrentScope().clear();
});

describe("the Sentry mirror", () => {
  it("files a report from a hostile scope and lets none of it into the envelope", async () => {
    startSentry();
    seedHostileScopes();

    await mirrorFeedback({
      report: REPORT,
      user: USER,
      screenshot: { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png", filename: "screenshot.png" },
    });

    expect(envelopes).toHaveLength(1);
    const envelope = envelopes[0]!;
    const whole = JSON.stringify(envelope);

    /* The five markers from the plan's table, each of which reached the
       envelope before the two clean scopes went in. */
    expect(whole).not.toContain("articleProse");
    expect(whole).not.toContain("Four score");
    expect(whole).not.toContain("provider");
    expect(whole).not.toContain("echoed the whole article");
    expect(whole).not.toContain("leakyTag");
    expect(whole).not.toContain("my private search");
    expect(whole).not.toContain("a-username-nobody-asked-for");
    expect(whole).not.toContain("203.0.113");

    const event = feedbackEvent(envelope);
    expect(event.user).toEqual({ id: USER.id, email: USER.email });
    expect(event.breadcrumbs ?? []).toEqual([]);
    expect(event.extra ?? {}).toEqual({});
    expect(Object.keys((event.contexts ?? {}) as object)).not.toContain("provider");
  });

  it("carries the three answers, the gate's email and our own tags", async () => {
    startSentry();
    seedHostileScopes();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const event = feedbackEvent(envelopes[0]!);
    const feedback = (event.contexts as { feedback: Record<string, unknown> }).feedback;
    expect(feedback.contact_email).toBe("reader@example.com");
    expect(String(feedback.message)).toContain("Pressed the button on the third paragraph");
    expect(String(feedback.message)).toContain("a gist in the margin");
    expect(String(feedback.message)).toContain("an empty column");

    const tags = event.tags as Record<string, unknown>;
    expect(tags.report_id).toBe(REPORT.id);
    expect(tags.route_kind).toBe("read");
    expect(tags.slug).toBe("an-article");
    expect(tags.leakyTag).toBeUndefined();
  });

  it("sends the diagnostics blob and the screenshot as attachments", async () => {
    startSentry();
    await mirrorFeedback({
      report: REPORT,
      user: USER,
      screenshot: { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png", filename: "screenshot.png" },
    });

    const items = envelopes[0]![1].filter(([header]) => header.type === "attachment");
    const names = items.map(([header]) => header.filename);
    expect(names).toContain("diagnostics.json");
    expect(names).toContain("screenshot.png");
    const shot = items.find(([header]) => header.filename === "screenshot.png")!;
    expect(shot[0].content_type).toBe("image/png");
  });

  it("records what Sentry answered with", async () => {
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]?.id).toBe(REPORT.id);
    expect(typeof mirrored[0]?.sentryEventId).toBe("string");
  });

  it("does nothing at all when there is no client, rather than claiming it mirrored", async () => {
    /* No `startSentry`. On a laptop and in `npm test` there is no DSN, so this
       is the ordinary case rather than an edge one — and a `mirrored_at` written
       for a report that went nowhere would quietly break the only query that
       finds a stranded report.

       `setClient(undefined)` explicitly, because `Scope.clear()` deliberately
       does not drop the client and a test earlier in this file installed one. */
    getCurrentScope().setClient(undefined);
    await expect(mirrorFeedback({ report: REPORT, user: USER, screenshot: null })).resolves.toBeUndefined();
    expect(mirrored).toHaveLength(0);
  });
});
