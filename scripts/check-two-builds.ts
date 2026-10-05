/**
 * **Does an open `/changelog` move itself onto a new build when one goes
 * live?** — the whole path, in a real browser engine, against two real builds.
 *
 * The unit tests drive each decision with stand-ins: a fake document, a fake
 * clock, a `/build.json` that is a function. What none of them can say is that
 * the pieces meet — that a production bundle really installs the watcher, that
 * the watcher's question really reaches the file a deploy publishes, that the
 * lazily-loaded page is really listening, and that the reload really lands on
 * the other build. This does, and it is the check the postmortem
 * docs/postmortems/261003f-a-home-screen-app-outlives-every-deploy-and-has-no-reload-button.md
 * said was worth keeping once it had a second thing to assert.
 * docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md.
 *
 * ## What it does
 *
 * 1. **Builds the client twice** from this tree, into two scratch directories.
 *    One commit built twice is two builds: the build time is part of a build's
 *    identity (src/web/stale-shell.ts § `buildIdentity`) and is compiled into
 *    the bundle, so the hashed files differ. **Asserted, not assumed** — if the
 *    two identities were equal there would be nothing to notice and every later
 *    step would "pass" by doing nothing.
 * 2. **Serves build one** from a static server that answers a missing file
 *    with the shell's HTML and a 200, which is what production does
 *    (`vercel.json`'s last rewrite). `/api/*` is a JSON 404: the page under
 *    test is signed out and needs none of it.
 * 3. **Opens `/changelog`, signed out, in Playwright WebKit** with an iPad user
 *    agent, and waits for the watcher's first question — the one it asks when
 *    installed.
 * 4. **Swaps the server to build two** — the deploy.
 * 5. **Wakes the page.** Headless WebKit under Playwright never really hides a
 *    page, so this is done by hand and it is worth being exact about how:
 *    `document.visibilityState` is overridden to `"hidden"` with an own
 *    property on `document` and a `visibilitychange` event is dispatched (the
 *    watcher cancels its timer); then the override is deleted, so the
 *    prototype's real getter answers `"visible"` again, and a second
 *    `visibilitychange` is dispatched (the watcher asks). The event and the
 *    property are the two things the watcher listens to and reads. It is not
 *    iOS putting an installed app to sleep, and says nothing about that.
 * 6. **Asserts**, all of them:
 *    - the document was replaced (a marker left on `window` before the wake is
 *      gone), and the address is still `/changelog`;
 *    - **the running client is build two**: every script the new document
 *      loaded that carries a build time carries build two's and not build
 *      one's, and that file does not exist in build one at all. The stamp is a
 *      literal compiled into the bundle and no global exposes it, so the file
 *      the document is running is where it can be read. Not the URL, and not
 *      `/build.json`, which would both be right on a page that never reloaded;
 *    - when the page draws a pending release, its `<time>` is the running
 *      bundle's own build time to the second (ChangelogPage.tsx §
 *      `withPending`) — the same fact read off the screen. Skipped, and said to
 *      be skipped, when `src/web/changelog-pending.json` holds nothing.
 *
 * ## The control
 *
 * `--control` leaves `/build.json` answering with build one after the swap:
 * everything else is build two, but the watcher is told nothing changed, so no
 * reload can happen. The same assertions are then run and **must fail**. A
 * check that has never been seen to fail is not evidence
 * (docs/reusable/silent-success.md), and this is the way to see it.
 *
 * ## Running it
 *
 *   npx tsx scripts/check-two-builds.ts              # must pass
 *   npx tsx scripts/check-two-builds.ts --control    # must report the failure
 *
 * `--dir <path>` keeps the two builds there and reuses them if they exist, so
 * the second run does not build again; without it they go in a fresh temporary
 * directory. Two client builds take a minute or two and a lot of memory, which
 * is why this is run by hand before a change to this area and is **not** part
 * of `npm test`. WebKit has to be installed
 * (docs/project/browser-control.md § On the remote box).
 *
 * Exit status: 0 when the mode's expectation held, 1 when it did not, 2 when
 * the check could not be made at all.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { webkit } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const control = process.argv.includes("--control");
const dir = path.resolve(flag("dir") ?? fs.mkdtempSync(path.join(os.tmpdir(), "spy-two-builds-")));

const say = (line: string): void => console.log(line);

/** The check itself could not be made: not a pass, and not the failure it looks for. */
function cannot(why: string): never {
  console.error(`CANNOT CHECK: ${why}`);
  process.exit(2);
}

