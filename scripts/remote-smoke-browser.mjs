#!/usr/bin/env node
/**
 * Does the browser stack on the remote box actually work?
 *
 * Runs ON THE BOX (`gjd-remote doctor` copies it there and runs it; you can also
 * run it by hand over `gjd-remote ssh`). It serves two pages from a Node server
 * on 127.0.0.1, drives them with Playwright, and asserts on the values it reads
 * back — not merely that nothing threw.
 *
 * Three things here are load-bearing, and each is a way this check could have
 * passed while the stack was broken:
 *
 *  1. executablePath is SYSTEM Chrome, never the bundled chromium.
 *     ~/.cache/ms-playwright/chromium-1234 was downloaded by @playwright/mcp.
 *     A project that installs its own playwright pins a different build number
 *     and dies with "Executable doesn't exist" — so a smoke test that used the
 *     bundled browser would be testing a browser nothing else uses.
 *  2. It asserts the text BEFORE and AFTER the click, and that they differ.
 *     "no exception was thrown" is true of a page that never loaded.
 *  3. It screenshots two visually different pages and requires the bytes to
 *     differ. A headless browser that renders blank produces a perfectly valid
 *     PNG of the right size every time — magic bytes and dimensions alone
 *     cannot tell you anything rendered.
 *
 * No dependency beyond playwright-core, which must already be on the box; see
 * PLAYWRIGHT_ROOTS below for where it is looked for and what to do if it is not
 * found.
 */
import http from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** System Chrome. Override only to prove this script can fail. */
const CHROME = process.env.GJD_SMOKE_CHROME ?? "/usr/bin/google-chrome-stable";

/** Explicit, because the whole point of check 3 is to compare against a number
 *  we asked for rather than whatever came back. */
const VIEWPORT = { width: 1024, height: 640 };

/**
 * Where playwright-core might live on the box, best first. This script
 * deliberately installs nothing, so it borrows a copy.
 *
 * The repo checkout is the one that is meant to win: `playwright-core` is a
 * pinned devDependency of this repo, so a checkout that has run `npm ci` has
 * exactly the version our lockfile names, on the box and on the laptop alike.
 * The npx cache is a fallback for a box with no checkout yet, and it is luck
 * rather than a plan — its version is whatever the MCPs happened to bundle.
 * The script prints which root it used, so a run on the fallback says so.
 *
 * `~/smoke` used to be on this list and has been removed on purpose. It was a
 * scratch directory a session made by hand on 2026-08-31, and it quietly became
 * the thing the check depended on — a hand-made `npm init` default that nothing
 * provisions, nothing pins, and any tidy-up would delete.
 *
 * GJD_SMOKE_PLAYWRIGHT overrides the lot.
 */
const PLAYWRIGHT_ROOTS = () => {
  const home = homedir();
  const roots = [];
  if (process.env.GJD_SMOKE_PLAYWRIGHT) roots.push(process.env.GJD_SMOKE_PLAYWRIGHT);
  roots.push(path.join(home, "code/spideryarn2"), process.cwd());
  const npx = path.join(home, ".npm/_npx");
  try {
    for (const d of readdirSync(npx)) roots.push(path.join(npx, d));
  } catch {
    // no npx cache; the other roots still stand
  }
  return roots;
};

// ---------------------------------------------------------------- assertions

/** Named so a failure says WHICH check broke, not just that something did. */
class SmokeError extends Error {
  constructor(check, detail) {
    super(detail);
    this.check = check;
  }
}

function assert(check, ok, detail) {
  if (!ok) throw new SmokeError(check, detail);
}

/** PNG header: 8 magic bytes, then a length, then "IHDR", then w and h. */
function pngDims(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------------------------------------------------------------- the pages

/** Ordinary page: reads one way, then another after you click. */
const PAGE_A = `<!doctype html><meta charset="utf-8"><title>A</title>
<style>body{background:#fff;color:#111;font:48px system-ui;margin:0;padding:40px}</style>
<h1 id="t">Localhost app OK</h1>
<button id="b" onclick="document.getElementById('t').textContent='CLICKED'">go</button>`;

/** Deliberately unlike page A at every pixel — inverted, and full-bleed, so two
 *  blank renders cannot pass for two different ones. */
const PAGE_B = `<!doctype html><meta charset="utf-8"><title>B</title>
<style>body{background:#101820;color:#ffd400;font:64px system-ui;margin:0;padding:0}
div{height:100vh;display:flex;align-items:center;justify-content:center}</style>
<div>SECOND PAGE</div>`;

const TEXT_BEFORE = "Localhost app OK";
const TEXT_AFTER = "CLICKED";
const TEXT_B = "SECOND PAGE";

// ---------------------------------------------------------------- run

async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const roots = PLAYWRIGHT_ROOTS();
  let resolved;
  for (const name of ["playwright-core", "playwright"]) {
    try {
      resolved = req.resolve(name, { paths: roots });
      break;
    } catch {
      // try the next name
    }
  }
  assert(
    "playwright-resolve",
    resolved,
    `playwright-core not found. Looked under: ${roots.join(", ")}\n` +
      `  Fix by installing it somewhere on that list, e.g.\n` +
      `    npm --prefix ~/code/spideryarn2 install\n` +
      `  or point GJD_SMOKE_PLAYWRIGHT at a directory whose node_modules has it.`,
  );
  const mod = await import(pathToFileURL(resolved).href);
  const pw = mod.chromium ? mod : mod.default;
  assert("playwright-resolve", pw?.chromium, `${resolved} exports no chromium`);
  return { chromium: pw.chromium, resolved };
}

