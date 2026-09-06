/**
 * **What a cold visitor downloads to open a page, and how long until they can
 * read it.**
 *
 *     # signed-out landing, three runs
 *     npx tsx scripts/measure-startup.ts --base http://localhost:4291 --paths "/" --runs 3
 *
 *     # signed-in: shelf, reader, design, admin
 *     npx tsx scripts/measure-startup.ts --base http://localhost:4291 \
 *       --paths "/,/read/constitution,/design,/admin" --runs 3 \
 *       --local-sign-in --sign-in-via http://localhost:5273 \
 *       --json /tmp/startup.json
 *
 * ## Why this exists next to `measure-cpu.ts`
 *
 * [`measure-cpu.ts`](measure-cpu.ts) answers *what does this page cost while it
 * sits there* — CPU over a window, after a deliberate `--settle` that throws the
 * page load away. This one measures **only** the part that file discards: the
 * bytes a first-time visitor pulls down and the wait before there is anything to
 * read. It was written for
 * [docs/plans/260905i-lazy-load-admin-and-design-routes.md](../docs/plans/260905i-lazy-load-admin-and-design-routes.md),
 * whose whole question is whether moving two routes behind `React.lazy` removes
 * anything a reader actually fetches — a question the emitted asset table cannot
 * answer, because an emitted chunk that nobody requests and an emitted chunk
 * everybody requests look identical on disk.
 *
 * It takes its parameters on the command line and prints the same shape every
 * time, so the "before" and the "after" are the same instrument rather than two
 * descriptions of one.
 *
 * ## Measure a `vite preview`, not `npm run dev`
 *
 * `vite.config.ts` § `configurePreviewServer` mounts the same `/api` middleware
 * on the preview server, so a production build served by `npx vite preview` is a
 * working app. The dev server is the wrong thing to measure here for a reason
 * that is specific to this script rather than general: in dev there are no
 * chunks at all — every module arrives as its own unbundled request — so
 * "how many JS files does this route pull, and how big are they" has no dev
 * answer that means anything about what we ship.
 *
 * ## How time-to-readable-prose is defined here
 *
 * `PROSE_READY_DEFINITION` below is the single source of that definition and it
 * is **printed with every result**, because the one way to get this badly wrong
 * is for a later run to use a different definition and be compared against an
 * earlier number as though it were the same measurement.
 *
 * The definition, in words: a probe installed with
 * `Page.addScriptToEvaluateOnNewDocument` — so it is running before any of the
 * app's own script — starts a `requestAnimationFrame` loop and a
 * `MutationObserver` on the document. On every frame it evaluates one predicate:
 * **is there at least one element matching the prose selector whose
 * `textContent` is non-empty?** The first frame on which that is true, it records
 * `performance.now()`, which is measured from this document's `timeOrigin` —
 * i.e. from navigation start. That number is time-to-readable-prose (TTRP).
 *
 * Three deliberate choices in that:
 *
 *  - **A frame, not a mutation.** A `MutationObserver` fires while style and
 *    layout are still pending, so it answers "when was it in the DOM", which is
 *    earlier than "when could a reader see it". The observer is installed anyway,
 *    but only to wake the loop; the timestamp always comes off a frame.
 *  - **Non-empty text, not element presence.** The reading view mounts its rows
 *    before it has any prose to put in them, and a run that stopped at the empty
 *    scaffold would report a fast page that shows nothing —
 *    [silent-success.md](../docs/reusable/silent-success.md) with a stopwatch on
 *    it.
 *  - **`requestAnimationFrame` does not run in a hidden document.** So this
 *    launches Chrome on an X display when there is one (`--display :99` on the
 *    box) and says so when it cannot; a run whose probe saw zero frames is
 *    reported as a **failure**, not as a fast page.
 *
 * For routes that have no prose — the landing page, the shelf, `/design`,
 * `/admin` — the same machinery measures **time-to-first-text** against
 * `document.body.innerText`, which is a *different* definition and is labelled
 * as such in the output. Do not compare the two columns.
 *
 * ## Bytes: over the wire, from the browser, not from `ls`
 *
 * Sizes come from `Network.loadingFinished.encodedDataLength`, which is what
 * Chrome actually pulled down the socket for that request — compressed body plus
 * headers — and not from the file on disk. The two differ by more than 3× here,
 * because the preview server gzips. Every response's `content-encoding` is
 * recorded and printed, so a future run against a server that does *not*
 * compress cannot be silently compared against one that does.
 *
 * The HTTP cache is disabled and cleared for every run
 * (`Network.setCacheDisabled` + `Network.clearBrowserCache`), so each run is a
 * cold visitor. Any response Chrome nevertheless served from a cache is counted
 * and reported separately rather than folded into the total.
 *
 * **"Initial" means "requested before the route was ready"** — i.e. before the
 * moment defined above — which is the window a lazy chunk for the *visited*
 * route still falls inside. That is the honest boundary: a route split does not
 * remove the chunk for the route you are on, it removes the chunks for the
 * routes you are not on. Everything requested in the whole run window is
 * reported underneath as a cross-check.
 *
 * ## Signing in
 *
 * The same mechanism as `measure-cpu.ts`, and deliberately not a second one:
 * `--local-sign-in` mints a magic link against the **local** Supabase with
 * [`seed-local-session.ts`](seed-local-session.ts) and hands its `hashed_token`
 * to the app's own SDK via `verifyOtp`. That needs a module served at its source
 * path, which only a dev server does, so `--sign-in-via <dev origin>` signs in
 * there and carries the SDK's own stored keys across to the preview origin.
 * Both origins are checked to be local before anything is minted or moved.
 *
 * Sign-in happens **once**, in a kept profile; each measured run then gets a
 * fresh tab with a cleared cache. A fresh browser *profile* per run would throw
 * the session away with the cache.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { localMagicLink } from "./seed-local-session.js";

/* ------------------------------------------------------------------ flags */

