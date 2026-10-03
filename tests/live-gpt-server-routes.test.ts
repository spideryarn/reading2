/** Failure paths through the real route, with stores and OpenAI stubbed. No database. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiCallRow } from "../src/ai-spend.js";
import type { RealtimeSession } from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";

const state = vi.hoisted(() => ({
  session: null as RealtimeSession | null,
  rows: [] as AiCallRow[],
  calls: [] as string[],
  accountingFailures: 0,
  journalFails: false,
  articleFails: false,
}));

vi.mock("../src/arrivals.js", () => ({ noteArrival: async () => undefined }));
vi.mock("../src/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/index.js")>();
  return {
    ...actual,
    loadArticle: async () => {
      if (state.articleFails) throw Object.assign(new Error("No such article"), { status: 404 });
      return {
        meta: { slug: "piece", title: "A piece" }, blocks: [],
        tree: { rootId: "root", nodes: { root: { depth: 0, children: [] } } },
      };
    },
    chatStore: { ...actual.chatStore, load: async () => [] },
    realtimeSessionStore: {
      ...actual.realtimeSessionStore,
      issue: async (session: RealtimeSession) => {
        state.calls.push("issue");
        if (state.journalFails) throw new Error("journal failed");
        state.session = { ...session };
      },
      closeUnopened: async (id: string, owner: string, at: string, reason: string, providerSessionId?: string) => {
        state.calls.push("close");
        expect(id).toBe(state.session?.id);
        expect(owner).toBe(TEST_OWNER);
        if (state.session) {
          state.session.closedAt = at;
          state.session.closeReason = reason;
          if (providerSessionId !== undefined) state.session.providerSessionId = providerSessionId;
        }
      },
      advanceVoiceSeconds: async (id: string, owner: string, opts: {
        seconds: number; providerSessionId?: string; rowFor: (session: RealtimeSession) => AiCallRow | null;
      }) => {
        state.calls.push("charge");
        expect(id).toBe(state.session?.id);
        expect(owner).toBe(TEST_OWNER);
        if (state.accountingFailures-- > 0) throw new Error("transaction failed");
        if (!state.session) throw new Error("missing fixture session");
        const row = opts.rowFor({ ...state.session });
        if (row) {
          state.rows.push(row);
          state.session.voiceSecondsReported = opts.seconds;
        }
        if (opts.providerSessionId !== undefined) state.session.providerSessionId = opts.providerSessionId;
        return row;
      },
    },
  };
});

const { handleApi } = await import("../src/routes.js");
const realKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  state.session = null;
  state.rows = [];
  state.calls = [];
  state.accountingFailures = 0;
  state.journalFails = false;
  state.articleFails = false;
  process.env.OPENAI_API_KEY = "sk-test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (realKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = realKey;
});

function provider(body: unknown = { session: { id: "live_created" }, transport: { sdp: "v=0 answer" } }, status = 201) {
  const mock = vi.fn(async () => {
    state.calls.push("create");
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function open(headers: Record<string, string> = AUTHED_HEADERS) {
  const req = Object.assign((async function* () {
    yield Buffer.from(JSON.stringify({ sdp: "v=0 offer", useProfile: false }));
  })(), {
    method: "POST", url: "/api/chat/piece/spya-aaaaaa/live-session", headers,
  }) as unknown as IncomingMessage;
  let body = "";
  const res = {
    statusCode: 0, writableEnded: false, destroyed: false,
    setHeader() {}, on() {}, flushHeaders() {},
    end(chunk?: string) { body += chunk ?? ""; (this as { writableEnded: boolean }).writableEnded = true; },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status: res.statusCode, body: JSON.parse(body) as Record<string, unknown> };
}

describe("GPT-Live create failure provenance and accounting", () => {
  it("retries the charge transaction without creating another provider session", async () => {
    const fetchMock = provider();
    state.accountingFailures = 1;
    const out = await open();
    expect(out.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.calls).toEqual(["issue", "create", "charge", "charge"]);
    expect(state.session?.providerSessionId).toBe("live_created");
    expect(state.session?.voiceSecondsReported).toBe(15);
    expect(state.session?.connectedAt).toBeNull();
    expect(state.rows.map((row) => row.voiceSeconds)).toEqual([15]);
    expect(Object.keys(out.body).sort()).toEqual(["liveSessionId", "sdp", "sessionId", "tailId"]);
  });

  it("preserves a created provider id and pending-accounting state after repeated transaction failures", async () => {
    const fetchMock = provider();
    state.accountingFailures = 2;
    const out = await open();
    expect(out.status).toBeGreaterThanOrEqual(500);
    expect(out.body).not.toHaveProperty("sdp");
    expect(String(out.body.error)).toContain("[live-upstream]");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.session?.providerSessionId).toBe("live_created");
    expect(state.session?.closeReason).toBe("create_accounting_failed");
    expect(state.session?.connectedAt).toBeNull();
    expect(state.rows).toEqual([]); // Explicit gap, rather than a claim that it cost nothing.
  });

  it("records confirmed creation's charge even when the SDP answer is missing", async () => {
    provider({ session: { id: "live_created" } });
    const out = await open();
    expect(out.status).toBeGreaterThanOrEqual(500);
    expect(out.body).not.toHaveProperty("sdp");
    expect(state.session?.providerSessionId).toBe("live_created");
    expect(state.session?.closeReason).toBe("create_unusable");
    expect(state.rows.map((row) => row.voiceSeconds)).toEqual([15]);
    expect(state.session?.connectedAt).toBeNull();
  });

  it("records confirmed creation's charge even when the successful JSON body cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 201, json: async () => { throw new SyntaxError("truncated JSON"); },
    })));
    await open();
    expect(state.session?.closeReason).toBe("create_unusable");
    expect(state.rows.map((row) => row.voiceSeconds)).toEqual([15]);
  });

  it("records an uncertain outcome when the request loses its response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const out = await open();
    expect(out.status).toBeGreaterThanOrEqual(500);
    expect(state.session?.closeReason).toBe("create_uncertain");
    expect(state.session?.connectedAt).toBeNull();
    expect(state.rows).toEqual([]);
  });

  it("keeps confirmed refusal, missing key and journal failure unbilled", async () => {
    provider({ error: { message: "invalid SDP" } }, 400);
    await open();
    expect(state.session?.closeReason).toBe("create_failed");
    expect(state.rows).toEqual([]);
    const fetchMock = provider();
    delete process.env.OPENAI_API_KEY;
    await open();
    expect(state.session?.closeReason).toBe("create_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.OPENAI_API_KEY = "sk-test";
    state.journalFails = true;
    await open();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authenticates and checks article ownership before journalling or creating", async () => {
    const fetchMock = provider();
    expect((await open({})).status).toBe(401);
    state.articleFails = true;
    expect((await open()).status).toBe(404);
    expect(state.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
