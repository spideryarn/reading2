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
 * No dependency at all: MCP over stdio is newline-delimited JSON-RPC on a pipe,
 * which is a dozen lines of node:child_process. Deliberately not importing an
 * MCP SDK — this must run on a box with no checkout.
 */
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";

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
 *  enough that a hung browser is reported rather than waited on for ever. */
const TIMEOUT_MS = Number(process.env.GJD_SMOKE_MCP_TIMEOUT_MS ?? 150_000);

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
 */
const SERVERS = [
  { name: "playwright", tool: "browser_navigate", arg: "url" },
  { name: "chrome-devtools", tool: "new_page", arg: "url" },
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
 * Speak MCP to one server over stdio and resolve with what its page-opening
 * tool returned.
 *
 * Resolves rather than rejects on a tool error, because the interesting
 * failures ("browser is already running for …") come back as a perfectly
 * ordinary JSON-RPC result with isError set, and the caller wants the message.
 *
 * `mine` is the marker this instance must see; `forbidden` are the markers of
 * instances running alongside it, which it must NOT see.
 */
function openPage({ command, args, tool, arg }, mine, forbidden = []) {
  const page = `data:text/html,<h1>${mine}</h1>`;
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `timed out after ${TIMEOUT_MS}ms ${stderr.trim().split("\n").at(-1) ?? ""}`.trim() }), TIMEOUT_MS);
    const send = (o) => {
      try {
        child.stdin.write(`${JSON.stringify(o)}\n`);
      } catch (e) {
        finish({ ok: false, detail: `could not write to the server: ${e.message}` });
      }
    };
    child.on("error", (e) => finish({ ok: false, detail: `could not start ${command}: ${e.message}` }));
    child.on("exit", (code, signal) => finish({ ok: false, detail: `server exited ${code ?? `on signal ${signal}`} before answering — ${stderr.trim().split("\n").at(-1) ?? "no stderr"}` }));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    /** The handshake reply; ask it to open the page. */
    const onInitialized = () => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: { [arg]: page } } });
    };

    /** The answer that decides this instance's verdict. */
    const onPageOpened = (msg) => {
      const body = JSON.stringify(msg.result ?? msg.error ?? {});
      const strayed = forbidden.find((other) => body.includes(other));
      if (msg.error || msg.result?.isError) {
        return finish({ ok: false, detail: firstLine(body) });
      }
      if (!body.includes(mine)) {
        // Point 2: a result came back and the page was not the one we asked
        // for. Blank-page-renders-fine is the failure this catches.
        return finish({ ok: false, detail: `opened a page but ${mine} was not in the response — ${firstLine(body)}` });
      }
      if (strayed) {
        // Point 4: this instance can see the OTHER instance's page, so the two
        // are sharing a browser rather than running independently. A shared
        // marker would have called this a pass.
        return finish({ ok: false, detail: `saw another instance's page (${strayed}) — the two are sharing a browser` });
      }
      return finish({ ok: true, detail: "" });
    };

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
        if (msg.id === 1) onInitialized();
        if (msg.id === 2) onPageOpened(msg);
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "gjd-remote-smoke", version: "1" } },
    });
  });
}

/** Trim a JSON blob down to something that fits on a doctor line. */
function firstLine(s) {
  return s.replace(/\s+/g, " ").slice(0, 220);
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
    const spec = { ...registered, tool: server.tool, arg: server.arg };

    // One first: a clean single run, which is what most agents do.
    const single = await openPage(spec, marker());
    if (!single.ok) {
      failures.push(`${server.name}: ${single.detail}`);
      continue;
    }

    // Then two at once — point 4. This is the check that catches a server
    // registered without --isolated on a box built for parallel sessions. Each
    // is given the other's marker as forbidden, so "both started" is not enough:
    // they must also be looking at different browsers.
    const [markerA, markerB] = [marker(), marker()];
    const [a, b] = await Promise.all([openPage(spec, markerA, [markerB]), openPage(spec, markerB, [markerA])]);
    if (!a.ok || !b.ok) {
      failures.push(`${server.name}: works alone but not twice at once — ${(a.ok ? b : a).detail}`);
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

main().catch((e) => {
  console.error(`FAIL ${e?.stack ?? e}`);
  process.exit(1);
});
