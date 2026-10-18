// @vitest-environment jsdom
/**
 * **Point at words the article gave hover text to, and our card shows it as the
 * article's** — plan 261018n, Greg's option C on q-z2c269. The html goes
 * through the real browser binding first, so this is the attribute the policy
 * writes rather than one typed in by hand. Harness after
 * tests/citation-hover-card.test.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProseHoverCard } from "../src/web/ProseHoverCard.js";
import { sanitizeBlockHtml } from "../src/web/sanitize.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import { HOVER_DELAY } from "../src/web/useHoverCard.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const HTML = sanitizeBlockHtml(
  `<p>Models scale (<a href="https://gwern.net/doc/x" title="'Scaling Laws for Neural Language Models', Kaplan et al 2020">science</a>),
   <abbr title="circa">c.</abbr> 2020, as <a href="https://en.wikipedia.org/wiki/Leo_(constellation)" title="Leo (constellation)">Leo</a> does.
   <span title="ctx_ver=Z39.88-2004&amp;rft.genre=book">x</span></p>`,
);

let host: HTMLDivElement;
let root: Root;

function paint(): void {
  act(() =>
    root.render(
      <>
        <div
          className="prose"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: standing in for TableView
          dangerouslySetInnerHTML={{ __html: HTML }}
        />
        <ProseHoverCard
          entries={[]}
          works={[]}
          slug={null}
          sourceUrl={null}
          blockText={new Map()}
          notes={buildNoteIndex([])}
          lookUpLinks={false}
          canAddToShelf={false}
          showInSpideryarn={false}
          termActions={null}
          onOpenTerm={() => {}}
          onJump={() => {}}
          onFollowNote={() => {}}
        />
      </>,
    ),
  );
}

function hover(target: Element): void {
  act(() => {
    const event = new MouseEvent("pointerover", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "isPrimary", { value: true });
    target.dispatchEvent(event);
  });
  act(() => {
    vi.advanceTimersByTime(HOVER_DELAY.open + 100);
  });
}

function focus(target: HTMLElement): void {
  act(() => target.focus());
  act(() => vi.advanceTimersByTime(1));
}

const card = () => document.querySelector(".prose-card");
const el = (selector: string) => {
  const found = host.querySelector(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  paint();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the article's own hover text, in our card", () => {
  it("leaves no title for the browser to draw", () => {
    expect(host.querySelector("[title]")).toBeNull();
  });

  it("shows a link's citation as the article's, above the link half", () => {
    hover(el('a[href^="https://gwern.net"]'));
    const shown = card();
    expect(shown?.textContent).toContain("from the article");
    const quote = shown?.querySelector(".prose-card-quote");
    expect(quote?.textContent).toBe("'Scaling Laws for Neural Language Models', Kaplan et al 2020");
    expect(shown?.textContent).toContain("gwern.net");
  });

  it("shows the same author section when a keyboard focuses the link", () => {
    focus(el('a[href^="https://gwern.net"]') as HTMLElement);
    expect(card()?.querySelector(".prose-card-quote")?.textContent).toBe(
      "'Scaling Laws for Neural Language Models', Kaplan et al 2020",
    );
    expect(card()?.parentElement?.getAttribute("aria-label")).toContain("from the article");
  });

  it("opens a card on an abbreviation by itself", () => {
    hover(el("abbr"));
    expect(card()?.querySelector(".prose-card-quote")?.textContent).toBe("circa");
  });

  it("says nothing extra where the title only restates the address", () => {
    hover(el('a[href*="wikipedia"]'));
    expect(card()?.textContent ?? "").not.toContain("from the article");
  });

  it("lets a cross-reference shadow only its own words inside a titled span", () => {
    const span = el("span");
    span.setAttribute("data-author-title", "Section 2, above");
    span.innerHTML = `<em>ordinary words</em> <mark class="xref" data-xref="x1">see above</mark>`;
    hover(el("mark.xref"));
    expect(card()).toBeNull();
    hover(el("em"));
    expect(card()?.querySelector(".prose-card-quote")?.textContent).toBe("Section 2, above");
  });

  it("opens no card on COinS metadata", () => {
    hover(el("span"));
    expect(card()).toBeNull();
  });
});
