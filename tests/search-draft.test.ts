/**
 * **The draft both search boxes type into** — plan 261002h stage 3,
 * src/web/search-draft.ts. The store is small; what is held here is the
 * handful of promises the bar and the band lean on.
 */
import { describe, expect, it } from "vitest";

import { createSearchDraft, searchDraftFor, type BandTyping } from "../src/web/search-draft.js";

const noBand = (): BandTyping => ({
  edit() {},
  flush() {},
  end() {},
  blur() {},
  focus() {},
  pause() {},
});

describe("the shared search draft", () => {
  it("carries the words and tells its subscribers, but not for a no-op write", () => {
    const d = createSearchDraft();
    let heard = 0;
    d.subscribe(() => heard++);
    d.set("why replication");
    expect(d.text()).toBe("why replication");
    expect(heard).toBe(1);
    d.set("why replication");
    expect(heard, "an unchanged write still announced itself").toBe(1);
  });

  it("is one store per article, the same one each time it is asked for", () => {
    expect(searchDraftFor("a-piece")).toBe(searchDraftFor("a-piece"));
    expect(searchDraftFor("a-piece")).not.toBe(searchDraftFor("another-piece"));
  });

  it("hands one handoff over once: take leaves none behind", () => {
    const d = createSearchDraft();
    expect(d.take()).toBeNull();
    d.handOff("pause");
    expect(d.handoff()).toBe("pause");
    expect(d.take()).toBe("pause");
    expect(d.handoff()).toBeNull();
    expect(d.take()).toBeNull();
  });

  it("forgets a band or a box only if it is still the one that registered", () => {
    const d = createSearchDraft();
    const first = noBand();
    const second = noBand();
    const offFirst = d.registerBand(first);
    d.registerBand(second);
    offFirst();
    expect(d.band(), "an old unmount took the new band with it").toBe(second);

    let focused = 0;
    expect(d.focusBox()).toBe(false);
    const off = d.registerBox(() => focused++);
    expect(d.focusBox()).toBe(true);
    expect(focused).toBe(1);
    off();
    expect(d.focusBox()).toBe(false);
  });
});
