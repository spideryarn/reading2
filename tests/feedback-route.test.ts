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
import { deflateSync, inflateSync } from "node:zlib";
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
import { currentOwnerId } from "../src/owner.js";
import {
  EARLIER_FEEDBACK_LIMIT,
  FEEDBACK_LIST_BYTES,
  MAX_FEEDBACK_ANSWER_CHARS,
  MAX_FEEDBACK_BODY_CHARS,
  MAX_LEGACY_FEEDBACK_ANSWER_CHARS,
  MAX_FEEDBACK_SCREENSHOT_BYTES,
  MAX_FEEDBACK_URL_CHARS,
} from "../src/types.js";
import type {
  FeedbackAnswerSubmission,
  FeedbackReport,
  FeedbackSubmission,
  LinkedFeedbackReport,
  NewFeedback,
  NewFeedbackAnswer,
  StoredFeedbackAnswer,
  StoredFeedbackDeferral,
  NewFeedbackDeferral,
} from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS, TEST_EMAIL, TEST_OWNER } from "./helpers/authed.js";
import { logLinesWhile } from "./helpers/log-capture.js";

/** Every `submit` the route made, in order. Read by nearly every test below. */
let submitted: NewFeedback[] = [];
/** Every `markMirrored`, so "the mirror ran" is a fact rather than a hope. */
let mirrored: { id: string; sentryEventId: string | null }[] = [];
/** Every `markMirrorAttempted` — the honest half, written before delivery. */
let attempted: string[] = [];
/** Every `listMine` limit the route asked for. */
let listed: number[] = [];
/** The id filter each `listMine` was given — `undefined` for the whole list. */
let listFilters: unknown[] = [];
/** The request owner in force when each `listMine` began. */
let listOwners: string[] = [];
/** What the fake `listMine` answers with — deliberately loose, see § GET. */
let listAnswer: unknown = { reports: [], more: false };
/** The ids each `listMine` was asked to count, and the owner in force. */
let counted: { ids: readonly string[]; owner: string }[] = [];
/** The counts the fake `listMine` adds to its answer. */
let countAnswer: unknown = { all: 0, in: 0 };
/** Each `listMineByStatus` the admin route made: its limit, the endings it bound, the filter, the owner. */
let statusListed: { limit: number; endings: unknown; show: string; owner: string }[] = [];
/** What the fake `listMineByStatus` answers with, or an Error to throw. */
let statusAnswer: unknown = { reports: [], more: false, counts: { open: 0, waiting: 0, aside: 0, shipped: 0 } };
/** Every `submitAnswer` the route made, with the owner in force (261007d stage 2). */
let answersSubmitted: { input: NewFeedbackAnswer; owner: string }[] = [];
/** What the fake `submitAnswer` answers with; null means "created, echoing the input". */
let answerOutcome: FeedbackAnswerSubmission | null = null;
/** The question ids each `answersTo` asked about, and the replies it hands back. */
let newestAsked: { ids: readonly string[]; owner: string }[] = [];
let newestAnswer: StoredFeedbackAnswer[] = [];
/** The deferrals the fake store holds, and every `setDeferred` the route made (261008i). */
let deferralsAnswer: StoredFeedbackDeferral[] = [];
let deferralsSet: { input: NewFeedbackDeferral; owner: string }[] = [];
/** The report ids each `linkedReports` asked about, and what it hands back. */
let linkedAsked: { ids: readonly string[]; owner: string }[] = [];
let linkedAnswer: LinkedFeedbackReport[] = [];
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

/**
 * Every admin notice the route asked for (plan 261002j), and whether the
 * reader's response had already ended when it was asked — the notice must
 * never sit in front of the reader.
 */
let notices: { id: string; ownerId: string; afterResponse: boolean; mirroredYet: boolean }[] = [];
/** Set by the fake response's `end`, read by the fake notice. */
let responseEnded = false;

/** The whole report each notice was handed, for the one case that renders the email from it. */
let noticedReports: FeedbackReport[] = [];
/** What each `captureFeedback` was given: the event's own fields, tags included. */
let sentryCaptures: unknown[] = [];

vi.mock("../src/feedback-notice.js", () => ({
  noticeFeedback: async (report: FeedbackReport, ownerId: string) => {
    noticedReports.push(report);
    notices.push({ id: report.id, ownerId, afterResponse: responseEnded, mirroredYet: mirrored.length > 0 });
    return { kind: "sent" };
  },
}));

/* The notes' endings, fixed here rather than read from docs/user-feedback/, so
   a note's header changing cannot move this file's answers. */
vi.mock("../src/feedback-endings.generated.js", () => ({
  FEEDBACK_NOTE_ENDINGS: {
    "spya-k3m9qt": "shipped",
    "spya-dec1ne": "declined",
    "spya-wa1t00": "awaiting",
    "spya-sh1pd2": "shipped",
  },
  FEEDBACK_NOTE_COMMENTS: {
    "spya-dec1ne": "Set aside: the browser gives us no way to do this.",
    "spya-wa1t00": "Waiting on you: one switch or two?",
    /* A comment for a report this reader never filed: it must go nowhere. */
    "spya-n0tm1n": "about somebody else's report",
  },
}));

/* The questions, fixed here for the same reason. One open about the admin's
   own report, one open about nothing, one open about a report the admin did
   not file, and one already answered: known to the POST, never sent by the GET. */
