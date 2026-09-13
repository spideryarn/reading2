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

import {
  expectFeedbackEnvelope,
  FEEDBACK_NONCE_TAG,
  guardFeedbackEnvelope,
} from "../src/feedback-envelope.js";
import { buildSafeEvent } from "../src/monitoring.js";
import type { FeedbackReport, RawSource } from "../src/store/contracts.js";
import { RawObjectTooLarge } from "../src/store/raw-document.js";
import type { ArticleMetadata } from "../src/types.js";

/** Every markMirrored the mirror made — an acknowledgement Sentry actually gave. */
let mirrored: { id: string; sentryEventId: string | null }[] = [];
/** Every markMirrorAttempted — what we knew at the moment we handed it over. */
let attempted: string[] = [];

/**
 * **The three article reads, faked, and counted.** "Unticked, nothing is read at
 * all" is a claim about a count, so the count is what the tests read — a fake
 * that returned nothing would agree with a mirror that read everything and
 * dropped it. Each fake is reset to *not yours* (a 404, the owner-filtered
 * reads' answer for a stranger's slug) before every test.
 */
let reads = { source: 0, article: 0, metadata: 0 };
/** The options each source read was handed — where the 10 MiB cap is visible. */
let sourceOptions: ({ maxBytes?: number } | undefined)[] = [];
let fakeSource: (slug: string, options?: { maxBytes?: number }) => Promise<RawSource | null>;
let fakeArticle: (slug: string) => Promise<unknown>;
let fakeMetadata: (slug: string) => Promise<ArticleMetadata>;

