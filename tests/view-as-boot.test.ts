// @vitest-environment jsdom
/**
 * **index.html's `view-as-boot` script, run as the exact text the page ships.**
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § round 1 F1, round 2 R2-1 and R2-4.
 *
 * The script cannot import anything, so it is lifted out of index.html and
 * evaluated, the way tests/appearance.test.ts runs the appearance script. What
 * it must do, and what each test pins:
 *
 * - nothing at all unless the fragment is `#view-as=` and a well-formed nonce;
 * - the fragment gone from the address;
 * - `localStorage` an empty store in memory — a key the administrator's own
 *   tabs saved is **not** readable through it, and a key written through it
 *   does not reach the real one — except Supabase's session keys, which read
 *   and write through, so a token refresh here is the same session every tab
 *   shares;
 * - `sessionStorage` empty and in memory;
 * - the nonce on a frozen, non-configurable mark that lib/view-as.ts reads;
 * - `data-view-as` on `<html>` for the bar's room;
 * - and it runs before the appearance script and before any module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
const inline = /<script id="view-as-boot">([\s\S]*?)<\/script>/.exec(html)?.[1];

const NONCE = "x".repeat(21) + "-_" + "Q".repeat(20);
const SESSION_KEY = "sb-abcdefgh-auth-token";
const VERIFIER_KEY = "sb-abcdefgh-auth-token-code-verifier";

/**
 * **The browser's real storage**, standing in for it: this jsdom has none (no
 * origin), so a small `Storage` that keeps its keys is what the script is
 * handed as the thing it must hide.
 */
class RealStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}

/** A page's globals, as the script sees them. */
function fakePage(hash: string, realSession: Storage = new RealStorage()) {
  const real = new RealStorage();
  real.setItem("spya.sentinel", "the administrator's own");
  real.setItem(SESSION_KEY, '{"access_token":"ADMIN"}');
  const fakeWindow: Record<string, unknown> = { localStorage: real, sessionStorage: realSession };
  const replaceState = vi.fn();
  const doc = document.implementation.createHTMLDocument("t");
  const run = () =>
    new Function("window", "location", "history", "document", inline!)(
      fakeWindow,
      { hash, pathname: "/read/some-slug", search: "?mode=quotes" },
      { state: { kept: 1 }, replaceState },
      doc,
    );
  return { real, fakeWindow, replaceState, doc, run };
}