vi.mock("../src/feedback-questions.generated.js", () => ({
  FEEDBACK_QUESTION_STATUS: {
    "q-aaaaaa": "open",
    "q-bbbbbb": "open",
    "q-cccccc": "open",
    "q-dddddd": "answered",
  },
  FEEDBACK_OPEN_QUESTIONS: [
    { id: "q-aaaaaa", title: "One switch or two?", report: "spya-wa1t00", asked: "2026-10-05", body: "Background.\n\nA. One.\nB. Two." },
    { id: "q-bbbbbb", title: "A question about nothing filed", report: null, asked: "2026-10-06", body: "Stands alone." },
    { id: "q-cccccc", title: "About a reader's report", report: "spya-n0tm1n", asked: "2026-10-07", body: "The body says it all." },
  ],
  /* q-bbbbbb's first replies have been acted on (plans 261008i and 261010h). */
  FEEDBACK_QUESTION_ACTED: {
    "q-aaaaaa": [],
    "q-bbbbbb": [
      "spya-act3d0",
      "spya-act3d1",
      "spya-act3d2",
      "spya-act3d3",
      "spya-act3d4",
      "spya-act3d5",
      "spya-act3d6",
    ],
    "q-cccccc": [],
  },
}));

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
      listMine: async (limit: number, countIds: readonly string[], filter?: unknown) => {
        listed.push(limit);
        listFilters.push(filter);
        /* The real store resolves this at the start of its query. Doing the
           same here proves this route reached it only after the gate installed
           the signed-in reader's owner. */
        listOwners.push(currentOwnerId());
        counted.push({ ids: countIds, owner: currentOwnerId() });
        if (listAnswer instanceof Error) throw listAnswer;
        return { counts: countAnswer, ...(listAnswer as object) };
      },
      listMineByStatus: async (limit: number, endings: unknown, show: string) => {
        statusListed.push({ limit, endings, show, owner: currentOwnerId() });
        if (statusAnswer instanceof Error) throw statusAnswer;
        return statusAnswer;
      },
      submitAnswer: async (input: NewFeedbackAnswer) => {
        answersSubmitted.push({ input, owner: currentOwnerId() });
        return (
          answerOutcome ?? {
            kind: "created",
            answer: { id: input.id, questionId: input.questionId, body: input.body, createdAt: "2026-10-07T09:00:00.000Z" },
          }
        );
      },
      answersTo: async (ids: readonly string[]) => {
        newestAsked.push({ ids, owner: currentOwnerId() });
        return newestAnswer;
      },
      deferrals: async () => deferralsAnswer,
      setDeferred: async (input: NewFeedbackDeferral) => {
        deferralsSet.push({ input, owner: currentOwnerId() });
        return { questionId: input.questionId, deferredAt: input.deferred ? "2026-10-08T10:00:00.000Z" : null };
      },
      linkedReports: async (ids: readonly string[]) => {
        linkedAsked.push({ ids, owner: currentOwnerId() });
        return linkedAnswer;
      },
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
    captureFeedback: (params: unknown) => {
      sentryCaptures.push(params);
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
    /** The request line's path, query included. */
    path?: string;
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
      url: options.path ?? "/api/feedback",
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
      responseEnded = true;
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
    url: "https://www.spideryarn.com/read/an-article?q=footnotes",
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
  /* 99% of the cap, in rows of 4,001 bytes. Derived rather than written down:
     it was a literal 95 for a 400,000 cap, and when the cap went to two
     megabytes on 2026-10-03 the "largest" picture would have gone on being
     380 KB and this helper's name would have gone on saying otherwise. */
  const height = Math.floor((MAX_FEEDBACK_SCREENSHOT_BYTES * 0.99) / (width * 4 + 1));
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

/** The inflated raster of a PNG that has exactly one `IDAT`, straight after `IHDR`. */
function pixelsOf(png: Buffer): Buffer {
  /* 8 of signature, 25 of IHDR, 8 of IDAT length and type; then 4 of IDAT CRC
     and 12 of IEND at the far end. */
  return inflateSync(png.subarray(41, png.length - 16));
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
  listed = [];
  listFilters = [];
  listOwners = [];
  listAnswer = { reports: [], more: false };
  counted = [];
  countAnswer = { all: 0, in: 0 };
  statusListed = [];
  statusAnswer = { reports: [], more: false, counts: { open: 0, waiting: 0, aside: 0, shipped: 0 } };
  answersSubmitted = [];
  answerOutcome = null;
  newestAsked = [];
  newestAnswer = [];
  linkedAsked = [];
  linkedAnswer = [];
  deferralsAnswer = [];
  deferralsSet = [];
  hooks.clear();
  answer = undefined as unknown as FeedbackSubmission;
  captureBehaviour = () => "sentry-event-id";
  sendResponse = { statusCode: 200 };
  notices = [];
  noticedReports = [];
  sentryCaptures = [];
  responseEnded = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * **The Earlier tab's read** — the reader's own reports, and only six fields
 * of each from the store. docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * The fake store hands back rows carrying *more* than the six — an email, an
 * address, diagnostics — which is what makes "the route picks, it does not
 * spread" a thing this file can see rather than a thing the store happens to do.
 */
describe("GET /api/feedback", () => {
  it("answers the reader's own list, seven fields a report, and never caches it", async () => {
    listAnswer = {
      reports: [
        {
          id: "spya-k3m9qt",
          createdAt: "2026-09-12T10:45:00.000Z",
          kind: "suggestion",
          body: "A tab of what I sent before",
          page: "/add",
          at: "spya-tgnssb",
          reporterEmail: "someone@example.invalid",
          url: "https://www.spideryarn.com/add/https://user:secret@example.com/",
          diagnostics: { version: 2, payload: {} },
        },
      ],
      more: true,
    };
    countAnswer = { all: 115, in: 70 };
    const reply = await call(undefined, { method: "GET" });
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.body).toEqual({
      reports: [
        {
          id: "spya-k3m9qt",
          createdAt: "2026-09-12T10:45:00.000Z",
          kind: "suggestion",
          body: "A tab of what I sent before",
          /* The store's label, passed on. The `url` beside it in the row is not. */
          page: "/add",
          /* And the paragraph beside it, passed on the same way (261006b). */
          at: "spya-tgnssb",
          shipped: true,
        },
      ],
      more: true,
      counts: { all: 115, shipped: 70, unshipped: 45 },
    });
    /* The cap is the server's, not a query parameter somebody can raise. */
    expect(listed).toEqual([EARLIER_FEEDBACK_LIMIT]);
    expect(listOwners).toEqual([TEST_OWNER]);
  });

  /* Fifty reports at the 20,000-character cap, each character a control
     character that JSON escapes to six bytes, are 6 MB — past the 4.5 MB a
     Vercel response may be. The list is cut to a prefix that fits and says
     there are more; no report is shortened. Plan 261007j, GPT Sol's review. */
  it("cuts the list to what fits a response, whole reports only, and says there are more", async () => {
    const heavy = "\u0001".repeat(MAX_FEEDBACK_ANSWER_CHARS);
    const rows = Array.from({ length: EARLIER_FEEDBACK_LIMIT }, (_, i) => ({
      id: `spya-hvy${String(i).padStart(3, "0")}`,
      createdAt: "2026-09-12T10:45:00.000Z",
      kind: null,
      body: heavy,
      page: null,
      at: null,
    }));
    listAnswer = { reports: rows, more: false };
    countAnswer = { all: EARLIER_FEEDBACK_LIMIT, in: 0 };
    const reply = await call(undefined, { method: "GET" });
    expect(reply.status).toBe(200);
    const sent = reply.body as { reports: { id: string; body: string }[]; more: boolean };
    expect(Buffer.byteLength(JSON.stringify(reply.body))).toBeLessThan(FEEDBACK_LIST_BYTES + 4 * 1024);
    expect(sent.reports.length).toBeGreaterThan(0);
    expect(sent.reports.length).toBeLessThan(EARLIER_FEEDBACK_LIMIT);
    expect(sent.reports.map((r) => r.id)).toEqual(
      rows.slice(0, sent.reports.length).map((r) => r.id),
    );
    expect(sent.reports.every((r) => r.body === heavy)).toBe(true);
    expect(sent.more).toBe(true);
  });

  it("says shipped only for a report whose note says shipped — not declined, not waiting, not unknown", async () => {
    const row = (id: string) => ({ id, createdAt: "2026-09-12T10:45:00.000Z", kind: null, body: "x", page: null, at: null });
    listAnswer = {
      reports: [row("spya-k3m9qt"), row("spya-dec1ne"), row("spya-wa1t00"), row("spya-unkn0w")],
      more: false,
    };
    const reply = await call(undefined, { method: "GET" });
    const reports = (reply.body as { reports: { id: string; shipped: boolean }[] }).reports;
    expect(reports.map((r) => [r.id, r.shipped])).toEqual([
      ["spya-k3m9qt", true],
      ["spya-dec1ne", false],
      ["spya-wa1t00", false],
      ["spya-unkn0w", false],
    ]);
    expect(listFilters, "no ?show= is the whole list").toEqual([undefined]);
  });

  it("narrows by the shipped ids in the query, in for shipped and out for unshipped", async () => {
    expect((await call(undefined, { method: "GET", path: "/api/feedback?show=shipped" })).status).toBe(200);
    expect((await call(undefined, { method: "GET", path: "/api/feedback?show=unshipped" })).status).toBe(
      200,
    );
    expect((await call(undefined, { method: "GET", path: "/api/feedback?show=all" })).status).toBe(200);
    const shipped = ["spya-k3m9qt", "spya-sh1pd2"];
    expect(listFilters).toEqual([{ ids: shipped, keep: "in" }, { ids: shipped, keep: "out" }, undefined]);
    expect(listed, "the cap applies within a filter too").toEqual([
      EARLIER_FEEDBACK_LIMIT,
      EARLIER_FEEDBACK_LIMIT,
      EARLIER_FEEDBACK_LIMIT,
    ]);
    expect(listOwners).toEqual([TEST_OWNER, TEST_OWNER, TEST_OWNER]);
  });

  it("counts every filter on every answer, by the same shipped ids the filter uses", async () => {
    countAnswer = { all: 9, in: 4 };
    for (const show of ["shipped", "unshipped", "all"]) {
      const reply = await call(undefined, { method: "GET", path: `/api/feedback?show=${show}` });
      expect((reply.body as { counts: unknown }).counts, show).toEqual({ all: 9, shipped: 4, unshipped: 5 });
    }
    const shipped = ["spya-k3m9qt", "spya-sh1pd2"];
    expect(counted).toEqual([
      { ids: shipped, owner: TEST_OWNER },
      { ids: shipped, owner: TEST_OWNER },
      { ids: shipped, owner: TEST_OWNER },
    ]);
  });

  it("refuses a show it does not know, rather than passing the whole list off as filtered", async () => {
    const reply = await call(undefined, { method: "GET", path: "/api/feedback?show=done" });
    expect(reply.status).toBe(400);
    expect(listed).toEqual([]);
  });

  it("sets no-store before awaiting the store, so a failed read is private too", async () => {
    listAnswer = new Error("the feedback read failed");
    const reply = await call(undefined, { method: "GET" });
    expect(reply.status).toBe(500);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
  });

  it("does not read a request body or fall through to the POST on the shared path", async () => {
    const reply = await call(undefined, {
      method: "GET",
      raw: Buffer.from("{not json", "utf8"),
    });
    expect(reply.status).toBe(200);
    expect(listed).toEqual([EARLIER_FEEDBACK_LIMIT]);
    expect(submitted).toEqual([]);
  });

  it("ignores a limit in the query", async () => {
    await call(undefined, { method: "GET", path: "/api/feedback?limit=100000" });
    expect(listed).toEqual([EARLIER_FEEDBACK_LIMIT]);
  });

  it("refuses an anonymous request before it reads anything", async () => {
    const reply = await call(undefined, { method: "GET", headers: {} });
    expect(reply.status).toBe(401);
    expect(listed).toEqual([]);
    /* The positive control, for the reason the POST's twin below gives: a 401
       alone would pass with no route at all. Signed in, the same request reads. */
    expect((await call(undefined, { method: "GET" })).status).toBe(200);
    expect(listed).toEqual([EARLIER_FEEDBACK_LIMIT]);
  });
});

/**
 * `GET /api/admin/feedback/earlier` — an admin's own list, with what became of
 * each report. docs/plans/261007d-…. `acceptAny` signs in as the local
 * administrator, which is why every test above this one already passes the
 * namespace gate without knowing it.
 */
describe("GET /api/admin/feedback/earlier", () => {
  const PATH = "/api/admin/feedback/earlier";
  const get = (path = PATH, verify?: Parameters<typeof handleApi>[2]) =>
    call(undefined, { method: "GET", path, ...(verify ? { verify } : {}) });
  const acceptSomebodyElse: Parameters<typeof handleApi>[2] = async () => ({
    ok: true,
    claims: {
      sub: "0000f5e1-0000-4000-8000-00000000beef",
      email: "somebody-else@example.test",
      role: "authenticated",
      is_anonymous: false,
    },
  });
  const row = (id: string, number: number, status: string, over: object = {}) => ({
    id,
    createdAt: "2026-09-12T10:45:00.000Z",
    kind: null,
    body: "x",
    page: null,
    at: null,
    number,
    status,
    ignoredAt: null,
    ...over,
  });

  /* The same budget as the reader's list: fifty at the cap in control
     characters are 6 MB, so whole reports as many as fit, and `more`. 261007j. */
  it("cuts the list to what fits a response, whole reports only, and says there are more", async () => {
    const heavy = "\u0001".repeat(MAX_FEEDBACK_ANSWER_CHARS);
    const rows = Array.from({ length: EARLIER_FEEDBACK_LIMIT }, (_, i) =>
      row(`spya-hvy${String(i).padStart(3, "0")}`, 300 - i, "open", { body: heavy }),
    );
    statusAnswer = {
      reports: rows,
      more: false,
      counts: { open: EARLIER_FEEDBACK_LIMIT, waiting: 0, aside: 0, shipped: 0 },
    };
    const reply = await get();
    expect(reply.status).toBe(200);
    const sent = reply.body as { reports: { id: string; body: string }[]; more: boolean };
    expect(sent.reports.length).toBeGreaterThan(0);
    expect(sent.reports.length).toBeLessThan(EARLIER_FEEDBACK_LIMIT);
    expect(sent.reports.map((r) => r.id)).toEqual(rows.slice(0, sent.reports.length).map((r) => r.id));
    expect(sent.reports.every((r) => r.body === heavy)).toBe(true);
    expect(sent.more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(sent.reports))).toBeLessThanOrEqual(FEEDBACK_LIST_BYTES);
  });

  it("answers the admin's own list: ten fields a report, the comment from the note, never cached", async () => {
    statusAnswer = {
      reports: [
        {
          ...row("spya-dec1ne", 212, "aside", { kind: "suggestion", body: "Could it do this?", page: "/add", at: "spya-tgnssb" }),
          /* What a store that one day hands back more must not get through. */
          reporterEmail: "someone@example.invalid",
          url: "https://www.spideryarn.com/add/https://user:secret@example.com/",
        },
        row("spya-k3m9qt", 211, "shipped"),
        row("spya-unkn0w", 210, "aside", { ignoredAt: "2026-10-05T09:00:00.000Z" }),
      ],
      more: true,
      counts: { open: 3, waiting: 2, aside: 5, shipped: 60 },
    };
    const reply = await get();
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.body).toEqual({
      reports: [
        {
          id: "spya-dec1ne",
          createdAt: "2026-09-12T10:45:00.000Z",
          kind: "suggestion",
          body: "Could it do this?",
          page: "/add",
          at: "spya-tgnssb",
          number: 212,
          status: "aside",
          comment: "Set aside: the browser gives us no way to do this.",
          ignoredAt: null,
        },
        { ...row("spya-k3m9qt", 211, "shipped"), comment: null },
        { ...row("spya-unkn0w", 210, "aside", { ignoredAt: "2026-10-05T09:00:00.000Z" }), comment: null },
      ],
      more: true,
      /* Report counts, and the four sum to All. */
      counts: { all: 70, open: 3, waiting: 2, aside: 5, shipped: 60 },
      questions: expect.any(Array),
    });
    expect(JSON.stringify(reply.body)).not.toContain("somebody else's report");
    expect(statusListed).toEqual([
      {
        limit: EARLIER_FEEDBACK_LIMIT,
        endings: {
          shipped: ["spya-k3m9qt", "spya-sh1pd2"],
          declined: ["spya-dec1ne"],
          awaiting: ["spya-wa1t00"],
        },
        show: "all",
        owner: TEST_OWNER,
      },
    ]);
    expect(listed, "the plain list is not read as well").toEqual([]);
  });

  it("hands each ?show= to the store, so the cap applies after the filter", async () => {
    for (const show of ["all", "open", "waiting", "aside", "shipped"]) {
      expect((await get(`${PATH}?show=${show}`)).status, show).toBe(200);
    }
    expect(statusListed.map((one) => one.show)).toEqual(["all", "open", "waiting", "aside", "shipped"]);
    expect(statusListed.every((one) => one.limit === EARLIER_FEEDBACK_LIMIT && one.owner === TEST_OWNER)).toBe(true);
  });

  it("refuses a show it does not know, the plain tab's `unshipped` included, and a limit changes nothing", async () => {
    expect((await get(`${PATH}?show=unshipped`)).status).toBe(400);
    expect((await get(`${PATH}?show=done`)).status).toBe(400);
    expect(statusListed).toEqual([]);
    await get(`${PATH}?limit=100000`);
    expect(statusListed.map((one) => one.limit)).toEqual([EARLIER_FEEDBACK_LIMIT]);
  });

  it("is a 403 for a signed-in reader who is not an admin, and reaches no store", async () => {
    const reply = await get(PATH, acceptSomebodyElse);
    expect(reply.status).toBe(403);
    expect(statusListed).toEqual([]);
    expect(listed).toEqual([]);
    /* The positive control: the same request as the admin reads. */
    expect((await get()).status).toBe(200);
    expect(statusListed).toHaveLength(1);
  });

  it("is a 401 signed out, and private when the read fails", async () => {
    expect((await call(undefined, { method: "GET", path: PATH, headers: {} })).status).toBe(401);
    expect(statusListed).toEqual([]);
    statusAnswer = new Error("the feedback read failed");
    const reply = await get();
    expect(reply.status).toBe(500);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
  });

  it("is not the one-report route: `earlier` alone is one segment, and that route takes two", async () => {
    /* `/api/admin/feedback/<owner>/<id>` would answer 400 "ownerId must be a uuid". */
    const reply = await get();
    expect(reply.status).toBe(200);
    expect(reply.body).toHaveProperty("counts");
  });

  it("leaves the plain route as it was for the same admin: seven fields, three counts", async () => {
    listAnswer = {
      reports: [{ id: "spya-dec1ne", createdAt: "2026-09-12T10:45:00.000Z", kind: null, body: "x", page: null, at: null }],
      more: false,
    };
    countAnswer = { all: 1, in: 0 };
    const reply = await call(undefined, { method: "GET" });
    expect(reply.body).toEqual({
      reports: [
        { id: "spya-dec1ne", createdAt: "2026-09-12T10:45:00.000Z", kind: null, body: "x", page: null, at: null, shipped: false },
      ],
      more: false,
      counts: { all: 1, shipped: 0, unshipped: 1 },
    });
    expect(statusListed).toEqual([]);
  });
});

