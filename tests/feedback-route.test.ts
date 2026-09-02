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
import { deflateSync } from "node:zlib";
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
import { MAX_FEEDBACK_ANSWER_CHARS } from "../src/types.js";
import type { FeedbackReport, FeedbackSubmission, NewFeedback } from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS, TEST_EMAIL } from "./helpers/authed.js";
import { logLinesWhile } from "./helpers/log-capture.js";

/** Every `submit` the route made, in order. Read by nearly every test below. */
let submitted: NewFeedback[] = [];
/** Every `markMirrored`, so "the mirror ran" is a fact rather than a hope. */
let mirrored: { id: string; sentryEventId: string | null }[] = [];
/** Every `markMirrorAttempted` — the honest half, written before delivery. */
let attempted: string[] = [];
/** What the fake store answers with. Set per test. */
let answer: FeedbackSubmission;
/** What `captureFeedback` does. A test makes it throw. */
let captureBehaviour: () => string = () => "sentry-event-id";
/** What the fake transport answers. `null` is "nothing came back at all". */
let sendResponse: { statusCode?: number } | null = { statusCode: 200 };

/**
 * A report as the store would hand one back, built from what was submitted so
 * that the route's own mapping is what is under test rather than this fixture.
 */
function storedReport(input: NewFeedback): FeedbackReport {
  return {
    ...input,
    createdAt: "2026-08-31T12:00:00.000Z",
    screenshotBytes: input.screenshot === null ? null : input.screenshot.length,
    mirrorAttemptedAt: null,
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

/**
 * **The real Sentry path, with two functions replaced.** Not a mock of
 * src/feedback.ts: the property under test at the bottom of this file is that
 * `mirrorFeedback` swallows a throw from the SDK, and mocking the module that
 * does the swallowing would test the mock.
 *
 * The fake client's hook table. `mirrorFeedback` registers two things on a
 * client — the envelope guard and a one-shot `afterSendEvent` listener — so a
 * bare `{}` is no longer a client, and pretending otherwise would put the whole
 * mirror inside its own `catch` where every assertion below would pass by
 * accident.
 */
const hooks = new Map<string, ((...args: never[]) => void)[]>();

vi.mock("@sentry/node-core/light", async (importActual) => {
  const actual = await importActual<typeof import("@sentry/node-core/light")>();
  return {
    ...actual,
    getClient: () =>
      ({
        on(hook: string, callback: (...args: never[]) => void) {
          const list = hooks.get(hook) ?? [];
          list.push(callback);
          hooks.set(hook, list);
          return () => {
            const current = hooks.get(hook) ?? [];
            hooks.set(
              hook,
              current.filter((one) => one !== callback),
            );
          };
        },
      }) as never,
    /**
     * The SDK's real shape, which is the point: an event id back **now**, and
     * whatever the transport says about it **later**. Anything that resolves
     * both at once would be a mock of the bug rather than of the SDK.
     */
    captureFeedback: () => {
      const id = captureBehaviour();
      queueMicrotask(() => {
        for (const callback of hooks.get("afterSendEvent") ?? []) {
          (callback as (event: unknown, response: unknown) => void)(
            { event_id: id },
            sendResponse ?? {},
          );
        }
      });
      return id;
    },
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
    body: "Open an article and press the button and nothing at all happens",
    kind: "problem",
    consented: false,
    routeKind: "read",
    slug: "an-article",
    buildCommit: "abc1234",
    ...extra,
  };
}

/** A one-pixel PNG — a real one, because the route now decodes it. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * **A screenshot as big as one is allowed to be**, and a real one.
 *
 * Random pixels, because deflate cannot shrink them: the encoded file is
 * therefore about the size of the raster, which is how this lands just under
 * `MAX_FEEDBACK_SCREENSHOT_BYTES` instead of being a megabyte of white.
 */
function bigPng(): Buffer {
  const width = 1000;
  const height = 95;
  const raster = Buffer.alloc(height * (width * 4 + 1));
  /* An xorshift, so the bytes really are incompressible. A tidy arithmetic
     pattern deflates to nothing, and the first version of this helper did
     exactly that and produced a 94 KB "maximum" body. */
  let state = 0x9e3779b9;
  for (let row = 0; row < height; row++) {
    const at = row * (width * 4 + 1);
    /* Filter 0 — none. */
    raster[at] = 0;
    for (let i = 1; i <= width * 4; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      raster[at + i] = state & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG.subarray(0, 8),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raster, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One chunk, length and CRC included. */
function pngChunk(type: string, payload: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), payload]);
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + payload.length);
  return out;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A well-formed `tEXt` chunk, CRC and all — the legitimate way to hide prose. */
function textChunk(keyword: string, value: string): Buffer {
  return pngChunk("tEXt", Buffer.from(`${keyword}\0${value}`, "latin1"));
}

beforeEach(() => {
  submitted = [];
  mirrored = [];
  attempted = [];
  hooks.clear();
  answer = undefined as unknown as FeedbackSubmission;
  captureBehaviour = () => "sentry-event-id";
  sendResponse = { statusCode: 200 };
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
      body: "Open an article and press the button and nothing at all happens",
      kind: "problem",
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

  it("refuses an x-vercel-id that is not shaped like one, rather than truncating it", async () => {
    /* The header is only Vercel's where Vercel is in front. Behind anything
       else it is whatever arrived, and the old code kept 200 characters of it
       and made them a Sentry tag and a column. */
    const prose = "Four score and seven years ago our fathers brought forth on this continent";
    await call(minimal(), { headers: { ...AUTHED_HEADERS, "x-vercel-id": prose } });
    expect(submitted[0]?.requestVercelId).toBeNull();

    /* The positive control, so this is not merely a test that the field is
       always null. Both of Vercel's shapes. */
    await call(minimal(), {
      headers: { ...AUTHED_HEADERS, "x-vercel-id": "iad1:sfo1::abcde-1234567890-0123456789ab" },
    });
    expect(submitted[1]?.requestVercelId).toBe("iad1:sfo1::abcde-1234567890-0123456789ab");
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
        body: "what they wrote the first time",
        kind: null,
        environment: "test",
        requestVercelId: null,
        diagnostics: null,
        createdAt: "2026-08-31T12:00:00.000Z",
        screenshotBytes: null,
        mirrorAttemptedAt: null,
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
    /* Two megabytes, which is past the feedback route's limit and five figures
       past the shared one. Raw, because the point is the byte count. */
    const raw = Buffer.alloc(2 * 1024 * 1024, "x");
    const reply = await call(undefined, { raw });
    expect(reply.status).toBe(413);
    expect(submitted).toHaveLength(0);
  });

  /**
   * **The positive control the body limit did not have**, and the reason it
   * needed one.
   *
   * `MAX_FEEDBACK_BODY_BYTES` was the screenshot's base64 expansion plus 96 KB
   * of headroom, while the answers and the diagnostics arrays are capped in
   * JavaScript string units rather than UTF-8 bytes. GPT Sol constructed a body
   * that satisfied every inner limit at 662,501 bytes against an outer limit of
   * 631,640 — refused by `readBody` with a bare 413 before the validator could
   * say a word about it. A test proving a megabyte is rejected cannot see that.
   *
   * So: the largest report this route accepts, built at every cap at once, with
   * the answers in the character `JSON.stringify` expands furthest — a control
   * character, six bytes per unit. If this goes red, the outer limit and the
   * inner ones have drifted apart again.
   */
  it("takes the largest report the validator accepts", async () => {
    const body = minimal({
      consented: true,
      /* Six bytes per unit once escaped, at the cap, three times over — the
         *legacy* shape, because that is the largest body this route still takes
         and therefore the one the outer limit has to clear. */
      steps: "\u0001".repeat(MAX_FEEDBACK_ANSWER_CHARS),
      expected: "\u0002".repeat(MAX_FEEDBACK_ANSWER_CHARS),
      actual: "\u0003".repeat(MAX_FEEDBACK_ANSWER_CHARS),
      body: undefined,
      /* `isSlug` caps a slug at 60 characters — src/ingest.ts. */
      slug: `a${"b".repeat(59)}`,
      buildCommit: "c".repeat(64),
      screenshot: bigPng().toString("base64"),
      diagnostics: {
        device: {
          viewportW: 1280,
          viewportH: 800,
          devicePixelRatio: 2,
          userAgent: "u".repeat(300),
          language: "en-GB-oxendict",
          online: true,
          timezone: "America/Argentina/Buenos_Aires",
          colorScheme: "dark",
          reducedMotion: false,
        },
        api: Array.from({ length: 50 }, () => ({
          method: "GET",
          path: `/${Array.from({ length: 4 }, () => "s".repeat(24)).join("/")}`,
          status: 500,
          ms: 1234,
          vercelId: `iad1:sfo1::${"a".repeat(64)}`,
          at: "2026-08-31T12:00:00.000Z",
        })),
        errors: Array.from({ length: 20 }, () => ({
          name: `E${"r".repeat(62)}`,
          at: "2026-08-31T12:00:00.000Z",
        })),
        article: {
          slug: `a${"b".repeat(198)}`,
          /* Longer than a real slug on purpose: it is dropped, and that is the
             point — this is the *body* at its largest, not the blob. */
          revisionId: "e3b57b27-3c1c-4522-b2ea-8c1dea44afab",
          view: "article",
          mode: "plain",
          level: 20,
          blockCount: 1_000_000,
          rootBlockId: "spya-k3m9qt",
          blockIds: Array.from({ length: 200 }, () => "spya-k3m9qt"),
        },
        job: { id: "spya-k3m9qt", step: "extract", status: "running" },
      },
    });

    const bytes = Buffer.byteLength(JSON.stringify(body));
    /* **The floor is the check that this check can fail.** A body that had come
       out small — a screenshot helper whose "random" pixels deflated to nothing,
       say, which is exactly what the first draft of `bigPng` did — would pass
       the 201 below while proving nothing at all about the limit. */
    expect(bytes).toBeGreaterThan(550_000);
    const reply = await call(body);
    expect(reply.status).toBe(201);
    expect(submitted).toHaveLength(1);
  });

  it("takes a report with no kind at all", async () => {
    /* Greg asked for the toggle to start unset, so an absent `kind` is a valid
       report rather than a client that forgot a field. */
    const reply = await call(minimal({ kind: undefined }));
    expect(reply.status).toBe(201);
    expect(submitted[0]?.kind).toBeNull();
  });

  it("refuses a kind that is not one of ours", async () => {
    const reply = await call(minimal({ kind: "grumble" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-kind\]/);
    expect(submitted).toHaveLength(0);
  });

  it("still takes the old three-box shape, and folds it into one body", async () => {
    /* **A reader whose tab was loaded before the deploy.** `FEEDBACK_FIELDS`
       refuses an unknown key outright, so without the legacy vocabulary this
       reader is told "a report has a field this endpoint does not take" at the
       exact moment they are trying to report that something is broken. GPT Sol's
       review of the plan, 2026-09-02. The headings are the ones the migration
       used, so a stale report and a backfilled one read the same. */
    const reply = await call(
      minimal({
        body: undefined,
        kind: undefined,
        steps: "Pressed the button",
        expected: "a dialog",
        actual: "nothing at all",
      }),
    );
    expect(reply.status).toBe(201);
    expect(submitted[0]?.body).toBe(
      "Steps to reproduce:\nPressed the button\n\n" +
        "What you expected to see:\na dialog\n\n" +
        "What you saw instead:\nnothing at all",
    );
    expect(submitted[0]?.kind).toBeNull();
  });

  it("refuses a body that carries both shapes at once", async () => {
    /* Not an old client — an old client has no `body` — so there is no right
       answer about which of the two to keep, and guessing one would store half
       of what somebody sent. */
    const reply = await call(minimal({ steps: "Pressed the button" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-shape\]/);
    expect(submitted).toHaveLength(0);
  });

  it("decides which shape a report is on its keys, not on which of them are empty", async () => {
    /* `{body: null, steps: "…"}` carries both vocabularies, and the first
       version read it as a well-formed old client because it asked whether each
       field held *text*. A shape is a set of keys. GPT Sol's code review,
       2026-09-02. */
    const reply = await call(minimal({ body: null, steps: "Pressed the button" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-shape\]/);
    expect(submitted).toHaveLength(0);

    /* And the mirror image: a real body beside empty legacy keys. */
    const other = await call(minimal({ steps: null, expected: null, actual: null }));
    expect(other.status).toBe(400);
    expect(String(other.body.error)).toMatch(/\[fb-shape\]/);
    expect(submitted).toHaveLength(0);
  });

  it("refuses a report with nothing in it", async () => {
    const reply = await call(minimal({ body: "  " }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-empty\]/);
    expect(submitted).toHaveLength(0);
  });

  it("refuses an answer past the cap, and never quotes it back", async () => {
    const prose = "The unbearable lightness of a very long paragraph. ".repeat(200);
    const reply = await call(minimal({ body: prose }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toMatch(/\[fb-long\]/);
    expect(String(reply.body.error)).not.toContain("unbearable");
  });

  it("never puts a field name in the error, or in the log", async () => {
    /* `logRequest` writes an `httpError` message as `reason`, so a key in the
       message is an authenticated caller writing into our logs 40 characters at
       a time, without ever reaching the rate limiter — which counts reports and
       not refusals. GPT Sol's code review, 2026-08-31. */
    const key = "MY_SECRET_MANUSCRIPT_FIRST_FORTY_CHARACTERS";
    const written = await logLinesWhile(async () => {
      const reply = await call(minimal({ [key]: 1 }));
      expect(reply.status).toBe(400);
      expect(String(reply.body.error)).toMatch(/\[fb-field\]/);
      expect(String(reply.body.error)).not.toContain("MY_SECRET");
    });
    /* The positive control: something was captured, so the assertion below is
       about the log rather than about an empty string. */
    expect(written.length).toBeGreaterThan(0);
    expect(written).not.toContain("MY_SECRET");
  });

  it("refuses a route kind that is not one of ours", async () => {
    const reply = await call(minimal({ routeKind: "wherever" }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).not.toContain("wherever");
  });

  it("refuses an anonymous request, and takes the same one signed in", async () => {
    const body = minimal();
    const refused = await call(body, { headers: {} });
    expect(refused.status).toBe(401);
    expect(submitted).toHaveLength(0);

    /* **The positive control, and the reason it is in the same test.** On its
       own the 401 is a regression test for the gate in `handleApi` and not
       evidence about this route: deleting `/api/feedback` entirely leaves it
       green, because an unmatched path is refused by the gate too. GPT Sol's
       code review, 2026-08-31. The same body, signed in, has to land. */
    const filed = await call(body);
    expect(filed.status).toBe(201);
    expect(submitted).toHaveLength(1);
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

  /**
   * **The polyglot, in its three shapes.**
   *
   * The old check was eight bytes of signature, so all three of these were
   * stored and forwarded to a third party — GPT Sol's code review, 2026-08-31.
   * What replaced it takes the file apart and writes a new one
   * (src/feedback-image.ts), so the assertion is not "refused" in every case: a
   * real picture with prose glued to it is *accepted, without the prose*, which
   * is a better answer than refusing the reader's screenshot.
   */
  it("keeps the picture and drops everything glued to it", async () => {
    /* 1. Prose appended after IEND — a file every decoder opens happily. */
    const appended = Buffer.concat([PNG, Buffer.from("MY SECRET MANUSCRIPT".repeat(20))]);
    const first = await call(minimal({ screenshot: appended.toString("base64") }));
    expect(first.status).toBe(201);
    const stored = Buffer.from(submitted[0]!.screenshot!);
    expect(stored.includes("MY SECRET")).toBe(false);
    /* And it is still a PNG, so the reader's screenshot survived the trip. */
    expect(stored.subarray(1, 4).toString()).toBe("PNG");

    /* 2. A tEXt chunk, which is where a well-formed file carries prose. */
    const withText = Buffer.concat([
      PNG.subarray(0, PNG.length - 12),
      textChunk("Comment", "MY SECRET MANUSCRIPT"),
      PNG.subarray(PNG.length - 12),
    ]);
    await call(minimal({ screenshot: withText.toString("base64") }));
    expect(Buffer.from(submitted[1]!.screenshot!).includes("MY SECRET")).toBe(false);

    /* 3. The signature and then anything at all, which is the reviewer's own
          example and the only one of the three that is not a picture. */
    const prefixed = Buffer.concat([
      PNG.subarray(0, 8),
      Buffer.from("MY SECRET MANUSCRIPT".repeat(20)),
    ]);
    const third = await call(minimal({ screenshot: prefixed.toString("base64") }));
    expect(third.status).toBe(400);
    expect(String(third.body.error)).not.toContain("SECRET");
    expect(submitted).toHaveLength(2);
  });

  it("refuses a JPEG, and says which format it wants", async () => {
    /* The plan expected PNG or JPEG. A JPEG's entropy-coded scan cannot be
       length-checked without a baseline decoder, so it would be forwarded as an
       opaque caller-supplied span — half a guarantee at the one seam this is
       for. src/feedback-image.ts argues it at length. */
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const reply = await call(minimal({ screenshot: jpeg.toString("base64") }));
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toContain("PNG");
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

  /**
   * **Prose inside the fields that are allowed**, which is the leak the first
   * version had and the one a test for unknown *keys* cannot see.
   *
   * > `blockIds` accepts 200 arbitrary 64-character strings … A caller can place
   * > article prose or a provider body inside those named slots.
   * >
   * > — GPT Sol's code review, 2026-08-31
   *
   * Every field below is a name the allowlist knows, filled with something that
   * is not what that name is for.
   */
  it("drops a value that is the wrong shape for the field it is in", async () => {
    const PROSE = "Four score and seven years ago our fathers brought forth";
    await call(
      minimal({
        consented: true,
        diagnostics: {
          device: {
            userAgent: `${PROSE}\nand a second line of it`,
            language: PROSE,
            timezone: PROSE,
            colorScheme: PROSE,
          },
          api: [
            {
              method: "GET",
              path: `/api/article/${PROSE.replaceAll(" ", "-").toLowerCase()}/and/more/of/it`,
              vercelId: PROSE,
              at: PROSE,
              status: 500,
            },
          ],
          errors: [{ name: PROSE, at: PROSE }],
          article: {
            slug: PROSE,
            revisionId: PROSE,
            view: PROSE,
            mode: PROSE,
            rootBlockId: PROSE,
            blockIds: [PROSE, "spya-k3m9qt", "x".repeat(64)],
            level: 9999,
          },
          job: { id: PROSE, step: PROSE, status: PROSE },
        },
      }),
    );
    const stored = JSON.stringify(submitted[0]?.diagnostics);
    expect(stored).not.toContain("Four score");
    expect(stored).not.toContain("four-score");
    expect(stored).not.toContain("xxxxx");
    /* The path became a template rather than keeping a hyphenated "slug" that
       is really a sentence. */
    expect(stored).toContain('"/api/article/:x/and/more/of/it"');
    /* The positive control, so this is not a test that the blob is always
       empty: the one legitimate value in there survived. */
    expect(stored).toContain("spya-k3m9qt");
  });

  it("records a route template rather than the path that was fetched", async () => {
    await call(
      minimal({
        consented: true,
        diagnostics: {
          api: [{ method: "GET", path: "/api/chat/why-trees-spya-k3m9qt/live?q=private", status: 200 }],
        },
      }),
    );
    const payload = submitted[0]!.diagnostics!.payload as { api: { path: string }[] };
    const calls = payload.api;
    /* Which endpoint, and not which article. The slug is a column already. */
    expect(calls[0]?.path).toBe("/api/chat/:x/live");
  });

  it("mirrors a newly created report and records the event id", async () => {
    const body = minimal();
    await call(body);
    expect(attempted).toEqual([body.id]);
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
    /* Neither column written: nothing was handed over, so there was no attempt
       either. */
    expect(attempted).toHaveLength(0);
    expect(mirrored).toHaveLength(0);
  });

  /**
   * **The outage that is not a throw**, and the reason the test above is not
   * enough on its own.
   *
   * A real transport failure never reaches this code: `captureFeedback` returns
   * an id, the send happens later, and `Client.sendEnvelope` catches everything
   * and resolves an empty result. The old code wrote `mirrored_at` off the id
   * alone, so this was the shape it got wrong while the throwing test stayed
   * green. GPT Sol's code review, 2026-08-31.
   */
  it("records the attempt but not delivery when the transport does not answer", async () => {
    sendResponse = null;
    const body = minimal();
    const reply = await call(body);
    expect(reply.status).toBe(201);
    expect(attempted).toEqual([body.id]);
    expect(mirrored).toHaveLength(0);
  });

  it("records the attempt but not delivery when Sentry rate-limits us", async () => {
    sendResponse = { statusCode: 429 };
    const body = minimal();
    expect((await call(body)).status).toBe(201);
    expect(attempted).toEqual([body.id]);
    expect(mirrored).toHaveLength(0);
  });

  it("logs lengths, never the reader's words", async () => {
    const written = await logLinesWhile(async () => {
      await call(
        minimal({
          body: "I clicked the thing about MY SECRET MANUSCRIPT and got A CONFIDENTIAL PARAGRAPH",
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
