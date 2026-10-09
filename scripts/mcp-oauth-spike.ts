/**
 * **The remote MCP's sign-in, run for real against the local stack** — the spike
 * docs/plans/261007p-mcp-remote-sign-in-with-oauth.md § What landed left as the
 * first step of switching on. No browser: it plays both Claude (the OAuth client)
 * and the reader pressing Allow on /oauth/consent, using the same supabase-js
 * calls that page makes.
 *
 *     npx tsx scripts/mcp-oauth-spike.ts register --out <file> [--redirect URI]
 *     MCP_OAUTH_CLIENT_ID=<id> npm run dev        # in another shell
 *     npx tsx scripts/mcp-oauth-spike.ts flow --client <file> --site http://localhost:<port> \
 *         --email <admin email> [--password-env VAR]
 *
 * `register` creates one confidential client with the service-role key from
 * `.env.local` (local only: it refuses a non-local SUPABASE_URL). `flow` runs
 * discovery → authorize (with `resource=`) → consent → token, prints the token's
 * claims (never the token), then checks (a) `/api/mcp` serves it, (b) the same
 * token on `/api/library` is a 401, and (c) what `PUT /auth/v1/user` does with it,
 * using a harmless `data` field that it then removes again.
 */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { parseEnvFile } from "../src/env.js";

const env = { ...parseEnvFile(readFileSync(".env.local", "utf8")), ...process.env } as Record<string, string>;
const SUPABASE_URL = env.SUPABASE_URL ?? "";
const PUBLISHABLE = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/* Validate every target, including discovery, before sending credentials.
   URL parsing matters: localhost:password@production.example is not local. */
class SpikeError extends Error {}
function localUrl(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SpikeError(`${label} must be a local HTTP URL`); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.hash) {
    throw new SpikeError(`${label} must be a local HTTP URL without credentials or a fragment`);
  }
  return url;
}

/* Even the SDK uses this fetch. Never follow a redirect with a password,
   service key, authorization code or bearer token. */
const localFetch: typeof fetch = async (input, init) => {
  localUrl(input instanceof Request ? input.url : String(input), "request target");
  return fetch(input, { ...init, redirect: "manual" });
};
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } };

function localOrigin(value: string, label: string): URL {
  const url = localUrl(value, label);
  if (url.pathname !== "/" || url.search) throw new SpikeError(`${label} must be a local origin`);
  return url;
}

function checkedCallback(value: string, callback: URL, state: string, issuer: string): URL {
  const back = localUrl(value, "approved redirect");
  if (back.origin !== callback.origin || back.pathname !== callback.pathname || back.searchParams.get("state") !== state ||
      (back.searchParams.has("iss") && back.searchParams.get("iss") !== issuer)) {
    throw new SpikeError("OAuth callback URI, state or issuer mismatch");
  }
  return back;
}