vi.mock("../src/store/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/store/index.js")>();
  return {
    ...actual,
    loadSource: async (slug: string, options?: { maxBytes?: number }) => {
      reads.source += 1;
      sourceOptions.push(options);
      return fakeSource(slug, options);
    },
    loadArticle: async (slug: string) => {
      reads.article += 1;
      return fakeArticle(slug);
    },
    articleMetadata: async (slug: string) => {
      reads.metadata += 1;
      return fakeMetadata(slug);
    },
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
  body: "Pressed the button on the third paragraph, expected a gist in the margin, got an empty column",
  kind: "problem",
  consented: true,
  url: "https://www.spideryarn.com/read/a-piece",
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

/** A 404 tagged the way the owner-filtered reads tag one (src/store/pg.ts `notFound`). */
function notYours(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/**
 * Held by the event processor the concurrency test adds. `Scope.clear()` keeps
 * event processors, so the processor stays on the global scope for the rest of
 * the file and this is what keeps it inert there.
 */
let processorDelayMs = 0;

beforeEach(() => {
  envelopes = [];
  mirrored = [];
  attempted = [];
  reads = { source: 0, article: 0, metadata: 0 };
  sourceOptions = [];
  fakeSource = async (slug) => {
    throw notYours(slug);
  };
  fakeArticle = async (slug) => {
    throw notYours(slug);
  };
  fakeMetadata = async (slug) => {
    throw notYours(slug);
  };
  processorDelayMs = 0;
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

  it("carries the reader's words as they wrote them, the gate's email and our own tags", async () => {
    startSentry();
    seedHostileScopes();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const event = feedbackEvent(envelopes[0]!);
    const feedback = (event.contexts as { feedback: Record<string, unknown> }).feedback;
    expect(feedback.contact_email).toBe("reader@example.com");
    /* **Exactly the body, with nothing added to it.** It used to be three
       answers under three headings we wrote; there is one box now, and the kind
       is a tag rather than a heading pushed into somebody's sentence. */
    expect(feedback.message).toBe(REPORT.body);

    const tags = event.tags as Record<string, unknown>;
    expect(tags.report_id).toBe(REPORT.id);
    /* The whole address, since 2026-09-02 — query string and all, which is
       Greg's call and is disclosed on /privacy. src/db/schema.ts § `url`. */
    expect(tags.url).toBe("https://www.spideryarn.com/read/a-piece");
    expect(tags.kind).toBe("problem");
    expect(tags.slug).toBe("an-article");
    expect(tags.leakyTag).toBeUndefined();
  });

  it("leaves the kind tag off entirely when the reader did not say", async () => {
    /* Absent rather than empty. Greg asked for the toggle to start unset, so
       "did not say" is a real answer — and a tag whose value is `""` is one
       Sentry will happily group by, while "reports with no kind" is a filter on
       the tag being missing. */
    startSentry();
    await mirrorFeedback({ report: { ...REPORT, kind: null }, user: USER, screenshot: null });

    const tags = feedbackEvent(envelopes[0]!).tags as Record<string, unknown>;
    /* The whole address, since 2026-09-02 — query string and all, which is
       Greg's call and is disclosed on /privacy. src/db/schema.ts § `url`. */
    expect(tags.url).toBe("https://www.spideryarn.com/read/a-piece");
    expect("kind" in tags).toBe(false);
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
    /* And not a read. A ticked report on a laptop is going nowhere, so nobody
       pays for ten megabytes of bucket to be thrown away. */
    expect(reads).toEqual({ source: 0, article: 0, metadata: 0 });
  });
});

/* ------------------------------------------------ the article, attached -- */

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nSOURCE_BYTES_MARKER\n");
const MIB = 1024 * 1024;

/**
 * An `ArticleMetadata` as the store answers one, **with the reader's own words
 * in it** — `profile` and `purpose` are the "about you" and "why this one"
 * boxes, and the mirror must build its pick rather than copy this object.
 */
function metadataFor(slug: string): ArticleMetadata {
  return {
    slug,
    dir: "db",
    stages: [
      {
        step: "fetch",
        label: "Fetching the page",
        outputs: ["article_revisions.raw_source_sha256", "raw_sources"],
        done: true,
        ranAt: "2026-09-12T08:00:02.000Z",
        startedAt: "2026-09-12T08:00:00.000Z",
        bytes: null,
      },
    ],
    comments: 3,
    profile: "PROFILE_SENTINEL a physicist who reads slowly",
    purpose: "PURPOSE_SENTINEL for the thesis chapter due Friday",
    archivedAt: null,
    sharing: { visibility: "private", publicAt: null, personalised: ["glossary"] },
  };
}

/** An article payload, marked so a test can tell whose it is. */
function articleFor(slug: string, marker: string): unknown {
  return {
    meta: { slug, title: `${marker} title` },
    blocks: [{ id: "spya-aaaaaa", kind: "p", text: `${marker} paragraph` }],
    tree: { id: "root", children: [] },
    navLabelStatus: "ready",
  };
}

/**
 * The source read as the real one behaves: it honours the cap it is handed by
 * refusing with `RawObjectTooLarge`, which is what src/store/raw-document.ts
 * throws when the bucket's object is over it.
 */
function sourceOf(bytes: Uint8Array, kind: RawSource["kind"]) {
  return async (slug: string, options?: { maxBytes?: number }): Promise<RawSource> => {
    if (options?.maxBytes !== undefined && bytes.byteLength > options.maxBytes) {
      throw new RawObjectTooLarge(slug, kind, bytes.byteLength, options.maxBytes);
    }
    return { bytes, kind, filename: "UPLOADED_FILENAME_MARKER.pdf" };
  };
}

/** The reporter's own article: a PDF, an article payload, and the metadata above. */
function ownArticle(marker = "ARTICLE_MARKER"): void {
  fakeSource = sourceOf(PDF_BYTES, "pdf");
  fakeArticle = async (slug) => articleFor(slug, marker);
  fakeMetadata = async (slug) => metadataFor(slug);
}

/** Every attachment item, in order. */
function attachmentItems(envelope: Envelope): [Record<string, unknown>, unknown][] {
  return envelope[1].filter(([header]) => header.type === "attachment");
}

/** One attachment's bytes, by filename. */
function attachmentBytes(envelope: Envelope, filename: string): Uint8Array {
  const item = attachmentItems(envelope).find(([header]) => header.filename === filename);
  if (!item) throw new Error(`no ${filename} in the envelope`);
  return item[1] as Uint8Array;
}

/**
 * The whole envelope as text, **attachments decoded** — `JSON.stringify` of a
 * `Uint8Array` is a list of numbers, which no sentinel search can see into.
 */
function everything(envelope: Envelope): string {
  return JSON.stringify(envelope, (_key, value: unknown) =>
    value instanceof Uint8Array ? new TextDecoder().decode(value) : value,
  );
}

function tagsOf(envelope: Envelope): Record<string, unknown> {
  return feedbackEvent(envelope).tags as Record<string, unknown>;
}

describe("the article, sent with extra diagnostics", () => {
  it("attaches the source and article.json when the box is ticked on the reader's own article", async () => {
    ownArticle();
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const envelope = envelopes[0]!;
    expect(attachmentItems(envelope).map(([header]) => header.filename)).toEqual([
      "diagnostics.json",
      "source.pdf",
      "article.json",
    ]);
    /* The exact bytes — a PDF that was re-encoded or truncated on the way is
       a PDF that reproduces a different bug. */
    expect(attachmentBytes(envelope, "source.pdf")).toEqual(PDF_BYTES);
    const source = attachmentItems(envelope).find(([header]) => header.filename === "source.pdf")!;
    expect(source[0].content_type).toBe("application/pdf");
    /* And the cap was handed to the read, which is where it is enforced. */
    expect(sourceOptions).toEqual([{ maxBytes: 10 * MIB }]);

    const json = JSON.parse(new TextDecoder().decode(attachmentBytes(envelope, "article.json")));
    expect(json.version).toBe(1);
    expect(json.article.meta.title).toBe("ARTICLE_MARKER title");
    /* **The pick, pinned.** A field added to `ArticleMetadata` does not ride
       along until somebody decides it should. */
    expect(Object.keys(json).sort()).toEqual(["article", "metadata", "source", "version"]);
    expect(Object.keys(json.metadata).sort()).toEqual(
      ["archivedAt", "comments", "sharing", "slug", "stages"].sort(),
    );
    expect(json.metadata.stages).toEqual([
      {
        step: "fetch",
        done: true,
        ranAt: "2026-09-12T08:00:02.000Z",
        startedAt: "2026-09-12T08:00:00.000Z",
        bytes: null,
      },
    ]);
    expect(json.source).toEqual({ kind: "pdf", bytes: PDF_BYTES.byteLength });
    expect(json.metadata.sharing).toEqual({
      visibility: "private",
      publicAt: null,
      personalised: ["glossary"],
    });

    const tags = tagsOf(envelope);
    expect(tags.source_file).toBe("attached");
    expect(tags.article_json).toBe("attached");
  });

  it("sends an HTML source as text/plain, so nothing that opens it renders it", async () => {
    const html = new TextEncoder().encode("<html><script>SOURCE_HTML_MARKER()</script></html>");
    ownArticle();
    fakeSource = sourceOf(html, "html");
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const envelope = envelopes[0]!;
    const item = attachmentItems(envelope).find(([header]) => header.filename === "source.html");
    expect(item?.[0].content_type).toBe("text/plain");
    expect(attachmentBytes(envelope, "source.html")).toEqual(html);
    expect(tagsOf(envelope).source_file).toBe("attached");
  });

  it("reads nothing at all when the box is not ticked, and says none", async () => {
    ownArticle();
    startSentry();
    /* `diagnostics: null` with it, as the CHECK on the row requires. */
    await mirrorFeedback({
      report: { ...REPORT, consented: false, diagnostics: null },
      user: USER,
      screenshot: null,
    });

    expect(reads).toEqual({ source: 0, article: 0, metadata: 0 });
    const envelope = envelopes[0]!;
    expect(attachmentItems(envelope)).toEqual([]);
    /* **On every report**, so "reports without the file" is a filter on a
       value rather than on a tag being missing. */
    expect(tagsOf(envelope).source_file).toBe("none");
    expect(tagsOf(envelope).article_json).toBe("none");
  });

  it("reads nothing when the report names no article", async () => {
    ownArticle();
    startSentry();
    await mirrorFeedback({ report: { ...REPORT, slug: null }, user: USER, screenshot: null });

    expect(reads).toEqual({ source: 0, article: 0, metadata: 0 });
    expect(tagsOf(envelopes[0]!).source_file).toBe("none");
    expect(tagsOf(envelopes[0]!).article_json).toBe("none");
  });

  it("sends nothing for an article that is not the reporter's", async () => {
    /* The default fakes: every read answers 404, as the owner-filtered reads
       do for a stranger's slug, a forged one, or one that does not exist. */
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const envelope = envelopes[0]!;
    expect(attachmentItems(envelope).map(([header]) => header.filename)).toEqual(["diagnostics.json"]);
    /* `none`, not `failed`: a tag that told *not yours* apart from *nothing
       held* would say whether somebody else's slug exists. */
    expect(tagsOf(envelope).source_file).toBe("none");
    expect(tagsOf(envelope).article_json).toBe("none");
  });

  it("leaves the source off, and says so, when it is over 10 MiB", async () => {
    ownArticle();
    fakeSource = sourceOf(new Uint8Array(10 * MIB + 1), "pdf");
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const envelope = envelopes[0]!;
    expect(attachmentItems(envelope).map(([header]) => header.filename)).toEqual([
      "diagnostics.json",
      "article.json",
    ]);
    expect(tagsOf(envelope).source_file).toBe("too_large");
    expect(tagsOf(envelope).article_json).toBe("attached");
    /* The size still reaches the report, which is what a too-large file is
       worth to whoever reads it. */
    const json = JSON.parse(new TextDecoder().decode(attachmentBytes(envelope, "article.json")));
    expect(json.source).toEqual({ kind: "pdf", bytes: 10 * MIB + 1 });
  });

  it("refuses an oversized source even from a read that ignored the cap", async () => {
    /* Belt and braces: the cap is the gatherer's promise, not only the
       store's, so a read that handed back too much is still left off. */
    ownArticle();
    const big = new Uint8Array(10 * MIB + 1);
    fakeSource = async () => ({ bytes: big, kind: "pdf", filename: null });
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    expect(tagsOf(envelopes[0]!).source_file).toBe("too_large");
    expect(
      attachmentItems(envelopes[0]!).some(([header]) => header.filename === "source.pdf"),
    ).toBe(false);
  });

  it("measures article.json in UTF-8 bytes, not string length", async () => {
    /* Three bytes each in UTF-8 and one UTF-16 unit each in `.length`, so this
       is under 5 MiB by `.length` and over it by what actually goes out. */
    const text = "中".repeat(2 * MIB);
    ownArticle();
    fakeArticle = async (slug) => ({ ...(articleFor(slug, "ARTICLE_MARKER") as object), wide: text });
    expect(JSON.stringify(text).length).toBeLessThan(5 * MIB);
    expect(new TextEncoder().encode(JSON.stringify(text)).byteLength).toBeGreaterThan(5 * MIB);
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const envelope = envelopes[0]!;
    expect(tagsOf(envelope).article_json).toBe("too_large");
    expect(tagsOf(envelope).source_file).toBe("attached");
    expect(attachmentItems(envelope).map(([header]) => header.filename)).toEqual([
      "diagnostics.json",
      "source.pdf",
    ]);
  });

  it("says failed when a read throws, and still files the report", async () => {
    ownArticle();
    fakeSource = async () => {
      throw new Error("Storage said 503");
    };
    /* `throw null` is legal, and a bare `.status` on it would throw from
       inside the code deciding what a throw means. */
    fakeMetadata = async () => {
      throw null;
    };
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const envelope = envelopes[0]!;
    expect(tagsOf(envelope).source_file).toBe("failed");
    expect(tagsOf(envelope).article_json).toBe("failed");
    const feedback = (feedbackEvent(envelope).contexts as { feedback: Record<string, unknown> }).feedback;
    expect(feedback.message).toBe(REPORT.body);
    expect(attachmentItems(envelope).map(([header]) => header.filename)).toEqual(["diagnostics.json"]);
    expect(attempted).toEqual([REPORT.id]);
    expect(mirrored).toHaveLength(1);
  });

  it("never sends the reader's profile, purpose or upload filename", async () => {
    ownArticle();
    startSentry();
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const whole = everything(envelopes[0]!);
    /* Not vacuous: the article did go. */
    expect(whole).toContain("ARTICLE_MARKER title");
    expect(whole).not.toContain("PROFILE_SENTINEL");
    expect(whole).not.toContain("PURPOSE_SENTINEL");
    expect(whole).not.toContain("UPLOADED_FILENAME_MARKER");
  });

  /**
   * **The id is the browser's, and unique only per owner** — `(owner_id, id)`
   * is the key (src/db/schema.ts). So two readers can file the same id at the
   * same moment, and a guard that found registrations by it would write one
   * reader's message, address and article into the other's envelope.
   *
   * The event processor is what makes the two overlap: it holds each event
   * after capture, as any async processor would, so both registrations exist
   * before either envelope reaches the guard.
   */
  it("keeps two readers' reports apart when their browsers minted the same id", async () => {
    const USER_B = { id: "99999999-8888-7777-6666-555555555555", email: "other@example.com" };
    const REPORT_A: FeedbackReport = { ...REPORT, slug: "article-a", body: "WORDS_OF_READER_A" };
    const REPORT_B: FeedbackReport = {
      ...REPORT,
      reporterEmail: USER_B.email,
      slug: "article-b",
      body: "WORDS_OF_READER_B",
    };
    const MARKERS: Record<string, string> = { "article-a": "MARKER_A", "article-b": "MARKER_B" };
    fakeSource = async (slug) => ({
      bytes: new TextEncoder().encode(`%PDF SOURCE_${MARKERS[slug]}`),
      kind: "pdf",
      filename: null,
    });
    fakeArticle = async (slug) => articleFor(slug, MARKERS[slug]!);
    fakeMetadata = async (slug) => metadataFor(slug);

    startSentry();
    getGlobalScope().addEventProcessor((event) =>
      processorDelayMs === 0
        ? event
        : new Promise((resolve) => setTimeout(() => resolve(event), processorDelayMs)),
    );
    processorDelayMs = 30;

    await Promise.all([
      mirrorFeedback({ report: REPORT_A, user: USER, screenshot: null }),
      mirrorFeedback({ report: REPORT_B, user: USER_B, screenshot: null }),
    ]);

    expect(envelopes).toHaveLength(2);
    const byUser = new Map(
      envelopes.map((envelope) => [(feedbackEvent(envelope).user as { id: string }).id, envelope]),
    );
    for (const [user, mine, theirs] of [
      [USER, "A", "B"],
      [USER_B, "B", "A"],
    ] as const) {
      const envelope = byUser.get(user.id);
      expect(envelope).toBeDefined();
      const feedback = (feedbackEvent(envelope!).contexts as { feedback: Record<string, unknown> })
        .feedback;
      expect(feedback.message).toBe(`WORDS_OF_READER_${mine}`);
      expect(feedback.contact_email).toBe(user.email);
      const whole = everything(envelope!);
      expect(whole).toContain(`SOURCE_MARKER_${mine}`);
      expect(whole).toContain(`MARKER_${mine} title`);
      expect(whole).not.toContain(`MARKER_${theirs}`);
      expect(whole).not.toContain(`WORDS_OF_READER_${theirs}`);
    }
  });

  it("puts a nonce on the captured event and never writes it into the envelope", async () => {
    startSentry();
    /* A client processor runs after every scope is merged and before the
       envelope is built, so it sees the event as the guard will receive it. */
    const seen: Record<string, unknown>[] = [];
    getClient()?.addEventProcessor((event) => {
      seen.push({ ...event.tags });
      return event;
    });
    await mirrorFeedback({ report: REPORT, user: USER, screenshot: null });

    const nonce = seen[0]?.[FEEDBACK_NONCE_TAG];
    /* Not vacuous: there was one to leak. */
    expect(typeof nonce).toBe("string");
    expect((nonce as string).length).toBeGreaterThanOrEqual(32);
    expect(everything(envelopes[0]!)).not.toContain(nonce as string);
    expect(FEEDBACK_NONCE_TAG in tagsOf(envelopes[0]!)).toBe(false);
  });

  it("empties an envelope whose report id is registered but which carries no nonce", () => {
    /* The report id is the browser's; being able to name one is not being the
       one who registered it. */
    const forget = expectFeedbackEnvelope(REPORT.id, {
      message: "REGISTERED_MESSAGE",
      contactEmail: USER.email,
      source: "spideryarn",
      user: USER,
      tags: { report_id: REPORT.id },
      attachments: [],
    });
    try {
      const envelope: Envelope = [
        { event_id: "0".repeat(32) },
        [[{ type: "feedback" }, { tags: { report_id: REPORT.id } }]],
      ];
      guardFeedbackEnvelope(envelope);
      expect(envelope[1]).toEqual([]);
    } finally {
      forget();
    }
  });

  it("empties an envelope carrying a registered nonce under another report's id", () => {
    /* The nonce makes the registration this capture's; the id agreeing is the
       guarantee the guard had before it, kept. A processor that rewrote the id
       must not get one report sent under another's name. */
    const forget = expectFeedbackEnvelope("a-server-minted-nonce-for-the-id-check", {
      message: "REGISTERED_MESSAGE",
      contactEmail: USER.email,
      source: "spideryarn",
      user: USER,
      tags: { report_id: REPORT.id },
      attachments: [],
    });
    try {
      const envelope: Envelope = [
        { event_id: "0".repeat(32) },
        [
          [
            { type: "feedback" },
            {
              tags: {
                report_id: "spya-zzzzzz",
                [FEEDBACK_NONCE_TAG]: "a-server-minted-nonce-for-the-id-check",
              },
            },
          ],
        ],
      ];
      guardFeedbackEnvelope(envelope);
      expect(envelope[1]).toEqual([]);
    } finally {
      forget();
    }
  });

  it("rebuilds an envelope carrying a registered nonce, and drops the nonce", () => {
    const forget = expectFeedbackEnvelope("a-server-minted-nonce-0123456789ab", {
      message: "REGISTERED_MESSAGE",
      contactEmail: USER.email,
      source: "spideryarn",
      user: USER,
      tags: { report_id: REPORT.id },
      attachments: [],
    });
    try {
      const envelope: Envelope = [
        { event_id: "0".repeat(32) },
        [
          [
            { type: "feedback" },
            {
              tags: { report_id: REPORT.id, [FEEDBACK_NONCE_TAG]: "a-server-minted-nonce-0123456789ab" },
            },
          ],
        ],
      ];
      guardFeedbackEnvelope(envelope);
      expect(envelope[1]).toHaveLength(1);
      expect(everything(envelope)).toContain("REGISTERED_MESSAGE");
      expect(everything(envelope)).not.toContain("a-server-minted-nonce");
    } finally {
      forget();
    }
  });
});
