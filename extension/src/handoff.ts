/**
 * **What the Spideryarn extension does when its button is pressed, and whom it
 * hands the page to** — everything but the Chrome calls themselves, which come
 * in through `Chromeish`, so tests/extension-handoff.test.ts can decide every
 * branch without a browser. extension/src/background.ts is the wiring.
 *
 *   button pressed on a tab ── capturePage() run in that tab only (activeTab)
 *     └─ a blank tab opened beside it; the page kept here, keyed by that tab;
 *        only then is the tab sent to our receiving page
 *   that page ── asks for it (`chrome.runtime.sendMessage`)
 *     └─ handed over once, if the asker is the top frame of exactly that tab,
 *        at exactly our receiving address on exactly our origin
 *
 * **The extension holds nothing of the reader's**: no token, no cookie, and it
 * never calls our API. The receiving page uploads the page with the session it
 * already has, through the existing upload path. That is the whole auth design:
 * docs/plans/261024q-chrome-extension-one-click-add-the-page.md.
 */
import type { PageCapture } from "../../src/web/save-page-bookmarklet.js";
import { MAX_UPLOAD_BYTES } from "../../src/uploads.js";

/** The page that takes a capture, on our origin. Not under `/add/`, whose
 *  branch reads everything after it as a stranger's URL (src/web/router.ts).
 *  The web app's copy is `EXTENSION_RECEIVE_PATH` in src/web/router.ts, and
 *  tests/extension-handoff.test.ts holds them equal. */
export const RECEIVE_PATH = "/add-from-extension";

/** What the page sends to ask for its capture. */
export const TAKE = "spideryarn.take";

/** A capture not taken in this long is dropped: the reader has gone elsewhere.
 *  Also how long a second press on the same address goes to the same tab. */
export const KEEP_MS = 15 * 60 * 1000;

/**
 * The largest capture, as JSON, that Chrome will carry: its messages are JSON
 * and capped at 64 MiB, so 60 leaves room for the reply's own keys. A quote or
 * a backslash is two characters of JSON, so a page under the upload cap can be
 * over this (GPT Sol, 261024q F9).
 */
export const MESSAGE_CAP = 60 * 1024 * 1024;

/** One page waiting for the tab opened for it. */
export interface Waiting {
  /** The receiving tab that may take it, and no other. */
  tabId: number;
  html: string;
  filename: string;
  /** `Date.now()` when it was captured. */
  at: number;
}

/** The receiving tab opened for a page's address, so a second press goes there. */
export interface Opened {
  source: string;
  tabId: number;
  at: number;
}

/** The answer to `TAKE`. The page reads it in src/web/extension-handoff.ts. */
export type TakeReply = { kind: "page"; html: string; filename: string } | { kind: "nothing" };

/**
 * Where captures wait between the button and the tab asking. IndexedDB in the
 * worker (extension/src/store.ts), because the worker is stopped after 30 s
 * idle and a reader signing in first takes longer; a `Map` in the tests.
 */
export interface WaitingStore {
  put(entry: Waiting, opened: Opened): Promise<void>;
  /** The entry for this tab, **removed in the same transaction**, so two asks
   *  at once cannot both have it (F4). */
  take(tabId: number): Promise<Waiting | undefined>;
  openedFor(source: string): Promise<Opened | undefined>;
  /** Everything kept for this receiving tab, which has closed. */
  forgetTab(tabId: number): Promise<void>;
  /** Everything captured or opened before `before`. */
  dropOlderThan(before: number): Promise<void>;
}

/** The Chrome calls this needs. */
export interface Chromeish {
  /** `capturePage(MAX_UPLOAD_BYTES, MESSAGE_CAP)` in the tab, through
   *  `chrome.scripting.executeScript`. Rejects where Chrome forbids it. */
  capture(tabId: number): Promise<PageCapture>;
  /** A new tab beside `besideTabId`, at `url`, made active; its id. */
  openTab(url: string, besideTabId: number): Promise<number>;
  /** Sends an open tab to `url`. */
  navigate(tabId: number, url: string): Promise<void>;
  /** Brings a tab and its window to the front; `false` if it has gone. */
  focus(tabId: number): Promise<boolean>;
  /** The badge and tooltip on the button, for this tab. `""` clears the badge. */
  say(tabId: number, badge: string, title: string): Promise<void>;
}

