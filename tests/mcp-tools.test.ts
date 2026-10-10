/**
 * **The MCP tools call the routes they claim, and the asking tools ask a
 * person first** — plan docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md
 * § Stages, stage 1.
 *
 * Driven end to end through the SDK's own client over an in-memory pair, with
 * a fake `fetch` standing in for Spideryarn, so what is checked is what an AI
 * app would see and what the site would receive: the method, the path, the
 * body, the Bearer header — and, for the four tools that send mail or
 * publish, that **nothing at all reaches the site** unless the `Approver` said
 * yes.
 */

import { Client as McpClient } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { SHARING_RIGHTS_CONFIRM } from "../src/messages.js";
import { ApiError, makeApi, type TokenSource } from "../src/mcp/api.js";
import { type Approver, defaultApprover, dialogText, type Operation, osascriptArgs, readDialogAnswer } from "../src/mcp/approve.js";
import { buildServer } from "../src/mcp/server.js";
import { TOOLS, voucherId } from "../src/mcp/tools.js";

const SITE = "https://sy.test";
const ACCESS = "SENTINEL-ACCESS-7f3a9c";
const REFRESHED = "SENTINEL-REFRESHED-2b8e1d";
const USER = "6b2f1c4e-9a37-4d81-b5e0-3c7a2d9f8e14";
const VOUCHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

interface Seen {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}
type Reply = { status?: number; body?: unknown };
type Routes = Record<string, Reply | ((seen: Seen) => Reply)>;

const shelfEntry = (slug: string, title: string) => ({
  slug,
  title,
  url: `https://example.com/${slug}`,
  addedAt: "2026-10-01T00:00:00Z",
  words: 1200,
  minutes: 5,
  blocks: 10,
  parts: 1,
  sections: 2,
  comments: 0,
  sourceReusable: true,
  opens: 0,
  has: { arc: false, tweets: false, glossary: false },
  tags: ["ai"],
});

const adminVoucher = {
  id: VOUCHER,
  email: "ada@example.com",
  articles: 20,
  note: "PRIVATE-NOTE-xyz",
  recipientNote: "RECIPIENT-NOTE-xyz",
  recipientName: "Ada",
  createdAt: "2026-10-01T00:00:00Z",
  createdBy: USER,
  updatedAt: "2026-10-01T00:00:00Z",
  claimedBy: null,
  claimedAt: null,
  revokedAt: null,
  claimantEmail: null,
  claimant: { kind: "free", used: 3, limit: 25, remaining: 22, lapsed: false },
  emails: {
    gift: {
      id: "99999999-8888-4777-8666-555555555555",
      kind: "gift",
      status: "failed",
      attempts: 1,
      detail: null,
      updatedAt: "2026-10-01T00:00:00Z",
      attemptStartedAt: null,
      retryable: true,
    },
    claimed: null,
  },
};

const DEFAULT_ROUTES: Routes = {
  "GET /api/reader": { body: { profile: null, experimentalSince: null, autoModes: true } },
  "GET /api/library": { body: { articles: [shelfEntry("on-tools", "On Tools")] } },
  "GET /api/library?archived=1": { body: { articles: [shelfEntry("old-one", "Old One")] } },
  "GET /api/admin/vouchers": { body: { vouchers: [adminVoucher] } },
  "GET /api/admin/author-gifts": {
    body: {
      gifts: [
        {
          id: VOUCHER,
          status: "draft",
          starter: { slug: "on-tools", title: "On Tools" },
          email: null,
          recipientName: "Ann Author",
          recipientNote: null,
          articles: 20,
          notes: "GIFT-NOTES-abc",
          /* A route regression must not make an unrecognised credential part of
             an MCP answer. The tool has its own allow-list boundary. */
          privateLinkKey: "SENTINEL-PRIVATE-LINK-KEY",
          notesUpdatedAt: "2026-10-09T00:00:00Z",
          emailLookupId: null,
          nameLookupId: null,
          createdAt: "2026-10-09T00:00:00Z",
          createdBy: USER,
          updatedAt: "2026-10-09T00:00:00Z",
          sendStartedAt: null,
          discardedAt: null,
          voucherId: null,
          lookups: [],
        },
      ],
    },
  },
};

class StubApprover implements Approver {
  readonly asked: Operation[] = [];
  constructor(private readonly answer: boolean) {}
  async approve(op: Operation): Promise<boolean> {
    this.asked.push(op);
    return this.answer;
  }
}

