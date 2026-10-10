/**
 * **The MCP tools at an address: `POST /api/mcp`, for an AI app signed in with
 * OAuth** — plan docs/plans/261007p-mcp-remote-sign-in-with-oauth.md, read with
 * its "Revised after Sol's plan review" section, which overrides the rest.
 *
 * The local server (scripts/spideryarn-mcp.ts) runs on the owner's Mac and
 * calls the site over HTTP. Cowork on the web, or Claude on a phone, cannot
 * start a program; they can only talk to a server at an address. So the same
 * `TOOLS` are served here, and Supabase's OAuth server issues the token.
 *
 * ## The gate, which is this file's own
 *
 * Dispatched in `serveApi` **before** `requireUser`, as the Stripe webhook is,
 * because `requireUser` refuses exactly the tokens this route exists for (an
 * OAuth token carries `client_id`; src/auth.ts). In order:
 *
 * 1. **`Origin`**, when present, is this site's own, `https://claude.ai` or
 *    `https://chatgpt.com`; anything else, `null` included, is a 403 (Sol F7).
 *    Absent is fine: a server-side client sends none.
 * 2. **`MCP_OAUTH_CLIENT_ID` must be set**, or everyone is refused: the route
 *    ships dark. Either a comma-separated list of hand-registered client ids,
 *    or `*`: any app Supabase's dynamic registration let in, so any MCP client
 *    works with just the URL (Greg turned that on, 2026-10-09; 261009a).
 * 3. **The token verifies as `requireUser`'s does** — the same
 *    `verifiedClaims` and `personFrom` — **and it carries a `client_id`**, one
 *    of those listed unless the list contains `*`. `personFrom` also requires
 *    the authenticated role, which Supabase's OAuth ID tokens lack despite
 *    carrying `client_id`. A browser's token, an unlisted
 *    app's, or none: 401, with the
 *    `WWW-Authenticate` header that tells an MCP client where to sign in.
 * 4. **The administrator only** (`isAdmin`), else 403. Offering this to readers
 *    is a later decision, and the consent page's wording would change with it.
 *
 * ## Then the tools run as that person, through the site's own routes
 *
 * Each tool calls `Api.call`, which here is **in-process**: it builds a request
 * and hands it to `handleApi`, so every route's own checks — owner scoping, the
 * admin namespace, billing — apply exactly as they do to the browser. No token
 * travels inside. The synthetic request carries a random sentinel made for
 * this one request, and the verifier `handleApi` is given answers yes to that
 * sentinel only, with the claims already verified above minus `client_id`. It
 * is created per request and never leaves this closure, so nothing new can be
 * made to authenticate (Sol: "defensible if its verifier is private, created
 * per verified request, and used only for tool-constructed requests").
 *
 * ## One request, one server
 *
 * Stateless Streamable HTTP with JSON answers: a fresh `McpServer`, transport
 * and identity per `POST`, closed afterwards (Sol F5 — the SDK refuses a second
 * request on a stateless transport, and a shared server closed over one
 * person's identity is a hazard under concurrency). `GET` and `DELETE` are 405.
 *
 * ## The asking tools are not offered
 *
 * Sending mail, publishing and handing over a private link need the owner's
 * approval, which is a dialog on their Mac; a server on Vercel cannot show
 * one. So the list served here is `remoteTools()`, which leaves those tools
 * out so a model does not plan around them (plan 261010i § D2), and the
 * approver throws `CannotAsk` with the page to use, whatever the OS, should
 * one ever be reached (Sol F8: a remote request served during Mac development
 * must refuse too).
 *
 * **Not imported by the local server.** scripts/spideryarn-mcp.ts must not
 * pull in src/routes.ts, and this file is reached only from there; it takes
 * `handleApi` as an argument rather than importing it, which also keeps
 * routes.ts → remote.ts from being a cycle.
 */

import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { isAdmin } from "../admin.js";
import { afterResponse } from "../after-response.js";
import {
  personFrom,
  type TokenClaims,
  type Verifier,
  verifiedClaims,
  verifyWithSupabase,
} from "../auth.js";
import { siteOrigin } from "../site-origin.js";
import { type Api, ApiError, type HttpMethod } from "./api.js";
import { type Approver, CannotAsk } from "./approve.js";
import { remoteTools } from "./tools.js";
import { buildServer } from "./server.js";

export const MCP_PATH = "/api/mcp";
export const MCP_METADATA_PATH = "/api/mcp/resource-metadata";

/** Where RFC 9728 says a client looks for `/api/mcp`'s metadata; vercel.json rewrites it to `MCP_METADATA_PATH`. */
export const MCP_WELL_KNOWN_PATH = "/.well-known/oauth-protected-resource/api/mcp";

/** The AI apps' own origins, the only others a browser may call `/api/mcp` from. Exact match. */
const APP_ORIGINS: readonly string[] = ["https://claude.ai", "https://chatgpt.com"];

