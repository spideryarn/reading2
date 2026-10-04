#!/usr/bin/env node
/**
 * Do the two browser MCP servers actually drive a browser on this box?
 *
 * Runs ON THE BOX (`gjd-remote doctor` copies it there and runs it; you can also
 * run it by hand over `gjd-remote ssh`). It speaks MCP over stdio to each server
 * exactly as Claude Code does, asks it to open a page, and asserts on a marker
 * string it reads back out of the response.
 *
 * WHY THIS EXISTS, when remote-smoke-browser.mjs already proves Chrome works:
 * it proves a DIFFERENT thing. That one imports playwright-core and launches
 * Chrome itself, so it says ad-hoc Playwright works and nothing whatever about
 * the two MCP servers — which are what an agent on this box actually reaches
 * for. `claude mcp list` saying "✔ Connected" is the MCP handshake, not a
 * browser: on 2026-08-31 both servers said Connected while one was, on the
 * evidence then available, expected to be unable to launch. Nobody found out
 * either way, because nothing drove them. This is that missing check.
 *
 * Four things here are load-bearing, and each is a way this check could have
 * passed while the servers were broken:
 *
 *  1. It calls a tool that OPENS A PAGE, not `tools/list`. Listing tools needs
 *     no browser at all: a server with no Chrome to launch answers `tools/list`
 *     perfectly and fails on the first navigation. Asking what it can do is not
 *     asking it to do anything.
 *  2. It asserts a MARKER STRING out of the response body. A navigation that
 *     silently landed on a blank page returns a well-formed result too, so
 *     "no error came back" is not evidence — the same trap
 *     remote-smoke-browser.mjs guards with its before/after text comparison.
 *     docs/reusable/silent-success.md is the house pattern.
 *  3. It runs the servers WITH THE FLAGS THEY ARE REGISTERED WITH, read out of
 *     `claude mcp get`, rather than a set retyped here. A check that invents its
 *     own arguments tests a configuration nobody runs, and would stay green
 *     through exactly the misconfiguration it exists to catch.
 *  4. It starts TWO of each CONCURRENTLY. One at a time is the case that works
 *     even when the profile is shared; this box's whole purpose is parallel
 *     sessions, and a second agent reaching for a server whose profile is
 *     already locked gets a hard failure. Serial success hides it completely.
 *
 *     "Concurrently" has to be made true rather than hoped for, and until
 *     2026-10-04 it was hoped for: each client was killed the moment its OWN
 *     navigation answered, so if one had opened, answered and gone before the
 *     other reached its browser, the two never overlapped and a shared setup
 *     passed. Starting both at once is not the same as both being up at once.
 *     So now BOTH STAY ALIVE until both have opened their page, and then each
 *     is asked what it is looking at — a read, not a second navigation. A
 *     server that has been pushed onto the other's page says so there, whichever
 *     of the two got in first. tests/remote-smoke-mcp-browser.test.ts holds this
 *     against a fake pair sharing one page, late on either side, and keeps the
 *     old sequence beside it as the control that passes.
 *
 * No dependency at all: MCP over stdio is newline-delimited JSON-RPC on a pipe,
 * which is a dozen lines of node:child_process. Deliberately not importing an
 * MCP SDK — this must run on a box with no checkout.
 */
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A fresh marker per page, never a constant.
 *
 * Unique per run, so a marker cannot be matched out of a stale cache or a
 * previous run's leftover page — and unique per INSTANCE, which is the part
 * that does real work in the concurrency check below. Two servers that ended up
 * sharing one browser would each see the other's page, and a shared marker
 * would call that a pass; distinct markers make cross-talk a failure.
 */
const marker = () => `MCPSMOKE-${Math.random().toString(36).slice(2, 10)}`;

/** Long enough for a cold `npx` to unpack a package and Chrome to boot; short
 *  enough that a hung browser is reported rather than waited on for ever. It
 *  bounds opening a page, and separately each read of one. */
const TIMEOUT_MS = Number(process.env.GJD_SMOKE_MCP_TIMEOUT_MS ?? 150_000);