async function harness(
  routes: Routes = {},
  approver: Approver = new StubApprover(true),
  tokens?: TokenSource,
  identity: () => Promise<{ userId: string; email: string }> = async () => ({
    userId: USER,
    email: "greg@example.com",
  }),
) {
  const seen: Seen[] = [];
  const all = { ...DEFAULT_ROUTES, ...routes };
  const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    const s: Seen = {
      method: init?.method ?? "GET",
      path: `${u.pathname}${u.search}`,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.get("authorization"),
    };
    seen.push(s);
    const route = all[`${s.method} ${s.path}`];
    const reply = typeof route === "function" ? route(s) : (route ?? { body: { ok: true } });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  };
  const api = makeApi({
    site: SITE,
    fetch: fakeFetch,
    tokens: tokens ?? { accessToken: async () => ACCESS, refreshAfterRejection: async () => REFRESHED },
  });
  const server = buildServer({
    api,
    ctx: { identity },
    approver,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new McpClient({ name: "test", version: "1" });
  await client.connect(clientSide);
  const outputs: string[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    const textOut = content.map((c) => c.text ?? "").join("\n");
    outputs.push(textOut);
    return { isError: result.isError === true, text: textOut, json: () => JSON.parse(textOut) as unknown };
  };
  return { seen, call, outputs, client };
}

describe("each tool calls the route it claims", () => {
  const cases: {
    tool: string;
    args?: Record<string, unknown>;
    expect: { method: string; path: string; body?: unknown }[];
  }[] = [
    { tool: "whoami", expect: [{ method: "GET", path: "/api/reader" }] },
    { tool: "list_articles", expect: [{ method: "GET", path: "/api/library" }] },
    { tool: "list_articles", args: { archive: "archived" }, expect: [{ method: "GET", path: "/api/library?archived=1" }] },
    {
      tool: "search_library",
      args: { query: "cats & dogs", limit: 5, includeArchived: true },
      expect: [{ method: "GET", path: "/api/library/search?q=cats+%26+dogs&limit=5&archived=1" }],
    },
    { tool: "list_tags", expect: [{ method: "GET", path: "/api/library/tags" }] },
    {
      tool: "edit_tags",
      args: { slug: "a b", add: ["x"], remove: ["y"] },
      expect: [{ method: "PATCH", path: "/api/library/a%20b/tags", body: { add: ["x"], remove: ["y"] } }],
    },
    {
      tool: "import_article",
      args: { url: "https://example.com/p" },
      expect: [{ method: "POST", path: "/api/jobs", body: { url: "https://example.com/p" } }],
    },
    {
      tool: "import_article",
      args: { url: "https://example.com/p", own_copy: true },
      expect: [{ method: "POST", path: "/api/jobs", body: { url: "https://example.com/p", ownCopy: true } }],
    },
    { tool: "get_import_status", args: { id: "job-1" }, expect: [{ method: "GET", path: "/api/jobs/job-1" }] },
    { tool: "list_imports", expect: [{ method: "GET", path: "/api/jobs" }] },
    {
      tool: "set_auto_modes",
      args: { on: false },
      expect: [{ method: "PATCH", path: "/api/reader", body: { autoModes: false } }],
    },
    {
      tool: "make_article_private",
      args: { slug: "on-tools" },
      expect: [{ method: "PUT", path: "/api/article/on-tools/visibility", body: { visibility: "private" } }],
    },
    { tool: "list_gift_vouchers", expect: [{ method: "GET", path: "/api/admin/vouchers" }] },
    {
      tool: "update_gift_voucher",
      args: { id: VOUCHER, revoked: true, note: null },
      expect: [{ method: "PATCH", path: `/api/admin/vouchers/${VOUCHER}`, body: { revoked: true, note: null } }],
    },
    /* Plan 261009u § D6: the author gifts' two rows, neither of which asks. */
    { tool: "list_author_gifts", expect: [{ method: "GET", path: "/api/admin/author-gifts" }] },
    {
      tool: "update_author_gift",
      args: { id: VOUCHER, notes: "Found her address on her lab page." },
      expect: [
        { method: "PATCH", path: `/api/admin/author-gifts/${VOUCHER}`, body: { notes: "Found her address on her lab page." } },
      ],
    },
    {
      tool: "update_author_gift",
      args: { id: VOUCHER, email: null, recipientName: "Ann Author", articles: 30 },
      expect: [
        {
          method: "PATCH",
          path: `/api/admin/author-gifts/${VOUCHER}`,
          body: { email: null, recipientName: "Ann Author", articles: 30 },
        },
      ],
    },
  ];

  for (const c of cases) {
    it(`${c.tool} ${JSON.stringify(c.args ?? {})}`, async () => {
      const approver = new StubApprover(true);
      const h = await harness({}, approver);
      const result = await h.call(c.tool, c.args);
      expect(result.isError, result.text).toBe(false);
      expect(h.seen.map(({ method, path, body }) => ({ method, path, ...(body === undefined ? {} : { body }) }))).toEqual(
        c.expect,
      );
      expect(h.seen.every((s) => s.auth === `Bearer ${ACCESS}`)).toBe(true);
      /* None of these sends mail or publishes, so none of them asks. */
      expect(approver.asked).toEqual([]);
    });
  }

  it("list_articles all is two calls, each entry trimmed, marked archived or not, and carrying its link", async () => {
    const h = await harness();
    const result = await h.call("list_articles", { archive: "all" });
    expect(h.seen.map((s) => s.path).sort()).toEqual(["/api/library", "/api/library?archived=1"]);
    const { articles } = result.json() as { articles: Record<string, unknown>[] };
    expect(articles).toEqual([
      expect.objectContaining({ slug: "on-tools", archived: false, link: `${SITE}/read/on-tools`, visibility: "private" }),
      expect.objectContaining({ slug: "old-one", archived: true, link: `${SITE}/read/old-one` }),
    ]);
    expect(Object.keys(articles[0] ?? {})).not.toContain("opens");
  });

  /* A repeat paste is answered with the article, free and with nothing queued
     (plan 261007k), and the agent still gets the link to it. */
  it("import_article of an article already on the shelf answers it, with its link", async () => {
    const h = await harness({ "POST /api/jobs": { status: 200, body: { article: "on-tools", repeat: true } } });
    const result = await h.call("import_article", { url: "https://example.com/p" });
    expect(result.json()).toEqual({ article: "on-tools", repeat: true, link: `${SITE}/read/on-tools` });
  });

  /* Somebody else's public copy is answered, free and with nothing queued, so
     the agent can ask the reader which they want (plan 261009j). */
  it("import_article of an address somebody made public answers that copy, with its link", async () => {
    const h = await harness({
      "POST /api/jobs": { status: 200, body: { publicCopy: { slug: "theirs", title: "Theirs" } } },
    });
    const result = await h.call("import_article", { url: "https://example.com/p" });
    expect(result.json()).toEqual({ publicCopy: { slug: "theirs", title: "Theirs" }, link: `${SITE}/read/theirs` });
  });

  /* list_users and create_private_link arrived with plan 261007o, once Greg said
     yes; get_allowance is still out (it claims vouchers, so it is not a read). */
  it("there is no get_allowance tool (Sol F17), and no tool turns a private link off or remakes it", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).not.toContain("get_allowance");
    expect(names.filter((n) => /private_link|share_link/.test(n))).toEqual(["create_private_link"]);
  });

  /* Unlike a voucher's notes, an author gift's are the point (Greg, 2026-10-09:
     "either I (perhaps via MCP) or the agent can add stuff to"), so they are listed. */
  it("list_author_gifts lists the notes, with the article's plain link and no key", async () => {
    const h = await harness();
    const result = await h.call("list_author_gifts");
    const { gifts } = result.json() as { gifts: { notes: string; starter: Record<string, unknown> }[] };
    expect(gifts[0]?.notes).toBe("GIFT-NOTES-abc");
    expect(gifts[0]?.starter).toEqual({ slug: "on-tools", title: "On Tools", link: `${SITE}/read/on-tools` });
    expect(result.text).not.toContain("key=");
    expect(result.text).not.toContain("SENTINEL-PRIVATE-LINK-KEY");
  });

  it("update_author_gift with nothing to change sends nothing", async () => {
    const h = await harness();
    const result = await h.call("update_author_gift", { id: VOUCHER });
    expect(result.isError).toBe(true);
    expect(h.seen).toEqual([]);
  });

  it("there is no tool that sends an author gift", () => {
    expect(TOOLS.map((t) => t.name).filter((n) => /author_gift/.test(n))).toEqual([
      "list_author_gifts",
      "update_author_gift",
    ]);
  });

  it("list_gift_vouchers leaves out the notes and the claimant's usage (Sol F17)", async () => {
    const h = await harness();
    const result = await h.call("list_gift_vouchers");
    expect(result.text).not.toContain("PRIVATE-NOTE");
    expect(result.text).not.toContain("RECIPIENT-NOTE");
    expect(result.text).not.toContain("remaining");
    expect((result.json() as { vouchers: unknown[] }).vouchers[0]).toEqual({
      id: VOUCHER,
      email: "ada@example.com",
      recipientName: "Ada",
      articles: 20,
      createdAt: "2026-10-01T00:00:00Z",
      claimed: false,
      claimedAt: null,
      revoked: false,
      hasNote: true,
      giftEmail: { status: "failed", retryable: true },
    });
  });

  it("set_auto_modes returns only the setting, not the reader's profile text", async () => {
    const h = await harness({
      "PATCH /api/reader": {
        body: {
          profile: "PRIVATE-READER-PROFILE",
          experimentalSince: "2026-10-01T00:00:00Z",
          autoModes: false,
        },
      },
    });
    const result = await h.call("set_auto_modes", { on: false });
    expect(result.json()).toEqual({ autoModes: false });
    expect(result.text).not.toContain("PRIVATE-READER-PROFILE");
  });

  it("whoami returns only identity and auto-modes, not the reader's profile text", async () => {
    const h = await harness({
      "GET /api/reader": {
        body: {
          profile: "PRIVATE-READER-PROFILE",
          purpose: "PRIVATE-ARTICLE-PURPOSE",
          experimentalSince: "2026-10-01T00:00:00Z",
          autoModes: true,
        },
      },
    });
    const result = await h.call("whoami");
    expect(result.json()).toEqual({ email: "greg@example.com", userId: USER, site: SITE, autoModes: true });
    expect(result.text).not.toContain("PRIVATE-");
  });
});

