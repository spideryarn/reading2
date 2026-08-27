// @vitest-environment jsdom
/**
 * `useDocumentTitle` — the half of src/web/page-title.ts that touches the DOM.
 *
 * Its own file because it needs a DOM and tests/page-title.test.ts deliberately
 * does not; the composition rules are pure string work and should stay
 * testable without one.
 *
 * **The reason this exists at all is that every failure here is silent.** The
 * title is not something the app draws, so nothing on screen is wrong when it
 * stops being set; and the live region is invisible by construction, so a
 * region that announces nothing looks exactly like a region that works. There
 * is no browser check that would catch either — the app is behind a sign-in
 * gate a test cannot pass — so these three properties are pinned here instead:
 *
 *  - the title reaches `document.title`
 *  - a page passing `""` leaves the title alone, which is what lets
 *    `ArticlePage` hand over to `Reader` without clobbering it
 *  - the live region exists, is announced rather than hidden, and is one node
 *    rather than one per navigation
 *  - it is **created empty and filled a tick later**, which is the property
 *    that makes it announce anything at all
 *
 * No testing-library — nothing in this repo depends on one. `act` from `react`
 * and `createRoot` from `react-dom/client` are all a hook test needs; same
 * shape as tests/use-search.test.ts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announcement, useDocumentTitle } from "../src/web/page-title.js";

let container: HTMLDivElement;
let root: Root;

function Harness({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}

/** Render, and let the announcement's timer fire. */
async function render(title: string): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { title }));
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

/** Render without letting the timer fire — mid-burst, as while typing. */
async function type(title: string): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { title }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  document.title = "";
  /* The live region is a module-level singleton that outlives a test — that is
     the whole point of it (see `announce`), so it cannot be removed here
     without leaving the module holding a detached node. Emptied instead, so
     "" means "nothing was announced during this test". */
  for (const el of regions()) el.textContent = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** The live region, by the attributes `announce()` gives it. */
function regions(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]')];
}

describe("useDocumentTitle", () => {
  it("puts the title in the tab", async () => {
    await render("An Article · Spideryarn");
    expect(document.title).toBe("An Article · Spideryarn");
  });

  it("follows a change", async () => {
    await render("An Article · Spideryarn");
    await render("An Article · Glossary · Spideryarn");
    expect(document.title).toBe("An Article · Glossary · Spideryarn");
  });

  /* The property `ArticlePage` relies on. React runs a child's effects before
     its parent's, so a parent that computed a title would land on top of the
     more specific one its child had just written — the mode would show for a
     frame and vanish. An empty string is how the parent says "not mine". */
  it("leaves the tab alone when a page passes an empty string", async () => {
    await render("An Article · Spideryarn");
    await render("");
    expect(document.title).toBe("An Article · Spideryarn");
  });

  it("announces the title into a live region, without the app's name", async () => {
    await render("An Article · Glossary · Spideryarn");
    expect(regions()).toHaveLength(1);
    /* Everything but the app name. Not the leading segment alone: switching
       mode leaves the article's title unchanged, so announcing only that would
       repeat it and say nothing about what the reader pressed. And not the app
       name, because hearing "Spideryarn" after every navigation is the audible
       version of the problem this whole module exists to fix. */
    expect(regions()[0]?.textContent).toBe("An Article, Glossary");
  });

  /* **The finding this test exists for.** A region created *and* filled in one
     go is a live region appearing rather than updating, and nothing is
     announced — this file's own docstring said so while the code did it anyway
     (GPT Sol, 2026-08-27). Empty-now, filled-later is the fix, and the empty
     node has to be observable in between or the fix is not there. */
  it("creates the region empty and fills it a tick later", async () => {
    await type("An Article · Spideryarn");
    expect(regions()).toHaveLength(1);
    expect(regions()[0]?.textContent).toBe("");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(regions()[0]?.textContent).toBe("An Article");
  });

  /* Two articles can share a title, and re-announcing the same string is the
     case a same-tick clear-and-set cannot fix: the browser sees one net change
     and coalesces it away. The delay is what makes them two changes. */
  it("clears the region before a repeat of the same title", async () => {
    await render("Same Title · Spideryarn");
    await type("Same Title · Glossary · Spideryarn");
    expect(regions()[0]?.textContent).toBe("");
  });

  /* A region created *and* filled in the same tick is a live region appearing,
     not a live region updating, and nothing is announced. One node, reused, is
     what makes the second navigation onwards a real update. */
  it("reuses one region rather than adding one per navigation", async () => {
    await render("One · Spideryarn");
    await render("Two · Spideryarn");
    await render("Three · Spideryarn");
    expect(regions()).toHaveLength(1);
    expect(regions()[0]?.textContent).toBe("Three");
  });

  /* The shelf's search box puts what you have typed into the title, and
     `useQueryState` updates on the keystroke rather than on the debounced URL
     write. Without the pause a screen reader would spell the word back one
     letter at a time to the person typing it. */
  it("says nothing until a burst of changes settles, then says only where it settled", async () => {
    await type("s · Shelf · Spideryarn");
    await type("se · Shelf · Spideryarn");
    await type("set · Shelf · Spideryarn");
    // The tab is already current — only the announcement waits.
    expect(document.title).toBe("set · Shelf · Spideryarn");
    expect(regions()[0]?.textContent ?? "").toBe("");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(regions()[0]?.textContent).toBe("set, Shelf");
  });

  /* `display:none` and the `hidden` attribute both take a node out of the
     accessibility tree, which silences it while leaving the code looking
     right. Off-screen is the recipe that keeps it announceable. */
  it("hides the region without removing it from the accessibility tree", async () => {
    await render("An Article · Spideryarn");
    const el = regions()[0];
    expect(el).toBeDefined();
    expect(el?.hidden).toBe(false);
    expect(el?.style.display).not.toBe("none");
    expect(el?.style.position).toBe("absolute");
  });
});

describe("announcement", () => {
  it("drops the app's name and speaks the rest", () => {
    expect(announcement("An Article · Glossary · Spideryarn")).toBe("An Article, Glossary");
    expect(announcement("Spideryarn · AI-assisted reading")).toBe("Spideryarn, AI-assisted reading");
  });

  /* A comma, not the middot. The separator is punctuation a screen reader may
     read aloud, skip, or call "middle dot" depending on how it is set up; a
     comma is the one mark all of them turn into a pause. */
  it("speaks a comma rather than the separator the tab shows", () => {
    expect(announcement("A · B · Spideryarn")).not.toContain("·");
  });

  /* An article genuinely called "Spideryarn" would end `Spideryarn ·
     Spideryarn`, and only the trailing one is ours to drop. */
  it("drops only the trailing app name", () => {
    expect(announcement("Spideryarn · Spideryarn")).toBe("Spideryarn");
  });

  it("leaves a title that does not end with the app name alone", () => {
    expect(announcement("Just This")).toBe("Just This");
  });
});