/** A flag's value, where a following `--…` means "no value given". */
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? fallback : next;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Which Chrome. `SPIDERYARN_CHROME` wins, as in `measure-cpu.ts`. */
const CHROME =
  process.env.SPIDERYARN_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome-stable");

const display = (() => {
  const i = process.argv.indexOf("--display");
  return i === -1 ? process.env.DISPLAY : process.argv[i + 1];
})();
const HEADLESS = process.platform !== "darwin" && !display;

/* ------------------------------------------------------- the definitions */

/**
 * The prose predicate, as a string, because it is both the code the probe runs
 * and the sentence the report prints. One place, so they cannot drift.
 */
const PROSE_SELECTOR_DEFAULT = "table.zoom tr[data-block] .prose, .prose";

/**
 * How much of the page's text every result carries.
 *
 * Not decoration: the single most useful line in a failed run here was
 * `on screen: "… This document isn't shared …"`, which turned "no prose
 * appeared" from a mystery into an account problem in one read. `--text-chars`
 * raises it when a page's own heading is not enough to identify it.
 */
const TEXT_CHARS = Math.min(2000, Number(flag("text-chars", "200")));

/**
 * A substring of one URL to hold back, and for how long. Empty means intercept
 * nothing, which is the default and the only state a *measurement* should ever
 * run in — a delayed run is for looking at a loading surface, not for timing.
 */
const DELAY_JS = flag("delay-js", "");
const DELAY_MS = Number(flag("delay-ms", "5000"));

const PROSE_READY_DEFINITION =
  "TTRP = performance.now() (from navigation start) at the first requestAnimationFrame " +
  `frame on which at least one element matching "${PROSE_SELECTOR_DEFAULT}" has non-empty ` +
  "textContent. Probe installed via Page.addScriptToEvaluateOnNewDocument, before any app script.";

const TEXT_READY_DEFINITION =
  "TTFT = performance.now() (from navigation start) at the first requestAnimationFrame frame " +
  "on which document.body.innerText is non-empty. NOT the same measurement as TTRP.";

/* --------------------------------------------------------------- the CDP */

type EventParams = Record<string, unknown>;

/**
 * A minimal DevTools Protocol client that also delivers **events**, which is the
 * one thing `measure-cpu.ts`'s copy does not do — every byte figure here comes
 * off `Network.*` events rather than a command's return value.
 */