/** The tab the button was pressed on, as `chrome.action.onClicked` gives it. */
export interface PressedTab {
  id?: number;
  url?: string;
}

/** The tooltip when nothing is wrong; also the manifest's `action.default_title`. */
export const IDLE_TITLE = "Add this page to Spideryarn";

/**
 * The button was pressed on `tab`. `origin` is ours, from the build's flavour.
 *
 * **The tab is opened blank, the page stored, and only then is the tab sent to
 * our page** (F4): its id is the key, and a tab opened at our address could ask
 * before the store had it.
 */
export async function pressed(
  tab: PressedTab,
  origin: string,
  chrome: Chromeish,
  store: WaitingStore,
  now: () => number,
): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;
  const source = webAddress(tab.url);
  if (source === null) {
    await chrome.say(tabId, "!", "Spideryarn can only add web pages, and this isn't one.");
    return;
  }
  await store.dropOlderThan(now() - KEEP_MS);

  /* A second press on the same page goes to the tab the first one opened, which
     is already adding it: two presses must not make two articles (F5). */
  const opened = await store.openedFor(source);
  if (opened !== undefined && (await chrome.focus(opened.tabId))) return;

  let got: PageCapture;
  try {
    got = await chrome.capture(tabId);
  } catch {
    await chrome.say(tabId, "!", "Chrome doesn't let extensions read this page, so it can't be added from here.");
    return;
  }
  if (got.kind === "pdf") {
    /* Our server fetches the PDF from its address, as a pasted link does. A
       PDF behind a check fails there, and the add page says to download it and
       upload the file. */
    await chrome.openTab(`${origin}/add/${encodeURIComponent(source)}`, tabId);
    await chrome.say(tabId, "", IDLE_TITLE);
    return;
  }
  if (got.kind === "too-big") {
    await chrome.say(
      tabId,
      "!",
      `This page is too big to add from here (${mb(got.bytes)} MB; the limit is ${mb(MAX_UPLOAD_BYTES)} MB).`,
    );
    return;
  }
  const receiver = await chrome.openTab("about:blank", tabId);
  const at = now();
  await store.put(
    { tabId: receiver, html: got.html, filename: got.filename, at },
    { source, tabId: receiver, at },
  );
  await chrome.navigate(receiver, `${origin}${RECEIVE_PATH}`);
  await chrome.say(tabId, "", IDLE_TITLE);
}

/** What `chrome.runtime.onMessageExternal` says about who sent a message. */
export interface Sender {
  origin?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number };
}

/**
 * Somebody asked for a capture. Answered only for **the top frame of exactly
 * the tab opened for it, at exactly our receiving address on exactly one of
 * `origins`**, once, within `KEEP_MS`.
 *
 * Chrome has already refused any page whose origin is not in the manifest's
 * `externally_connectable.matches` (measured: such a page has no
 * `chrome.runtime.sendMessage` at all), and every other extension, since the
 * manifest names none. This is the second check. The tab binds a capture to
 * the tab opened for it, so another Spideryarn tab cannot take it; the top
 * frame and the path stop a page that the tab was later navigated to from
 * framing ours to take it (F3).
 *
 * The origin is compared whole, never by prefix, which
 * `https://www.spideryarn.com.evil.example` would pass.
 */
export async function take(
  message: unknown,
  sender: Sender,
  origins: readonly string[],
  store: WaitingStore,
  now: () => number,
): Promise<TakeReply> {
  if (!isTake(message)) return NOTHING;
  if (sender.frameId !== 0) return NOTHING;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return NOTHING;
  let url: URL;
  try {
    url = new URL(sender.url ?? "");
  } catch {
    return NOTHING;
  }
  if (!origins.includes(url.origin) || url.pathname !== RECEIVE_PATH) return NOTHING;
  if (sender.origin !== undefined && sender.origin !== url.origin) return NOTHING;
  const entry = await store.take(tabId);
  if (entry === undefined || now() - entry.at > KEEP_MS) return NOTHING;
  return { kind: "page", html: entry.html, filename: entry.filename };
}

const NOTHING: TakeReply = { kind: "nothing" };

function isTake(message: unknown): boolean {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === TAKE;
}

/** The tab's address if it is a web page, without its fragment; else `null`. */
function webAddress(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function mb(bytes: number): number {
  return Math.round(bytes / 1048576);
}
