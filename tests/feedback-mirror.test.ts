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
  captureException,
  flush,
  getClient,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  initWithoutDefaultIntegrations,
  setContext,
  setExtra,
  setTag,
  setUser,
} from "@sentry/node-core/light";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardFeedbackEnvelope } from "../src/feedback-envelope.js";
import { buildSafeEvent } from "../src/monitoring.js";
import type { FeedbackReport } from "../src/store/contracts.js";

/** Every markMirrored the mirror made — an acknowledgement Sentry actually gave. */
let mirrored: { id: string; sentryEventId: string | null }[] = [];
/** Every markMirrorAttempted — what we knew at the moment we handed it over. */
let attempted: string[] = [];

vi.mock("../src/store/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/store/index.js")>();
  return {
    ...actual,
    feedbackStore: {
      submit: async () => {
        throw new Error("not used here");
      },
      read: async () => null,
      markMirrorAttempted: async (id: string) => {
        attempted.push(id);
      },
      markMirrored: async (id: string, sentryEventId: string | null) => {
        mirrored.push({ id, sentryEventId });
        return true;
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
  mirrorAttemptedAt: null,
  mirroredAt: null,
  sentryEventId: null,
};

const USER = { id: "11111111-2222-3333-4444-555555555555", email: "reader@example.com" };

/**
 * Start a client whose transport hands us the envelope instead of the network.
 *
 * `send` answers **200**, because that is what a real ingest answers and
 * because `mirrorFeedback` now only writes `mirrored_at` for an acknowledgement
 * it can point at. `failing: true` gives the other shape — a transport whose
 * promise rejects, which is what an outage actually looks like from here and
 * which `Client.sendEnvelope` swallows into an empty `{}`.
 */
function startSentry(options: { failing?: boolean } = {}): void {
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
        if (options.failing) throw new Error("the ingest endpoint is unreachable");
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
}

/**
 * Everything a scope can carry that must not reach the envelope.
 *
 * Seeded on **all three** scopes, because replacing two of them was tried and
 * still leaked. `prepareEvent` starts from the *global* scope and merges the
 * isolation and current scopes into it, so a clean isolation scope and a clean
 * current scope leave the global one untouched — GPT Sol's code review,
 * 2026-08-31, which reproduced `getGlobalScope().setExtra(…)` reaching
 * `event.extra` in the final envelope.
 *
 * Two more post-construction mutation points are seeded with it, for the same
 * reason: a **global scope attachment** (scope attachments are appended *after*
 * `hint.attachments`, so they arrive as extra envelope items nothing this file
 * passed) and an **event processor**, which runs after every scope has been
 * merged and can put back anything it likes.
 */
function seedHostileScopes(): void {
  for (const scope of [getGlobalScope(), getIsolationScope(), getCurrentScope()]) {
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

  /* An attachment nobody here passed. Scope attachments are appended to the
     envelope after `hint.attachments`, so this is a whole extra envelope item
     carrying whatever bytes it likes. */
  getGlobalScope().addAttachment({
    filename: "ambient.txt",
    data: "PROVIDER_BODY_MARKER: the model echoed the article back",
  });
  /* And a second one wearing our own filename, because an allowlist of
     filenames alone would let this one through. */
  getGlobalScope().addAttachment({
    filename: "diagnostics.json",
    data: JSON.stringify({ articleProse: "AMBIENT_DIAGNOSTICS_MARKER" }),
  });

  /* The last mutation point: an event processor, which runs after every scope
     has been merged and can put back anything a scope guard removed. */
  getGlobalScope().addEventProcessor((event) => {
    event.extra = { ...event.extra, processorProse: "PROCESSOR_MARKER, a whole paragraph" };
    event.tags = { ...event.tags, processorTag: "PROCESSOR_TAG_MARKER" };
    event.server_name = "PROCESSOR_MARKER-host";
    return event;
  });
  getClient()?.addEventProcessor((event) => {
    event.contexts = {
      ...event.contexts,
      provider3: { body: "CLIENT_PROCESSOR_MARKER" },
    };
    return event;
  });
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
  attempted = [];
  getGlobalScope().clear();
  getIsolationScope().clear();
  getCurrentScope().clear();
});

afterEach(() => {
  getGlobalScope().clear();
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
    /* The three the two clean scopes do **not** reach: the global scope, a
       global scope attachment, and an event processor. */
    expect(whole).not.toContain("PROVIDER_BODY_MARKER");
    expect(whole).not.toContain("AMBIENT_DIAGNOSTICS_MARKER");
    expect(whole).not.toContain("PROCESSOR_MARKER");
    expect(whole).not.toContain("PROCESSOR_TAG_MARKER");
    expect(whole).not.toContain("CLIENT_PROCESSOR_MARKER");

    const event = feedbackEvent(envelope);
    expect(event.user).toEqual({ id: USER.id, email: USER.email });
    expect(event.breadcrumbs ?? []).toEqual([]);
    expect(event.extra ?? {}).toEqual({});
    expect(Object.keys((event.contexts ?? {}) as object).sort()).toEqual(["feedback", "runtime"]);
  });

  it("carries exactly the attachments we passed, and no ambient ones", async () => {
    startSentry();
    seedHostileScopes();

    await mirrorFeedback({
      report: REPORT,
      user: USER,
      screenshot: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: "image/png",
        filename: "screenshot.png",
      },
    });

    /* **The exact set**, not "contains ours". The global scope seeded two more
       — one with a filename of its own and one wearing ours — and both are
       appended to the envelope after `hint.attachments`, so a guard that only
       looked at what it passed in would not see them at all. */
    const items = envelopes[0]![1].filter(([header]) => header.type === "attachment");
    expect(items.map(([header]) => header.filename)).toEqual(["diagnostics.json", "screenshot.png"]);
    /* The guard writes the bytes it was given rather than the string, so this
       reads them the way `serializeEnvelope` will. */
    const blob = new TextDecoder().decode(items[0]![1] as Uint8Array);
    expect(blob).toContain("en-GB");
    expect(blob).not.toContain("AMBIENT_DIAGNOSTICS_MARKER");
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

  it("records the attempt first, then the acknowledgement", async () => {
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });
    /* Both, in that order: `mirror_attempted_at` is what we know the moment we
       hand the event over, and `mirrored_at` is what the transport answered. */
    expect(attempted).toEqual([REPORT.id]);
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]?.id).toBe(REPORT.id);
    expect(typeof mirrored[0]?.sentryEventId).toBe("string");
  });

  /**
   * **The failure this file existed to miss.**
   *
   * The old test made `captureFeedback` throw synchronously, which is not how
   * an outage behaves: the SDK returns an event id immediately and sends later,
   * `sendEvent` does not return the send promise, and `sendEnvelope` catches
   * every transport failure and resolves `{}`. So a rejecting transport is the
   * real shape, and against the old code it left `mirrored_at` populated with
   * nothing delivered — docs/reusable/silent-success.md, in the one column that
   * finds a stranded report.
   */
  it("records the attempt but not delivery when the transport fails", async () => {
    startSentry({ failing: true });
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });
    expect(attempted).toEqual([REPORT.id]);
    expect(mirrored).toHaveLength(0);
  });

  it("records the attempt but not delivery when Sentry answers with a 429", async () => {
    initWithoutDefaultIntegrations({
      dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
      environment: "test",
      integrations: [],
      maxBreadcrumbs: 0,
      transport: () => ({
        send: async (envelope: unknown) => {
          envelopes.push(envelope as Envelope);
          return { statusCode: 429 };
        },
        flush: async () => true,
      }),
    });
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });
    expect(attempted).toEqual([REPORT.id]);
    expect(mirrored).toHaveLength(0);
  });

  it("empties a feedback envelope nothing registered, rather than tidying it", () => {
    /* Fail closed. A `captureFeedback` from somewhere that did not go through
       `mirrorFeedback` is not ours, and there is no version of "clean it up a
       bit" that is safe at this seam. An envelope with no items is never sent,
       so it also never gets marked as mirrored. */
    const envelope: [Record<string, unknown>, [Record<string, unknown>, unknown][]] = [
      { event_id: "0".repeat(32) },
      [
        [{ type: "feedback" }, { tags: { report_id: "spya-zzzzzz" }, extra: { prose: "PROSE" } }],
        [{ type: "attachment", filename: "x.txt" }, new TextEncoder().encode("PROSE")],
      ],
    ];
    guardFeedbackEnvelope(envelope);
    expect(envelope[1]).toEqual([]);
  });

  it("leaves an ordinary error envelope alone", async () => {
    /**
     * **The guard is on the client, so it sees every envelope**, not only ours.
     * An error has already been rebuilt by `safeEvent` (src/monitoring-scrub.ts)
     * and must come out of here untouched — otherwise installing this would
     * quietly break the four seams error reporting actually uses.
     */
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });
    envelopes = [];

    captureException(new Error("something broke [gen-failed]"));
    await flush(1000);

    expect(envelopes).toHaveLength(1);
    const item = envelopes[0]![1].find(([header]) => header.type === "event");
    expect(item).toBeDefined();
    const event = item![1] as Record<string, unknown>;
    expect((event.exception as { values: { type: string }[] }).values[0]?.type).toBe("Error");
    /* The stack survives, which is the thing an error report is for and the
       thing a guard that ran on the wrong envelope would have removed. */
    expect(JSON.stringify(event.exception)).toContain("stacktrace");
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
    /* Not even an attempt. Nothing was handed to anybody, so a row saying we
       tried would be as untrue as one saying we succeeded. */
    expect(attempted).toHaveLength(0);
  });
});