class Cdp {
  private ws: WebSocket;
  private next = 1;
  private pending = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();
  private listeners = new Map<string, ((p: EventParams) => void)[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: EventParams;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.id === undefined) {
        if (!msg.method) return;
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params ?? {});
        return;
      }
      const waiting = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (!waiting) return;
      /* A CDP failure is `{id, error}`, not a rejected socket; resolving it
         unconditionally would make a refused command look like a run one. */
      if (msg.error) waiting.fail(new Error(msg.error.message ?? "unknown error"));
      else waiting.ok(msg.result);
    });
    this.ws.addEventListener("close", () => {
      for (const waiting of this.pending.values()) {
        waiting.fail(new Error("the browser closed the connection"));
      }
      this.pending.clear();
    });
  }

  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`could not open ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  on(method: string, fn: (p: EventParams) => void): void {
    const list = this.listeners.get(method) ?? [];
    list.push(fn);
    this.listeners.set(method, list);
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        ok: resolve as (v: unknown) => void,
        fail: (e) => reject(new Error(`${method}: ${e.message}`)),
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close(): void {
    this.ws.close();
  }
}

let PORT = 0;

/** First line of `DevToolsActivePort` is the port Chrome actually got. */
async function readDebugPort(profile: string, deadlineMs = 20_000): Promise<number> {
  const file = join(profile, "DevToolsActivePort");
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const first = readFileSync(file, "utf8").split("\n")[0]?.trim();
      const n = Number(first);
      if (Number.isInteger(n) && n > 0) return n;
    } catch {
      /* not written yet */
    }
    await sleep(150);
  }
  throw new Error(`Chrome never wrote ${file} — did it fail to start?`);
}

async function waitForPort(deadlineMs = 20_000): Promise<string> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const body = (await r.json()) as { webSocketDebuggerUrl?: string };
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Chrome's debugging port ${PORT} never opened`);
}

/** Refuse to carry a real session anywhere but this machine. */
function assertLocalOrigin(u: string, flagName: string): void {
  const { hostname, protocol } = new URL(u);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!local || (protocol !== "http:" && protocol !== "https:")) {
    throw new Error(`${flagName} points at ${u} — a session may only be moved between local origins`);
  }
}

async function waitForOrigin(cdp: Cdp, origin: string, deadlineMs = 15_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const at = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
      expression: "location.origin",
      returnByValue: true,
    });
    if (at.result.value === origin) return;
    await sleep(200);
  }
  throw new Error(`the browser never reached ${origin} — nothing was written`);
}

/* ------------------------------------------------------------- the probe */

/**
 * The script installed into every measured document before any app code runs.
 *
 * It is a string rather than a function because it is handed to
 * `Page.addScriptToEvaluateOnNewDocument`, and it deliberately records what it
 * *saw* as well as when — `frames` proves the rAF loop ran at all, and a result
 * with `frames: 0` is a hidden tab, not a fast page.
 */
function probeSource(proseSelector: string): string {
  return `(() => {
    const out = {
      proseMs: null, textMs: null, proseDomMs: null, textDomMs: null, frames: 0,
      firstProseCount: 0, sawText: "", timeOrigin: performance.timeOrigin,
      spinnerSeenMs: null, spinnerGoneMs: null,
    };
    window.__startup = out;
    const proseReady = () => {
      const els = document.querySelectorAll(${JSON.stringify(proseSelector)});
      let n = 0;
      for (const el of els) if ((el.textContent || "").trim().length > 0) n++;
      return n;
    };
    const hasText = () => ((document.body && document.body.innerText) || "").trim().length > 0;
    /* A Suspense fallback is usually a spinner with no text at all, so nothing
       above can see one — and "did the loading surface appear, and then go
       away" is precisely the question a lazy route raises. ARIA's role=status
       is the standard for it, so this is a general check rather than a hook
       into one app's markup. NOTE: no backticks in here — this whole function
       body is a template literal, and one backtick ends it. */
    const spinner = () => document.querySelector('[role="status"]') !== null;
    const tick = () => {
      out.frames++;
      if (spinner()) {
        if (out.spinnerSeenMs === null) out.spinnerSeenMs = performance.now();
      } else if (out.spinnerSeenMs !== null && out.spinnerGoneMs === null) {
        out.spinnerGoneMs = performance.now();
      }
      if (out.textMs === null && hasText()) {
        out.textMs = performance.now();
        out.sawText = (document.body.innerText || "").trim().slice(0, 80);
      }
      if (out.proseMs === null) {
        const n = proseReady();
        if (n > 0) { out.proseMs = performance.now(); out.firstProseCount = n; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    /* The observer wakes on every DOM write, so it has millisecond resolution
       where the frame loop has only whatever cadence this machine's compositor
       manages. It answers a DIFFERENT question — "when was it written" rather
       than "when was it drawn" — so it is recorded beside the frame number, as
       a lower bound, and never instead of it. */
    try {
      new MutationObserver(() => {
        if (out.textDomMs === null && hasText()) out.textDomMs = performance.now();
        if (out.proseDomMs === null && proseReady() > 0) out.proseDomMs = performance.now();
      }).observe(document, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* no document yet on some very early runs */ }
  })()`;
}