async function mcp(resource: string, bearer: Record<string, string>, method: string, params: unknown, id: number) {
  const r = await localFetch(resource, {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json", accept: "application/json, text/event-stream", origin: new URL(resource).origin },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  line(`(a) ${method} status`, r.status);
  if (!r.ok) throw new SpikeError("MCP request failed");
  const reply = await r.json() as { error?: unknown; result?: { isError?: boolean } };
  if (reply.error || !reply.result || reply.result.isError) throw new SpikeError("MCP returned a protocol or tool error");
}

async function probeMetadata(base: URL, bearer: Record<string, string>) {
  const probeKey = `mcp_spike_${b64url(randomBytes(16))}`;
  const write = (value: boolean | null) => localFetch(`${base.origin}/auth/v1/user`, {
    method: "PUT",
    headers: { ...bearer, apikey: PUBLISHABLE, "content-type": "application/json" },
    body: JSON.stringify({ data: { [probeKey]: value } }),
  });
  async function undo() {
    const response = await write(null);
    line("    undone", response.status);
    if (!response.ok) throw new SpikeError("local account metadata cleanup failed");
  }
  let cleanup = true;
  try {
    const put = await write(true);
    line("(c) PUT /auth/v1/user data status", put.status);
    if (put.status === 401 || put.status === 403) cleanup = false;
    else if (!put.ok) throw new SpikeError("metadata probe returned an unexpected status");
  } finally {
    /* Also clean up if the response was lost after the write. A random key
       avoids overwriting an existing field. An explicit refusal wrote nothing. */
    if (cleanup) await undo();
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function need(name: string): string {
  const v = flag(name);
  if (!v || v.startsWith("--")) throw new SpikeError(`${name} is required`);
  return v;
}

const b64url = (b: Buffer) => b.toString("base64url");

function claimsOf(jwt: string): Record<string, unknown> {
  const [, payload = ""] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function line(label: string, value: unknown) {
  console.log(`${label.padEnd(34)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function register() {
  const base = localOrigin(SUPABASE_URL, "SUPABASE_URL");
  const admin = createClient(base.origin, SERVICE, options);
  const redirect = flag("--redirect") ?? "http://localhost:8976/callback";
  const callback = localUrl(redirect, "redirect URI");
  if (callback.search) throw new SpikeError("redirect URI must have no query");
  /* Reserve a new private file before registration; never overwrite or follow
     a symlink to an existing file containing credentials. */
  const out = openSync(need("--out"), "wx", 0o600);
  try {
    const { data, error } = await admin.auth.admin.oauth.createClient({
      client_name: "MCP spike (local)",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "client_secret_post",
    });
    if (error || !data) throw new SpikeError("client registration failed");
    if (data.client_type !== "confidential" || !data.client_secret || data.token_endpoint_auth_method !== "client_secret_post") {
      throw new SpikeError("registration did not return a confidential client using client_secret_post");
    }
    writeFileSync(out, JSON.stringify({ ...data, redirect }, null, 2));
    line("client registered", { client_id: data.client_id, client_type: data.client_type, auth: data.token_endpoint_auth_method });
  } finally {
    closeSync(out);
  }
}

async function flow() {
  const base = localOrigin(SUPABASE_URL, "SUPABASE_URL");
  const siteUrl = localOrigin(need("--site"), "site");
  const client = JSON.parse(readFileSync(need("--client"), "utf8")) as {
    client_id: string;
    client_secret?: string;
    redirect: string;
    token_endpoint_auth_method: string;
  };
  if (!client.client_id || !client.client_secret || client.token_endpoint_auth_method !== "client_secret_post") {
    throw new SpikeError("client file must contain a confidential client using client_secret_post");
  }
  const callback = localUrl(client.redirect, "redirect URI");
  if (callback.search) throw new SpikeError("redirect URI must have no query");
  const site = siteUrl.origin;
  const resource = `${site}/api/mcp`;
  const passwordFile = flag("--password-file");
  const password = passwordFile
    ? readFileSync(passwordFile, "utf8").trim()
    : (env[flag("--password-env") ?? "SPIKE_PASSWORD"] ?? "");
  if (!password) throw new SpikeError("password environment variable is empty");

  /* Discovery: what Claude and ChatGPT read first. */
  /* vercel.json rewrites the well-known address to the route; the dev server does not. */
  let discovery = await localFetch(`${site}/.well-known/oauth-protected-resource/api/mcp`);
  const wellKnownIsJson = discovery.ok && (discovery.headers.get("content-type") ?? "").includes("json");
  line("resource metadata (well-known)", wellKnownIsJson ? "served" : "not routed here; using /api/mcp/resource-metadata");
  if (!wellKnownIsJson) discovery = await localFetch(`${site}/api/mcp/resource-metadata`);
  if (!discovery.ok) throw new SpikeError("protected resource discovery failed");
  const prm = (await discovery.json()) as {
    resource?: string;
    authorization_servers?: string[];
  };
  const asBase = `${base.origin}/auth/v1`;
  if (prm.resource !== resource || prm.authorization_servers?.[0] !== asBase) {
    throw new SpikeError("resource metadata does not describe this local site and Supabase");
  }
  line("protected resource metadata", { resource, authorization_servers: [asBase] });
  /* RFC 8414's path-inserted address is what Claude and ChatGPT try first. The
     local stack's gateway does not route it (production's does), so report it and
     fall back to the suffix form Supabase itself serves. */
  let asDiscovery = await localFetch(`${base.origin}/.well-known/oauth-authorization-server/auth/v1`);
  line("AS discovery (RFC 8414 address)", asDiscovery.status);
  if (!asDiscovery.ok) asDiscovery = await localFetch(`${asBase}/.well-known/oauth-authorization-server`);
  if (!asDiscovery.ok) throw new SpikeError("authorization server discovery failed");
  const meta = (await asDiscovery.json()) as Record<
    string,
    unknown
  >;
  if (meta.issuer !== asBase || meta.authorization_endpoint !== `${asBase}/oauth/authorize` || meta.token_endpoint !== `${asBase}/oauth/token`) {
    throw new SpikeError("discovered OAuth endpoints do not belong to the configured local Supabase");
  }
  for (const k of [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "code_challenge_methods_supported",
    "token_endpoint_auth_methods_supported",
    "client_id_metadata_document_supported",
    "authorization_response_iss_parameter_supported",
    "scopes_supported",
  ]) {
    line(`  AS ${k}`, meta[k] ?? "(absent)");
  }

  /* Authorize, as the client would send the browser. */
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const authorize = new URL(String(meta.authorization_endpoint));
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "openid email profile",
    resource,
  }).toString();
  const auth = await localFetch(authorize);
  const toConsent = auth.headers.get("location") ?? "";
  line("authorize status", auth.status);
  const consent = localUrl(new URL(toConsent, site).href, "consent redirect");
  if (auth.status < 300 || auth.status >= 400 || consent.origin !== site || consent.pathname !== "/oauth/consent") {
    throw new SpikeError("authorize did not redirect to this site's consent page");
  }
  const authorizationId = consent.searchParams.get("authorization_id");
  if (!authorizationId) throw new SpikeError("authorize returned no authorization_id");

  /* The reader, signed in, on /oauth/consent: the page's own calls. */
  const reader = createClient(base.origin, PUBLISHABLE, options);
  const signIn = await reader.auth.signInWithPassword({ email: need("--email"), password });
  if (signIn.error) throw new SpikeError("reader sign-in failed");
  const details = await reader.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error) throw new SpikeError("consent details failed");
  const d = details.data as unknown as Record<string, unknown>;
  let redirect = d.redirect_url;
  if (typeof redirect !== "string") {
    if ((d.client as { id?: string } | undefined)?.id !== client.client_id || d.redirect_uri !== client.redirect) {
      throw new SpikeError("consent request does not match the spike client");
    }
    const approved = await reader.auth.oauth.approveAuthorization(authorizationId);
    if (approved.error) throw new SpikeError("consent approval failed");
    redirect = (approved.data as { redirect_url: string }).redirect_url;
  }
  const back = checkedCallback(String(redirect), callback, state, asBase);
  line("approve → redirect", `${back.origin}${back.pathname}`);
  const code = back.searchParams.get("code");
  if (!code) throw new SpikeError("OAuth callback returned no code");

  /* Code → token, as a confidential client. */
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: client.redirect,
    code_verifier: verifier,
    client_id: client.client_id,
    resource,
  });
  if (client.client_secret) body.set("client_secret", client.client_secret);
  const tok = await localFetch(String(meta.token_endpoint), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = (await tok.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tok.ok || !tokens.access_token) throw new SpikeError(`token exchange failed (${tok.status})`);
  const c = claimsOf(tokens.access_token);
  if (c.client_id !== client.client_id || c.iss !== asBase) throw new SpikeError("token claims do not match the spike issuer and client");
  line("token claims", { iss: c.iss, aud: c.aud, client_id: c.client_id, role: c.role, scope: c.scope, sub: c.sub, aal: c.aal });
  line("refresh token issued", Boolean(tokens.refresh_token));
  const bearer = { Authorization: `Bearer ${tokens.access_token}` };

  /* (a) /api/mcp serves it. */
  await mcp(resource, bearer, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "spike", version: "1" } }, 1);
  await mcp(resource, bearer, "tools/call", { name: "whoami", arguments: {} }, 2);

  /* (b) the same token on an ordinary route. */
  const lib = await localFetch(`${site}/api/library`, { headers: bearer });
  line("(b) /api/library status", lib.status);
  if (lib.status !== 401) throw new SpikeError("ordinary API did not refuse the OAuth token");

  /* (c) what Supabase lets the token do to the account itself. Harmless field, removed after. */
  await probeMetadata(base, bearer);
}

const command = process.argv[2];
try {
  await (command === "register" ? register() : command === "flow" ? flow() : Promise.reject(new SpikeError("register | flow")));
} catch (error) {
  /* SDK/server/network errors can echo credentials. Never dump them or bodies. */
  /* The error's class, code and status say which step broke without echoing a body. */
  const e = error as { name?: string; code?: unknown; status?: unknown };
  console.error(
    error instanceof SpikeError
      ? error.message
      : `Spike failed: ${e.name ?? "error"} code=${String(e.code ?? "-")} status=${String(e.status ?? "-")} (details withheld to protect credentials)`,
  );
  process.exitCode = 1;
}
