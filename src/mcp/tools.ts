/**
 * **The MCP tools, as data** — plan 261007j § The tools (V1).
 *
 * Each tool is a name, the words the model reads, a zod input, MCP
 * annotations, and a handler that takes an `Api` and the checked arguments.
 * Nothing here knows about stdio or MCP's wire, so the remote server the plan
 * defers can wrap the same list (§ Deferred).
 *
 * **Nothing here decides who may do what.** Every handler is one or two calls
 * to a route that already decides that for the signed-in person; an admin-only
 * tool says so in its description because the server will refuse anybody else,
 * not because this file checks.
 *
 * A tool with `ask` sends mail or publishes, and **the person approves it**:
 * `ask` describes the exact operation and `server.ts` puts it to them through
 * an `Approver` (approve.ts) before the handler runs — outside MCP, so neither
 * the model nor the app can answer for them (Sol F1, F12). Every input is a
 * strict object, so an argument such as `approved: true` is refused rather
 * than quietly carried.
 */

import { createHash } from "node:crypto";

import type { ToolAnnotations } from "@modelcontextprotocol/server";
import * as z from "zod";

import type { AdminUser } from "../admin.js";
import { type AdminAuthorGift, type AdminAuthorLookup, AUTHOR_GIFT_NOTES_MAX } from "../admin-author-gifts.js";
import type { AdminVoucher } from "../admin-vouchers.js";
import { freeArticles } from "../admin-vouchers.js";
import { SHARING_RIGHTS_CONFIRM } from "../messages.js";
import { SHARE_KEY_PARAM } from "../share-key.js";
import type { LibraryEntry, ShareLinkState } from "../types.js";
import { type Api, ApiError } from "./api.js";
import type { Operation } from "./approve.js";

/** What a handler may know besides its arguments. */
export interface ToolContext {
  /** Who this server is signed in as — the sign-in it is bound to (session.ts). */
  identity(): Promise<{ userId: string; email: string }>;
}