/* ------------------------------------------------------------ the record */

interface RequestRecord {
  url: string;
  /** ms from the main document's request, i.e. roughly from navigation start. */
  issuedMs: number;
  /**
   * When the last byte arrived, on the same clock.
   *
   * Issued and finished are far apart only when something held the response
   * up — a slow server, or `--delay-js`. Recording both is what makes a
   * delayed run *provable*: "issued +364ms, finished +6,400ms" is evidence the
   * interception fired, where a screenshot of a spinner is not.
   */
  finishedMs: number;
  mimeType: string;
  status: number;
  /** Bytes off the socket for this request: compressed body plus headers. */
  encodedDataLength: number;
  contentEncoding: string;
  fromCache: boolean;
  finished: boolean;
}

interface RunResult {
  path: string;
  ok: boolean;
  why: string;
  title: string;
  /** What was actually on screen at the end, so a failed run says what it saw instead. */
  sawText: string;
  /**
   * The **first** text the probe ever saw, which on a `Suspense` route is the
   * fallback. Reported beside `sawText` so "it showed a spinner and then the
   * page" and "it showed the page" are distinguishable, which they are not
   * from an end-of-run snapshot alone.
   */
  firstSawText: string;
  proseBlocks: number;
  rows: number;
  proseMs: number | null;
  textMs: number | null;
  proseDomMs: number | null;
  textDomMs: number | null;
  /** When a `role="status"` loading surface appeared, and when it went away. */
  spinnerSeenMs: number | null;
  spinnerGoneMs: number | null;
  frames: number;
  fcpMs: number | null;
  dclMs: number | null;
  loadMs: number | null;
  responseEndMs: number | null;
  scriptDurationMs: number | null;
  jsBeforeReady: RequestRecord[];
  jsAll: RequestRecord[];
  allBytes: number;
}

const isJs = (r: RequestRecord): boolean =>
  r.mimeType.includes("javascript") || /\.[cm]?jsx?(\?|$)/.test(new URL(r.url).pathname);

/* --------------------------------------------------------------- one run */

interface PageProbe {
  proseMs: number | null;
  textMs: number | null;
  /** Same predicate, seen by the MutationObserver: written, not necessarily drawn. */
  proseDomMs: number | null;
  textDomMs: number | null;
  frames: number;
  firstProseCount: number;
  sawText: string;
  /** When a `role="status"` loading surface first appeared, and when it left. */
  spinnerSeenMs: number | null;
  spinnerGoneMs: number | null;
}

interface PageState {
  title: string;
  text: string;
  prose: number;
  rows: number;
  fcp: number | null;
  dcl: number | null;
  load: number | null;
  responseEnd: number | null;
}