describe("index.html's view-as script", () => {
  it("is there, and runs before the appearance script and the app", () => {
    expect(inline).toBeTruthy();
    const at = html.indexOf('id="view-as-boot"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf('id="appearance-boot"'));
    expect(at).toBeLessThan(html.indexOf("/src/web/boot.tsx"));
  });

  for (const hash of [
    "",
    "#spya-k3m9qt",
    `#view-as=${NONCE.slice(1)}`,
    `#view-as=${NONCE}x`,
    `#view-as=${NONCE.slice(1)}=`,
    `#view-as=${NONCE}&x=1`,
    `#other=1&view-as=${NONCE}`,
  ]) {
    it(`does nothing for ${JSON.stringify(hash)}`, () => {
      const page = fakePage(hash);
      page.run();
      expect(page.fakeWindow.localStorage).toBe(page.real);
      expect(page.fakeWindow.__spideryarnViewAs).toBeUndefined();
      expect(page.replaceState).not.toHaveBeenCalled();
      expect(page.doc.documentElement.hasAttribute("data-view-as")).toBe(false);
    });
  }

  describe("with a nonce", () => {
    it("strips the fragment, keeping the path, query and history state", () => {
      const page = fakePage(`#view-as=${NONCE}`);
      page.run();
      expect(page.replaceState).toHaveBeenCalledWith({ kept: 1 }, "", "/read/some-slug?mode=quotes");
    });

    it("leaves the nonce on a frozen mark nothing can replace", () => {
      const page = fakePage(`#view-as=${NONCE}`);
      page.run();
      const mark = page.fakeWindow.__spideryarnViewAs as { nonce: string };
      expect(mark.nonce).toBe(NONCE);
      expect(Object.isFrozen(mark)).toBe(true);
      const descriptor = Object.getOwnPropertyDescriptor(page.fakeWindow, "__spideryarnViewAs")!;
      expect(descriptor.configurable).toBe(false);
      expect(descriptor.writable).toBe(false);
      expect(page.doc.documentElement.hasAttribute("data-view-as")).toBe(true);
    });

    it("hides what the administrator's tabs saved, and keeps what this tab writes to itself", () => {
      const page = fakePage(`#view-as=${NONCE}`);
      page.run();
      const local = page.fakeWindow.localStorage as Storage;
      expect(local).not.toBe(page.real);
      expect(local.getItem("spya.sentinel")).toBeNull();
      expect(local.length).toBe(0);
      local.setItem("spya.appearance", "light");
      expect(local.getItem("spya.appearance")).toBe("light");
      expect(page.real.getItem("spya.appearance")).toBeNull();
      local.clear();
      expect(page.real.getItem("spya.sentinel")).toBe("the administrator's own");
    });

    it("passes Supabase's session keys through to the real storage, both ways", () => {
      const page = fakePage(`#view-as=${NONCE}`);
      page.run();
      const local = page.fakeWindow.localStorage as Storage;
      expect(local.getItem(SESSION_KEY)).toBe('{"access_token":"ADMIN"}');
      local.setItem(SESSION_KEY, '{"access_token":"REFRESHED"}');
      expect(page.real.getItem(SESSION_KEY)).toBe('{"access_token":"REFRESHED"}');
      local.setItem(VERIFIER_KEY, "v");
      expect(page.real.getItem(VERIFIER_KEY)).toBe("v");
      local.removeItem(VERIFIER_KEY);
      expect(page.real.getItem(VERIFIER_KEY)).toBeNull();
      /* Near-misses stay in memory. */
      local.setItem("sb-abcdefgh-auth-token-user", "u");
      local.setItem("xsb-abcdefgh-auth-token", "u");
      expect(page.real.getItem("sb-abcdefgh-auth-token-user")).toBeNull();
      expect(page.real.getItem("xsb-abcdefgh-auth-token")).toBeNull();
    });

    it("starts sessionStorage empty, in memory, with nothing passed through", () => {
      const realSession = new RealStorage();
      realSession.setItem(SESSION_KEY, "session-copy");
      realSession.setItem("spya.draft", "the administrator's draft");
      const page = fakePage(`#view-as=${NONCE}`, realSession);
      page.run();
      const session = page.fakeWindow.sessionStorage as Storage;
      expect(session).not.toBe(realSession);
      expect(session.length).toBe(0);
      expect(session.getItem(SESSION_KEY)).toBeNull();
      expect(session.getItem("spya.draft")).toBeNull();
      session.setItem("k", "v");
      expect(realSession.getItem("k")).toBeNull();
    });
  });

  /**
   * **On the real window**, because a browser's `localStorage` is an accessor
   * the script has to be allowed to replace. Last, because the mark it leaves
   * cannot be taken off again — which is the point of it.
   */
  it("replaces the real window's storage, and lib/view-as.ts then reads the nonce", async () => {
    /* As a browser has it: an accessor on the window, configurable. */
    const real = new RealStorage();
    real.setItem("spya.sentinel", "the administrator's own");
    real.setItem(SESSION_KEY, "token");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => real });
    history.replaceState(null, "", `/read/x?y=1#view-as=${NONCE}`);
    new Function(inline!)();
    expect(location.hash).toBe("");
    expect(location.pathname + location.search).toBe("/read/x?y=1");
    expect(window.localStorage.getItem("spya.sentinel")).toBeNull();
    expect(localStorage.getItem("spya.sentinel")).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBe("token");
    expect(real.getItem("spya.sentinel")).toBe("the administrator's own");
    const { viewAsNonce } = await import("../src/web/lib/view-as.js");
    expect(viewAsNonce()).toBe(NONCE);
  });
});
