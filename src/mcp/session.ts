/**
 * **The local MCP server's signed-in session: one small file per site, built as
 * a piece of authentication** — docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md
 * § How you sign in, locally (Sol F3, F14, F15).
 *
 * It holds a Supabase access token and refresh token, and four things make that
 * more delicate than "write some JSON":
 *
 * - **Supabase rotates the refresh token on every use and treats reuse of an
 *   old one as theft**, revoking the session. An AI app may start several
 *   copies of the server at once, and two copies refreshing together would
 *   sign Greg out. So every change to the file — login, refresh, logout —
 *   happens under one exclusive lock, and whoever takes it **re-reads the file
 *   first**: a copy that waited finds the fresh token and spends nothing, and a
 *   refresh that waited behind a logout finds no file and does not write one
 *   back.
 * - **A running server is bound to the sign-in it started with** (F14): the
 *   user id and the token's `session_id`. Somebody running `login` as another
 *   account, or `logout`, while a server is running must not let that server
 *   act as the new account or keep using a cached token, so the file is read
 *   again before every call and a different sign-in, or none, is refused.
 * - **The file is a credential**: its directory is ours and `0700`, the file
 *   `0600`, and anything else is refused rather than used.
 * - **It is written whole** — a temp file, then `rename` — so a crash leaves the
 *   old file or the new one, never half of either.
 *
 * No Supabase client library: three plain calls to the Auth REST API, so every
 * place a token goes is in this file. **No token ever reaches an error message
 * or a log line**; `scrub` is the backstop for the one place text arrives from
 * outside (Supabase's own error description).
 */

import { randomBytes } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** What one session file holds. `expiresAt` is the access token's expiry, in epoch seconds. */
export interface SessionData {
  readonly site: string;
  readonly supabaseUrl: string;
  readonly supabaseKey: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly userId: string;
  readonly email: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SessionOptions {
  /** The directory the session files live in. Default `SPIDERYARN_MCP_HOME`, else `~/.config/spideryarn-mcp`. */
  readonly home?: string;
  readonly fetch?: FetchLike;
  /** Milliseconds since the epoch; injected so a test can move time. */
  readonly now?: () => number;
}

/** Refresh when the token in the file has less than this left. */
const REFRESH_MARGIN_SECONDS = 60;
/**
 * A lock file older than this belongs to a copy that died holding it. It is
 * safe only because nothing done under the lock can take longer: the one slow
 * thing is a call to Supabase, and that is cut off at `AUTH_TIMEOUT_MS`.
 */
const LOCK_STALE_MS = 30_000;
const AUTH_TIMEOUT_MS = 10_000;
/** How long to wait for somebody else's lock before giving up. */
const LOCK_WAIT_MS = 40_000;

/** A failure to read, sign in or refresh, in words that are safe to show anyone. */
export class SessionError extends Error {
  override name = "SessionError";
}

export function sessionHome(home?: string): string {
  return home ?? process.env.SPIDERYARN_MCP_HOME ?? path.join(os.homedir(), ".config", "spideryarn-mcp");
}

/**
 * The site, normalised to its origin — `https://www.spideryarn.com/` and
 * `https://www.spideryarn.com` are one site with one session.
 */
export function siteOrigin(site: string): string {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new SessionError(`Not a site address: ${site}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SessionError(`The site must be an http or https address: ${site}`);
  }
  return url.origin;
}

/** One file per host, so a local stack and production keep separate sessions. `:` is not portable in a filename. */
export function sessionFileFor(site: string, home?: string): string {
  const host = new URL(siteOrigin(site)).host.replace(/[^\w.-]/g, "_");
  return path.join(sessionHome(home), `${host}.json`);
}

/**
 * The claims this file cares about from an access token, **unverified**: the
 * server verifies the token on every call. These are read only to notice that
 * the file now holds a different sign-in from the one a server started with.
 */
export function tokenClaims(token: string): { sub?: string; sessionId?: string } {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return {
      ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}),
      ...(typeof payload.session_id === "string" ? { sessionId: payload.session_id } : {}),
    };
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------ the files -- */

function ownedByUs(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

/**
 * The directory must be ours and closed to writes from anyone else — somebody
 * who can write there can swap the file. Made `0700` when missing; an
 * existing one that others can merely read is tightened.
 */
async function checkHome(home: string, create: boolean): Promise<void> {
  if (create) await fs.mkdir(home, { recursive: true, mode: 0o700 });
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(home);
  } catch {
    return; /* No directory means no file, which the caller reports. */
  }
  if (!stat.isDirectory()) throw new SessionError(`Refusing ${home}: it is not a directory.`);
  if (!ownedByUs(stat.uid)) throw new SessionError(`Refusing ${home}: it is owned by another user.`);
  if ((stat.mode & 0o022) !== 0) {
    throw new SessionError(`Refusing ${home}: other users could write to it (mode ${(stat.mode & 0o777).toString(8)}).`);
  }
  if ((stat.mode & 0o077) !== 0) await fs.chmod(home, 0o700);
}

/**
 * Read a session file, refusing anything that is not a regular file owned by
 * us and closed to everyone else. `lstat`, not `stat`: a symlink is refused
 * rather than followed, so nobody can point us at a file of their choosing.
 */
export async function readSessionFile(file: string): Promise<SessionData> {
  await checkHome(path.dirname(file), false);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SessionError(`Not signed in: there is no session at ${file}. Run \`login\` first.`);
    }
    throw new SessionError(`Could not read the session at ${file}.`);
  }
  if (!stat.isFile()) throw new SessionError(`Refusing ${file}: it is not a regular file.`);
  if (!ownedByUs(stat.uid)) throw new SessionError(`Refusing ${file}: it is owned by another user.`);
  if ((stat.mode & 0o077) !== 0) {
    throw new SessionError(
      `Refusing ${file}: other users could read it (mode ${(stat.mode & 0o777).toString(8)}). ` +
        "Delete it and run `login` again, since its tokens may have been seen.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new SessionError(`The session at ${file} is not valid JSON. Run \`login\` again.`);
  }
  return asSessionData(parsed, file);
}