describe("the site's refusals come back as readable tool errors", () => {
  it("a 403 says Spideryarn refused, in the server's words, and that the tool is admin-only", async () => {
    const h = await harness({ "GET /api/admin/vouchers": { status: 403, body: { error: "Admins only." } } });
    const result = await h.call("list_gift_vouchers");
    expect(result.isError).toBe(true);
    expect(result.text).toBe("Spideryarn refused: Admins only. (this tool is for Spideryarn admins only)");
  });

  it("the author gift tools are admin-only too, and say so on a 403", async () => {
    const h = await harness({
      "GET /api/admin/author-gifts": { status: 403, body: { error: "Admins only." } },
      [`PATCH /api/admin/author-gifts/${VOUCHER}`]: { status: 403, body: { error: "Admins only." } },
    });
    for (const [name, args] of [
      ["list_author_gifts", {}],
      ["update_author_gift", { id: VOUCHER, notes: "x" }],
    ] as const) {
      const result = await h.call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toBe("Spideryarn refused: Admins only. (this tool is for Spideryarn admins only)");
    }
  });

  it("a 402 names the free-article limit", async () => {
    const h = await harness({ "POST /api/jobs": { status: 402, body: { error: "You have used your 10 free articles." } } });
    const result = await h.call("import_article", { url: "https://example.com/p" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("You have used your 10 free articles.");
    expect(result.text).toContain("free articles");
  });

  it("a 401 is refreshed once and retried once with the new token, through the token source", async () => {
    const rejected: string[] = [];
    const tokens: TokenSource = {
      accessToken: async () => ACCESS,
      refreshAfterRejection: async (bad) => {
        rejected.push(bad);
        return REFRESHED;
      },
    };
    const h = await harness(
      { "GET /api/jobs": (s) => (s.auth === `Bearer ${REFRESHED}` ? { body: { jobs: [] } } : { status: 401, body: { error: "expired" } }) },
      new StubApprover(true),
      tokens,
    );
    const result = await h.call("list_imports");
    expect(result.isError, result.text).toBe(false);
    expect(rejected).toEqual([ACCESS]);
    expect(h.seen.map((s) => s.auth)).toEqual([`Bearer ${ACCESS}`, `Bearer ${REFRESHED}`]);
  });

  it("a second 401 is the answer, not a loop", async () => {
    const h = await harness({ "GET /api/jobs": { status: 401, body: { error: "expired" } } });
    const result = await h.call("list_imports");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("401");
    expect(h.seen).toHaveLength(2);
  });

  it("a refusal from the token source (signed out, another account) sends nothing", async () => {
    const tokens: TokenSource = {
      accessToken: async () => {
        throw new Error("The Spideryarn session file now holds a different sign-in.");
      },
      refreshAfterRejection: async () => REFRESHED,
    };
    const h = await harness({}, new StubApprover(true), tokens);
    const result = await h.call("list_imports");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("different sign-in");
    expect(h.seen).toEqual([]);
  });
});

describe("the asking tools ask the person first, and send nothing without a yes", () => {
  const gift = {
    email: "Ada@Example.com",
    articles: 20,
    recipientName: "Ada",
    recipientNote: "I thought you'd enjoy this",
    note: "met at the conference",
    idempotency_key: "ada-oct",
  };

  const asking: { tool: string; args: Record<string, unknown>; sends: { method: string; path: string } }[] = [
    { tool: "create_gift_voucher", args: gift, sends: { method: "POST", path: "/api/admin/vouchers" } },
    {
      tool: "update_gift_voucher",
      args: { id: VOUCHER, email: "ada2@example.com" },
      sends: { method: "PATCH", path: `/api/admin/vouchers/${VOUCHER}` },
    },
    {
      tool: "retry_gift_voucher_email",
      args: { voucherId: VOUCHER },
      sends: { method: "POST", path: "/api/admin/voucher-emails/99999999-8888-4777-8666-555555555555/retry" },
    },
    {
      tool: "make_article_public",
      args: { slug: "on-tools" },
      sends: { method: "PUT", path: "/api/article/on-tools/visibility" },
    },
  ];

  it("binds the server to its reader before opening a dialog or allowing a write", async () => {
    const approver = new StubApprover(true);
    const h = await harness({}, approver, undefined, async () => {
      throw new Error("There is no signed-in reader to bind to.");
    });
    const result = await h.call("update_gift_voucher", { id: VOUCHER, email: "new@example.com" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("no signed-in reader");
    expect(approver.asked).toEqual([]);
    expect(h.seen).toEqual([]);
  });

  for (const c of asking) {
    it(`${c.tool}: a no sends nothing, and says so without an error`, async () => {
      const approver = new StubApprover(false);
      const h = await harness({}, approver);
      const result = await h.call(c.tool, c.args);
      expect(approver.asked).toHaveLength(1);
      expect(result.isError).toBe(false);
      expect(result.text).toContain("nothing was sent");
      /* Reads to describe the operation are allowed; a write is not. */
      expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
    });

    it(`${c.tool}: a yes sends exactly one write`, async () => {
      const approver = new StubApprover(true);
      const h = await harness({}, approver);
      const result = await h.call(c.tool, c.args);
      expect(result.isError, result.text).toBe(false);
      expect(approver.asked).toHaveLength(1);
      expect(h.seen.filter((s) => s.method !== "GET").map(({ method, path }) => ({ method, path }))).toEqual([c.sends]);
    });

    it(`${c.tool}: no argument can stand in for the person's approval`, async () => {
      for (const bypass of [{ approved: true }, { confirm: true }]) {
        const approver = new StubApprover(false);
        const h = await harness({}, approver);
        const result = await h.call(c.tool, { ...c.args, ...bypass });
        expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
        /* Refused by the strict input, so it never reached the tool at all. */
        expect(result.isError).toBe(true);
      }
    });
  }

  it("create_gift_voucher posts the derived id and the exact body, after showing the person exactly that", async () => {
    const approver = new StubApprover(true);
    const h = await harness({}, approver);
    await h.call("create_gift_voucher", gift);
    const post = h.seen.find((s) => s.method === "POST");
    expect(post?.body).toEqual({
      id: voucherId(SITE, USER, "ada-oct"),
      email: "Ada@Example.com",
      articles: 20,
      note: "met at the conference",
      recipientNote: "I thought you'd enjoy this",
      recipientName: "Ada",
    });
    const lines = approver.asked[0]?.lines.join("\n") ?? "";
    expect(lines).toContain("To: Ada@Example.com");
    expect(lines).toContain("Dear Ada,");
    expect(lines).toContain("20 free articles");
    expect(lines).toContain("I thought you'd enjoy this");
    expect(lines).toContain(SITE);
    /* The private note is not for the dialog, and certainly not for the email. */
    expect(lines).not.toContain("met at the conference");
  });

  it("make_article_public asks with the title, the link and the rights sentence, then confirms rights", async () => {
    const approver = new StubApprover(true);
    const h = await harness({}, approver);
    const result = await h.call("make_article_public", { slug: "on-tools" });
    const lines = approver.asked[0]?.lines.join("\n") ?? "";
    expect(lines).toContain('"On Tools"');
    expect(lines).toContain(`${SITE}/read/on-tools`);
    expect(lines).toContain(SHARING_RIGHTS_CONFIRM);
    expect(h.seen.find((s) => s.method === "PUT")?.body).toEqual({ visibility: "public", rightsConfirmed: true });
    expect((result.json() as { link: string }).link).toBe(`${SITE}/read/on-tools`);
  });

  it("update_gift_voucher without a new address does not ask", async () => {
    const approver = new StubApprover(false);
    const h = await harness({}, approver);
    const result = await h.call("update_gift_voucher", { id: VOUCHER, articles: 30 });
    expect(result.isError).toBe(false);
    expect(approver.asked).toEqual([]);
    expect(h.seen).toHaveLength(1);
  });

  it("retry sends the exact delivery the person approved, even if the voucher changes afterwards", async () => {
    const oldEmailId = adminVoucher.emails.gift.id;
    const newEmailId = "77777777-6666-4555-8444-333333333333";
    let reads = 0;
    const h = await harness({
      "GET /api/admin/vouchers": () => {
        reads += 1;
        return {
          body: {
            vouchers: [
              reads === 1
                ? adminVoucher
                : {
                    ...adminVoucher,
                    email: "different@example.com",
                    emails: { ...adminVoucher.emails, gift: { ...adminVoucher.emails.gift, id: newEmailId } },
                  },
            ],
          },
        };
      },
    });
    const result = await h.call("retry_gift_voucher_email", { voucherId: VOUCHER });
    expect(result.isError, result.text).toBe(false);
    expect(reads).toBe(1);
    expect(h.seen.find((seen) => seen.method === "POST")?.path).toBe(
      `/api/admin/voucher-emails/${oldEmailId}/retry`,
    );
  });

  it("the retry dialog names the address and never today's name, count or note, which a retry does not send", async () => {
    /* A retry re-sends the email as first written (C6). Showing the voucher's
       current fields would ask the person to approve words that are not sent. */
    const approver = new StubApprover(true);
    const h = await harness({}, approver);
    await h.call("retry_gift_voucher_email", { voucherId: VOUCHER });
    const lines = approver.asked[0]?.lines.join("\n") ?? "";
    expect(lines).toContain("ada@example.com");
    expect(lines).toContain("Exactly as first written");
    expect(lines).not.toContain("RECIPIENT-NOTE-xyz");
    expect(lines).not.toContain("Dear Ada");
    expect(lines).not.toContain("20 free articles");
  });

  it("when no person can be asked, it is an error and nothing is sent", async () => {
    const h = await harness({}, defaultApprover({ platform: "linux", execFile: () => expect.fail("spawned") }));
    const result = await h.call("create_gift_voucher", gift);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("only show on macOS");
    expect(h.seen).toEqual([]);
  });

  it("a 409 on a reused key says nothing was sent", async () => {
    const h = await harness({ "POST /api/admin/vouchers": { status: 409, body: { error: "A different voucher already has that id." } } });
    const result = await h.call("create_gift_voucher", gift);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("nothing was sent");
  });
});

describe("the voucher id comes from the key, never from the gift (Sol F13)", () => {
  it("is a version-5 UUID, stable for one site, admin and key", () => {
    const id = voucherId(SITE, USER, "ada-oct");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(voucherId(`${SITE}/`, USER, "ada-oct")).toBe(id);
  });

  it("a different key, admin or site is a different id", () => {
    const id = voucherId(SITE, USER, "ada-oct");
    expect(voucherId(SITE, USER, "ada-nov")).not.toBe(id);
    expect(voucherId(SITE, "someone-else", "ada-oct")).not.toBe(id);
    expect(voucherId("http://localhost:5173", USER, "ada-oct")).not.toBe(id);
  });

  it("the same key with a changed body posts the same id, so the server's 409 is reached", async () => {
    const h = await harness();
    const base = { email: "ada@example.com", articles: 20, idempotency_key: "ada-oct" };
    await h.call("create_gift_voucher", base);
    await h.call("create_gift_voucher", base);
    await h.call("create_gift_voucher", { ...base, articles: 25, recipientNote: "changed" });
    await h.call("create_gift_voucher", { ...base, idempotency_key: "ada-second" });
    const ids = h.seen.filter((s) => s.method === "POST").map((s) => (s.body as { id: string }).id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[0]);
  });

  it("idempotency_key is required", async () => {
    const h = await harness();
    const result = await h.call("create_gift_voucher", { email: "ada@example.com", articles: 2 });
    expect(result.isError).toBe(true);
    expect(h.seen).toEqual([]);
  });
});

describe("the macOS dialog", () => {
  const hostile = 'x" & do shell script "touch /tmp/pwned" & "';

  it("passes the operation as argv after --, never inside a script string", () => {
    const argv = osascriptArgs({ title: hostile, lines: [`To: ${hostile}`, "Note: \"quoted\" and 'single'"] });
    const dash = argv.indexOf("--");
    expect(dash).toBe(argv.length - 3);
    const scripts = argv.slice(0, dash).filter((_, i) => i % 2 === 1);
    expect(argv.slice(0, dash).filter((_, i) => i % 2 === 0).every((a) => a === "-e")).toBe(true);
    for (const script of scripts) {
      expect(script).not.toContain("do shell script");
      expect(script).not.toContain("pwned");
      expect(script).not.toContain("quoted");
    }
    expect(argv[dash + 1]).toContain("do shell script");
    expect(argv[dash + 2]).toContain("do shell script");
  });

  it("strips control characters and caps the length", () => {
    const [, , , , , , , message = ""] = osascriptArgs({
      title: "t",
      lines: [`a\u0007b\u001b[31mc\rd`, "y".repeat(5000), ...Array.from({ length: 50 }, () => "z".repeat(200))],
    });
    expect(message.replace(/\n/g, "")).not.toMatch(/\p{Cc}/u);
    expect(message.split("\n")[1]?.length).toBeLessThanOrEqual(300);
    expect(message.length).toBeLessThanOrEqual(2000);
  });

  it("approves only a plain Approve that did not give up", () => {
    expect(readDialogAnswer("button returned:Approve, gave up:false")).toBe(true);
    expect(readDialogAnswer("button returned:Approve")).toBe(true);
    expect(readDialogAnswer("button returned:, gave up:true")).toBe(false);
    expect(readDialogAnswer("button returned:Approve, gave up:true")).toBe(false);
    expect(readDialogAnswer("button returned:Cancel")).toBe(false);
    expect(readDialogAnswer("")).toBe(false);
  });

  it("on macOS runs osascript with those argv; Cancel's non-zero exit and an error are a no", async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const op = { title: "t", lines: ["l"] };
    const answers: [Error | null, string][] = [
      [null, "button returned:Approve, gave up:false\n"],
      [new Error("User canceled. (-128)"), ""],
      [null, "button returned:, gave up:true\n"],
    ];
    const results: boolean[] = [];
    for (const [error, stdout] of answers) {
      const approver = defaultApprover({
        platform: "darwin",
        execFile: (file, args, _o, cb) => {
          calls.push({ file, args });
          cb(error, stdout, "");
        },
      });
      results.push(await approver.approve(op));
    }
    expect(results).toEqual([true, false, false]);
    expect(calls[0]).toEqual({ file: "osascript", args: osascriptArgs(op) });
  });

  it("elsewhere refuses without spawning anything", async () => {
    let spawned = false;
    const approver = defaultApprover({
      platform: "linux",
      execFile: () => {
        spawned = true;
      },
    });
    await expect(approver.approve({ title: "t", lines: [] })).rejects.toThrow(/only show on macOS/);
    expect(spawned).toBe(false);
  });
});

describe("no token reaches a result", () => {
  it("across every tool, success and failure", async () => {
    const leaky = { status: 500, body: { error: `boom ${ACCESS}` } };
    const routes: Routes = { "GET /api/jobs": leaky, "POST /api/jobs": { status: 402, body: { error: "limit" } } };
    const h = await harness(routes);
    for (const t of TOOLS) {
      const args: Record<string, Record<string, unknown>> = {
        search_library: { query: "q" },
        edit_tags: { slug: "s", add: ["t"] },
        import_article: { url: "https://example.com/" },
        get_import_status: { id: "j" },
        set_auto_modes: { on: true },
        make_article_private: { slug: "s" },
        make_article_public: { slug: "on-tools" },
        create_gift_voucher: { email: "a@example.com", articles: 1, idempotency_key: "k" },
        update_gift_voucher: { id: VOUCHER, articles: 2 },
        update_author_gift: { id: VOUCHER, notes: "n" },
        retry_gift_voucher_email: { voucherId: VOUCHER },
      };
      await h.call(t.name, args[t.name] ?? {});
    }
    const everything = h.outputs.join("\n");
    expect(everything).toContain("boom [redacted]");
    expect(everything).not.toContain(ACCESS);
    expect(everything).not.toContain(REFRESHED);
    expect(new ApiError(500, "x").message).not.toContain(ACCESS);
  });

  it("scrubs both the rejected and refreshed access tokens from the retry's answer", async () => {
    const h = await harness({
      "GET /api/jobs": (seen) =>
        seen.auth === `Bearer ${ACCESS}`
          ? { status: 401, body: { error: "expired" } }
          : { status: 500, body: { error: `the old token was ${ACCESS}; the new token was ${REFRESHED}` } },
    });
    const result = await h.call("list_imports");
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain(ACCESS);
    expect(result.text).not.toContain(REFRESHED);
    expect(result.text).toContain("the old token was [redacted]; the new token was [redacted]");
  });

  it("scrubs an access token even if a successful route accidentally echoes it", async () => {
    const h = await harness({ "GET /api/jobs": { body: { jobs: [], debug: `Bearer ${ACCESS}` } } });
    const result = await h.call("list_imports");
    expect(result.isError).toBe(false);
    expect(result.text).not.toContain(ACCESS);
    expect(result.text).toContain("Bearer [redacted]");
  });
});

/* ---------------------------------------------------------- plan 261007o -- */

const KEY_ON = "KEYabcdefghijklmnopqrs";
const KEY_NEW = "NEWabcdefghijklmnopqrs";

describe("create_private_link hands over the existing link, and makes one only when there is none", () => {
  const on = { "GET /api/article/on-tools/share-link": { body: { on: true, key: KEY_ON, since: "2026-10-01T00:00:00Z" } } };
  const off = {
    "GET /api/article/on-tools/share-link": { body: { on: false } },
    "POST /api/article/on-tools/share-link": { body: { on: true, key: KEY_NEW, since: "2026-10-07T00:00:00Z" } },
  };

  it("keeps the article's slug visible in the actual dialog when its title is long", async () => {
    for (const routes of [on, off]) {
      const approver = new StubApprover(false);
      const h = await harness({
        ...routes,
        "GET /api/library": { body: { articles: [shelfEntry("on-tools", "A".repeat(400))] } },
      }, approver);
      await h.call("create_private_link", { slug: "on-tools" });
      expect(approver.asked).toHaveLength(1);
      const message = dialogText(approver.asked[0]!).message;
      expect(message).toContain("on-tools");
      expect(message).not.toContain(KEY_ON);
      expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
    }
  });

  it("when a link is on: asks, then answers that link and never posts (a POST would replace the key)", async () => {
    const approver = new StubApprover(true);
    const h = await harness(on, approver);
    const result = await h.call("create_private_link", { slug: "on-tools" });
    expect(result.isError, result.text).toBe(false);
    expect(approver.asked).toHaveLength(1);
    const lines = approver.asked[0]?.lines.join("\n") ?? "";
    expect(lines).toContain('"On Tools"');
    expect(lines).toMatch(/already has a private link/);
    expect(lines).not.toContain(KEY_ON);
    expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
    /* Read again after the yes (Sol's F2), so a session that signed out or
       changed hands while the dialog was open hands over nothing. */
    expect(h.seen.filter((s) => s.path === "/api/article/on-tools/share-link")).toHaveLength(2);
    expect(result.json()).toEqual({
      link: `${SITE}/read/on-tools?key=${KEY_ON}`,
      since: "2026-10-01T00:00:00Z",
    });
  });

  it("when the approved link changed or went while the dialog was open: an error, no key, nothing made", async () => {
    for (const second of [
      { body: { on: false } },
      { body: { on: true, key: KEY_NEW, since: "2026-10-07T03:00:00Z" } },
      { status: 401, body: { error: "signed out" } },
    ]) {
      let gets = 0;
      const h = await harness({
        "GET /api/article/on-tools/share-link": () =>
          ++gets === 1 ? { body: { on: true, key: KEY_ON, since: "2026-10-01T00:00:00Z" } } : second,
      });
      const result = await h.call("create_private_link", { slug: "on-tools" });
      expect(result.isError, JSON.stringify(second)).toBe(true);
      expect(result.text).not.toContain(KEY_ON);
      expect(result.text).not.toContain(KEY_NEW);
      expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
    }
  });

  it("when it is off: asks with the rights sentence, then posts once, keeping any link made meanwhile", async () => {
    const approver = new StubApprover(true);
    const h = await harness(off, approver);
    const result = await h.call("create_private_link", { slug: "on-tools" });
    expect(result.isError, result.text).toBe(false);
    expect(approver.asked[0]?.lines.join("\n")).toContain(SHARING_RIGHTS_CONFIRM);
    const writes = h.seen.filter((s) => s.method !== "GET");
    /* keepExisting: the server decides under its row lock (Sol's F1), so a link
       somebody made while the dialog was open is handed over, not replaced. */
    expect(writes.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      {
        method: "POST",
        path: "/api/article/on-tools/share-link",
        body: { rightsConfirmed: true, keepExisting: true },
      },
    ]);
    expect(result.json()).toEqual({
      link: `${SITE}/read/on-tools?key=${KEY_NEW}`,
      since: "2026-10-07T00:00:00Z",
    });
  });

  for (const [label, routes] of [
    ["on", on],
    ["off", off],
  ] as const) {
    it(`a no (link ${label}) writes nothing and hands over no key`, async () => {
      const approver = new StubApprover(false);
      const h = await harness(routes, approver);
      const result = await h.call("create_private_link", { slug: "on-tools" });
      expect(result.isError).toBe(false);
      expect(result.text).toContain("nothing was sent");
      expect(result.text).not.toContain(KEY_ON);
      expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
    });
  }

  it("no argument can stand in for the person's approval", async () => {
    const approver = new StubApprover(false);
    const h = await harness(off, approver);
    const result = await h.call("create_private_link", { slug: "on-tools", approved: true });
    expect(result.isError).toBe(true);
    expect(h.seen.filter((s) => s.method !== "GET")).toEqual([]);
  });
});

describe("list_users and user_activity read the admin's users route, trimmed", () => {
  const row = (n: number, email: string, extra: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    email,
    createdAt: "2026-09-01T00:00:00Z",
    providers: ["google"],
    articles: 3,
    archived: 1,
    uploads: 0,
    questions: 2,
    chats: 1,
    searches: 4,
    opens: 9,
    spendNanos: 1000,
    spendCalls: 2,
    spendUnpricedCalls: 0,
    spendMonth: "2026-10",
    plan: "free",
    ingests: 3,
    ingestsShared: 0,
    highPower: 0,
    highPowerShared: 0,
    minimal: 0,
    ingestLimit: 25,
    ingestWindow: "lifetime",
    ...extra,
  });
  const users = [
    row(1, "old@example.com", { lastSignInAt: "2026-09-02T00:00:00Z", lastReadAt: "2026-09-03T00:00:00Z" }),
    row(2, "ada@example.com", { lastSignInAt: "2026-10-05T00:00:00Z", lastReadAt: "2026-10-06T00:00:00Z" }),
    row(3, "never@example.org"),
  ];
  const routes = { "GET /api/admin/users": { body: { users } } };

  it("list_users answers each account trimmed, most recently active first", async () => {
    const h = await harness(routes);
    const result = await h.call("list_users");
    expect(h.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/admin/users"]);
    const answer = result.json() as { total: number; users: Record<string, unknown>[] };
    expect(answer.total).toBe(3);
    expect(answer.users.map((u) => u.email)).toEqual(["ada@example.com", "old@example.com", "never@example.org"]);
    expect(Object.keys(answer.users[0] ?? {}).sort()).toEqual(
      ["archived", "articles", "createdAt", "email", "id", "lastReadAt", "lastSignInAt", "plan"].sort(),
    );
  });

  it("list_users filters by a piece of the address and limits", async () => {
    const h = await harness(routes);
    const filtered = (await h.call("list_users", { query: "EXAMPLE.COM", limit: 1 })).json() as {
      total: number;
      users: { email: string }[];
    };
    expect(filtered.total).toBe(2);
    expect(filtered.users.map((u) => u.email)).toEqual(["ada@example.com"]);
  });

  it("list_users uses the latest activity, even when a sign-in is newer than the last read", async () => {
    const h = await harness({
      "GET /api/admin/users": {
        body: {
          users: [
            users[1],
            row(1, "returned@example.com", {
              lastReadAt: "2026-09-03T00:00:00Z",
              lastSignInAt: "2026-10-07T00:00:00Z",
            }),
          ],
        },
      },
    });
    const result = (await h.call("list_users", { limit: 1 })).json() as { users: { email: string }[] };
    expect(result.users.map((u) => u.email)).toEqual(["returned@example.com"]);
  });

  it("user_activity answers one account's counts and dates, by address in any case or by id", async () => {
    const h = await harness(routes);
    const ada = (await h.call("user_activity", { email: "ADA@example.com" })).json() as { user: Record<string, unknown> };
    expect(ada.user).toEqual(expect.objectContaining({ email: "ada@example.com", questions: 2, spendMonth: "2026-10" }));
    expect((await h.call("user_activity", { id: users[2]?.id })).json()).toEqual({
      user: expect.objectContaining({ email: "never@example.org" }),
    });
  });

  /* Sol's F3 on plan 261007o: a field added to the admin page's row later must
     not reach an AI conversation without somebody deciding it should. */
  it("user_activity answers an allowlist, so a field the admin page gains later stays out", async () => {
    const planted = users.map((u) => ({ ...u, articleTitles: ["SENTINEL-TITLE"], profile: "SENTINEL-PROFILE" }));
    const h = await harness({ "GET /api/admin/users": { body: { users: planted } } });
    const result = await h.call("user_activity", { email: "ada@example.com" });
    expect(result.text).not.toContain("SENTINEL");
    expect(Object.keys((result.json() as { user: object }).user).sort()).toEqual(
      [
        "id", "email", "createdAt", "lastSignInAt", "emailConfirmedAt", "providers", "lastReadAt",
        "articles", "archived", "uploads", "questions", "chats", "searches", "opens",
        "spendNanos", "spendCalls", "spendUnpricedCalls", "spendMonth",
        "plan", "planStatus", "ingests", "ingestsShared", "ingestLimit", "ingestWindow",
      ].sort(),
    );
    const listed = await h.call("list_users");
    expect(listed.text).not.toContain("SENTINEL");
  });

  it("user_activity needs exactly one of email or id, and says when there is no such account", async () => {
    const h = await harness(routes);
    expect((await h.call("user_activity", {})).isError).toBe(true);
    expect((await h.call("user_activity", { email: "a@b.c", id: users[0]?.id })).isError).toBe(true);
    const missing = await h.call("user_activity", { email: "nobody@example.com" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("No account");
  });

  for (const tool of ["list_users", "user_activity"]) {
    it(`${tool}: the server's 403 says the tool is admin-only, and neither asks`, async () => {
      const approver = new StubApprover(true);
      const h = await harness(
        { "GET /api/admin/users": { status: 403, body: { error: "That page is for the site's administrator. [admin-only]" } } },
        approver,
      );
      const result = await h.call(tool, tool === "user_activity" ? { email: "ada@example.com" } : {});
      expect(result.isError).toBe(true);
      expect(result.text).toContain("admins only");
      expect(approver.asked).toEqual([]);
    });
  }
});
