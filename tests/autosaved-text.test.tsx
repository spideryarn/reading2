// @vitest-environment jsdom
/**
 * **The save behind a box that saves itself.** `useAutosavedText`, shared by
 * `/profile` and Metadata's purpose box since 2026-10-01 (spya-czbj9r).
 *
 * Each case here is something a two-second idle save makes ordinary that a
 * blur-only save made rare — most of them from GPT Sol's plan review of
 * docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reloadVeto } from "../src/web/safe-to-reload.js";
import { SaveStatus } from "../src/web/ProfileBox.js";
import { type AutosavedText, useAutosavedText } from "../src/web/useAutosavedText.js";

/** Each save the hook started, in order, with a way to answer it. */
let sent: Array<{ text: string; ok(stored: string): void; fail(message: string): void; reject(reason: unknown): void }> = [];
let left: string[] = [];
let syncFailure: Error | null = null;
let leaveFailure: Error | null = null;

let host: HTMLDivElement;
let root: Root;
let t: AutosavedText | null = null;

function Probe() {
  t = useAutosavedText({
    save: (text) => {
      if (syncFailure) throw syncFailure;
      return new Promise<string>((resolve, reject) => {
        sent.push({ text, ok: resolve, fail: (m) => reject(new Error(m)), reject });
      });
    },
    leave: (text) => {
      if (leaveFailure) throw leaveFailure;
      left.push(text);
    },
  });
  return createElement(SaveStatus, { save: t.state });
}
const get = (): AutosavedText => {
  if (!t) throw new Error("no render");
  return t;
};

beforeEach(() => {
  sent = [];
  left = [];
  syncFailure = null;
  leaveFailure = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Probe)));
  act(() => get().seed("Stored"));
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  /* Answer whatever is still out. A box that unmounts with newer words behind
     an unanswered save holds the tab until that save settles (unload-guard.ts),
     and that hold is module state the next test would inherit. */
  await act(async () => {
    for (const s of sent) s.ok(s.text);
  });
});

describe("what lands after a save", () => {
  it("keeps words typed during the round trip, and calls them unsaved", async () => {
    act(() => get().setDraft("Cognitive scientist "));
    act(() => get().commit());
    act(() => get().setDraft("Cognitive scientist, twenty years"));
    // The server trims, so its answer differs from what was sent as well.
    await act(async () => sent[0]?.ok("Cognitive scientist"));
    expect(get().draft).toBe("Cognitive scientist, twenty years");
    expect(get().saved).toBe("Cognitive scientist");
    expect(get().state.kind).toBe("dirty");
  });

  it("shows the server's version, and says Saved, when nothing was typed meanwhile", async () => {
    act(() => get().setDraft("Cognitive scientist "));
    act(() => get().commit());
    expect(get().state.kind).toBe("saving");
    await act(async () => sent[0]?.ok("Cognitive scientist"));
    expect(get().draft).toBe("Cognitive scientist");
    expect(get().state.kind).toBe("saved");
  });

  it("says nothing was saved when the save fails", async () => {
    act(() => get().setDraft("Too much"));
    act(() => get().commit());
    await act(async () => sent[0]?.fail("Over the limit"));
    expect(get().state).toEqual({ kind: "error", message: "Over the limit" });
  });

  it.each([new Error(""), "network failed", undefined, null])(
    "keeps a failure visible even when its rejection has no Error message (%s)",
    async (reason) => {
      act(() => get().setDraft("Words to keep"));
      act(() => get().commit());
      await act(async () => sent[0]?.reject(reason));
      expect(get().state).toEqual({ kind: "error", message: "The request failed." });
      expect(host.querySelector(".prof-save")?.textContent).toContain("Not saved — The request failed.");
      expect(get().draft).toBe("Words to keep");
      expect(get().saved).toBe("Stored");
      expect(get().inFlight).toBe(false);
    },
  );

  /* The idle timer arms only on `dirty`. A refusal of older text shown over
     newer words would leave them unsent until the next keystroke or blur. */
  it("does not call newer words refused when an older save fails", async () => {
    act(() => get().setDraft("Too much"));
    act(() => get().commit());
    act(() => get().setDraft("Less"));
    await act(async () => sent[0]?.fail("Over the limit"));
    expect(get().state.kind).toBe("dirty");
  });

  it("drops a failed attempt's error when the reader changes the draft", async () => {
    act(() => get().setDraft("Too much"));
    act(() => get().commit());
    await act(async () => sent[0]?.fail("Over the limit"));

    act(() => get().setDraft("Stored"));
    expect(get().state.kind).toBe("clean");
  });
});