/** What must be shown, plus an optional write already bound to the facts shown. */
export interface ApprovalRequest {
  readonly operation: Operation;
  /**
   * Used when describing the operation required a read whose result selects the
   * write. Keeping the closure makes approval and execution one snapshot rather
   * than re-reading and possibly acting on a different object afterwards.
   */
  readonly run?: () => Promise<unknown>;
}

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: S;
  readonly annotations: ToolAnnotations;
  /**
   * **Present on a tool a person must approve.** Describes the exact
   * operation to put to them, or `null` when this call needs no approval (an
   * `update_gift_voucher` that does not change the address).
   */
  readonly ask?: (api: Api, args: z.infer<S>, ctx: ToolContext) => Promise<ApprovalRequest | null>;
  readonly handler: (api: Api, args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

/** Erases the per-tool input type so a list can hold them all; each was checked where it was written. */
function tool<S extends z.ZodObject>(t: Tool<S>): Tool {
  return t as unknown as Tool;
}

/* ---------------------------------------------------------------- helpers -- */

const slugInput = z.string().min(1).describe("The article's slug, as list_articles gives it.");

function seg(value: string): string {
  return encodeURIComponent(value);
}

export function articleLink(api: Api, slug: string): string {
  return `${api.site}/read/${seg(slug)}`;
}

/** A shelf entry cut to what an agent needs, plus the link it will want to put in a message. */
function trimEntry(api: Api, e: LibraryEntry, archived: boolean) {
  return {
    slug: e.slug,
    title: e.title,
    ...(e.url ? { url: e.url } : {}),
    link: articleLink(api, e.slug),
    added: e.addedAt,
    tags: e.tags ?? [],
    words: e.words,
    visibility: e.visibility ?? "private",
    privateLinkOn: e.privateLinkOn === true,
    archived,
  };
}

async function shelf(api: Api, archived: boolean): Promise<LibraryEntry[]> {
  const answer = await api.call<{ articles: LibraryEntry[] }>("GET", `/api/library${archived ? "?archived=1" : ""}`);
  return answer.articles;
}

/** `slug` at the top of an object earns a `link` beside it. */
function withLink<T>(api: Api, value: T): T {
  if (value && typeof value === "object" && typeof (value as { slug?: unknown }).slug === "string") {
    return { ...value, link: articleLink(api, (value as unknown as { slug: string }).slug) };
  }
  return value;
}

/**
 * **The voucher id, derived from the operation's key and nothing else** —
 * plan § A retry sends one gift, not two (Sol F2, then F13).
 *
 * The server treats a second create under one id as a replay when the body is
 * the same (`200 replayed`, nothing sent) and as a `409` when it is not. So
 * the id must come from *which gift this is* — the site, the admin giving it,
 * and the agent's `idempotency_key` — and never from the gift's contents: a
 * retry that changed a word in the note must reach that 409, not mint a new id
 * and send a second gift.
 *
 * A name-based UUID in the RFC 9562 version 5 shape: SHA-1 over a fixed
 * namespace and `JSON.stringify([origin, userId, key])`, with the version and
 * variant bits set.
 */
export const VOUCHER_NAMESPACE = "6b3f1c52-8d0e-4c1a-9f57-2e8a4b7d9c31";

export function voucherId(site: string, userId: string, idempotencyKey: string): string {
  const canonical = JSON.stringify([new URL(site).origin, userId, idempotencyKey]);
  const namespace = Buffer.from(VOUCHER_NAMESPACE.replace(/-/g, ""), "hex");
  const bytes = createHash("sha1").update(namespace).update(canonical, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quoted(text: string): string {
  return `"${text}"`;
}

async function listVouchers(api: Api): Promise<AdminVoucher[]> {
  return (await api.call<{ vouchers: AdminVoucher[] }>("GET", "/api/admin/vouchers")).vouchers;
}

async function findVoucher(api: Api, id: string): Promise<AdminVoucher> {
  const found = (await listVouchers(api)).find((v) => v.id === id.toLowerCase());
  if (!found) throw new ApiError(404, "There is no such voucher.");
  return found;
}

/**
 * **A voucher as an agent sees it** — Sol F17. Recipients' addresses and names
 * are what the agent needs to avoid gifting someone twice; the private note,
 * the note to them, and a claimant's usage figures are not, and every word
 * here goes into an AI provider's conversation.
 */
function trimVoucher(v: AdminVoucher) {
  return {
    id: v.id,
    email: v.email,
    recipientName: v.recipientName,
    articles: v.articles,
    createdAt: v.createdAt,
    claimed: v.claimedAt !== null,
    claimedAt: v.claimedAt,
    revoked: v.revokedAt !== null,
    hasNote: v.note !== null || v.recipientNote !== null,
    giftEmail: v.emails.gift ? { status: v.emails.gift.status, retryable: v.emails.gift.retryable } : null,
  };
}

/** One lookup, explicitly allow-listed because every field returned here enters an AI conversation. */
function trimAuthorLookup(l: AdminAuthorLookup) {
  return {
    id: l.id,
    createdAt: l.createdAt,
    finishedAt: l.finishedAt,
    outcome: l.outcome,
    failure: l.failure,
    authorName: l.authorName,
    authorSourceUrl: l.authorSourceUrl,
    email: l.email,
    emailSourceUrl: l.emailSourceUrl,
    suggestedEmail: l.suggestedEmail,
    contactUrl: l.contactUrl,
    searches: l.searches,
    model: l.model,
    cost: l.cost,
  };
}

/** An author gift as an agent sees it. Never spread the route's object: it must not grow a private-link key by accident. */
function trimAuthorGift(api: Api, g: AdminAuthorGift) {
  return {
    id: g.id,
    status: g.status,
    starter: { slug: g.starter.slug, title: g.starter.title, link: articleLink(api, g.starter.slug) },
    email: g.email,
    recipientName: g.recipientName,
    recipientNote: g.recipientNote,
    articles: g.articles,
    notes: g.notes,
    notesUpdatedAt: g.notesUpdatedAt,
    emailLookupId: g.emailLookupId,
    nameLookupId: g.nameLookupId,
    createdAt: g.createdAt,
    createdBy: g.createdBy,
    updatedAt: g.updatedAt,
    sendStartedAt: g.sendStartedAt,
    discardedAt: g.discardedAt,
    voucherId: g.voucherId,
    lookups: g.lookups.map(trimAuthorLookup),
  };
}

const voucherNote = z.string().max(500).nullable().optional();

async function titleOf(api: Api, slug: string): Promise<string | undefined> {
  const entries = [...(await shelf(api, false)), ...(await shelf(api, true))];
  return entries.find((e) => e.slug === slug)?.title;
}

/* --------------------------------------------- the private link (261007o) -- */

function shareLinkPath(slug: string): string {
  return `/api/article/${seg(slug)}/share-link`;
}

/** The link an owner's card shows, with its key: a credential, so it is built only for the person's yes. */
function privateLink(api: Api, slug: string, state: ShareLinkState) {
  if (!state.on) throw new ApiError(500, "Spideryarn did not make the link.");
  const link = new URL(articleLink(api, slug));
  link.searchParams.set(SHARE_KEY_PARAM, state.key);
  return { link: link.toString(), since: state.since };
}

/* ------------------------------------------------ readers, for the admin -- */

async function listUsers(api: Api): Promise<AdminUser[]> {
  return (await api.call<{ users: AdminUser[] }>("GET", "/api/admin/users")).users;
}

/** The most recent sign of life across reading, signing in and signing up. */
function lastActive(u: AdminUser): string {
  return [u.lastReadAt, u.lastSignInAt, u.createdAt]
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1)!;
}

/**
 * **A reader as `list_users` shows one** — enough to say who they are and
 * whether they are active, for a list that may be long. `user_activity` has
 * an explicit set of activity fields. Neither names an article: `AdminUser` never does
 * (docs/project/admin.md § What it deliberately does not show).
 */
function trimUser(u: AdminUser) {
  return {
    id: u.id,
    email: u.email,
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt ?? null,
    lastReadAt: u.lastReadAt ?? null,
    articles: u.articles,
    archived: u.archived,
    plan: u.plan,
  };
}

/**
 * **One reader's activity, field by field** (Sol's F3 on 261007o). Named
 * rather than spread, so a field the admin page's row gains later does not
 * reach an AI conversation until somebody adds it here.
 */
function userActivity(u: AdminUser) {
  return {
    ...trimUser(u),
    emailConfirmedAt: u.emailConfirmedAt ?? null,
    providers: u.providers,
    uploads: u.uploads,
    questions: u.questions,
    chats: u.chats,
    searches: u.searches,
    opens: u.opens,
    /* The period and the unpriced count travel with the money, as on the page. */
    spendNanos: u.spendNanos,
    spendCalls: u.spendCalls,
    spendUnpricedCalls: u.spendUnpricedCalls,
    spendMonth: u.spendMonth,
    planStatus: u.planStatus ?? null,
    ingests: u.ingests,
    ingestsShared: u.ingestsShared,
    ingestLimit: u.ingestLimit,
    ingestWindow: u.ingestWindow,
  };
}

/* ------------------------------------------------------------------ tools -- */

export const TOOLS: readonly Tool[] = [
  tool({
    name: "whoami",
    title: "Who am I signed in as",
    description:
      "Who this Spideryarn session is signed in as, and whether new imports automatically run the main reading modes. " +
      "It cannot tell whether you are an admin: the server decides that on each admin-only call.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api, _args, ctx) => {
      const me = await ctx.identity();
      const reader = await api.call<{ autoModes?: boolean }>("GET", "/api/reader");
      return { email: me.email, userId: me.userId, site: api.site, autoModes: reader.autoModes ?? null };
    },
  }),

  tool({
    name: "list_articles",
    title: "List my articles",
    description:
      "The articles on your Spideryarn shelf: slug, title, source url, a link to read it, when it was added, tags, " +
      "word count, whether it is public, and whether a private link is on. `archive` chooses active articles " +
      "(the default), archived ones, or all.",
    input: z.strictObject({
      archive: z.enum(["active", "archived", "all"]).default("active"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api, { archive }) => {
      const [active, archived] = await Promise.all([
        archive !== "archived" ? shelf(api, false) : Promise.resolve([]),
        archive !== "active" ? shelf(api, true) : Promise.resolve([]),
      ]);
      return {
        articles: [
          ...active.map((e) => trimEntry(api, e, false)),
          ...archived.map((e) => trimEntry(api, e, true)),
        ],
      };
    },
  }),

  tool({
    name: "search_library",
    title: "Search my articles",
    description:
      "Full-text search over the text of the articles on your shelf. Answers matching passages with the article " +
      "each came from and its link. At most 30 hits.",
    input: z.strictObject({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(30).optional(),
      includeArchived: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api, { query, limit, includeArchived }) => {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set("limit", String(limit));
      if (includeArchived) params.set("archived", "1");
      const answer = await api.call<{ hits?: unknown[] }>("GET", `/api/library/search?${params}`);
      return { ...answer, hits: (answer.hits ?? []).map((h) => withLink(api, h)) };
    },
  }),

  tool({
    name: "list_tags",
    title: "List my tags",
    description: "Every tag you use on your shelf, with how many articles carry it.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api) => await api.call("GET", "/api/library/tags"),
  }),

  tool({
    name: "edit_tags",
    title: "Add or remove tags on an article",
    description: "Adds and removes your own tags on one of your articles. Answers the article's tags afterwards.",
    input: z.strictObject({
      slug: slugInput,
      add: z.array(z.string().min(1)).optional(),
      remove: z.array(z.string().min(1)).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (api, { slug, add, remove }) =>
      await api.call("PATCH", `/api/library/${seg(slug)}/tags`, {
        ...(add ? { add } : {}),
        ...(remove ? { remove } : {}),
      }),
  }),

  tool({
    name: "import_article",
    title: "Import an article from a URL",
    description:
      "Adds the article at a web address to your shelf. It runs in the background: this answers the import job, " +
      "and get_import_status says when it is done. On a free plan it uses one of your free articles; when they " +
      "are gone Spideryarn refuses. An address you already have answers that article instead " +
      "({ article, repeat: true }), and costs nothing. An address somebody else has already made public answers " +
      "that public copy instead ({ publicCopy: { slug, title }, link }), costs nothing and imports nothing: it can " +
      "be read free at the link, read-only. Ask the reader which they want; call again with own_copy: true to " +
      "import their own copy, which uses one of their articles.",
    input: z.strictObject({ url: z.string().url(), own_copy: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    /* A job, or — for an address the reader already has — `{ article, repeat: true }`,
       free and with nothing queued (plan 261007k), or somebody else's public
       copy, also free, for the reader to choose (plan 261009j). The link is the
       article's in each. */
    handler: async (api, { url, own_copy }) => {
      const answer = await api.call("POST", "/api/jobs", { url, ...(own_copy === true ? { ownCopy: true } : {}) });
      if (answer && typeof answer === "object" && typeof (answer as { article?: unknown }).article === "string") {
        return { ...answer, link: articleLink(api, (answer as { article: string }).article) };
      }
      const found = answer && typeof answer === "object" ? (answer as { publicCopy?: { slug?: unknown } }).publicCopy : undefined;
      if (found && typeof found.slug === "string") {
        return { ...(answer as object), link: articleLink(api, found.slug) };
      }
      return withLink(api, answer);
    },
  }),

  tool({
    name: "get_import_status",
    title: "Check one import",
    description: "Where one import job has got to, by the id import_article answered.",
    input: z.strictObject({ id: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api, { id }) => withLink(api, await api.call("GET", `/api/jobs/${seg(id)}`)),
  }),

  tool({
    name: "list_imports",
    title: "List my recent imports",
    description: "Your recent import and processing jobs, and where each has got to.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api) => {
      const answer = await api.call<{ jobs?: unknown[] }>("GET", "/api/jobs");
      return { ...answer, jobs: (answer.jobs ?? []).map((j) => withLink(api, j)) };
    },
  }),

  tool({
    name: "set_auto_modes",
    title: "Run the main modes on import, or not",
    description:
      "Turns on or off the setting that makes every new import also prepare the main reading modes. One switch " +
      "for all of them; there is no per-mode choice.",
    input: z.strictObject({ on: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (api, { on }) => {
      const reader = await api.call<{ autoModes: boolean }>("PATCH", "/api/reader", { autoModes: on });
      return { autoModes: reader.autoModes };
    },
  }),

  tool({
    name: "make_article_private",
    title: "Make an article private",
    description: "Stops one of your articles being readable by anyone with its link. It stays on your shelf.",
    input: z.strictObject({ slug: slugInput }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (api, { slug }) =>
      await api.call("PUT", `/api/article/${seg(slug)}/visibility`, { visibility: "private" }),
  }),

  tool({
    name: "make_article_public",
    title: "Make an article public",
    description:
      "Makes one of your articles readable by anyone with its link, and answers that link. Publishing republishes " +
      "somebody's text, so a dialog on this computer asks the person to approve it and to confirm they have the " +
      "right to share it. You cannot approve it for them.",
    input: z.strictObject({ slug: slugInput }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    ask: async (api, { slug }) => {
      const title = await titleOf(api, slug);
      return {
        operation: {
          title: "Spideryarn: make an article public?",
          lines: [
            `Make this article public, so anyone with its link can read its full text?`,
            "",
            `Article: ${title ? `${quoted(title)} ` : ""}(${slug})`,
            `Link: ${articleLink(api, slug)}`,
            `Site: ${api.site}`,
            "",
            `Approving confirms: ${SHARING_RIGHTS_CONFIRM}`,
          ],
        },
      };
    },
    handler: async (api, { slug }) => {
      const answer = await api.call("PUT", `/api/article/${seg(slug)}/visibility`, {
        visibility: "public",
        rightsConfirmed: true,
      });
      return { link: articleLink(api, slug), visibility: answer };
    },
  }),

  /* Plan 261007o. **Read first; make one only when there is none**: a POST
     mints a new key and the old one stops working, so posting for a link that
     already exists would break it for everybody it was sent to. The read is in
     `ask` and the approved action is bound to its answer (`run`), so approving
     "hand over the existing link" can never become a POST. */
  tool({
    name: "create_private_link",
    title: "Get a private link to an article",
    description:
      "Answers the private link to one of your articles (its address with a key), making one if it has none. " +
      "Anyone who has the link can read the article without signing in, and can pass it on. An existing link is " +
      "handed over unchanged, never replaced. The key is a credential, so a dialog on this computer asks the " +
      "person to approve every call, and to confirm they have the right to share the article when one is made. " +
      "You cannot approve it for them.",
    input: z.strictObject({ slug: slugInput }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    ask: async (api, { slug }) => {
      const [state, title] = await Promise.all([
        api.call<ShareLinkState>("GET", shareLinkPath(slug)),
        titleOf(api, slug),
      ]);
      /* Keep identity separate: the native dialog caps each line, so a long
         article title must not hide which slug the person is approving. */
      const article = [`Slug: ${slug}`, ...(title ? [`Article: ${quoted(title)}`] : [])];
      if (state.on) {
        return {
          operation: {
            title: "Spideryarn: hand over a private link?",
            lines: [
              "This article already has a private link. Give it to the AI assistant?",
              "Anyone who has it can read the article, and the assistant keeps it in its conversation.",
              "",
              ...article,
              `Site: ${api.site}`,
            ],
          },
          /* **Read again after the yes, and hand over only the link approved**
             (Sol's F2). A fresh authenticated call is what re-checks the session
             binding, so a logout or another sign-in while the dialog was open
             hands over nothing; a link turned off or remade meanwhile is an
             error without a key, never a substitute. */
          run: async () => {
            const now = await api.call<ShareLinkState>("GET", shareLinkPath(slug));
            if (!now.on || now.key !== state.key) {
              throw new ApiError(409, "The private link changed while the dialog was open, so nothing was handed over. Ask again.");
            }
            return privateLink(api, slug, now);
          },
        };
      }
      return {
        operation: {
          title: "Spideryarn: make a private link?",
          lines: [
            "Make a private link to this article, and give it to the AI assistant?",
            "Anyone who has it can read the article, and the assistant keeps it in its conversation.",
            "",
            ...article,
            `Site: ${api.site}`,
            "",
            `Approving confirms: ${SHARING_RIGHTS_CONFIRM}`,
          ],
        },
        /* `keepExisting`: somebody may have made one while the dialog was open
           (the owner, on the article's page). The server hands that one over
           rather than replace it, deciding under its row lock (Sol's F1). */
        run: async () =>
          privateLink(
            api,
            slug,
            await api.call<ShareLinkState>("POST", shareLinkPath(slug), { rightsConfirmed: true, keepExisting: true }),
          ),
      };
    },
    handler: async () => {
      throw new Error("create_private_link must run the action prepared for approval");
    },
  }),

  tool({
    name: "list_users",
    title: "List Spideryarn's readers",
    description:
      "Admin only. Every account on Spideryarn, most recently active first: email address, when they signed up, " +
      "last signed in and last read, how many articles they have (and archived), and their plan. `query` keeps " +
      "only addresses containing it; `limit` caps how many come back (`total` says how many matched). " +
      "user_activity has one account's full activity. Never which articles they read or anything they wrote.",
    input: z.strictObject({
      query: z.string().min(1).optional().describe("A piece of the email address, any case."),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api, { query, limit }) => {
      const needle = query?.toLowerCase();
      const matched = (await listUsers(api))
        .filter((u) => needle === undefined || u.email.toLowerCase().includes(needle))
        .sort((a, b) => lastActive(b).localeCompare(lastActive(a)));
      return { total: matched.length, users: matched.slice(0, limit).map(trimUser) };
    },
  }),

  tool({
    name: "user_activity",
    title: "One reader's activity",
    description:
      "Admin only. One account, by `email` or `id` (exactly one): sign-up, last sign-in, last read, articles, " +
      "archived, uploads, questions, chats, searches, opens, this month's model spend and calls, plan, and imports " +
      "against their limit. Counts and dates only: never which articles they read or anything they wrote.",
    input: z.strictObject({
      email: z.string().min(3).optional(),
      id: z.string().uuid().optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api, { email, id }) => {
      if ((email === undefined) === (id === undefined)) throw new ApiError(400, "Give exactly one of email or id.");
      const users = await listUsers(api);
      const found = users.find((u) =>
        email !== undefined ? u.email.toLowerCase() === email.trim().toLowerCase() : u.id === id?.toLowerCase(),
      );
      if (!found) throw new ApiError(404, "No account has that address or id.");
      return { user: userActivity(found) };
    },
  }),

  tool({
    name: "list_gift_vouchers",
    title: "List gift vouchers",
    description:
      "Admin only. Every gift voucher: its id, who it was for (address and name), how many free articles, when it " +
      "was made, whether it has been claimed or revoked, whether it has notes, and where its gift email has got to. " +
      "The notes themselves are not shown.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api) => ({ vouchers: (await listVouchers(api)).map(trimVoucher) }),
  }),

  tool({
    name: "create_gift_voucher",
    title: "Give someone free articles",
    description:
      "Admin only. Creates a gift voucher of free articles for an email address and **sends that person a real " +
      "gift email**. A dialog on this computer asks the person to approve every one. `idempotency_key` names this " +
      "one gift: calling again with the same key never sends a second gift (the same arguments are a harmless " +
      "replay; changed arguments are refused), so reuse it when you retry and choose a new one for a new gift.",
    input: z.strictObject({
      email: z.string().min(3).describe("The recipient's email address."),
      articles: z.number().int().min(1).max(1000).describe("How many free articles."),
      recipientName: z.string().max(80).nullable().optional().describe('Their name; the email opens "Dear <name>,".'),
      recipientNote: voucherNote.describe("A note to them, put in their email."),
      note: voucherNote.describe("A private note for admins. Not sent."),
      idempotency_key: z
        .string()
        .min(1)
        .max(80)
        .describe("A short stable name for this gift, e.g. 'ada-lovelace-oct'; reuse it if you retry."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    ask: async (api, a) => ({
      operation: {
        title: "Spideryarn: send a gift email?",
        lines: [
          "Send this gift email?",
          "",
          `To: ${a.email.trim()}`,
          ...(a.recipientName ? [`Opens: Dear ${a.recipientName},`] : []),
          `Gift: ${freeArticles(a.articles)}`,
          `Note to them: ${a.recipientNote ? quoted(a.recipientNote) : "(none)"}`,
          `Site: ${api.site}`,
        ],
      },
    }),
    handler: async (api, a, ctx) => {
      const id = voucherId(api.site, (await ctx.identity()).userId, a.idempotency_key);
      const answer = await api.call<{ id: string; email: "queued" | "replayed" }>("POST", "/api/admin/vouchers", {
        id,
        email: a.email,
        articles: a.articles,
        note: a.note ?? null,
        recipientNote: a.recipientNote ?? null,
        recipientName: a.recipientName ?? null,
      });
      return {
        ...answer,
        said:
          answer.email === "replayed"
            ? "This gift already existed under that idempotency_key, so nothing new was created or sent."
            : "Created; the gift email is on its way.",
      };
    },
  }),

  tool({
    name: "update_gift_voucher",
    title: "Change or revoke a gift voucher",
    description:
      "Admin only. Changes a voucher's number of articles, notes or name, or revokes it (revoked: true) or " +
      "restores it (revoked: false); none of those sends anything. Changing the email address **sends the gift " +
      "email to the new address**, so a dialog on this computer asks the person to approve that change. A claimed " +
      "voucher's address cannot change.",
    input: z.strictObject({
      id: z.string().uuid().describe("The voucher's id, from list_gift_vouchers."),
      email: z.string().min(3).optional(),
      articles: z.number().int().min(1).max(1000).optional(),
      recipientName: z.string().max(80).nullable().optional(),
      recipientNote: voucherNote,
      note: voucherNote,
      revoked: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    ask: async (api, a) =>
      a.email === undefined
        ? null
        : {
            operation: {
              title: "Spideryarn: send a gift email to a new address?",
              lines: [
                "Change this gift voucher's address? That sends the gift email to the new address.",
                "",
                `Voucher: ${a.id}`,
                `New address: ${a.email.trim()}`,
                ...(a.recipientName ? [`Opens: Dear ${a.recipientName},`] : []),
                ...(a.articles !== undefined ? [`Gift: ${freeArticles(a.articles)}`] : []),
                ...(a.recipientNote ? [`Note to them: ${quoted(a.recipientNote)}`] : []),
                `Site: ${api.site}`,
              ],
            },
          },
    handler: async (api, { id, ...change }) => {
      const body = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
      if (Object.keys(body).length === 0) throw new ApiError(400, "Nothing to change.");
      return await api.call("PATCH", `/api/admin/vouchers/${seg(id)}`, body);
    },
  }),

  tool({
    name: "retry_gift_voucher_email",
    title: "Send a voucher email again",
    description:
      "Admin only. Tries again to send a voucher email that failed or was skipped: by default the gift email to " +
      'the recipient, or with which: "claimed" the notice to the voucher\'s creator. **It sends a real email**, ' +
      "so a dialog on this computer asks the person to approve it. Spideryarn refuses if it was already sent.",
    input: z.strictObject({
      voucherId: z.string().uuid().describe("The voucher's id, from list_gift_vouchers."),
      which: z.enum(["gift", "claimed"]).default("gift"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    ask: async (api, { voucherId: id, which }) => {
      const v = await findVoucher(api, id);
      const email = v.emails[which];
      if (!email) throw new ApiError(404, `That voucher has no ${which} email to retry.`);
      return {
        operation: {
          title: "Spideryarn: send a voucher email again?",
          lines: [
            "Send this voucher email again?",
            "",
            /* **Only the address, never the voucher's current name, count or note.** A
               retry re-sends the email exactly as it was first written
               (src/store/pg-voucher-emails.ts keeps the rendered text so a retry sends the
               same bytes), and the route does not expose that text. Showing today's fields
               would let the person approve words that are not the ones sent, whenever the
               voucher was edited after the first attempt. Sol's C6, code review 261007j.
               The address is right: the route refuses a voucher re-addressed since. */
            ...(which === "gift"
              ? [`The gift email, to: ${v.email}`, "Exactly as first written: any edits to the voucher since are not in it."]
              : [`The "your gift was claimed" notice to the voucher's creator, about ${v.email}`]),
            `Site: ${api.site}`,
          ],
        },
        run: async () => await api.call("POST", `/api/admin/voucher-emails/${seg(email.id)}/retry`),
      };
    },
    handler: async () => {
      throw new Error("retry_gift_voucher_email must run the delivery prepared for approval");
    },
  }),

  /* **Author gifts** — plan 261010c § D6. Greg wanted the notes reachable "perhaps
     via MCP", so an agent can read the drafts and add what it found. Neither tool
     reaches the outside world, so neither asks; *Send* is deliberately not a tool
     (it sends mail), and stays a button on /admin/vouchers. */
  tool({
    name: "list_author_gifts",
    title: "List author gifts",
    description:
      "Admin only. Every author gift, newest first: a draft gift voucher for the author of one of the admin's own " +
      "articles. Each has its id, status (draft, sending, sent or discarded), the article (slug, title, link), the " +
      "address and name and which lookup supplied each (null when typed by hand), the note to them, how many free " +
      "articles, the admin's notes in full, and every web-search lookup with what it found, its sources and its " +
      "cost in nano-dollars. Never a private link. Nothing can be sent from here: a gift is sent only by pressing " +
      "Send on /admin/vouchers.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (api) => {
      const { gifts } = await api.call<{ gifts: AdminAuthorGift[] }>("GET", "/api/admin/author-gifts");
      return { gifts: gifts.map((g) => trimAuthorGift(api, g)) };
    },
  }),

  tool({
    name: "update_author_gift",
    title: "Change an author gift's notes or draft",
    description:
      "Admin only. Changes an author gift: its notes, and, while it is still a draft, its address, name, note to " +
      "them and number of free articles. Sends nothing. To add to the notes, use `append_notes`: it adds your text " +
      "as a new paragraph under whatever is there, and cannot lose anybody else's words. Append rather than replace. " +
      "`notes` **replaces the whole notes field**; use it only to correct or tidy them, and expect a refusal if " +
      "somebody else wrote the notes since this tool read them (then call list_author_gifts and try again). Notes " +
      "can change in every status, sent included; the other fields only on a draft. Changing the address or name " +
      "marks it as typed by hand rather than found by a lookup.",
    input: z.strictObject({
      id: z.string().uuid().describe("The gift's id, from list_author_gifts."),
      append_notes: z
        .string()
        .trim()
        .min(1)
        .max(AUTHOR_GIFT_NOTES_MAX)
        .optional()
        .describe(
          "Preferred. A paragraph to add under the notes, e.g. what you found and where. Admins only ever see the " +
            "notes; they are never emailed.",
        ),
      notes: z
        .string()
        .max(AUTHOR_GIFT_NOTES_MAX)
        .nullable()
        .optional()
        .describe("Replaces the whole notes text (null or empty clears it). Prefer append_notes. Not with append_notes."),
      email: z.string().min(3).nullable().optional().describe("The recipient's address, or null for none yet."),
      recipientName: z.string().max(80).nullable().optional().describe('Their name; the email opens "Dear <name>,".'),
      recipientNote: voucherNote.describe("A note to them, put in their email when the gift is sent."),
      articles: z.number().int().min(1).max(1000).optional().describe("How many free articles."),
    }),
    /* Not idempotent: two appends add two paragraphs. */
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    handler: async (api, { id, append_notes, ...change }) => {
      if (append_notes !== undefined && change.notes !== undefined) {
        throw new ApiError(400, "Give append_notes (preferred) or notes, not both.");
      }
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
      if (append_notes !== undefined) body.appendNotes = append_notes;
      if (Object.keys(body).length === 0) throw new ApiError(400, "Nothing to change.");
      /* A replace says which notes it is replacing (Sol's C7): the stamp as
         listed now, so a write that lands between this read and the PATCH is
         refused rather than overwritten. */
      if (change.notes !== undefined) {
        const { gifts } = await api.call<{ gifts: AdminAuthorGift[] }>("GET", "/api/admin/author-gifts");
        const gift = gifts.find((g) => g.id === id);
        if (!gift) throw new ApiError(404, "There is no such author gift.");
        body.notesBase = gift.notesUpdatedAt;
      }
      const answer = await api.call<{ notesUpdatedAt?: unknown }>("PATCH", `/api/admin/author-gifts/${seg(id)}`, body);
      return { ok: true, notesUpdatedAt: typeof answer.notesUpdatedAt === "string" ? answer.notesUpdatedAt : null };
    },
  }),
];

/* ----------------------------------------------------- failures, in words -- */

const ADMIN_ONLY = new Set([
  "list_users",
  "user_activity",
  "list_gift_vouchers",
  "create_gift_voucher",
  "update_gift_voucher",
  "retry_gift_voucher_email",
  "list_author_gifts",
  "update_author_gift",
]);

/** A failure as the sentence a tool error says. Neither source of its text can hold a token. */
export function describeFailure(toolName: string, err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 0:
        return err.serverMessage;
      case 401:
        return `Spideryarn did not accept this session (401): ${err.serverMessage}. Run \`spideryarn-mcp login\` again.`;
      case 402:
        return (
          `Spideryarn refused: ${err.serverMessage}. This account has used its free articles, ` +
          "so nothing more can be imported until it has more (a gift voucher, or a paid plan)."
        );
      case 403:
        return `Spideryarn refused: ${err.serverMessage}${ADMIN_ONLY.has(toolName) ? " (this tool is for Spideryarn admins only)" : ""}`;
      case 404:
        return `Not found: ${err.serverMessage}`;
      case 409:
        return toolName === "create_gift_voucher"
          ? `Spideryarn refused: ${err.serverMessage} That idempotency_key was already used for a different gift; nothing was sent. Use a new key for a new gift.`
          : `Spideryarn refused (409): ${err.serverMessage}`;
      default:
        return `Spideryarn refused (${err.status}): ${err.serverMessage}`;
    }
  }
  return err instanceof Error ? err.message : `Something went wrong: ${String(err)}`;
}