interface Stamp {
  commit: string;
  builtAt: string;
}

function readStamp(buildDir: string): Stamp {
  const stamp = JSON.parse(fs.readFileSync(path.join(buildDir, "build.json"), "utf8")) as Stamp;
  if (typeof stamp.commit !== "string" || typeof stamp.builtAt !== "string") {
    cannot(`${buildDir}/build.json is not a build stamp`);
  }
  return stamp;
}

/** Build the client into `out`, unless a build is already there. */
function build(out: string): void {
  if (fs.existsSync(path.join(out, "build.json"))) {
    say(`  reusing ${out}`);
    return;
  }
  const env = { ...process.env };
  /* Not a deployment and not a release: no source maps to Sentry, and no
     Vercel-only refusal. Everything else — `.env.local` included — is as
     `npm run build:client` has it. */
  for (const name of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "VERCEL", "VERCEL_DEPLOYMENT_ID"]) {
    delete env[name];
  }
  const ran = spawnSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (ran.status !== 0) cannot(`the client build into ${out} failed (status ${ran.status ?? ran.signal})`);
}

say(`two builds, in ${dir}`);
const ONE = path.join(dir, "one");
const TWO = path.join(dir, "two");
build(ONE);
build(TWO);
const one = readStamp(ONE);
const two = readStamp(TWO);
say(`  build one: ${one.commit.slice(0, 7)} ${one.builtAt}`);
say(`  build two: ${two.commit.slice(0, 7)} ${two.builtAt}`);
if (`${one.commit} ${one.builtAt}` === `${two.commit} ${two.builtAt}`) {
  cannot("the two builds have the same identity, so there is no deploy to notice");
}

/* ---- the server ---------------------------------------------------------- */

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

let serving = ONE;
/** Each `/build.json` asked for, and which build answered. */
const asked: string[] = [];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (p.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not here"}');
    return;
  }
  /* The control: the deploy happened, and the one file that says so did not. */
  const from = p === "/build.json" && control ? ONE : serving;
  if (p === "/build.json") asked.push(from === ONE ? "one" : "two");
  const file = path.join(from, p);
  if (p !== "/" && file.startsWith(from + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(fs.readFileSync(file));
    return;
  }
  /* Production's answer to a file that is not there: the shell, and a 200. */
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(fs.readFileSync(path.join(serving, "index.html")));
});
await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
const address = server.address();
if (address === null || typeof address === "string") cannot("the static server has no port");
const base = `http://localhost:${address.port}`;