function asSessionData(value: unknown, file: string): SessionData {
  const v = (value ?? {}) as Record<string, unknown>;
  const strings = ["site", "supabaseUrl", "supabaseKey", "accessToken", "refreshToken", "userId", "email"] as const;
  for (const key of strings) {
    if (typeof v[key] !== "string") throw new SessionError(`The session at ${file} is missing ${key}. Run \`login\` again.`);
  }
  if (typeof v.expiresAt !== "number") {
    throw new SessionError(`The session at ${file} is missing expiresAt. Run \`login\` again.`);
  }
  return v as unknown as SessionData;
}

/** Written whole: a `0600` temp file beside it, then `rename`, which is atomic on one filesystem. */
export async function writeSessionFile(file: string, data: SessionData): Promise<void> {
  await checkHome(path.dirname(file), true);
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

/* ------------------------------------------------------------ the lock -- */

/**
 * **Run `fn` holding `<file>.lock`.** Three properties, each for a reason:
 *
 * - **Exclusive**: created with `O_EXCL`, so exactly one process makes it.
 * - **Owned**: it holds a random token, and is removed at the end only if it
 *   still holds ours — so a holder that was presumed dead and overtaken
 *   cannot, on waking, delete the lock its successor now holds.
 * - **Recoverable**: one older than thirty seconds is taken over. It is
 *   *renamed* aside rather than deleted, and the renamed file is checked to
 *   be the stale one we looked at; if a live holder's fresh lock was caught
 *   instead, it is put back.
 *
 * Acquisition and stale takeover share a short-lived `<lock>.acquire` gate.
 * Without it, one waiter can rename the stale lock, a second can install a
 * fresh lock, and the first can then rename that fresh lock away; a third
 * waiter enters while the second still owns the critical section. The gate is
 * held only for local filesystem operations, never for `fn` or a network call.
 */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  await checkHome(path.dirname(file), true);
  const lock = `${file}.lock`;
  const token = randomBytes(16).toString("hex");
  const started = Date.now();
  for (;;) {
    const acquired = await withAcquisitionGate(lock, async () => {
      for (;;) {
        try {
          const handle = await fs.open(lock, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
          try {
            await handle.writeFile(token);
          } finally {
            await handle.close();
          }
          return true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
          if (!(await takeOverIfStale(lock))) return false;
          /* Still holding the acquisition gate: no other waiter can fill the
             name between taking the stale inode aside and this retry. */
        }
      }
    });
    if (acquired) break;
    if (Date.now() - started > LOCK_WAIT_MS) {
      throw new SessionError(`Gave up waiting for ${lock}. If no other copy is running, delete it.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 40));
  }
  try {
    return await fn();
  } finally {
    const holder = await fs.readFile(lock, "utf8").catch(() => undefined);
    if (holder === token) await fs.rm(lock, { force: true });
  }
}

/**
 * Serialize the few filesystem operations that acquire or replace `lock`.
 * This guard is deliberately not subject to automatic stale takeover: doing
 * that safely would need another compare-and-swap gate and recreate the same
 * race one level up. A process can strand it only in this tiny, network-free
 * window; refusing with a deletion instruction is safer than two holders.
 */
async function withAcquisitionGate<T>(lock: string, fn: () => Promise<T>): Promise<T> {
  const gate = `${lock}.acquire`;
  const token = randomBytes(16).toString("hex");
  const started = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(gate, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
      try {
        await handle.writeFile(token);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - started > LOCK_WAIT_MS) {
        throw new SessionError(`Gave up waiting for ${gate}. If no other copy is starting, delete it.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
    }
  }
  try {
    return await fn();
  } finally {
    const holder = await fs.readFile(gate, "utf8").catch(() => undefined);
    if (holder === token) await fs.rm(gate, { force: true });
  }
}

async function takeOverIfStale(lock: string): Promise<boolean> {
  let seen: string;
  try {
    const stat = await fs.stat(lock);
    if (Date.now() - stat.mtimeMs <= LOCK_STALE_MS) return false;
    seen = await fs.readFile(lock, "utf8");
  } catch {
    return true; /* Gone already: try again at once. */
  }
  const aside = `${lock}.${randomBytes(6).toString("hex")}.stale`;
  try {
    await fs.rename(lock, aside);
  } catch {
    return true;
  }
  const caught = await fs.readFile(aside, "utf8").catch(() => seen);
  if (caught !== seen) {
    /* A fresh lock was made between our look and our rename: give it back.
       `link` fails if somebody has made yet another, which is then theirs. */
    await fs.link(aside, lock).catch(() => undefined);
  }
  await fs.rm(aside, { force: true });
  return true;
}

/* ------------------------------------------------- Supabase Auth, by hand -- */

/** Any secret we know of, replaced, in text that came from outside. */
function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out.slice(0, 300);
}

interface TokenAnswer {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}

async function tokenRequest(
  doFetch: FetchLike,
  supabaseUrl: string,
  supabaseKey: string,
  grant: "password" | "refresh_token",
  body: Record<string, string>,
  now: () => number,
  what: string,
): Promise<TokenAnswer> {
  const secrets = Object.values(body);
  let res: Response;
  try {
    res = await doFetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new SessionError(
      `${what} failed: could not reach ${supabaseUrl} (${scrub(String((err as Error)?.message ?? err), secrets)}).`,
    );
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* Answered below as a bad status or a malformed answer. */
  }
  if (!res.ok) {
    const said = json.error_description ?? json.msg ?? json.message ?? json.error ?? "";
    throw new SessionError(`${what} was refused (${res.status})${said ? `: ${scrub(String(said), secrets)}` : ""}.`);
  }
  const user = (json.user ?? {}) as Record<string, unknown>;
  const access = json.access_token;
  const refresh = json.refresh_token;
  if (typeof access !== "string" || typeof refresh !== "string" || typeof user.id !== "string") {
    throw new SessionError(`${what} answered without a session.`);
  }
  const expiresAt =
    typeof json.expires_at === "number"
      ? json.expires_at
      : Math.floor(now() / 1000) + (typeof json.expires_in === "number" ? json.expires_in : 3600);
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt,
    userId: user.id,
    email: typeof user.email === "string" ? user.email : "",
  };
}

