#!/usr/bin/env node
/**
 * A pretend browser MCP server, for tests/remote-smoke-mcp-browser.test.ts.
 *
 * It speaks the same newline-delimited JSON-RPC over stdio that
 * scripts/remote-smoke-mcp-browser.mjs speaks to `@playwright/mcp` and
 * `chrome-devtools-mcp`, and it has a "browser" that is one string: the address
 * of the page it last opened. What makes it worth having is where that string
 * lives:
 *
 *   --shared <file>   in a FILE, so two of these started with the same flag are
 *                     two servers driving one browser — the misconfiguration
 *                     the smoke check exists to catch. Without the flag each
 *                     process keeps its own page in memory, which is what
 *                     `--isolated` buys on the real servers.
 *
 * The rest are ways to be late or broken, each one a case in the test:
 *
 *   --as <name>          `playwright` or `chrome-devtools`: which pair of tool
 *                        names to answer to. Any other tool is an error, as it
 *                        is on the real servers — so the script cannot ask this
 *                        fake for a tool the real one does not have by that
 *                        name and be answered anyway.
 *   --slow <text> <ms>   take <ms> to "boot the browser" before opening a page
 *                        whose address contains <text>. The real servers launch
 *                        Chrome on the first tool call, not at the handshake,
 *                        so this is where a slow start actually shows. Keyed on
 *                        the marker so the test can choose WHICH of two
 *                        identical commands is the late one.
 *   --blank              open the page but answer as if it were blank.
 *   --read-fails         answer the read tool with `isError`.
 *   --read-hangs         never answer the read tool.
 *   --ignore-term        ignore SIGTERM, to prove close() does not wait for ever.
 *   --pids <dir>         write `<dir>/<pid>` on start, containing the pids that
 *                        were already alive in that directory. The test reads
 *                        these to see what was closed, and when.
 *
 * Deliberately tiny and deliberately not a general transport harness: it has
 * the one piece of state the isolation check is about.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, offset = 1) => (argv.includes(name) ? argv[argv.indexOf(name) + offset] : undefined);

const TOOLS = {
  playwright: { open: "browser_navigate", read: "browser_snapshot" },
  "chrome-devtools": { open: "new_page", read: "list_pages" },
}[value("--as") ?? "playwright"];

const shared = value("--shared");
const slowText = value("--slow", 1);
const slowMs = Number(value("--slow", 2) ?? 0);
const pids = value("--pids");

if (flag("--ignore-term")) process.on("SIGTERM", () => {});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (pids) {
  const others = readdirSync(pids).map(Number).filter((pid) => pid !== process.pid && alive(pid));
  writeFileSync(path.join(pids, String(process.pid)), JSON.stringify({ startedAt: Date.now(), aliveAtStart: others }));
}

let own = "about:blank";
const setPage = (url) => {
  if (shared) writeFileSync(shared, url);
  else own = url;
};
const getPage = () => (shared ? (existsSync(shared) ? readFileSync(shared, "utf8") : "about:blank") : own);

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function handle(msg) {
  if (msg.method === "initialize") {
    return reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } });
  }
  if (msg.method !== "tools/call") return; // notifications
  const { name, arguments: args = {} } = msg.params ?? {};
  if (name === TOOLS.open) {
    const url = String(args.url ?? "");
    if (slowText && url.includes(slowText)) await sleep(slowMs);
    setPage(url);
    return reply(msg.id, text(flag("--blank") ? "### Page\n- Page URL: about:blank" : `### Page\n- Page URL: ${url}`));
  }
  if (name === TOOLS.read) {
    if (flag("--read-hangs")) return;
    if (flag("--read-fails")) return reply(msg.id, text("Error: the browser went away", true));
    return reply(msg.id, text(`### Page\n- Page URL: ${getPage()}`));
  }
  return reply(msg.id, text(`Error: no tool called ${name}`, true));
}

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    void handle(JSON.parse(line));
  }
});
/* A real server leaves when its client hangs up. `--ignore-term` is the one
   that does not, and it stays for exactly that reason. */
process.stdin.on("end", () => {
  if (!flag("--ignore-term")) process.exit(0);
});
if (flag("--ignore-term")) setInterval(() => {}, 1000);
