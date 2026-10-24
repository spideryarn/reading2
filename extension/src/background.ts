/**
 * The extension's service worker: Chrome's events wired to extension/src/handoff.ts,
 * which holds every decision. Nothing here decides anything.
 *
 * Listeners are registered at the top level, synchronously, because Chrome
 * starts a stopped worker to deliver an event and only finds the listeners that
 * exist on its first turn.
 */
import { capturePage } from "../../src/web/save-page-bookmarklet.js";
import { MAX_UPLOAD_BYTES } from "../../src/uploads.js";
import { type Chromeish, MESSAGE_CAP, pressed, take } from "./handoff.js";
import { indexedDbStore } from "./store.js";

/** Set by scripts/build-extension.ts from the flavour: production is
 *  `["https://www.spideryarn.com"]`; dev adds the local servers. The first is
 *  where the button sends the reader. */
declare const SPIDERYARN_ORIGINS: readonly string[];

/** The slice of the `chrome` global this file calls. Typed here rather than by
 *  `@types/chrome`, a dependency for nine calls. */
declare const chrome: {
  action: {
    onClicked: { addListener(cb: (tab: { id?: number; url?: string }) => void): void };
    setBadgeText(d: { tabId: number; text: string }): Promise<void>;
    setTitle(d: { tabId: number; title: string }): Promise<void>;
  };
  scripting: {
    executeScript<A extends unknown[], R>(d: {
      target: { tabId: number };
      func: (...args: A) => R;
      args: A;
    }): Promise<{ result?: R }[]>;
  };
  tabs: {
    create(d: { url: string; openerTabId: number; index?: number; active: boolean }): Promise<{ id?: number }>;
    get(id: number): Promise<{ id?: number; index: number; windowId: number }>;
    update(id: number, d: { url?: string; active?: boolean }): Promise<unknown>;
    onRemoved: { addListener(cb: (tabId: number) => void): void };
  };
  windows: { update(id: number, d: { focused: boolean }): Promise<unknown> };
  runtime: {
    onMessageExternal: {
      addListener(
        cb: (message: unknown, sender: Parameters<typeof take>[1], reply: (r: unknown) => void) => boolean,
      ): void;
    };
  };
};

const ORIGIN = SPIDERYARN_ORIGINS[0] as string;

const browser: Chromeish = {
  async capture(tabId) {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: capturePage,
      args: [MAX_UPLOAD_BYTES, MESSAGE_CAP],
    });
    if (frame?.result === undefined) throw new Error("no result from the page");
    return frame.result;
  },
  async openTab(url, besideTabId) {
    const beside = await chrome.tabs.get(besideTabId);
    const tab = await chrome.tabs.create({ url, openerTabId: besideTabId, index: beside.index + 1, active: true });
    if (tab.id === undefined) throw new Error("Chrome opened a tab with no id");
    return tab.id;
  },
  async navigate(tabId, url) {
    await chrome.tabs.update(tabId, { url });
  },
  async focus(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    } catch {
      return false;
    }
  },
  async say(tabId, badge, title) {
    await chrome.action.setBadgeText({ tabId, text: badge });
    await chrome.action.setTitle({ tabId, title });
  },
};

chrome.action.onClicked.addListener((tab) => {
  void pressed(tab, ORIGIN, browser, indexedDbStore, Date.now);
});

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  void take(message, sender, SPIDERYARN_ORIGINS, indexedDbStore, Date.now).then(reply, () =>
    reply({ kind: "nothing" }),
  );
  /* `true`: the reply is sent later, so Chrome keeps the channel open. */
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void indexedDbStore.forgetTab(tabId);
});