async function measureOnce(
  browserWs: string,
  base: string,
  path: string,
  proseSelector: string,
  timeoutMs: number,
): Promise<RunResult> {
  const browser = await Cdp.open(browserWs);
  const created = await browser.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
  });
  const targetId = created.targetId;
  const wsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${targetId}`;
  const cdp = await Cdp.open(wsUrl);

  const byId = new Map<string, RequestRecord>();
  let docStart: number | null = null;

  cdp.on("Network.requestWillBeSent", (p) => {
    const id = String(p.requestId);
    const req = p.request as { url?: string } | undefined;
    const ts = Number(p.timestamp);
    if (p.type === "Document" && docStart === null) docStart = ts;
    byId.set(id, {
      url: req?.url ?? "",
      issuedMs: docStart === null ? 0 : (ts - docStart) * 1000,
      finishedMs: 0,
      mimeType: "",
      status: 0,
      encodedDataLength: 0,
      contentEncoding: "",
      fromCache: false,
      finished: false,
    });
    /* Recorded relative to the document request, which is not known until the
       document request itself arrives — so the first entry fixes the origin
       and is corrected here rather than being left at whatever it was. */
    if (docStart !== null) {
      const rec = byId.get(id);
      if (rec) rec.issuedMs = (ts - docStart) * 1000;
    }
  });
  cdp.on("Network.responseReceived", (p) => {
    const rec = byId.get(String(p.requestId));
    if (!rec) return;
    const res = p.response as
      | { mimeType?: string; status?: number; headers?: Record<string, string>; fromDiskCache?: boolean }
      | undefined;
    rec.mimeType = res?.mimeType ?? "";
    rec.status = res?.status ?? 0;
    rec.fromCache = Boolean(res?.fromDiskCache);
    const headers = res?.headers ?? {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "content-encoding") rec.contentEncoding = v;
    }
  });
  cdp.on("Network.loadingFinished", (p) => {
    const rec = byId.get(String(p.requestId));
    if (!rec) return;
    rec.encodedDataLength = Number(p.encodedDataLength ?? 0);
    rec.finishedMs = docStart === null ? 0 : (Number(p.timestamp) - docStart) * 1000;
    rec.finished = true;
  });

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  /* A cold visitor, every run. Both, because `setCacheDisabled` stops new
     writes and reads while `clearBrowserCache` removes what an earlier run
     left — including V8's code cache, which lives in the HTTP cache. */
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: probeSource(proseSelector) });

  /* **Hold one chunk back, so the loading surface is something you can see.**
     On a loopback server a lazy chunk arrives in single-digit milliseconds, so
     the `Suspense` fallback exists for about one frame and no screenshot,
     assertion or human will ever catch it. `--delay-js AdminPage --delay-ms
     6000` pauses exactly the matching request for that long, which turns the
     fallback into the page's first text and the real page into its last —
     both of which this run then reports. Nothing else is intercepted: the
     pattern is given to `Fetch.enable`, so unmatched requests never pause. */
  if (DELAY_JS) {
    cdp.on("Fetch.requestPaused", (p) => {
      const requestId = String(p.requestId);
      setTimeout(() => {
        cdp.send("Fetch.continueRequest", { requestId }).catch(() => {
          /* The page can be gone by the time the delay is up; a chunk that
             never resumed is visible as a missing row rather than a throw. */
        });
      }, DELAY_MS);
    });
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: `*${DELAY_JS}*`, requestStage: "Request" }],
    });
  }

  const url = `${base}${path}`;
  await cdp.send("Page.navigate", { url });

  const wantsProse = path.startsWith("/read/") && !path.startsWith("/read/public");
  const until = Date.now() + timeoutMs;
  let probe: PageProbe = {
    proseMs: null,
    textMs: null,
    proseDomMs: null,
    textDomMs: null,
    frames: 0,
    firstProseCount: 0,
    sawText: "",
    spinnerSeenMs: null,
    spinnerGoneMs: null,
  };
  while (Date.now() < until) {
    await sleep(120);
    const got = await cdp.send<{ result: { value: PageProbe | null } }>("Runtime.evaluate", {
      expression: "window.__startup || null",
      returnByValue: true,
    });
    probe = got.result.value ?? probe;
    if (wantsProse ? probe.proseMs !== null : probe.textMs !== null) break;
  }

  /* A settle after the route is ready, so anything the route requests just
     after first paint is in the "everything in the window" column rather than
     silently outside it. */
  await sleep(DELAY_JS ? DELAY_MS + 2500 : 2000);

  const state$ = await cdp.send<{ result: { value: PageState } }>("Runtime.evaluate", {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint')
        .find(e => e.name === 'first-contentful-paint');
      const t = document.querySelector('table.zoom');
      let prose = 0;
      for (const el of document.querySelectorAll(${JSON.stringify(proseSelector)})) {
        if ((el.textContent || '').trim().length > 0) prose++;
      }
      return {
        title: document.title,
        text: ((document.body && document.body.innerText) || '').trim().replace(/\\s+/g, ' ').slice(0, ${TEXT_CHARS}),
        prose,
        rows: t ? t.querySelectorAll('tr[data-block]').length : 0,
        fcp: paint ? paint.startTime : null,
        dcl: nav ? nav.domContentLoadedEventEnd : null,
        load: nav && nav.loadEventEnd ? nav.loadEventEnd : null,
        responseEnd: nav ? nav.responseEnd : null,
      };
    })()`,
    returnByValue: true,
  });
  const state = state$.result.value;

  const metrics = await cdp.send<{ metrics: { name: string; value: number }[] }>(
    "Performance.getMetrics",
  );
  const scriptDuration =
    metrics.metrics.find((m) => m.name === "ScriptDuration")?.value ?? null;

  const readyMs = wantsProse ? probe.proseMs : probe.textMs;
  const all = [...byId.values()].filter((r) => r.finished);
  const js = all.filter(isJs);
  const jsBeforeReady = readyMs === null ? js : js.filter((r) => r.issuedMs <= readyMs);

  let ok = true;
  let why = "";
  if (probe.frames === 0) {
    ok = false;
    why = "the rAF probe saw zero frames — the document was hidden, so no timing here is real";
  } else if (readyMs === null) {
    ok = false;
    why = wantsProse
      ? `no prose ever appeared within ${timeoutMs}ms — this is NOT a reading-view measurement`
      : `no text ever appeared within ${timeoutMs}ms`;
  } else if (wantsProse && state.prose === 0) {
    ok = false;
    why = "prose appeared and then went away — the page is not showing an article";
  }

  await browser.send("Target.closeTarget", { targetId });
  cdp.close();
  browser.close();

  return {
    path,
    ok,
    why,
    title: state.title,
    sawText: state.text,
    firstSawText: probe.sawText,
    proseBlocks: state.prose,
    rows: state.rows,
    proseMs: probe.proseMs,
    textMs: probe.textMs,
    proseDomMs: probe.proseDomMs,
    textDomMs: probe.textDomMs,
    spinnerSeenMs: probe.spinnerSeenMs,
    spinnerGoneMs: probe.spinnerGoneMs,
    frames: probe.frames,
    fcpMs: state.fcp,
    dclMs: state.dcl,
    loadMs: state.load,
    responseEndMs: state.responseEnd,
    scriptDurationMs: scriptDuration === null ? null : scriptDuration * 1000,
    jsBeforeReady,
    jsAll: js,
    allBytes: all.reduce((n, r) => n + r.encodedDataLength, 0),
  };
}