/** In `MCP_OAUTH_CLIENT_ID`, admits any OAuth client Supabase issued a token to. */
const ANY_CLIENT = "*";

/** A JSON-RPC body is small; the transport's own default is 4 MiB, which a tool call never needs. */
const MAX_BODY_BYTES = 1024 * 1024;

export function isRemoteMcpPath(path: string): boolean {
  return path === MCP_PATH || path === MCP_METADATA_PATH;
}

type HandleApi = (req: IncomingMessage, res: ServerResponse, verify?: Verifier) => Promise<boolean>;

export interface RemoteMcpRequest {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  /** `serveApi`'s verifier seam: undefined is the real one. */
  readonly verify: Verifier | undefined;
  /** src/routes.ts's own, handed in so this file does not import it. */
  readonly handleApi: HandleApi;
}

/** Mirrors src/routes.ts: a thrown error carrying its status, answered by `serveApi`'s catch. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function origin(): string {
  return siteOrigin().replace(/\/$/, "");
}

/** The two routes. Every refusal is thrown, so `serveApi`'s catch answers and logs it. */
export async function serveRemoteMcp(r: RemoteMcpRequest): Promise<void> {
  r.res.setHeader("Cache-Control", "no-store");
  if (r.path === MCP_METADATA_PATH) return serveMetadata(r);
  return serveMcp(r);
}

/** RFC 9728's protected-resource metadata: what this resource is, and who signs you in for it. */
function serveMetadata({ res, method }: RemoteMcpRequest): void {
  if (method !== "GET") {
    res.setHeader("Allow", "GET");
    throw httpError(405, "Only GET is answered here.");
  }
  const supabase = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  if (!supabase) throw httpError(503, "Sign-in is not configured on this server.");
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      resource: `${origin()}${MCP_PATH}`,
      authorization_servers: [`${supabase}/auth/v1`],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
    }),
  );
}

/** A 401 that says where to sign in, which is how an MCP client finds the authorization server. */
function unauthorized(res: ServerResponse, message: string): Error {
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${origin()}${MCP_WELL_KNOWN_PATH}"`);
  return httpError(401, message);
}