/** How long `close()` waits for a server to leave before it stops asking. */
const CLOSE_GRACE_MS = 3_000;

/**
 * The two servers, and how to ask each one to open a page.
 *
 * The tool names differ and so do the argument shapes, which is the whole
 * reason this is a table rather than a loop over one call:
 *
 *  - Playwright navigates the one page it already has, so `browser_navigate`
 *    needs only a url.
 *  - chrome-devtools defaults `--pageIdRouting` to true, so `navigate_page`
 *    demands a `pageId` this script has not got. `new_page` is the one that
 *    both creates and navigates, and it is what a fresh agent session hits
 *    first in any case.
 *
 * `read` is the tool that says what the server is looking at NOW, without
 * navigating — the second half of point 4. Both take no arguments, which is
 * why these two: Playwright's `browser_snapshot` describes its current page,
 * address and text; chrome-devtools' `take_snapshot` wants a `pageId` for the
 * same reason `navigate_page` does, but `list_pages` does not, and it lists
 * every page in the browser the server is attached to — so a second server's
 * page showing up in it is exactly the sharing this is looking for.
 */
const SERVERS = [
  { name: "playwright", tool: "browser_navigate", arg: "url", read: "browser_snapshot" },
  { name: "chrome-devtools", tool: "new_page", arg: "url", read: "list_pages" },
];

/**
 * Read a server's registered command out of Claude Code rather than hardcoding
 * it — see load-bearing point 3 above.
 *
 * `claude mcp get <name>` prints a human-readable block, not JSON, so this
 * scrapes the two lines it needs. A parse that finds nothing is a failure, not
 * a fallback to a guess: guessing is precisely the thing point 3 rules out.
 */