/* ------------------------------------------------------------- reporting */

const median = (xs: number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
};

const spread = (xs: number[], unit = "ms"): string =>
  xs.length === 0
    ? "—"
    : `${median(xs).toFixed(0)}${unit} (${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)})`;

function report(path: string, runs: RunResult[]): void {
  const good = runs.filter((r) => r.ok);
  console.log(`\n=== ${path} — ${good.length}/${runs.length} runs usable`);
  for (const r of runs) {
    if (!r.ok) console.log(`  ⚠ FAILED RUN: ${r.why}\n      on screen: "${r.sawText}"`);
  }
  if (good.length === 0) return;
  const first = good[0] as RunResult;
  const wantsProse = path.startsWith("/read/") && !path.startsWith("/read/public");

  console.log(`  title: "${first.title}"   prose blocks: ${good.map((r) => r.proseBlocks).join("/")}`);
  console.log(`  first text on screen: "${first.firstSawText}"`);
  console.log(`  on screen at end: "${first.sawText}"`);
  if (first.rows > 0) console.log(`  article rows: ${good.map((r) => r.rows).join("/")}`);

  const bytes = good.map((r) => r.jsBeforeReady.reduce((n, x) => n + x.encodedDataLength, 0));
  const counts = good.map((r) => r.jsBeforeReady.length);
  console.log(
    `  initial JS (requested before ready): ${counts.join("/")} requests, ` +
      `${spread(bytes, " B")} over the wire`,
  );
  const allJsBytes = good.map((r) => r.jsAll.reduce((n, x) => n + x.encodedDataLength, 0));
  console.log(
    `  all JS in window: ${good.map((r) => r.jsAll.length).join("/")} requests, ${spread(allJsBytes, " B")}`,
  );
  console.log(`  all responses in window: ${spread(good.map((r) => r.allBytes), " B")}`);

  console.log("  chunks (first usable run):");
  for (const c of [...first.jsBeforeReady].sort((a, b) => b.encodedDataLength - a.encodedDataLength)) {
    console.log(
      `    ${new URL(c.url).pathname.padEnd(40)} ${String(c.encodedDataLength).padStart(9)} B  ` +
        `enc=${c.contentEncoding || "none"}  issued +${c.issuedMs.toFixed(0)}ms  ` +
        `done +${c.finishedMs.toFixed(0)}ms` +
        (c.fromCache ? "  ⚠ FROM CACHE" : ""),
    );
  }

  if (wantsProse) {
    console.log(`  TTRP: ${spread(good.map((r) => r.proseMs ?? 0))}`);
    console.log(`    definition: ${PROSE_READY_DEFINITION}`);
    console.log(
      `  prose-in-DOM (MutationObserver, lower bound): ${spread(good.map((r) => r.proseDomMs ?? 0))}`,
    );
  } else {
    console.log(`  TTFT: ${spread(good.map((r) => r.textMs ?? 0))}`);
    console.log(`    definition: ${TEXT_READY_DEFINITION}`);
    console.log(
      `  text-in-DOM (MutationObserver, lower bound): ${spread(good.map((r) => r.textDomMs ?? 0))}`,
    );
  }
  console.log(`  FCP: ${spread(good.map((r) => r.fcpMs ?? 0))}`);
  console.log(`  domContentLoadedEventEnd: ${spread(good.map((r) => r.dclMs ?? 0))}`);
  console.log(`  loadEventEnd: ${spread(good.filter((r) => r.loadMs !== null).map((r) => r.loadMs as number))}`);
  console.log(`  ScriptDuration at end of run: ${spread(good.map((r) => r.scriptDurationMs ?? 0))}`);
  const spin = good.map((r) =>
    r.spinnerSeenMs === null
      ? "none"
      : `${r.spinnerSeenMs.toFixed(0)}→${r.spinnerGoneMs === null ? "still there" : `${r.spinnerGoneMs.toFixed(0)}ms`}`,
  );
  console.log(`  role="status" loading surface: ${spin.join("  |  ")}`);
  console.log(`  rAF frames observed: ${good.map((r) => r.frames).join("/")}`);
  /* A frame-based timestamp is only as fine as the cadence that produced it.
     On a loaded headless box this has been seen at ~6fps, which quantises TTRP
     to ~170ms — enough to swallow any difference smaller than that, and worth
     shouting rather than leaving for a reader to infer from a frame count. */
  const worstFrames = Math.min(...good.map((r) => r.frames));
  if (worstFrames < 30) {
    console.log(
      `    ⚠ only ${worstFrames} frames in a run that lasted seconds — this machine is not ` +
        "producing 60fps, so a frame-based timestamp is quantised to the gap between frames. " +
        "Read FCP and the DOM lower bound as the finer signals.",
    );
  }
}