/**
 * **Sign in with email and password and save the session**, under the lock.
 * The password is sent once and not kept anywhere, by this function or its
 * caller.
 */
export async function login(
  args: { site: string; supabaseUrl: string; supabaseKey: string; email: string; password: string },
  options: SessionOptions = {},
): Promise<{ file: string; data: SessionData }> {
  const now = options.now ?? Date.now;
  const site = siteOrigin(args.site);
  const file = sessionFileFor(site, options.home);
  return await withLock(file, async () => {
    const answer = await tokenRequest(
      options.fetch ?? fetch,
      args.supabaseUrl,
      args.supabaseKey,
      "password",
      { email: args.email, password: args.password },
      now,
      "Signing in",
    );
    const data: SessionData = { site, supabaseUrl: args.supabaseUrl, supabaseKey: args.supabaseKey, ...answer };
    await writeSessionFile(file, data);
    return { file, data };
  });
}

/* --------------------------------------------------------- the session -- */

/** Who a running server acts as: fixed by its first read, and checked on every later one. */
export interface Binding {
  readonly userId: string;
  readonly sessionId?: string;
}

/**
 * **One site's session, as the API caller sees it**: a token to send, and a
 * way to get a better one when the server says no. Several of these, in one
 * process or many, may share one file; the lock is what keeps them honest,
 * and the binding is what keeps each of them one reader.
 */