describe("one save at a time", () => {
  /* Two PATCHes in flight can be applied in either order, and the older one
     landing second would overwrite the newer after the box said Saved. */
  it("holds a second save until the first comes back, then sends the newest text", async () => {
    act(() => get().setDraft("one"));
    act(() => get().commit());
    act(() => get().setDraft("one two"));
    act(() => get().commit());
    act(() => get().setDraft("one two three"));
    act(() => get().commit());
    expect(sent.map((s) => s.text)).toEqual(["one"]);
    await act(async () => sent[0]?.ok("one"));
    expect(sent.map((s) => s.text)).toEqual(["one", "one two three"]);
    await act(async () => sent[1]?.ok("one two three"));
    expect(get().state.kind).toBe("saved");
  });

  /* "Saving…" about words that are not in the request is a silent success. */
  it("calls the box dirty, not saving, once it holds text the request does not", () => {
    act(() => get().setDraft("one"));
    act(() => get().commit());
    act(() => get().setDraft("one two"));
    expect(get().state.kind).toBe("dirty");
  });

  it("corrects an older write when the draft has returned to the loaded value", async () => {
    act(() => get().setDraft("one"));
    act(() => get().commit());
    act(() => get().setDraft("Stored"));
    expect(get().state.kind).toBe("clean");
    expect(get().inFlight).toBe(true);
    act(() => get().commit());
    await act(async () => sent[0]?.ok("one"));
    expect(sent.map((s) => s.text)).toEqual(["one", "Stored"]);
    expect(get().inFlight).toBe(true);
    await act(async () => sent[1]?.ok("Stored"));
    expect(get().state.kind).toBe("saved");
    expect(get().inFlight).toBe(false);
  });

  it("sends the queued text even when the first save failed", async () => {
    act(() => get().setDraft("one"));
    act(() => get().commit());
    act(() => get().setDraft("one two"));
    act(() => get().commit());
    await act(async () => sent[0]?.fail("network"));
    expect(sent.map((s) => s.text)).toEqual(["one", "one two"]);
  });

  it("keeps a refusal visible when another blur queued the same words", async () => {
    act(() => get().setDraft("Words to keep"));
    act(() => get().commit());
    act(() => get().commit());
    await act(async () => sent[0]?.fail("The shelf is unavailable."));
    expect(sent.map((s) => s.text)).toEqual(["Words to keep"]);
    expect(get().state).toEqual({ kind: "error", message: "The shelf is unavailable." });
    expect(host.querySelector(".prof-save")?.textContent).toContain("Not saved — The shelf is unavailable.");
    expect(get().inFlight).toBe(false);

    // A later explicit retry still works.
    act(() => get().commit());
    expect(sent).toHaveLength(2);
    await act(async () => sent[1]?.ok("Words to keep"));
    expect(get().state.kind).toBe("saved");
  });

  it("does not leave the queue stuck when save throws before returning a promise", async () => {
    syncFailure = new Error("could not start");
    act(() => get().setDraft("one"));
    act(() => get().commit());
    await act(async () => Promise.resolve());
    expect(get().state).toEqual({ kind: "error", message: "could not start" });

    syncFailure = null;
    act(() => get().commit());
    expect(sent.map((s) => s.text)).toEqual(["one"]);
    await act(async () => sent[0]?.ok("one"));
    expect(get().state.kind).toBe("saved");
  });

  it("does not save what is already stored", () => {
    act(() => get().commit());
    expect(sent).toHaveLength(0);
  });
});

describe("dictation", () => {
  /* Dictation calls onChange with the transcript and onCommit in the same
     tick, before React has rendered. On Safari there were no live words, so a
     commit that read state would have saved nothing at all. */
  it("commits text set in the same tick", () => {
    act(() => {
      get().setDraft("spoken words");
      get().commit();
    });
    expect(sent.map((s) => s.text)).toEqual(["spoken words"]);
  });
});