/**
 * Sign the browser in on the dev origin, then carry the SDK's own stored keys
 * to the origin being measured.
 *
 * Lifted straight out of `measure-cpu.ts` rather than reinvented, including its
 * two refusals: **both** origins are asserted local before anything is minted
 * or moved, and the carry waits for the target origin instead of sleeping — an
 * early write puts the token back into the origin it came from and measures a
 * signed-out page, which renders fine and reads as a good result.
 */
async function signIn(hashedToken: string, via: string, base: string): Promise<void> {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl?: string;
  }[];
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("no page target — did Chrome open the URL?");
  const cdp = await Cdp.open(page.webSocketDebuggerUrl);
  try {
    await sleep(3000);
    const said = (
      await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
        expression: `(async () => {
          try {
            const m = await import('/src/web/lib/supabase.ts');
            const r = await m.supabase.auth.verifyOtp({
              type: 'magiclink', token_hash: ${JSON.stringify(hashedToken)} });
            if (r.error) return 'error: ' + r.error.message;
            return r.data.session ? 'ok:' + (r.data.user?.email ?? '?') : 'no session';
          } catch (e) { return 'threw: ' + (e && e.message); }
        })()`,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
    if (!said.startsWith("ok:")) throw new Error(`local sign-in failed — ${said}`);
    console.log(`signed in locally (${said.slice(3)})`);

    const target = new URL(base).origin;
    if (!via || target === new URL(via).origin) return;
    assertLocalOrigin(via, "--sign-in-via");
    assertLocalOrigin(base, "--base");
    const dump = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
      expression: `JSON.stringify(Object.fromEntries(Object.entries(localStorage)
        .filter(([k]) => k.startsWith('sb-') || k === 'spideryarn.lastUser')))`,
      returnByValue: true,
    });
    const carried = JSON.parse(dump.result.value) as Record<string, string>;
    const keys = Object.keys(carried);
    if (keys.length === 0) throw new Error("nothing to carry — the SDK stored no session");
    await cdp.send("Page.navigate", { url: `${target}/favicon.ico` });
    await waitForOrigin(cdp, target);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { const s = ${JSON.stringify(JSON.stringify(carried))};
        for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); })()`,
    });
    console.log(`carried ${keys.length} storage keys to ${target}`);
  } finally {
    cdp.close();
  }
}

/**
 * Every path, every run, with a line printed **per run** rather than only a
 * summary at the end — so a run that measured nothing is visible while the job
 * is still going, not discovered in an aggregate afterwards.
 */
async function runAll(
  browserWs: string,
  base: string,
  paths: string[],
  runs: number,
  proseSelector: string,
  timeoutMs: number,
): Promise<Record<string, RunResult[]>> {
  const results: Record<string, RunResult[]> = {};
  for (const path of paths) {
    const got: RunResult[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await measureOnce(browserWs, base, path, proseSelector, timeoutMs);
      const readyMs = r.proseMs ?? r.textMs;
      console.log(
        `  ${path} run ${i + 1}/${runs}: ${r.jsBeforeReady.length} JS / ` +
          `${r.jsBeforeReady.reduce((n, x) => n + x.encodedDataLength, 0)} B, ` +
          `ready ${readyMs === null ? "NEVER" : `${readyMs.toFixed(0)}ms`}` +
          `${r.ok ? "" : `  ⚠ ${r.why}`}`,
      );
      got.push(r);
    }
    results[path] = got;
  }
  return results;
}

/* ----------------------------------------------------------------- main */

async function main(): Promise<void> {
  const base = flag("base", "http://localhost:4291").replace(/\/$/, "");
  const paths = flag("paths", "/")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const runs = Number(flag("runs", "3"));
  const timeoutMs = Number(flag("timeout", "30")) * 1000;
  const proseSelector = flag("prose-selector", PROSE_SELECTOR_DEFAULT);
  const json = has("json") ? flag("json", "") : "";
  const label = flag("label", "");

  const kept = has("profile") ? flag("profile", "") : "";
  const profile = kept || mkdtempSync(join(tmpdir(), "spya-startup-"));

  const via = flag("sign-in-via", "");
  const link = has("local-sign-in") ? await localMagicLink(via || base) : null;
  const startUrl = link ? new URL(via || base).origin : base;

  let chrome: ChildProcess | null = null;
  try {
    chrome = spawn(
      CHROME,
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        ...(HEADLESS ? ["--headless=new", "--disable-gpu"] : []),
        startUrl,
      ],
      { stdio: "ignore", env: display ? { ...process.env, DISPLAY: display } : process.env },
    );

    PORT = await readDebugPort(profile);
    const browserWs = await waitForPort();
    console.log(
      `chrome up on ${PORT}${HEADLESS ? " (headless — rAF still runs, but see the doc comment)" : ` (DISPLAY=${display})`}`,
    );

    if (link) await signIn(link.hashedToken, via, base);

    console.log(
      `\nmeasuring ${paths.length} path(s) × ${runs} run(s) against ${base}` +
        `${label ? ` [${label}]` : ""}, signed ${link ? "in" : "out"}`,
    );

    const results = await runAll(browserWs, base, paths, runs, proseSelector, timeoutMs);

    console.log(`\n${"=".repeat(72)}`);
    console.log(
      `base: ${base}   runs: ${runs}   signed ${link ? "in" : "out"}${label ? `   label: ${label}` : ""}`,
    );
    for (const path of paths) report(path, results[path] ?? []);

    if (json) {
      writeFileSync(
        json,
        `${JSON.stringify(
          {
            base,
            label,
            runs,
            signedIn: Boolean(link),
            proseSelector,
            proseDefinition: PROSE_READY_DEFINITION,
            textDefinition: TEXT_READY_DEFINITION,
            when: new Date().toISOString(),
            results,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`\nwrote ${json}`);
    }
  } finally {
    chrome?.kill();
    if (!kept) {
      await sleep(500);
      rmSync(profile, { recursive: true, force: true });
    }
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