export class Session {
  readonly site: string;
  readonly file: string;
  private readonly doFetch: FetchLike;
  private readonly now: () => number;
  private binding: Binding | undefined;

  constructor(site: string, options: SessionOptions = {}) {
    this.site = siteOrigin(site);
    this.file = sessionFileFor(this.site, options.home);
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Who this session is bound to, binding it now if it is not yet. */
  async bind(): Promise<Binding> {
    const data = await this.read();
    return this.binding ?? this.bindTo(data);
  }

  private bindTo(data: SessionData): Binding {
    const { sub, sessionId } = tokenClaims(data.accessToken);
    if (!sub || !sessionId) {
      throw new SessionError(
        `The session at ${this.file} has an access token that does not identify its user and session. Run \`login\` again.`,
      );
    }
    if (sub !== data.userId) {
      throw new SessionError(`The access token in ${this.file} does not match the session file's user. Run \`login\` again.`);
    }
    this.binding = { userId: data.userId, sessionId };
    return this.binding;
  }

  /** The file as it stands, checked. No refresh, no binding check. */
  private async readFile(): Promise<SessionData> {
    const data = await readSessionFile(this.file);
    if (siteOrigin(data.site) !== this.site) {
      throw new SessionError(`The session at ${this.file} is for ${data.site}, not ${this.site}.`);
    }
    return data;
  }

  /**
   * **The file, and only if it is still the sign-in this session is bound to.**
   * Gone means somebody ran `logout`; a different user or session id means
   * somebody ran `login`. Either way this process stops, rather than send a
   * request as somebody it did not start as.
   */
  async read(): Promise<SessionData> {
    let data: SessionData;
    try {
      data = await this.readFile();
    } catch (err) {
      if (this.binding && err instanceof SessionError && err.message.startsWith("Not signed in")) {
        throw new SessionError(
          "This server's Spideryarn session was signed out (`logout` ran), so it will not act any more. " +
            "Run `login` and restart the server.",
        );
      }
      throw err;
    }
    if (!this.binding) return data;
    const claims = tokenClaims(data.accessToken);
    const sameUser = data.userId === this.binding.userId && (claims.sub ?? data.userId) === this.binding.userId;
    const sameSession = this.binding.sessionId === undefined || claims.sessionId === this.binding.sessionId;
    if (!sameUser || !sameSession) {
      throw new SessionError(
        "The Spideryarn session file now holds a different sign-in from the one this server started with " +
          "(somebody ran `login` again), so this server will not act. Restart it to use the new sign-in.",
      );
    }
    return data;
  }

  private nearlyExpired(data: SessionData): boolean {
    return data.expiresAt - this.now() / 1000 < REFRESH_MARGIN_SECONDS;
  }

  /** A token with at least a minute left, from the bound sign-in, refreshing first if it must. */
  async accessToken(): Promise<string> {
    if (!this.binding) await this.bind();
    const data = await this.read();
    if (!this.nearlyExpired(data)) return data.accessToken;
    return await this.refreshUnderLock((inFile) => this.nearlyExpired(inFile));
  }

  /**
   * **The server refused `rejected`.** Refresh — unless the file already holds
   * a different token for the same sign-in, which means another copy
   * refreshed while we were calling, and that token is the one to try.
   */
  async refreshAfterRejection(rejected: string): Promise<string> {
    if (!this.binding) await this.bind();
    return await this.refreshUnderLock((inFile) => inFile.accessToken === rejected || this.nearlyExpired(inFile));
  }

  /**
   * Take the lock, **re-read the file** (bound, so a logout or a different
   * login is refused here too), and refresh only if what is in the file still
   * needs it. The re-read is the whole defence: a copy that waited finds the
   * token the first one wrote, and a refresh that waited behind a logout finds
   * no file and writes none back.
   */
  private async refreshUnderLock(stillNeeds: (inFile: SessionData) => boolean): Promise<string> {
    return await withLock(this.file, async () => {
      const inFile = await this.read();
      if (!stillNeeds(inFile)) return inFile.accessToken;
      return (await this.refreshLocked(inFile)).accessToken;
    });
  }

  /** The refresh itself. Only ever called holding the lock. */
  private async refreshLocked(inFile: SessionData): Promise<SessionData> {
    const answer = await tokenRequest(
      this.doFetch,
      inFile.supabaseUrl,
      inFile.supabaseKey,
      "refresh_token",
      { refresh_token: inFile.refreshToken },
      this.now,
      "Refreshing the Spideryarn session",
    ).catch((err: unknown) => {
      throw err instanceof SessionError ? new SessionError(`${err.message} Run \`login\` again.`) : err;
    });
    if (answer.userId !== inFile.userId) {
      throw new SessionError("Refreshing the session answered a different user. Run `login` again.");
    }
    const next: SessionData = { ...inFile, ...answer, email: answer.email || inFile.email };
    await writeSessionFile(this.file, next);
    if (this.binding) await this.read(); /* The refreshed file is checked against the binding too. */
    return next;
  }

  /**
   * **Revoke this session at Supabase and delete the file**, under the lock.
   * `scope=local` signs out this sign-in only — Supabase's default is every
   * device. The file goes even if Supabase cannot be reached, and the answer
   * says which happened.
   */
  async logout(): Promise<{ revoked: boolean }> {
    return await withLock(this.file, async () => {
      let data = await this.readFile();
      /* An expired token cannot sign itself out, so refresh first if need be. */
      if (this.nearlyExpired(data)) data = await this.refreshLocked(data).catch(() => data);
      let revoked = false;
      try {
        const res = await this.doFetch(`${data.supabaseUrl.replace(/\/$/, "")}/auth/v1/logout?scope=local`, {
          method: "POST",
          headers: { apikey: data.supabaseKey, Authorization: `Bearer ${data.accessToken}` },
          signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
        });
        revoked = res.ok;
      } catch {
        revoked = false;
      }
      await fs.rm(this.file, { force: true });
      return { revoked };
    });
  }
}