/* ---- the browser --------------------------------------------------------- */

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const browser = await webkit.launch().catch((err: unknown) => cannot(`WebKit would not start: ${String(err)}`));
const context = await browser.newContext({
  userAgent: IPAD_UA,
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  viewport: { width: 1024, height: 1366 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message.slice(0, 200)}`));

const until = async (what: string, test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  say(`  (gave up waiting for ${what} after ${ms} ms)`);
  return false;
};

/** What the document that is running right now says about itself. */
async function running(): Promise<{ marker: boolean; pathname: string; scripts: string[]; pendingTime: string | null; visibility: string }> {
  return page.evaluate(() => ({
    marker: (window as unknown as { __before_the_deploy__?: boolean }).__before_the_deploy__ === true,
    pathname: window.location.pathname,
    scripts: [
      ...new Set([
        ...[...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) => s.src),
        ...performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((n) => new URL(n).pathname.endsWith(".js")),
      ]),
    ].map((u) => new URL(u).pathname),
    pendingTime: document.querySelector("details h2 time")?.getAttribute("datetime") ?? null,
    visibility: document.visibilityState,
  }));
}

/** Which builds' compiled-in build times the scripts a document loaded carry. */
function stampsIn(scripts: string[]): { file: string; one: boolean; two: boolean; inOne: boolean; inTwo: boolean }[] {
  const found = [];
  for (const file of scripts) {
    const texts = [ONE, TWO]
      .map((b) => path.join(b, file))
      .filter((f) => fs.existsSync(f))
      .map((f) => fs.readFileSync(f, "utf8"));
    const hasOne = texts.some((t) => t.includes(one.builtAt));
    const hasTwo = texts.some((t) => t.includes(two.builtAt));
    if (hasOne || hasTwo) {
      found.push({
        file,
        one: hasOne,
        two: hasTwo,
        inOne: fs.existsSync(path.join(ONE, file)),
        inTwo: fs.existsSync(path.join(TWO, file)),
      });
    }
  }
  return found;
}

const toTheSecond = (iso: string): string => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");

const failures: string[] = [];
try {
  await page.goto(`${base}/changelog`, { waitUntil: "domcontentloaded" });
  await page.locator("h1").first().waitFor({ timeout: 20_000 });
  if (!(await until("the watcher's first question", () => asked.length >= 1, 10_000))) {
    cannot("the page never asked for /build.json, so the watcher is not installed in this build");
  }
  const before = await running();
  const beforeStamps = stampsIn(before.scripts);
  say(`opened ${before.pathname} on build one; visibility "${before.visibility}"; /build.json asked ${asked.length}x (${asked.join(", ")})`);
  if (!beforeStamps.some((s) => s.one) || beforeStamps.some((s) => s.two)) {
    cannot(`the page that was opened is not running build one: ${JSON.stringify(beforeStamps)}`);
  }
  say(`  running: ${beforeStamps.map((s) => s.file).join(", ")} — carries build one's time`);
  await page.evaluate(() => {
    (window as unknown as { __before_the_deploy__?: boolean }).__before_the_deploy__ = true;
  });

  serving = TWO;
  say(control ? "deployed build two — CONTROL: /build.json still answers with build one" : "deployed build two");

  const askedBefore = asked.length;
  /* A string, not a function: tsx wraps a nested function in a `__name` helper
     that does not exist in the page. */
  await page.evaluate(`
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  `);
  say('woke the page: visibilityState overridden to "hidden" + visibilitychange, override removed + visibilitychange');

  const reloaded = await until(
    "the document to be replaced",
    async () => !(await running().catch(() => ({ marker: true }))).marker,
    8_000,
  );
  if (reloaded) await page.locator("h1").first().waitFor({ timeout: 20_000 });
  /* Let the new document's scripts, and its own first question, land. */
  await new Promise((r) => setTimeout(r, 1500));

  const after = await running();
  const afterStamps = stampsIn(after.scripts);
  say(`after the wake: /build.json asked ${asked.length - askedBefore}x more (${asked.slice(askedBefore).join(", ") || "none"})`);
  say(`  running: ${afterStamps.map((s) => `${s.file}${s.two ? " [build two's time]" : ""}${s.one ? " [build one's time]" : ""}`).join(", ") || "no stamped script found"}`);

  if (asked.length === askedBefore) failures.push("waking the page asked /build.json nothing");
  if (after.marker) failures.push("the document was not replaced: the marker set before the deploy is still on window");
  if (after.pathname !== "/changelog") failures.push(`the reader is at ${after.pathname}, not /changelog`);
  if (!afterStamps.some((s) => s.two)) failures.push("no script the running document loaded carries build two's compiled-in build time");
  if (afterStamps.some((s) => s.one)) failures.push("a script the running document loaded carries build one's compiled-in build time");
  if (afterStamps.some((s) => s.two && s.inOne)) failures.push("the file carrying build two's time also exists in build one: the hash did not move");

  if (after.pendingTime === null) {
    say("  on screen: no pending release drawn, so the build time cannot be read off the page (skipped)");
  } else if (after.pendingTime === toTheSecond(two.builtAt)) {
    say(`  on screen: the pending release is dated ${after.pendingTime} — build two's own time`);
  } else if (after.pendingTime === toTheSecond(one.builtAt)) {
    failures.push(`the pending release on screen is dated ${after.pendingTime}, which is build one's time`);
  } else {
    say(`  on screen: the newest release is dated ${after.pendingTime}, neither build's time — not a pending release (skipped)`);
  }
  if (errors.length > 0) say(`  page errors: ${errors.join(" | ")}`);
} finally {
  await browser.close();
  server.close();
}

if (control) {
  if (failures.length === 0) {
    console.error("CONTROL DID NOT FAIL: the page reached build two with /build.json saying nothing had changed. The check proves nothing.");
    process.exit(1);
  }
  say("CONTROL OK — with the reload unable to happen, the assertions failed, as they must:");
  for (const f of failures) say(`  ✗ ${f}`);
  process.exit(0);
}
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
say("PASS — the open /changelog reloaded itself and the running client is build two.");