async function main() {
  const { chromium, resolved } = await loadPlaywright();

  // Ephemeral port. A fixed one collides with whatever else the box's agents
  // are running, and that collision would read as a browser failure.
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/b" ? PAGE_B : PAGE_A);
  });
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    assert("server-listening", Number.isInteger(port) && port > 0, `got port ${port}`);
    const base = `http://127.0.0.1:${port}`;

    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: CHROME,
        // The box runs as an unprivileged user with no user namespaces to
        // spare; Chrome's sandbox cannot start and the launch fails without
        // this.
        args: ["--no-sandbox"],
      });
    } catch (err) {
      throw new SmokeError("browser-launch", `${CHROME}: ${err.message.split("\n")[0]}`);
    }
    const page = await browser.newPage({ viewport: VIEWPORT });

    const response = await page.goto(`${base}/a`, { waitUntil: "load" });
    assert("navigate", response?.ok(), `GET ${base}/a → ${response?.status() ?? "no response"}`);

    const before = (await page.textContent("#t"))?.trim();
    assert("text-before", before === TEXT_BEFORE, `#t was ${JSON.stringify(before)}, expected ${JSON.stringify(TEXT_BEFORE)}`);

    await page.click("#b");
    const after = (await page.textContent("#t"))?.trim();
    assert("click-changed", after !== before, `#t is still ${JSON.stringify(after)} after clicking #b`);
    assert("click-changed", after === TEXT_AFTER, `#t became ${JSON.stringify(after)}, expected ${JSON.stringify(TEXT_AFTER)}`);

    const shotA = await page.screenshot();
    assert(
      "png-magic",
      shotA.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      `screenshot starts ${shotA.subarray(0, 8).toString("hex")}, not a PNG`,
    );
    const dims = pngDims(shotA);
    assert("png-dimensions", dims.width > 0 && dims.height > 0, `IHDR says ${dims.width}x${dims.height}`);
    assert(
      "png-dimensions",
      dims.width === VIEWPORT.width && dims.height === VIEWPORT.height,
      `IHDR says ${dims.width}x${dims.height}, asked for ${VIEWPORT.width}x${VIEWPORT.height}`,
    );

    const responseB = await page.goto(`${base}/b`, { waitUntil: "load" });
    assert("navigate-b", responseB?.ok(), `GET ${base}/b → ${responseB?.status() ?? "no response"}`);
    // Not decoration: without it, a server that hands back page A for every URL
    // still produces two different PNGs (A is mid-click by now), and the
    // differ check below would pass while nothing was being compared.
    // "body", not the div: textContent auto-waits for its selector, so a
    // selector only page B has would spend 30s timing out and then report
    // itself as an unexpected error rather than as this check.
    const textB = (await page.textContent("body"))?.replace(/\s+/g, " ").trim();
    assert("navigate-b", textB?.includes(TEXT_B), `second page reads ${JSON.stringify(textB)}, expected it to contain ${JSON.stringify(TEXT_B)}`);

    const shotB = await page.screenshot();
    assert(
      "png-magic",
      shotB.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      `second screenshot starts ${shotB.subarray(0, 8).toString("hex")}, not a PNG`,
    );
    assert(
      "screenshots-differ",
      !shotA.equals(shotB),
      `two visually different pages produced byte-identical PNGs (${shotA.length} bytes) — the browser is rendering nothing`,
    );

    const version = browser.version();
    console.log(
      `ok  chrome ${version} via ${CHROME}, playwright-core ${path.relative(homedir(), resolved) || resolved}: ` +
        `"${before}" → "${after}", 2 distinct ${dims.width}x${dims.height} PNGs (${shotA.length}/${shotB.length} bytes)`,
    );
  } finally {
    // Both paths. A leaked Chrome on a box running many agents is not a small
    // mess, and a listening server survives long enough to break the next run.
    await browser?.close().catch(() => {});
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  await main();
  process.exit(0);
} catch (err) {
  const check = err instanceof SmokeError ? err.check : "unexpected";
  console.error(`FAIL [${check}] ${err.message}`);
  process.exit(1);
}
