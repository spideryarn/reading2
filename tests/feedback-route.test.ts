/**
 * `POST /api/feedback` — the seam between a browser and the durable row.
 *
 * The store is faked here on purpose: tests/feedback-store.test.ts already owns
 * "did the right row land", and what this file is about is everything the route
 * decides *before* and *after* that call — which of the three answers becomes
 * which status, what a body is allowed to contain, and the two fields the
 * browser is not allowed to have an opinion about.
 *
 * The four that would be silently wrong rather than loudly broken:
 *
 * 1. **The email is the gate's.** A body carrying `reporterEmail` is refused,
 *    and the address that reaches the store is `VerifiedUser.email`.
 * 2. **`x-vercel-id` is read from the request, server-side.** A browser cannot
 *    put its own *response* header into a request, so a client-supplied one
 *    would be a fiction that looked exactly like the real thing in a report.
 * 3. **The screenshot is validated against its own bytes**, never against a
 *    content type the caller wrote down. There is nowhere to put one.
 * 4. **A Sentry outage is not the reader's problem.** The row is written and
 *    authoritative; a throwing mirror still answers 201.
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The level, raised before any import — `level()` in src/log.ts is read once at
 * that module's load and vitest sets `NODE_ENV=test`, which makes it `silent`.
 * Without this the "lengths, never text" assertion at the bottom would pass
 * against a log line containing the whole article. tests/helpers/log-capture.ts.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error", "warn"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "info";
  }
  return { previousLevel };
});

import { mintId } from "../src/ids.js";
import type { FeedbackReport, FeedbackSubmission, NewFeedback } from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS, TEST_EMAIL } from "./helpers/authed.js";
import { logLinesWhile } from "./helpers/log-capture.js";

/** Every `submit` the route made, in order. Read by nearly every test below. */
let submitted: NewFeedback[] = [];
/** Every `markMirrored`, so "the mirror ran" is a fact rather than a hope. */
let mirrored: { id: string; sentryEventId: string | null }[] = [];
/** What the fake store answers with. Set per test. */
let answer: FeedbackSubmission;
/** What `captureFeedback` does. A test makes it throw. */
let captureBehaviour: () => string = () => "sentry-event-id";

/**
 * A report as the store would hand one back, built from what was submitted so
 * that the route's own mapping is what is under test rather than this fixture.
 */
function storedReport(input: NewFeedback): FeedbackReport {
  return {
    ...input,
    createdAt: "2026-08-31T12:00:00.000Z",
    screenshotBytes: input.screenshot === null ? null : input.screenshot.length,
    mirroredAt: null,
    sentryEventId: null,
  };
}

vi.mock("../src/store/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/store/index.js")>();
  return {
    ...actual,
    feedbackStore: {
      submit: async (input: NewFeedback) => {
        submitted.push(input);
        return answer ?? { kind: "created", report: storedReport(input) };
      },
      read: async () => null,
      markMirrored: async (id: string, sentryEventId: string | null) => {
        mirrored.push({ id, sentryEventId });
      },
    },
  };
});

/**
 * **The real Sentry path, with one function replaced.** Not a mock of
 * src/feedback.ts: the property under test at the bottom of this file is that
 * `mirrorFeedback` swallows a throw from the SDK, and mocking the module that
 * does the swallowing would test the mock.
 */
vi.mock("@sentry/node-core/light", async (importActual) => {
  const actual = await importActual<typeof import("@sentry/node-core/light")>();
  return {
    ...actual,
    /* Truthy so the mirror believes there is somewhere to report to. Nothing
       here calls a method on it. */
    getClient: () => ({}) as never,
    captureFeedback: () => captureBehaviour(),
  };
});

const { handleApi } = await import("../src/routes.js");

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Drive `handleApi` with a fake request/response pair. */
async function call(
  body: unknown,
  options: {
    method?: string;
    headers?: Record<string, string>;
    verify?: Parameters<typeof handleApi>[2];
    /** A raw body, for the case where the point is how many bytes arrived. */
    raw?: Buffer;
  } = {},
): Promise<Reply> {
  const payload =
    options.raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
  const req = Object.assign(
    (async function* () {
      if (payload) yield payload;
    })(),
    {
      method: options.method ?? "POST",
      url: "/api/feedback",
      headers: options.headers ?? AUTHED_HEADERS,
    },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = String(value);
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, options.verify ?? acceptAny);
  return { status, headers, body: text ? JSON.parse(text) : {} };
}