function registeredCommand(name) {
  const r = spawnSync("claude", ["mcp", "get", name], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(`claude mcp get ${name} exited ${r.status ?? `on signal ${r.signal}`} — is it registered?`);
  }
  const text = `${r.stdout ?? ""}`;
  const command = /^\s*Command:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const argsLine = /^\s*Args:\s*(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  if (!command) throw new Error(`could not find a Command: line in \`claude mcp get ${name}\``);
  return { command, args: argsLine ? argsLine.split(/\s+/) : [] };
}

/**
 * Speak MCP to one server over stdio, ask it to open a page, and resolve with
 * the verdict on that **and a handle on the server, which is still running**:
 *
 *   { ok, detail, read(), close() }
 *
 * - `read()` asks the server what it is looking at now and judges the answer
 *   the same way the navigation's was judged. It does not navigate. It is
 *   bounded by the same timeout, and after `close()` it answers "not ok" rather
 *   than hanging.
 * - `close()` stops the server and resolves once it has gone. Calling it again
 *   is harmless, so a caller can close in a `finally` without keeping track.
 *
 * **The caller owns the close.** This used to kill the server as soon as the
 * navigation answered; see point 4 in the header for what that hid. A handle
 * whose page did NOT open has already been closed here, so `ok: false` never
 * leaves anything running.
 *
 * Resolves rather than rejects on a tool error, because the interesting
 * failures ("browser is already running for …") come back as a perfectly
 * ordinary JSON-RPC result with isError set, and the caller wants the message.
 *
 * `mine` is the marker this instance must see; `forbidden` are the markers of
 * instances running alongside it, which it must NOT see.
 */
export function openPage({ command, args, tool, arg, read: readTool }, mine, forbidden = [], timeoutMs = TIMEOUT_MS) {
  const page = `data:text/html,<h1>${mine}</h1>`;
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let stderr = "";
  /** Why the server can no longer be asked anything, once that is true. */
  let gone = null;
  let nextId = 3; // 1 is the handshake and 2 the navigation, as they always were
  /** Requests waiting on an answer: id → the function that settles it. */
  const waiting = new Map();
  const lastStderr = () => stderr.trim().split("\n").at(-1) ?? "";

  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      lose(`server exited ${code ?? `on signal ${signal}`} before answering — ${lastStderr() || "no stderr"}`);
      resolve();
    });
    child.on("error", (e) => {
      lose(`could not start ${command}: ${e.message}`);
      resolve();
    });
  });
  /* A pipe to a server that has just died raises EPIPE as an event, and an
     unhandled 'error' event ends the process. The exit handler above already
     reports the death. */
  child.stdin.on("error", () => {});

  /** The server is gone: answer everybody who was waiting, and anybody who asks later. */
  function lose(why) {
    if (gone === null) gone = why;
    for (const settle of [...waiting.values()]) settle({ failed: gone });
  }

  const send = (o) => {
    try {
      child.stdin.write(`${JSON.stringify(o)}\n`);
    } catch (e) {
      lose(`could not write to the server: ${e.message}`);
    }
  };

  /** One JSON-RPC request, resolved with its reply or with `{ failed }`. Never rejects, never waits past `timeoutMs`. */
  const request = (id, method, params) =>
    new Promise((resolve) => {
      if (gone !== null) return resolve({ failed: gone });
      const settle = (v) => {
        if (!waiting.delete(id)) return;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => settle({ failed: `timed out after ${timeoutMs}ms ${lastStderr()}`.trim() }), timeoutMs);
      waiting.set(id, settle);
      send({ jsonrpc: "2.0", id, method, params });
    });

  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  child.stdout.on("data", (d) => {
    buf += d.toString();
    // Newline-delimited JSON-RPC. The trailing element is whatever came after
    // the last newline — a partial line — so it goes back into buf for the
    // next chunk rather than being parsed now.
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // servers log non-JSON to stdout occasionally; ignore rather than fail
      }
      waiting.get(msg.id)?.(msg);
    }
  });

  /** The verdict on one answer — the navigation's, or a later read's. */
  const judge = (msg, what) => {
    if (msg.failed) return { ok: false, detail: msg.failed };
    const body = JSON.stringify(msg.result ?? msg.error ?? {});
    if (msg.error || msg.result?.isError) return { ok: false, detail: firstLine(body) };
    const strayed = forbidden.find((other) => body.includes(other));
    if (strayed) {
      // Point 4: this instance can see the OTHER instance's page, so the two
      // are sharing a browser rather than running independently. A shared
      // marker would have called this a pass. Asked before the next question,
      // because a server that has been moved onto the other's page fails both,
      // and this is the one that says why.
      return { ok: false, detail: `saw another instance's page (${strayed}) — the two are sharing a browser` };
    }
    if (!body.includes(mine)) {
      // Point 2: a result came back and the page was not the one we asked
      // for. Blank-page-renders-fine is the failure this catches.
      return { ok: false, detail: `${what} but ${mine} was not in the response — ${firstLine(body)}` };
    }
    return { ok: true, detail: "" };
  };

  let closing = null;
  const close = () => {
    closing ??= (async () => {
      lose("this client was closed");
      try {
        child.stdin.end();
      } catch {}
      try {
        child.kill();
      } catch {}
      const grace = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, CLOSE_GRACE_MS);
      /* Bounded twice over: a server that ignores SIGTERM gets SIGKILL, and if
         even that does not produce an exit this stops waiting anyway — a
         health check that hangs while cleaning up is worse than one that
         leaves a process behind and says what it found. */
      let giveUp;
      await Promise.race([exited, new Promise((r) => (giveUp = setTimeout(r, CLOSE_GRACE_MS * 2)))]);
      clearTimeout(grace);
      clearTimeout(giveUp);
    })();
    return closing;
  };

  const read = async () => judge(await request(nextId++, "tools/call", { name: readTool, arguments: {} }), "read the page back");

  const open = async () => {
    /* One clock for the handshake and the navigation together, as before: a
       cold start is slow in whichever of the two it happens to be slow in. */
    let expire;
    const expired = new Promise((resolve) => {
      expire = setTimeout(() => resolve({ failed: `timed out after ${timeoutMs}ms ${lastStderr()}`.trim() }), timeoutMs);
    });
    const opened = (async () => {
      const hello = await request(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "gjd-remote-smoke", version: "1" },
      });
      if (hello.failed) return hello;
      /* The handshake reply; ask it to open the page. */
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return request(2, "tools/call", { name: tool, arguments: { [arg]: page } });
    })();
    const verdict = judge(await Promise.race([opened, expired]), "opened a page");
    clearTimeout(expire);
    if (!verdict.ok) await close();
    return { ...verdict, read, close };
  };
  return open();
}

