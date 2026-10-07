/**
 * **The MCP server's session file, as a piece of authentication** — plan
 * docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md § How you sign
 * in, locally, with GPT Sol's round-2 F14 and F15.
 *
 * A fake Supabase Auth stands in, and it behaves like the real one where it
 * matters: **it rotates the refresh token and rejects an old one**, so two
 * copies refreshing at once would show up as a failure, not pass quietly.
 * Every file lives in a temp directory of the test's own.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeApi } from "../src/mcp/api.js";
import { parseArgs } from "../scripts/spideryarn-mcp.js";
import {
  login,
  readSessionFile,
  Session,
  type SessionData,
  sessionFileFor,
  tokenClaims,
  withLock,
  writeSessionFile,
} from "../src/mcp/session.js";

const SITE = "http://127.0.0.1:5173";
const SUPABASE = "http://supabase.test";
const PASSWORD = "SENTINEL-PASSWORD-91c2";

function jwt(sub: string, sessionId: string, n: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub, session_id: sessionId })}.SENTINEL-SIG-${n}`;
}

/** A Supabase Auth that rotates refresh tokens and treats reuse as theft. */
function fakeAuth(options: { delayMs?: number; logoutDelayMs?: number } = {}) {
  const state = {
    n: 0,
    validRefresh: "SENTINEL-REFRESH-0",
    user: "user-a",
    sessionId: "sess-a",
    email: "a@example.com",
    calls: { password: 0, refresh: 0, logout: [] as { url: string; auth: string | null }[] },
    refreshStarted: undefined as (() => void) | undefined,
    logoutStarted: undefined as (() => void) | undefined,
  };
  const issue = () => {
    state.n += 1;
    state.validRefresh = `SENTINEL-REFRESH-${state.n}`;
    return {
      access_token: jwt(state.user, state.sessionId, state.n),
      refresh_token: state.validRefresh,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: state.user, email: state.email },
    };
  };
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, string>) : {};
    if (url.includes("grant_type=password")) {
      state.calls.password += 1;
      if (body.password !== PASSWORD) {
        return Response.json({ error_description: `Invalid login credentials for ${body.password}` }, { status: 400 });
      }
      return Response.json(issue());
    }
    if (url.includes("grant_type=refresh_token")) {
      state.calls.refresh += 1;
      state.refreshStarted?.();
      await new Promise((r) => setTimeout(r, options.delayMs ?? 30));
      if (body.refresh_token !== state.validRefresh) {
        return Response.json(
          { error_description: `Invalid Refresh Token: Already Used (${body.refresh_token})` },
          { status: 400 },
        );
      }
      return Response.json(issue());
    }
    if (url.includes("/auth/v1/logout")) {
      state.logoutStarted?.();
      await new Promise((r) => setTimeout(r, options.logoutDelayMs ?? 0));
      state.calls.logout.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  };
  return { state, fetch };
}

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "spideryarn-mcp-test-"));
  home = path.join(home, "config");
});

afterEach(async () => {
  await fs.rm(path.dirname(home), { recursive: true, force: true });
});

async function signIn(auth: ReturnType<typeof fakeAuth>) {
  return await login(
    { site: SITE, supabaseUrl: SUPABASE, supabaseKey: "anon-key", email: "a@example.com", password: PASSWORD },
    { home, fetch: auth.fetch },
  );
}

/** Make the token in the file nearly expired, so the next use must refresh. */
async function expireSoon(file: string): Promise<void> {
  const data = await readSessionFile(file);
  await writeSessionFile(file, { ...data, expiresAt: Math.floor(Date.now() / 1000) + 10 });
}