/** The person this request is from, or a thrown refusal. Steps 1–4 of the header. */
async function gate({ req, res, verify }: RemoteMcpRequest): Promise<{ claims: TokenClaims; userId: string; email: string }> {
  const sent = req.headers.origin;
  if (sent !== undefined && sent !== origin() && !APP_ORIGINS.includes(sent)) {
    throw httpError(403, "Requests from that page are not accepted here. [mcp-origin]");
  }

  const clients = (process.env.MCP_OAUTH_CLIENT_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (clients.length === 0) throw unauthorized(res, "Remote MCP is not switched on for this site. [mcp-off]");

  let claims: TokenClaims;
  try {
    claims = await verifiedClaims(req, verify ?? verifyWithSupabase);
  } catch (err) {
    /* A 503 is our outage, not their token: no sign-in header on it. */
    if ((err as { status?: number }).status === 401) throw unauthorized(res, (err as Error).message);
    throw err;
  }
  const anyApp = clients.includes(ANY_CLIENT);
  if (typeof claims.client_id !== "string" || claims.client_id === "" || !(anyApp || clients.includes(claims.client_id))) {
    throw unauthorized(res, "That sign-in is not one this server accepts. [mcp-client]");
  }
  let user: ReturnType<typeof personFrom>;
  try {
    user = personFrom(claims);
  } catch (err) {
    throw unauthorized(res, (err as Error).message);
  }
  if (!isAdmin(user.id)) {
    throw httpError(403, "The MCP tools are for the administrator, for now. [mcp-admin-only]");
  }
  return { claims, userId: user.id, email: user.email };
}

async function serveMcp(r: RemoteMcpRequest): Promise<void> {
  const who = await gate(r);
  const { req, res, method } = r;

  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    throw httpError(405, "Only POST is answered here: there is no session and no stream.");
  }

  const body = await readBytes(req);
  const lifetime = new AbortController();
  const server = buildServer({
    api: inProcessApi(who.claims, r.handleApi, lifetime.signal),
    ctx: { identity: async () => ({ userId: who.userId, email: who.email }) },
    approver: REMOTE_APPROVER,
    /* Without the tools that could only refuse here (261010i § D2). */
    tools: remoteTools(),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const abort = () => lifetime.abort();
  const onClose = () => {
    if (!res.writableEnded) abort();
  };
  const disconnected = new Promise<null>((resolve) => {
    lifetime.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  try {
    req.once("aborted", abort);
    res.once("close", onClose);
    if (req.aborted || res.destroyed) abort();
    if (lifetime.signal.aborted) throw httpError(499, "The MCP request has ended. [mcp-closed]");
    await server.connect(transport);
    // The JSON transport's close() does not settle handleRequest. Race the
    // disconnect separately so cleanup also runs while a tool is still busy.
    const answer = await Promise.race([transport.handleRequest(
      new Request(`${origin()}${MCP_PATH}`, {
        method: "POST",
        headers: webHeaders(req.headers),
        body: new Uint8Array(body),
        signal: lifetime.signal,
      }),
    ), disconnected]);
    if (answer === null) throw httpError(499, "The MCP request has ended. [mcp-closed]");
    const bytes = Buffer.from(await answer.arrayBuffer());
    res.statusCode = answer.status;
    answer.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.end(bytes);
  } finally {
    req.off("aborted", abort);
    res.off("close", onClose);
    // A tool already running may finish, but cannot start another inner route
    // after this exchange ends. Already accepted routes/jobs keep their scope.
    abort();
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

/**
 * The request's headers, minus the token. Nothing downstream needs it — the
 * tools run on the in-process `Api` — and leaving it out means the SDK never
 * holds it.
 */
function webHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === "authorization" || name === "host") continue;
    out.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return out;
}

async function readBytes(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  /* An early return from the default iterator destroys IncomingMessage and
     its socket, before serveApi can send the 413. Keep the transport alive
     and drain the unused bytes without retaining them. */
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      throw httpError(413, "Request body too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * **No one can be asked from here.** The asking tools are not even listed
 * (`remoteTools`, 261010i § D2); this is the backstop, should one ever be
 * reached: it refuses, naming the page that does the same job with the owner
 * present. Unconditional: never chosen by the host's OS.
 */
export const REMOTE_APPROVER: Approver = {
  async approve(): Promise<boolean> {
    throw new CannotAsk(
      "Sending mail, publishing and handing over a private link need your approval, which is a dialog in the " +
        "Mac app and cannot be shown from here. Do it in the Mac app, or on Spideryarn itself: /admin/vouchers " +
        "for gift vouchers (draft_author_gift saves one there for you to send), the article's page for " +
        "publishing or its private link. Nothing was done.",
    );
  },
};

/**
 * **The site's routes, called in this process as the verified person.** See
 * the header: a sentinel per request, and a verifier that knows only it.
 */
export function inProcessApi(claims: TokenClaims, handleApi: HandleApi, lifetime: AbortSignal): Api {
  const sentinel = randomBytes(32).toString("base64url");
  const { client_id: _app, ...asPerson } = claims;
  const verify: Verifier = async (token) =>
    !lifetime.aborted && token === sentinel ? { ok: true, claims: asPerson } : { ok: false, kind: "bad-token" };
  const site = origin();

  return {
    site,
    async call<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
      if (lifetime.aborted) throw new ApiError(0, "This MCP request has ended. Ask again.");
      if (!path.startsWith("/api/") || path.startsWith(`${MCP_PATH}`)) {
        throw new ApiError(0, `A tool asked for ${path}, which is not one of the site's routes.`);
      }
      const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
      const req = Object.assign(Readable.from(payload), {
        method,
        url: path,
        headers: {
          authorization: `Bearer ${sentinel}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
      }) as unknown as IncomingMessage;
      const res = new CapturedResponse();
      const handled = handleApi(req, res as unknown as ServerResponse, verify);
      // If the outer connection closes, Vercel must still await this accepted
      // route, its cost ledger, and its own after-response tasks. Register its
      // completion in the outer request's queue; the work has already started.
      await afterResponse("mcp-inner-route", () => handled);
      await handled;

      const text = Buffer.concat(res.chunks).toString("utf8");
      let json: unknown;
      try {
        json = text === "" ? undefined : JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const said =
          json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
            ? (json as { error: string }).error
            : `the site answered ${res.statusCode} without saying why`;
        throw new ApiError(res.statusCode, said);
      }
      if (json === undefined && text !== "") {
        throw new ApiError(res.statusCode, `the site answered ${res.statusCode} with something that is not JSON`);
      }
      return json as T;
    },
  };
}

/**
 * Just enough `ServerResponse` for `handleApi` to answer into: the status,
 * the headers and the bytes, kept. An `EventEmitter` because a streaming route
 * listens for `close`; none of the tools' routes stream.
 */
class CapturedResponse extends EventEmitter {
  statusCode = 200;
  readonly chunks: Buffer[] = [];
  readonly headers = new Map<string, string | number | readonly string[]>();
  headersSent = false;
  writableEnded = false;
  destroyed = false;

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }
  hasHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }
  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }
  writeHead(status: number, headers?: Record<string, string | number | readonly string[]>): this {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers ?? {})) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  flushHeaders(): void {
    this.headersSent = true;
  }
  write(chunk: string | Uint8Array): boolean {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    return true;
  }
  end(chunk?: string | Uint8Array): this {
    if (chunk !== undefined) this.write(chunk);
    this.headersSent = true;
    this.writableEnded = true;
    this.emit("finish");
    this.emit("close");
    return this;
  }
}