/** Trim a JSON blob down to something that fits on a doctor line. */
function firstLine(s) {
  return s.replace(/\s+/g, " ").slice(0, 220);
}

/**
 * Two at once — point 4. This is the check that catches a server registered
 * without --isolated on a box built for parallel sessions. Each is given the
 * other's marker as forbidden, so "both started" is not enough: they must also
 * be looking at different browsers.
 *
 * The order matters and is the fix: open both and **keep both**, and only when
 * both pages are open ask each what it is looking at. Reading BOTH is what
 * makes the answer independent of which navigation landed last — whichever
 * server was overwritten is one of the two asked.
 */
export async function checkPair(spec, [markerA, markerB], timeoutMs = TIMEOUT_MS) {
  const started = [];
  try {
    // openPage never rejects, so both handles always arrive to be closed.
    started.push(...(await Promise.all([openPage(spec, markerA, [markerB], timeoutMs), openPage(spec, markerB, [markerA], timeoutMs)])));
    const failedToOpen = started.find((h) => !h.ok);
    if (failedToOpen) return { ok: false, detail: failedToOpen.detail };
    const reread = await Promise.all(started.map((h) => h.read()));
    const failedToRead = reread.find((r) => !r.ok);
    if (failedToRead) return { ok: false, detail: failedToRead.detail };
    return { ok: true, detail: "" };
  } finally {
    await Promise.all(started.map((h) => h.close()));
  }
}

/** One registered server: alone first, then twice at once. */
export async function checkServer(spec, timeoutMs = TIMEOUT_MS) {
  // One first: a clean single run, which is what most agents do. It is closed,
  // and has gone, before the pair starts — left running it would be a third
  // instance beside them, and its exit would be nobody's job.
  const single = await openPage(spec, marker(), [], timeoutMs);
  await single.close();
  if (!single.ok) return { ok: false, detail: single.detail };

  const pair = await checkPair(spec, [marker(), marker()], timeoutMs);
  if (!pair.ok) return { ok: false, detail: `works alone but not twice at once — ${pair.detail}` };
  return { ok: true, detail: "" };
}

async function main() {
  const failures = [];
  const proved = [];

  for (const server of SERVERS) {
    let registered;
    try {
      registered = registeredCommand(server.name);
    } catch (e) {
      failures.push(`${server.name}: ${e.message}`);
      continue;
    }
    const verdict = await checkServer({ ...registered, tool: server.tool, arg: server.arg, read: server.read });
    if (!verdict.ok) {
      failures.push(`${server.name}: ${verdict.detail}`);
      continue;
    }
    proved.push(server.name);
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  // The `ok ` line IS the result, and doctor requires it: exit 0 is also what an
  // empty script and a commented-out assertion produce.
  console.log(`ok  ${proved.join(" and ")} each opened a page and survived two at once`);
}

/**
 * Only when this file is what `node` was started with. The test imports it for
 * `openPage` and `checkPair`, and an import must not go and run `claude mcp
 * get`.
 *
 * Spelled out here rather than imported from src/is-main.ts because this file
 * is copied to the box on its own and has to run with no checkout. Same
 * comparison, for the same reason: both sides as real paths, so being started
 * through a symlink is not mistaken for being imported — a guard that wrongly
 * says "imported" prints nothing and exits 0. doctor would catch that one (it
 * requires the `ok ` line), which is why that requirement stays.
 */
function startedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  main().catch((e) => {
    console.error(`FAIL ${e?.stack ?? e}`);
    process.exit(1);
  });
}