describe("leaving", () => {
  it("saves when the tab is hidden", () => {
    act(() => get().setDraft("half a thought"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(sent.map((s) => s.text)).toEqual(["half a thought"]);
  });

  /* The ordinary save in flight is the one the browser may kill, so the last
     chance does not wait behind it. */
  it("fires the last-chance save on pagehide, even with a save in flight", () => {
    act(() => get().setDraft("half a thought"));
    act(() => get().commit());
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(left).toEqual(["half a thought"]);
  });

  it("sends nothing on pagehide when nothing is unsaved", () => {
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(left).toEqual([]);
  });

  /* **The box going away without the page going away.** Since 2026-10-02 the
     profile panel edits in place (plan 261002b), and its popover lives inside a
     mode band that the dock or an article change unmounts whatever the panel
     thinks — an SPA navigation fires neither `visibilitychange` nor
     `pagehide`. Without this, words typed in the last two seconds before
     switching mode were dropped without a sound. GPT Sol's plan review, P1. */
  it("fires the last-chance save when the box unmounts with words unsaved", () => {
    act(() => get().setDraft("typed, then switched mode"));
    act(() => root.render(null));
    expect(left).toEqual(["typed, then switched mode"]);
  });

  /* An ordinary PATCH and a keepalive PATCH are two independent requests. If
     unmount sends the newer draft immediately, the older ordinary request can
     land afterwards and put the server back to the older text. The last-chance
     write therefore waits behind an ordinary write that is already in flight. */
  it("orders an unmount save after the older ordinary save already in flight", async () => {
    act(() => get().setDraft("an older draft"));
    act(() => get().commit());
    act(() => get().setDraft("the newest words"));

    act(() => root.render(null));
    expect(left, "the newer write raced the older PATCH").toEqual([]);

    await act(async () => sent[0]?.ok("an older draft"));
    expect(left).toEqual(["the newest words"]);
  });

  /* **A box that has gone can still be holding the only copy of the newest
     words.** Between the unmount and the older save settling, they exist
     nowhere but in this hook's callback, and the field that would have warned
     about leaving is no longer on the page. `/changelog` reloads itself for a
     new build, so that window has to say no (GPT Sol's F12, plan 261005d). */
  it("holds off a page reload while the newest words wait behind an older save", async () => {
    expect(reloadVeto()).toBeNull();
    act(() => get().setDraft("an older draft"));
    act(() => get().commit());
    act(() => get().setDraft("the newest words"));

    act(() => root.render(null));
    expect(reloadVeto()).toBe("unsaved");

    await act(async () => sent[0]?.ok("an older draft"));
    expect(left).toEqual(["the newest words"]);
    expect(reloadVeto()).toBeNull();
  });

  it("lets go of that hold when the older save fails, too", async () => {
    act(() => get().setDraft("an older draft"));
    act(() => get().commit());
    act(() => get().setDraft("the newest words"));
    act(() => root.render(null));
    expect(reloadVeto()).toBe("unsaved");

    await act(async () => sent[0]?.fail("no"));
    expect(reloadVeto()).toBeNull();
  });

  it("lets go of that hold when the last-chance send itself throws", async () => {
    act(() => get().setDraft("an older draft"));
    act(() => get().commit());
    act(() => get().setDraft("the newest words"));
    act(() => root.render(null));
    leaveFailure = new Error("leave threw");
    await act(async () => sent[0]?.ok("an older draft"));
    expect(reloadVeto(), "a failed send must not hold the tab for good").toBeNull();
  });

  it("does not send a last-chance duplicate after a successful save", async () => {
    act(() => get().setDraft("already stored"));
    act(() => get().commit());
    await act(async () => sent[0]?.ok("already stored"));

    act(() => root.render(null));
    expect(left).toEqual([]);
  });

  /* The other half, and the one StrictMode leans on: it mounts, unmounts and
     mounts again in development, and nothing is pending at mount, so the
     cleanup must be a no-op rather than a PATCH per page load. */
  it("sends nothing when it unmounts with nothing unsaved", () => {
    act(() => root.render(null));
    expect(left).toEqual([]);
  });
});

/* Metadata's box moves to another article without remounting. */
it("drops a save begun for the previous value when re-seeded", async () => {
  act(() => get().setDraft("about the first article"));
  act(() => get().commit());
  act(() => get().seed("the second article's"));
  await act(async () => sent[0]?.ok("about the first article"));
  expect(get().saved).toBe("the second article's");
  expect(get().draft).toBe("the second article's");
  expect(get().state.kind).toBe("clean");
});