/**
 * **The questions an agent has put to the admin**, sent with every answer of
 * `GET /api/admin/feedback/earlier`, and `POST /api/admin/feedback/answers`,
 * which stores a reply. 261007d stage 2.
 */
describe("questions for the admin, and replies to them", () => {
  const EARLIER = "/api/admin/feedback/earlier";
  const ANSWERS = "/api/admin/feedback/answers";
  const get = (path = EARLIER, verify?: Parameters<typeof handleApi>[2]) =>
    call(undefined, { method: "GET", path, ...(verify ? { verify } : {}) });
  const post = (body: unknown, verify?: Parameters<typeof handleApi>[2]) =>
    call(body, { method: "POST", path: ANSWERS, ...(verify ? { verify } : {}) });
  const acceptSomebodyElse: Parameters<typeof handleApi>[2] = async () => ({
    ok: true,
    claims: {
      sub: "0000f5e1-0000-4000-8000-00000000beef",
      email: "somebody-else@example.test",
      role: "authenticated",
      is_anonymous: false,
    },
  });
  type Sent = { questions: Record<string, unknown>[] };

  const THREADS = `${EARLIER}?questions=2`;

  /* Plan 261008i: a client that asks `questions=2` gets threads. */
  it("sends threads to a client that asks: unacted replies, the state, the report's text", async () => {
    linkedAnswer = [{ id: "spya-wa1t00", number: 212, firstLine: "Could there be one switch?", body: "Could there be one switch?\nOr two." }];
    newestAnswer = [
      /* Acted on (the mock's `acted` names it), so not listed, though it still counts for the state. */
      { id: "spya-act3d0", questionId: "q-bbbbbb", body: "First go", createdAt: "2026-10-07T07:00:00.000Z" },
      { id: "spya-repzyy", questionId: "q-bbbbbb", body: "Yes, do it", createdAt: "2026-10-07T08:00:00.000Z" },
    ];
    /* q-cccccc deferred, and q-bbbbbb deferred before its newest reply, which wins (F2). */
    deferralsAnswer = [
      { questionId: "q-cccccc", deferredAt: "2026-10-07T09:00:00.000Z", updatedAt: "2026-10-07T09:00:00.000Z" },
      { questionId: "q-bbbbbb", deferredAt: "2026-10-07T07:30:00.000Z", updatedAt: "2026-10-07T07:30:00.000Z" },
    ];
    const reply = await get(THREADS);
    expect(reply.status).toBe(200);
    expect((reply.body as Sent).questions).toEqual([
      {
        id: "q-aaaaaa",
        title: "One switch or two?",
        body: "Background.\n\nA. One.\nB. Two.",
        asked: "2026-10-05",
        report: { id: "spya-wa1t00", number: 212, firstLine: "Could there be one switch?", body: "Could there be one switch?\nOr two." },
        answers: [],
        olderAnswers: 0,
        state: "waiting",
        deferredAt: null,
      },
      {
        id: "q-bbbbbb",
        title: "A question about nothing filed",
        body: "Stands alone.",
        asked: "2026-10-06",
        report: null,
        answers: [{ id: "spya-repzyy", body: "Yes, do it", createdAt: "2026-10-07T08:00:00.000Z" }],
        olderAnswers: 0,
        state: "responded",
        deferredAt: null,
      },
      {
        id: "q-cccccc",
        title: "About a reader's report",
        body: "The body says it all.",
        asked: "2026-10-07",
        report: null,
        answers: [],
        olderAnswers: 0,
        state: "deferred",
        deferredAt: "2026-10-07T09:00:00.000Z",
      },
    ]);
  });

  /* Plan 261010h (spya-j4sg9g): a client that asks `questions=3` also gets
     the replies an agent has acted on, so a thread answered and asked again
     does not look like one never answered. Shape 2 stays exactly as it was. */
  it("sends acted replies apart to a client that asks for shape 3, and shape 2 without them", async () => {
    newestAnswer = [
      { id: "spya-act3d0", questionId: "q-bbbbbb", body: "First go", createdAt: "2026-10-07T07:00:00.000Z" },
      { id: "spya-repzyy", questionId: "q-bbbbbb", body: "Yes, do it", createdAt: "2026-10-07T08:00:00.000Z" },
    ];
    const three = ((await get(`${EARLIER}?questions=3`)).body as Sent).questions;
    const b3 = three.find((one) => one.id === "q-bbbbbb");
    expect(b3?.actedAnswers).toEqual([{ id: "spya-act3d0", body: "First go", createdAt: "2026-10-07T07:00:00.000Z" }]);
    expect(b3?.olderActedAnswers).toBe(0);
    expect(b3?.answers).toEqual([{ id: "spya-repzyy", body: "Yes, do it", createdAt: "2026-10-07T08:00:00.000Z" }]);
    expect(three.find((one) => one.id === "q-aaaaaa")?.actedAnswers).toEqual([]);
    const two = ((await get(THREADS)).body as Sent).questions;
    expect(Object.keys(two[1] ?? {}).sort()).toEqual([
      "answers", "asked", "body", "deferredAt", "id", "olderAnswers", "report", "state", "title",
    ]);
  });

  it("sends at most five unacted replies a thread, the newest, and counts the rest (F12)", async () => {
    newestAnswer = Array.from({ length: 7 }, (_, i) => ({
      id: `spya-rep00${i}`,
      questionId: "q-aaaaaa",
      body: `reply ${i}`,
      createdAt: `2026-10-07T0${i}:00:00.000Z`,
    }));
    const [first] = ((await get(THREADS)).body as Sent).questions;
    expect(((first?.answers ?? []) as { body: string }[]).map((one) => one.body)).toEqual([
      "reply 2",
      "reply 3",
      "reply 4",
      "reply 5",
      "reply 6",
    ]);
    expect(first?.olderAnswers).toBe(2);
  });

  it("sends at most five acted replies a thread, the newest in oldest-first order, and counts the rest", async () => {
    newestAnswer = Array.from({ length: 7 }, (_, i) => ({
      id: `spya-act3d${i}`,
      questionId: "q-bbbbbb",
      body: `acted reply ${i}`,
      createdAt: `2026-10-07T0${i}:00:00.000Z`,
    }));
    const questions = ((await get(`${EARLIER}?questions=3`)).body as Sent).questions;
    const acted = questions.find((one) => one.id === "q-bbbbbb");
    expect(((acted?.actedAnswers ?? []) as { body: string }[]).map((one) => one.body)).toEqual([
      "acted reply 2",
      "acted reply 3",
      "acted reply 4",
      "acted reply 5",
      "acted reply 6",
    ]);
    expect(acted?.olderActedAnswers).toBe(2);
    expect(acted?.answers).toEqual([]);
  });

  it("sends every open question, oldest first, with the admin's own report and newest reply", async () => {
    linkedAnswer = [{ id: "spya-wa1t00", number: 212, firstLine: "Could there be one switch?", body: "Could there be one switch?" }];
    newestAnswer = [
      { id: "spya-older0", questionId: "q-bbbbbb", body: "first", createdAt: "2026-10-07T07:00:00.000Z" },
      { id: "spya-repzyy", questionId: "q-bbbbbb", body: "Yes, do it", createdAt: "2026-10-07T08:00:00.000Z" },
    ];
    /* No `questions=2`: a tab from before 261008i, which must keep working
       after the deploy, gets the six-key shape it was built against (F3). */
    const reply = await get();
    expect(reply.status).toBe(200);
    expect((reply.body as Sent).questions).toEqual([
      {
        id: "q-aaaaaa",
        title: "One switch or two?",
        body: "Background.\n\nA. One.\nB. Two.",
        asked: "2026-10-05",
        report: { id: "spya-wa1t00", number: 212, firstLine: "Could there be one switch?" },
        answer: null,
      },
      {
        id: "q-bbbbbb",
        title: "A question about nothing filed",
        body: "Stands alone.",
        asked: "2026-10-06",
        report: null,
        answer: { id: "spya-repzyy", body: "Yes, do it", createdAt: "2026-10-07T08:00:00.000Z" },
      },
      /* Its report is not this admin's, so the store found none: nothing of it is sent. */
      { id: "q-cccccc", title: "About a reader's report", body: "The body says it all.", asked: "2026-10-07", report: null, answer: null },
    ]);
    /* Both lookups ran as the signed-in admin, for the open questions only. */
    expect(newestAsked).toEqual([{ ids: ["q-aaaaaa", "q-bbbbbb", "q-cccccc"], owner: TEST_OWNER }]);
    expect(linkedAsked).toEqual([{ ids: ["spya-wa1t00", "spya-n0tm1n"], owner: TEST_OWNER }]);
  });

  it("never sends an answered question, whatever the store says about it", async () => {
    /* A store that handed back a reply to the answered one must not bring it in. */
    newestAnswer = [{ id: "spya-repzyy", questionId: "q-dddddd", body: "late", createdAt: "2026-10-07T08:00:00.000Z" }];
    const sent = (await get()).body as Sent;
    expect(sent.questions.map((question) => question.id)).toEqual(["q-aaaaaa", "q-bbbbbb", "q-cccccc"]);
    expect(JSON.stringify(sent)).not.toContain("q-dddddd");
    expect(newestAsked[0]?.ids).not.toContain("q-dddddd");
  });

  it("sends the same questions under every show, and exactly six fields of each", async () => {
    for (const show of ["all", "open", "waiting", "aside", "shipped"]) {
      const sent = (await get(`${EARLIER}?show=${show}`)).body as Sent;
      expect(sent.questions.map((question) => question.id), show).toEqual(["q-aaaaaa", "q-bbbbbb", "q-cccccc"]);
      for (const question of sent.questions) {
        expect(Object.keys(question).sort()).toEqual(["answer", "asked", "body", "id", "report", "title"]);
      }
    }
  });

  it("does not let a linked report from the store name a question that did not ask for it", async () => {
    /* The store is asked for two ids; one it should never return is ignored. */
    linkedAnswer = [{ id: "spya-0ther0", number: 9, firstLine: "unrelated", body: "unrelated" }];
    const sent = (await get()).body as Sent;
    expect(sent.questions.every((question) => question.report === null)).toBe(true);
    const threads = (await get(THREADS)).body as Sent;
    expect(threads.questions.every((question) => question.report === null)).toBe(true);
  });

  /* Defer for now, and Bring back: plan 261008i, decision 3. */
  describe("POST /api/admin/feedback/deferrals", () => {
    const DEFERRALS = "/api/admin/feedback/deferrals";
    const defer = (body: unknown, verify?: Parameters<typeof handleApi>[2]) =>
      call(body, { method: "POST", path: DEFERRALS, ...(verify ? { verify } : {}) });

    it("defers and brings back: 200, the deferral as it stands, the server's environment, the owner", async () => {
      const on = await defer({ question: "q-aaaaaa", deferred: true });
      expect(on.status).toBe(200);
      expect(on.headers["cache-control"]).toBe("private, no-store");
      expect(on.body).toEqual({ question: "q-aaaaaa", deferredAt: "2026-10-08T10:00:00.000Z" });
      const off = await defer({ question: "q-aaaaaa", deferred: false });
      expect(off.body).toEqual({ question: "q-aaaaaa", deferredAt: null });
      expect(deferralsSet).toEqual([
        { input: { questionId: "q-aaaaaa", deferred: true, environment: "test" }, owner: TEST_OWNER },
        { input: { questionId: "q-aaaaaa", deferred: false, environment: "test" }, owner: TEST_OWNER },
      ]);
    });

    it("refuses an answered question with a 409 and writes nothing: a late deferral preserves nothing (F6)", async () => {
      const late = await defer({ question: "q-dddddd", deferred: true });
      expect(late.status).toBe(409);
      expect(deferralsSet).toEqual([]);
    });

    it("refuses an unknown question, a field it does not take, and a deferred that is not a boolean", async () => {
      const SECRET = "thaumaturgical";
      expect((await defer({ question: "q-zzzzzz", deferred: true })).status).toBe(400);
      expect((await defer({ question: "constructor", deferred: true })).status).toBe(400);
      expect((await defer({ question: "q-aaaaaa", deferred: "yes" })).status).toBe(400);
      expect((await defer({ question: "q-aaaaaa" })).status).toBe(400);
      expect((await defer([{ question: "q-aaaaaa", deferred: true }])).status).toBe(400);
      for (const extra of [{ environment: "production" }, { deferredAt: "2020-01-01" }, { [SECRET]: 1 }]) {
        const reply = await defer({ question: "q-aaaaaa", deferred: true, ...extra });
        expect(reply.status).toBe(400);
        expect(JSON.stringify(reply.body)).not.toContain(SECRET);
      }
      expect(deferralsSet).toEqual([]);
    });

    it("is a 403 for a signed-in reader who is not an admin, and reaches no store", async () => {
      expect((await defer({ question: "q-aaaaaa", deferred: true }, acceptSomebodyElse)).status).toBe(403);
      expect(deferralsSet).toEqual([]);
    });
  });

  it("stores a reply: 201, the server's own environment, the signed-in owner, never cached", async () => {
    const reply = await post({ id: "spya-repzyy", question: "q-aaaaaa", body: "  1A, please  " });
    expect(reply.status).toBe(201);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.body).toEqual({ answer: { id: "spya-repzyy", body: "1A, please", createdAt: "2026-10-07T09:00:00.000Z" } });
    expect(answersSubmitted).toEqual([
      {
        input: { id: "spya-repzyy", questionId: "q-aaaaaa", body: "1A, please", environment: "test" },
        owner: TEST_OWNER,
      },
    ]);
    /* A reply is not a report: nothing is filed, mirrored or mailed. */
    expect(submitted).toEqual([]);
    expect(attempted).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("answers a retry of the same reply 200 with the stored row, and a reused id 409 (F15)", async () => {
    const body = { id: "spya-repzyy", question: "q-aaaaaa", body: "1A" };
    answerOutcome = {
      kind: "duplicate",
      answer: { id: "spya-repzyy", questionId: "q-aaaaaa", body: "1A", createdAt: "2026-10-07T08:59:00.000Z" },
    };
    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ answer: { id: "spya-repzyy", body: "1A", createdAt: "2026-10-07T08:59:00.000Z" } });

    answerOutcome = { kind: "conflict" };
    const reused = await post({ ...body, body: "2B" });
    expect(reused.status).toBe(409);
    expect(reused.body).not.toHaveProperty("answer");
    expect(JSON.stringify(reused.body)).not.toContain("2B");
  });

  it("accepts a reply to a question already marked answered: a late reply is not lost (F14)", async () => {
    const reply = await post({ id: "spya-repzyy", question: "q-dddddd", body: "I had more to say" });
    expect(reply.status).toBe(201);
    expect(answersSubmitted.map((one) => one.input.questionId)).toEqual(["q-dddddd"]);
  });

  it("refuses a question this build has no file for, and reaches no store", async () => {
    const reply = await post({ id: "spya-repzyy", question: "q-zzzzzz", body: "1A" });
    expect(reply.status).toBe(400);
    expect(await post({ id: "spya-repzyy", question: "constructor", body: "1A" })).toMatchObject({ status: 400 });
    expect(await post({ id: "spya-repzyy", question: "spya-wa1t00", body: "1A" })).toMatchObject({ status: 400 });
    expect(answersSubmitted).toEqual([]);
  });

  it("refuses a body with any field but the three, in fixed prose", async () => {
    const SECRET = "thaumaturgical";
    for (const extra of [{ environment: "production" }, { ownerId: TEST_OWNER }, { [SECRET]: 1 }, { createdAt: "2020-01-01" }]) {
      const reply = await post({ id: "spya-repzyy", question: "q-aaaaaa", body: "1A", ...extra });
      expect(reply.status).toBe(400);
      expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    }
    expect(answersSubmitted).toEqual([]);
  });

  it("refuses a bad id, an empty reply, a reply over the cap, and a body that is not an object", async () => {
    const good = { id: "spya-repzyy", question: "q-aaaaaa", body: "1A" };
    expect((await post({ ...good, id: "212" })).status).toBe(400);
    expect((await post({ ...good, id: undefined })).status).toBe(400);
    expect((await post({ ...good, body: "   " })).status).toBe(400);
    expect((await post({ ...good, body: 7 })).status).toBe(400);
    expect((await post({ ...good, body: "x".repeat(MAX_FEEDBACK_ANSWER_CHARS + 1) })).status).toBe(400);
    expect((await post([good])).status).toBe(400);
    expect(answersSubmitted).toEqual([]);
    /* The positive control: exactly the cap is stored. */
    expect((await post({ ...good, body: "x".repeat(MAX_FEEDBACK_ANSWER_CHARS) })).status).toBe(201);
    /* And a cap's worth of four-byte characters still fits the request limit. */
    expect((await post({ ...good, body: "é".repeat(MAX_FEEDBACK_ANSWER_CHARS) })).status).toBe(201);
  });

  it("is a 403 for a signed-in reader who is not an admin, on both routes, and reaches no store", async () => {
    const reply = await post({ id: "spya-repzyy", question: "q-aaaaaa", body: "1A" }, acceptSomebodyElse);
    expect(reply.status).toBe(403);
    expect((await get(EARLIER, acceptSomebodyElse)).status).toBe(403);
    expect(answersSubmitted).toEqual([]);
    expect(newestAsked).toEqual([]);
    expect(linkedAsked).toEqual([]);
    /* Signed out: 401. */
    expect((await call({ id: "spya-repzyy", question: "q-aaaaaa", body: "1A" }, { method: "POST", path: ANSWERS, headers: {} })).status).toBe(401);
  });

  it("logs the reply's length, never its words", async () => {
    const logged = await logLinesWhile(async () => {
      await post({ id: "spya-repzyy", question: "q-aaaaaa", body: "a thaumaturgical decision" });
    });
    expect(logged).toContain("spya-repzyy");
    expect(logged).not.toContain("thaumaturgical");
  });
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
      url: "https://www.spideryarn.com/read/an-article?q=footnotes",
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
    expect(notices).toEqual([]);
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
    expect(notices).toEqual([]);
  });

  it("answers 413 for a body past its own limit", async () => {
    /* Four megabytes, which is past the feedback route's limit (a little under
       three, since the screenshot cap went to two) and far past the shared
       one. Raw, because the point is the byte count. */
    const raw = Buffer.alloc(4 * 1024 * 1024, "x");
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
  /* Six bytes per unit once escaped, at the cap, in both shapes the route
     takes: the one box (20,000 since plan 261007j, now the larger) and a stale
     client's three answers (4,000 each). The outer limit has to clear whichever
     is bigger, and a cap that moves should not leave the other untested. */
  it.each([
    ["the one box", { body: "\u0001".repeat(MAX_FEEDBACK_ANSWER_CHARS) }],
    [
      "an old client's three answers",
      {
        steps: "\u0001".repeat(MAX_LEGACY_FEEDBACK_ANSWER_CHARS),
        expected: "\u0002".repeat(MAX_LEGACY_FEEDBACK_ANSWER_CHARS),
        actual: "\u0003".repeat(MAX_LEGACY_FEEDBACK_ANSWER_CHARS),
        body: undefined,
      },
    ],
  ])("takes the largest report the validator accepts, as %s", async (_shape, answers) => {
    const body = minimal({
      consented: true,
      ...answers,
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
    expect(bytes).toBeGreaterThan(2_700_000);
    const reply = await call(body);
    expect(reply.status).toBe(201);
    expect(submitted).toHaveLength(1);
  });

  /**
   * **A real picture at the ceiling, through the route and into the store.**
   *
   * The test above is about the *body*; this one is about the picture. When the
   * cap went from 400,000 to two megabytes, 2026-10-03, nothing here decoded a
   * PNG anywhere near the new number, and the server's re-encode had only ever
   * been run on rasters a fifth the size (GPT Sol's review of 261003k, F1 and
   * F2). So: incompressible pixels, 99% of the cap, taken apart and written
   * again, and what reaches the store is still that picture.
   */
  it("takes a real screenshot just under the cap, and stores it rebuilt", async () => {
    const png = bigPng();
    expect(png.length).toBeGreaterThan(MAX_FEEDBACK_SCREENSHOT_BYTES * 0.98);
    expect(png.length).toBeLessThanOrEqual(MAX_FEEDBACK_SCREENSHOT_BYTES);

    const reply = await call(minimal({ screenshot: png.toString("base64") }));
    expect(reply.status).toBe(201);
    const stored = Buffer.from(submitted[0]!.screenshot!);
    expect(stored.length).toBeGreaterThan(MAX_FEEDBACK_SCREENSHOT_BYTES * 0.98);
    expect(stored.length).toBeLessThanOrEqual(MAX_FEEDBACK_SCREENSHOT_BYTES);
    /* Same header and inflated pixels: dimensions and byte count alone would
       let a different raster of similar compressed size pass. */
    expect(stored.subarray(0, 33).equals(png.subarray(0, 33))).toBe(true);
    expect(pixelsOf(stored).equals(pixelsOf(png))).toBe(true);
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

  /* Fifteen minutes of dictation is about 13,000 characters at an even pace and
     15,108 in 261007b's non-stop soak, and the box used to stop taking them at
     4,000 — Greg, spya-n8cuqq, was cut off in this box. 12,000 from plan 261007b,
     20,000 from 261007j, which widened the database's CHECK to match. */
  it("takes a report as long as a fifteen-minute dictation", async () => {
    expect(MAX_FEEDBACK_ANSWER_CHARS).toBe(20_000);
    expect(MAX_FEEDBACK_ANSWER_CHARS).toBeLessThanOrEqual(MAX_FEEDBACK_BODY_CHARS);
    const reply = await call(minimal({ body: "x".repeat(MAX_FEEDBACK_ANSWER_CHARS) }));
    expect(reply.status).toBe(201);
    expect(submitted).toHaveLength(1);
  });

  /* A stale client's three answers are glued into one `body`. Each kept its old
     4,000 cap when the single box's went up, because three at the new one would
     pass this route, fail the column's CHECK, and reach the reader as a database
     error with no sentence. */
  it("holds an old client's three answers to the cap they were written under", async () => {
    const over = await call(
      minimal({ body: undefined, steps: "x".repeat(MAX_LEGACY_FEEDBACK_ANSWER_CHARS + 1) }),
    );
    expect(over.status).toBe(400);
    expect(String(over.body.error)).toMatch(/\[fb-long\]/);
    expect(submitted).toHaveLength(0);

    const full = "x".repeat(MAX_LEGACY_FEEDBACK_ANSWER_CHARS);
    const reply = await call(minimal({ body: undefined, steps: full, expected: full, actual: full }));
    expect(reply.status).toBe(201);
    expect(submitted).toHaveLength(1);
    /* Three full answers under their headings: 12,072, inside the column's cap. */
    expect(submitted[0]?.body.length).toBe(3 * MAX_LEGACY_FEEDBACK_ANSWER_CHARS + 72);
    expect(submitted[0]?.body.length).toBeLessThanOrEqual(MAX_FEEDBACK_BODY_CHARS);
  });

  it("refuses an answer past the cap, and never quotes it back", async () => {
    /* From the cap, so it stays one past it whatever the cap becomes: a fixed
       15,300 characters was over at 12,000 and became legal at 20,000. */
    const sentence = "The unbearable lightness of a very long paragraph. ";
    const prose = sentence.repeat(Math.ceil((MAX_FEEDBACK_ANSWER_CHARS + 1) / sentence.length));
    expect(prose.length).toBeGreaterThan(MAX_FEEDBACK_ANSWER_CHARS);
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

  /**
   * **What replaced the closed vocabulary**, 2026-09-02. `route_kind` was ten
   * route names and a CHECK; it is now the address, and `isWebUrl` at the seam
   * is the whole of the validation — src/db/schema.ts § `url`.
   *
   * The case that matters is the first one. This value is rendered by the
   * admin inbox, and `javascript:` in an `href` is the bug the allowlist in
   * src/urls.ts exists to stop; the inbox renders it as text as well, which is
   * belt and braces rather than the rule.
   */
  it("refuses an address that is not http(s)", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "not a url at all"]) {
      const reply = await call(minimal({ url }));
      expect([url, reply.status]).toEqual([url, 400]);
      /* The error never quotes the value back — the same rule every other
         refusal here follows, so a log line cannot become the payload. */
      expect(String(reply.body.error)).not.toContain(url);
    }
  });

  /**
   * **A report filed from a private link does not carry the link's key out.**
   * Plan 261005e, and GPT Sol's F1 on it.
   *
   * The Feedback button records the page's whole address, and on
   * `/read/<slug>?key=…` that address is the credential. Stage 1b removes it in
   * the browser; this is the server's half, for a bundle that does not. The
   * report's address goes to four places, and each is read here: the row, the
   * Sentry event, the admin email, and our own log line.
   *
   * Everything else in the address stays, because where the reader was is the
   * point of recording it.
   */
  it("takes a private link's key off the address before it is stored, mirrored, mailed or logged", async () => {
    const KEY = "AbCdEfGhIjKlMnOpQrStU_";
    const sent = `https://www.spideryarn.com/read/an-article?mode=glossary&key=${KEY}&at=spya-k3m9qt`;
    const kept = "https://www.spideryarn.com/read/an-article?mode=glossary&at=spya-k3m9qt";

    let reply: Reply | undefined;
    const written = await logLinesWhile(async () => {
      reply = await call(minimal({ url: sent }));
      /* The mirror and the notice run after the response; let both finish
         inside the capture. */
      await vi.waitFor(() => {
        expect(sentryCaptures).toHaveLength(1);
        expect(noticedReports).toHaveLength(1);
      });
    });
    expect(reply?.status).toBe(201);

    /* The row. */
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.url).toBe(kept);
    expect(JSON.stringify(submitted[0])).not.toContain(KEY);

    /* The Sentry event: the tag, and nothing else in it either. */
    expect((sentryCaptures[0] as { tags: { url: string } }).tags.url).toBe(kept);
    expect(JSON.stringify(sentryCaptures[0])).not.toContain(KEY);

    /* The admin email, rendered by the real composer from the report the route
       handed the notice. */
    const { feedbackNoticeMessage } =
      await vi.importActual<typeof import("../src/feedback-notice.js")>("../src/feedback-notice.js");
    const mail = feedbackNoticeMessage(noticedReports[0] as FeedbackReport, "reader@example.test");
    expect(JSON.stringify(mail)).toContain(kept);
    expect(JSON.stringify(mail)).not.toContain(KEY);

    /* Our own log. The control first: the accepted line is there, with the
       address in it, so the absence below is about the key. */
    expect(written).toContain("feedback report accepted");
    expect(written).toContain("mode=glossary");
    expect(written).not.toContain(KEY);

    /* And the reply to the reader does not echo it back. */
    expect(JSON.stringify(reply?.body)).not.toContain(KEY);
  });

  /** An address with no key is stored exactly as it was sent, as it always was. */
  it("stores an address without a key byte for byte", async () => {
    const url = "https://www.spideryarn.com/read/an-article?q=the monkey&find=a#spya-k3m9qt";
    expect((await call(minimal({ url }))).status).toBe(201);
    expect(submitted[0]?.url).toBe(url);
  });

  it("refuses an address past the cap, and takes one exactly at it", async () => {
    const pad = (n: number) => `https://www.spideryarn.com/read/a?q=${"x".repeat(n)}`;
    const exact = pad(MAX_FEEDBACK_URL_CHARS - pad(0).length);
    expect(await call(minimal({ url: `${exact}x` })).then((r) => r.status)).toBe(400);
    /* 201, like every other accepted report here — a row was created. */
    expect(await call(minimal({ url: exact })).then((r) => r.status)).toBe(201);
  });

  /**
   * **A bundle loaded before the change still gets its report filed.**
   *
   * The one endpoint where a client and a server disagreeing is likely to be
   * the very thing the reader is trying to report, so an absent `url` is
   * `null` in the row rather than a 400 — the same call
   * `LEGACY_ANSWER_FIELDS` makes for the old three answers. A *present* value
   * that is not an address is still refused, because that can only be a client
   * we wrote getting it wrong.
   */
  it("files a report from an older bundle that sends no url at all", async () => {
    const body = minimal();
    delete body.url;
    const reply = await call(body);
    expect(reply.status).toBe(201);
    expect(submitted[0]).toMatchObject({ url: null, slug: "an-article" });
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
    /* The same picture, not the same file: the server writes its own deflate
       stream, and the fixture's was written at another level (the two differ in
       one byte of zlib header). So the header chunk and the *inflated* pixels
       are compared — this asserted byte equality until the level moved from 9
       to 6 on 2026-10-03, which was true only by coincidence of settings. */
    const stored = Buffer.from(submitted[0]!.screenshot!);
    expect(stored.subarray(0, 33).equals(PNG.subarray(0, 33))).toBe(true);
    expect(pixelsOf(stored).equals(pixelsOf(PNG))).toBe(true);

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
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_FEEDBACK_SCREENSHOT_BYTES + 1)]);
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

  it("tells the admin about a newly created report, after the reader is answered", async () => {
    const body = minimal();
    const reply = await call(body);
    expect(reply.status).toBe(201);
    /* Started beside the Sentry mirror, not behind its acknowledgement. */
    expect(notices).toEqual([
      { id: body.id, ownerId: TEST_OWNER, afterResponse: true, mirroredYet: false },
    ]);
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