describe("the file", () => {
  it("is 0600 in a 0700 directory, holds the session, and never the password", async () => {
    const auth = fakeAuth();
    const { file, data } = await signIn(auth);
    expect(file).toBe(sessionFileFor(SITE, home));
    expect(path.basename(file)).toBe("127.0.0.1_5173.json");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(home)).mode & 0o777).toBe(0o700);
    const onDisk = await fs.readFile(file, "utf8");
    expect(onDisk).not.toContain(PASSWORD);
    expect(data).toMatchObject({ site: SITE, userId: "user-a", email: "a@example.com", supabaseUrl: SUPABASE });
    expect(tokenClaims(data.accessToken)).toEqual({ sub: "user-a", sessionId: "sess-a" });
  });

  it("refuses a file others can read, without showing what is in it", async () => {
    const { file } = await signIn(fakeAuth());
    await fs.chmod(file, 0o640);
    const err = await readSessionFile(file).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/other users could read it/);
    expect((err as Error).message).not.toMatch(/SENTINEL/);
  });

  it("refuses a symlink rather than following it", async () => {
    const { file } = await signIn(fakeAuth());
    const elsewhere = path.join(path.dirname(home), "elsewhere.json");
    await fs.rename(file, elsewhere);
    await fs.symlink(elsewhere, file);
    await expect(readSessionFile(file)).rejects.toThrow(/not a regular file/);
  });

  it("refuses a directory others can write to", async () => {
    const { file } = await signIn(fakeAuth());
    await fs.chmod(home, 0o770);
    await expect(readSessionFile(file)).rejects.toThrow(/could write to it/);
  });

  it("is written whole: a reader racing many writers never sees half a file, and no temp file is left", async () => {
    const { file, data } = await signIn(fakeAuth());
    const big = { ...data, email: `${"x".repeat(200_000)}@example.com` };
    const failures: unknown[] = [];
    let writing = true;
    const writers = (async () => {
      for (let i = 0; i < 40; i++) await writeSessionFile(file, i % 2 ? big : data);
      writing = false;
    })();
    while (writing) {
      await readSessionFile(file).catch((e: unknown) => failures.push(e));
    }
    await writers;
    expect(failures).toEqual([]);
    expect((await fs.readdir(home)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("refreshing", () => {
  it("two copies refreshing at once make one refresh call, and both end with the new token", async () => {
    const auth = fakeAuth({ delayMs: 80 });
    const { file } = await signIn(auth);
    await expireSoon(file);
    const one = new Session(SITE, { home, fetch: auth.fetch });
    const two = new Session(SITE, { home, fetch: auth.fetch });
    const [a, b] = await Promise.all([one.accessToken(), two.accessToken()]);
    expect(auth.state.calls.refresh).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe((await readSessionFile(file)).accessToken);
    expect(tokenClaims(a).sub).toBe("user-a");
  });

  it("after a 401, a copy that finds another already refreshed uses that token and spends nothing", async () => {
    const auth = fakeAuth();
    const { data } = await signIn(auth);
    const one = new Session(SITE, { home, fetch: auth.fetch });
    const two = new Session(SITE, { home, fetch: auth.fetch });
    const fromOne = await one.refreshAfterRejection(data.accessToken);
    expect(auth.state.calls.refresh).toBe(1);
    const fromTwo = await two.refreshAfterRejection(data.accessToken);
    expect(auth.state.calls.refresh).toBe(1);
    expect(fromTwo).toBe(fromOne);
  });

  it("takes over a lock left by a copy that died, and respects one that is live", async () => {
    const auth = fakeAuth();
    const { file } = await signIn(auth);
    await expireSoon(file);
    const lock = `${file}.lock`;

    await fs.writeFile(lock, "somebody-live", { mode: 0o600 });
    const session = new Session(SITE, { home, fetch: auth.fetch });
    let done = false;
    const pending = session.accessToken().then((t) => {
      done = true;
      return t;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    expect(auth.state.calls.refresh).toBe(0);

    /* Now it is a lock nobody has touched for a minute: taken over. */
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);
    await pending;
    expect(auth.state.calls.refresh).toBe(1);
    await expect(fs.stat(lock)).rejects.toThrow();
  });

  it("releases only its own lock: one taken over while it ran is left to its new owner", async () => {
    const file = sessionFileFor(SITE, home);
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await withLock(file, async () => {
      await fs.writeFile(`${file}.lock`, "the-new-owner");
    });
    expect(await fs.readFile(`${file}.lock`, "utf8")).toBe("the-new-owner");
  });

  it("never lets a third process acquire during two simultaneous stale takeovers", async () => {
    const file = sessionFileFor(SITE, home);
    const lock = `${file}.lock`;
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await fs.writeFile(lock, "stale-owner", { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);

    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    const firstRenameReached = deferred();
    const letFirstRenameRun = deferred();
    const restoreLinkReached = deferred();
    const letRestoreLinkRun = deferred();
    const enteredSecond = deferred();
    const enteredThird = deferred();
    const releaseSecond = deferred();
    const releaseThird = deferred();
    const originalRename = fs.rename.bind(fs);
    const originalLink = fs.link.bind(fs);
    let takeoverRenames = 0;
    let active = 0;
    let overlapped = false;

    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === lock && String(to).endsWith(".stale")) {
        takeoverRenames += 1;
        if (takeoverRenames === 1) {
          firstRenameReached.resolve();
          await letFirstRenameRun.promise;
        }
      }
      await originalRename(from, to);
    });
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (to === lock && String(from).endsWith(".stale")) {
        restoreLinkReached.resolve();
        await letRestoreLinkRun.promise;
      }
      await originalLink(from, to);
    });

    const enter = async (entered: { resolve(): void }, release: Promise<void>) => {
      active += 1;
      if (active > 1) overlapped = true;
      entered.resolve();
      await release;
      active -= 1;
    };

    try {
      const first = withLock(file, async () => undefined);
      await firstRenameReached.promise;

      const second = withLock(file, async () => await enter(enteredSecond, releaseSecond.promise));
      const secondEnteredDuringTakeover = await Promise.race([
        enteredSecond.promise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);

      if (secondEnteredDuringTakeover) {
        /* The broken implementation gets here: B replaced the stale lock while
           A was paused. Let A move B aside, then C can enter the empty name. */
        letFirstRenameRun.resolve();
        await restoreLinkReached.promise;
        const third = withLock(file, async () => await enter(enteredThird, releaseThird.promise));
        await enteredThird.promise;
        expect(overlapped).toBe(false);
        letRestoreLinkRun.resolve();
        releaseSecond.resolve();
        releaseThird.resolve();
        await Promise.all([first, second, third]);
      } else {
        /* With acquisition serialized, B cannot replace the lock while A is
           deciding its stale takeover. Once A is done, B enters; C still waits. */
        letFirstRenameRun.resolve();
        await first;
        await enteredSecond.promise;
        const third = withLock(file, async () => await enter(enteredThird, releaseThird.promise));
        const thirdEnteredAlongsideSecond = await Promise.race([
          enteredThird.promise.then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
        ]);
        expect(thirdEnteredAlongsideSecond).toBe(false);
        expect(overlapped).toBe(false);
        releaseSecond.resolve();
        await enteredThird.promise;
        releaseThird.resolve();
        await Promise.all([second, third]);
      }
    } finally {
      letFirstRenameRun.resolve();
      letRestoreLinkRun.resolve();
      releaseSecond.resolve();
      releaseThird.resolve();
      vi.restoreAllMocks();
    }
  });

  it("never puts a token or the password in an error", async () => {
    const auth = fakeAuth();
    const wrong = await login(
      { site: SITE, supabaseUrl: SUPABASE, supabaseKey: "k", email: "a@example.com", password: "SENTINEL-WRONG-pw" },
      { home, fetch: auth.fetch },
    ).catch((e: Error) => e);
    expect((wrong as Error).message).toMatch(/refused \(400\)/);
    expect((wrong as Error).message).not.toContain("SENTINEL");

    const { file } = await signIn(auth);
    await expireSoon(file);
    auth.state.validRefresh = "something-else"; /* the server now rejects ours, quoting it back */
    const err = await new Session(SITE, { home, fetch: auth.fetch }).accessToken().catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Already Used/);
    expect((err as Error).message).not.toContain("SENTINEL");
  });
});

describe("a running server stays the reader it started as (Sol F14)", () => {
  it("refuses to bind when the access token cannot prove its user and session", async () => {
    const auth = fakeAuth();
    const { file, data } = await signIn(auth);
    await writeSessionFile(file, { ...data, accessToken: "not-a-jwt" });
    const session = new Session(SITE, { home, fetch: auth.fetch });
    await expect(session.bind()).rejects.toThrow(/does not identify its user and session/);
  });

  it("refuses to bind when the access token names a different user than the file", async () => {
    const auth = fakeAuth();
    const { file, data } = await signIn(auth);
    await writeSessionFile(file, { ...data, accessToken: jwt("user-b", "sess-b", 9) });
    const session = new Session(SITE, { home, fetch: auth.fetch });
    await expect(session.bind()).rejects.toThrow(/does not match the session file/);
  });

  it("refuses once somebody logs in as another account, and sends nothing", async () => {
    const auth = fakeAuth();
    await signIn(auth);
    const session = new Session(SITE, { home, fetch: auth.fetch });
    await session.bind();
    const sent: string[] = [];
    const api = makeApi({
      site: SITE,
      tokens: session,
      fetch: async (url) => {
        sent.push(url);
        return Response.json({ jobs: [] });
      },
    });
    await api.call("GET", "/api/jobs");
    expect(sent).toHaveLength(1);

    auth.state.user = "user-b";
    auth.state.sessionId = "sess-b";
    await signIn(auth);
    await expect(api.call("GET", "/api/jobs")).rejects.toThrow(/different sign-in/);
    expect(sent).toHaveLength(1);
  });

  it("refuses once the same account signs in afresh, since that is a different session", async () => {
    const auth = fakeAuth();
    await signIn(auth);
    const session = new Session(SITE, { home, fetch: auth.fetch });
    await session.bind();
    auth.state.sessionId = "sess-a2";
    await signIn(auth);
    await expect(session.accessToken()).rejects.toThrow(/different sign-in/);
  });

  it("refuses after logout, rather than keep using a token it had", async () => {
    const auth = fakeAuth();
    await signIn(auth);
    const running = new Session(SITE, { home, fetch: auth.fetch });
    await running.accessToken();
    await new Session(SITE, { home, fetch: auth.fetch }).logout();
    await expect(running.accessToken()).rejects.toThrow(/signed out/);
  });

  it("a 401 retry after somebody else's login is refused, never sent as them", async () => {
    const auth = fakeAuth();
    const { data } = await signIn(auth);
    const session = new Session(SITE, { home, fetch: auth.fetch });
    await session.bind();
    auth.state.user = "user-b";
    auth.state.sessionId = "sess-b";
    await signIn(auth);
    await expect(session.refreshAfterRejection(data.accessToken)).rejects.toThrow(/different sign-in/);
    expect(auth.state.calls.refresh).toBe(0);
  });
});

describe("logout", () => {
  it("revokes with local scope and the session's own token, then deletes the file", async () => {
    const auth = fakeAuth();
    const { file, data } = await signIn(auth);
    const answer = await new Session(SITE, { home, fetch: auth.fetch }).logout();
    expect(answer).toEqual({ revoked: true });
    expect(auth.state.calls.logout).toEqual([
      { url: `${SUPABASE}/auth/v1/logout?scope=local`, auth: `Bearer ${data.accessToken}` },
    ]);
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it("wins over a refresh already in flight: the file is gone afterwards, and the fresh token is the one revoked", async () => {
    const auth = fakeAuth({ delayMs: 150 });
    const { file } = await signIn(auth);
    await expireSoon(file);
    const started = new Promise<void>((r) => {
      auth.state.refreshStarted = r;
    });
    const refreshing = new Session(SITE, { home, fetch: auth.fetch }).accessToken();
    await started;
    const out = await new Session(SITE, { home, fetch: auth.fetch }).logout();
    const token = await refreshing;
    expect(out.revoked).toBe(true);
    expect(auth.state.calls.logout[0]?.auth).toBe(`Bearer ${token}`);
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it("a refresh that waited behind a logout does not bring the file back", async () => {
    const auth = fakeAuth({ logoutDelayMs: 150 });
    const { file, data } = await signIn(auth);
    const bound = new Session(SITE, { home, fetch: auth.fetch });
    await bound.bind();
    const started = new Promise<void>((r) => {
      auth.state.logoutStarted = r;
    });
    const loggingOut = new Session(SITE, { home, fetch: auth.fetch }).logout();
    await started;
    /* The server said 401 to this token, so it must refresh, under the lock. */
    const refresh = bound.refreshAfterRejection(data.accessToken).catch((e: Error) => e);
    await loggingOut;
    expect(await refresh).toBeInstanceOf(Error);
    expect(auth.state.calls.refresh).toBe(0);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});

describe("the file's shape", () => {
  it("rejects a session for a different site", async () => {
    const { file, data } = await signIn(fakeAuth());
    const other: SessionData = { ...data, site: "https://www.spideryarn.com" };
    await writeSessionFile(file, other);
    await expect(new Session(SITE, { home }).accessToken()).rejects.toThrow(/is for https:\/\/www.spideryarn.com/);
  });
});

describe("command-line arguments", () => {
  it("rejects two commands instead of silently running the last one", () => {
    expect(() => parseArgs(["login", "logout", "--site", SITE])).toThrow(/Choose one command/);
  });

  it("reports a missing option value when the next token is another option", () => {
    expect(() => parseArgs(["serve", "--site", "--help"])).toThrow(/--site needs a value/);
  });

  it("rejects a duplicate option instead of silently replacing it", () => {
    expect(() => parseArgs(["serve", "--site", SITE, `--site=${SITE}`])).toThrow(/--site was given more than once/);
  });
});