/** The smallest body the route accepts. */
function minimal(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: mintId(),
    steps: "Open an article and press the button",
    expected: "a dialog",
    actual: "nothing at all",
    consented: false,
    routeKind: "read",
    slug: "an-article",
    buildCommit: "abc1234",
    ...extra,
  };
}

/** A one-pixel PNG, as bytes the sniffer will recognise. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

beforeEach(() => {
  submitted = [];
  mirrored = [];
  answer = undefined as unknown as FeedbackSubmission;
  captureBehaviour = () => "sentry-event-id";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/feedback", () => {
  it("files a report and answers 201", async () => {
    const body = minimal();
    const reply = await call(body);
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ id: body.id, status: "created" });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      id: body.id,
      steps: "Open an article and press the button",
      expected: "a dialog",
      actual: "nothing at all",
      consented: false,
      routeKind: "read",
      slug: "an-article",
      buildCommit: "abc1234",
      diagnostics: null,
      screenshot: null,
    });
  });

  it("takes the reporter's email from the gate and refuses one from the body", async () => {
    await call(minimal());
    expect(submitted[0]?.reporterEmail).toBe(TEST_EMAIL);

    const reply = await call(minimal({ reporterEmail: "someone@else.example" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).not.toContain("someone@else.example");
  });

  it("reads x-vercel-id off this request and ignores one in the body", async () => {
    await call(minimal(), {
      headers: { ...AUTHED_HEADERS, "x-vercel-id": "lhr1::abc-123" },
    });
    expect(submitted[0]?.requestVercelId).toBe("lhr1::abc-123");

    const reply = await call(minimal({ requestVercelId: "made-up" }));
    expect(reply.status).toBe(400);
  });

  it("answers 200 for a duplicate rather than an error", async () => {
    const body = minimal();
    answer = {
      kind: "duplicate",
      /* The report the store hands back is the one that is **stored** — the
         reader's first telling, not the retry's text. */
      report: {
        ...(body as unknown as NewFeedback),
        reporterEmail: TEST_EMAIL,
        steps: "what they wrote the first time",
        expected: null,
        actual: null,
        environment: "test",
        requestVercelId: null,
        diagnostics: null,
        createdAt: "2026-08-31T12:00:00.000Z",
        screenshotBytes: null,
        mirroredAt: null,
        sentryEventId: null,
      },
    };
    const reply = await call(body);
    expect(reply.status).toBe(200);
    expect(reply.body.status).toBe("duplicate");
    /* Not mirrored. Feedback is not deduped by Sentry, so a retry that filed a
       second copy is a bug nobody would ever see. */
    expect(mirrored).toHaveLength(0);
  });

  it("answers 429 with a Retry-After when the reader is over the cap", async () => {
    answer = { kind: "limited", retryAfterMs: 90_000 };
    const reply = await call(minimal());
    expect(reply.status).toBe(429);
    expect(reply.headers["retry-after"]).toBe("90");
    expect(String(reply.body.error)).toMatch(/\[fb-often\]/);
    expect(mirrored).toHaveLength(0);
  });

  it("answers 413 for a body past its own limit", async () => {
    /* A megabyte, which is past the feedback route's limit and four figures
       past the shared one. Raw, because the point is the byte count. */
    const raw = Buffer.alloc(1024 * 1024, "x");
    const reply = await call(undefined, { raw });
    expect(reply.status).toBe(413);
    expect(submitted).toHaveLength(0);
  });

  it("refuses a report with nothing in it", async () => {
    const reply = await call(minimal({ steps: "  ", expected: null, actual: "" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-empty\]/);
    expect(submitted).toHaveLength(0);
  });

  it("refuses an answer past the cap, and never quotes it back", async () => {
    const prose = "The unbearable lightness of a very long paragraph. ".repeat(200);
    const reply = await call(minimal({ actual: prose }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-long\]/);
    expect(String(reply.body.error)).not.toContain("unbearable");
  });

  it("refuses a route kind that is not one of ours", async () => {
    const reply = await call(minimal({ routeKind: "wherever" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).not.toContain("wherever");
  });

  it("refuses an anonymous request", async () => {
    const reply = await call(minimal(), { headers: {} });
    expect(reply.status).toBe(401);
    expect(submitted).toHaveLength(0);
  });

  it("takes a screenshot as bytes and gives a caller nowhere to type a MIME", async () => {
    await call(minimal({ screenshot: PNG.toString("base64") }));
    expect(submitted[0]?.screenshot).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(submitted[0]!.screenshot!).equals(PNG)).toBe(true);

    for (const field of ["screenshotType", "screenshotName", "contentType", "filename"]) {
      const reply = await call(minimal({ screenshot: PNG.toString("base64"), [field]: "image/svg+xml" }));
      expect(reply.status).toBe(400);
      expect(String(reply.body.error)).not.toContain("svg");
    }
  });

  it("refuses a screenshot that is not an image, whatever it is called", async () => {
    const svg = Buffer.from('<svg onload="alert(1)"><text>the article</text></svg>');
    const reply = await call(minimal({ screenshot: svg.toString("base64") }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-shot\]/);
    expect(String(reply.body.error)).not.toContain("article");
    expect(submitted).toHaveLength(0);
  });

  it("refuses a screenshot past the decoded cap", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(400_001)]);
    const reply = await call(minimal({ screenshot: big.toString("base64") }));
    expect(reply.status).toBe(413);
    expect(submitted).toHaveLength(0);
  });

  it("keeps only the diagnostics fields it knows, and refuses them without consent", async () => {
    await call(
      minimal({
        consented: true,
        diagnostics: {
          articleProse: "Four score and seven years ago",
          device: { language: "en-GB", viewportW: 1280, viewportH: 800, nonsense: 1 },
          api: [{ method: "GET", path: "/api/library/search?q=my+private+search", status: 500 }],
        },
      }),
    );
    const stored = JSON.stringify(submitted[0]?.diagnostics);
    expect(stored).not.toContain("Four score");
    expect(stored).not.toContain("nonsense");
    expect(stored).not.toContain("private+search");
    expect(stored).toContain("en-GB");

    const reply = await call(minimal({ consented: false, diagnostics: { device: { language: "en" } } }));
    expect(reply.status).toBe(400);
  });

  it("mirrors a newly created report and records the event id", async () => {
    const body = minimal();
    await call(body);
    expect(mirrored).toEqual([{ id: body.id, sentryEventId: "sentry-event-id" }]);
  });

  it("still answers 201 when Sentry throws, and leaves the row alone", async () => {
    captureBehaviour = () => {
      throw new Error("sentry is down");
    };
    const body = minimal();
    const reply = await call(body);
    expect(reply.status).toBe(201);
    expect(submitted).toHaveLength(1);
    /* Not marked. `mirrored_at is null` is the query that finds a report
       Sentry never took, and it only means that if nothing writes it hopefully. */
    expect(mirrored).toHaveLength(0);
  });

  it("logs lengths, never the reader's words", async () => {
    const written = await logLinesWhile(async () => {
      await call(
        minimal({
          steps: "I clicked the thing about MY SECRET MANUSCRIPT",
          expected: "SOMETHING ELSE ENTIRELY",
          actual: "A CONFIDENTIAL PARAGRAPH",
        }),
      );
    });
    /* The check that this check can fail: an empty capture satisfies every
       `not.toContain` below. tests/helpers/log-capture.ts. */
    expect(written).toContain("feedback report accepted");
    expect(written).not.toContain("MY SECRET MANUSCRIPT");
    expect(written).not.toContain("SOMETHING ELSE ENTIRELY");
    expect(written).not.toContain("A CONFIDENTIAL PARAGRAPH");
    expect(written).not.toContain(TEST_EMAIL);
    expect(written).toContain('"chars"');
  });
});

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});
