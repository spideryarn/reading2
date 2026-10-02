// @vitest-environment jsdom
/* Other modes' items in Marginalia are shut by default. Greg, 2026-10-01
   (SPIDERYARN-READING2-82): "Rather than showing the full item, maybe show them
   default-collapsed." One line per kind per block; a press opens the rest in
   place; the open half may hold a link, which must not sit inside the button.
   docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { CitedWork, FaqQuestion } from "../src/types.js";
import { MarginNotesSlot } from "../src/web/marginalia/MarginaliaColumn.js";
import type { MarginClaim, MarginComment, MarginaliaNote } from "../src/web/marginalia/notes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

function draw(notes: MarginaliaNote[]): HTMLDivElement {
  const el = document.createElement("div");
  host = el;
  document.body.append(el);
  const nextRoot = createRoot(el);
  root = nextRoot;
  act(() => nextRoot.render(<MarginNotesSlot notes={notes} />));
  return el;
}

const question = { id: "q1", question: "Why does the bound hold?", passages: [] } as unknown as FaqQuestion;
const row = {
  url: "https://elsewhere.example/a",
  title: "A reply",
  blockId: "spya-aaaaa1",
  claimQuote: "c",
  relation: "disputes",
  sourceQuote: "s",
  applies: "It says the bound is loose.",
} as unknown as MarginClaim;

describe("a shut line", () => {
  it("is shut until pressed, then opens in place, and shuts again", () => {
    const el = draw([{ kind: "faq", items: [{ question, quote: "because it does" }] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("Why does the bound hold?");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button?.getAttribute("aria-controls") ?? "");
    expect(panel?.hidden).toBe(true);
    expect(el.textContent).not.toContain("because it does");

    act(() => button?.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(el.textContent).toContain("because it does");

    act(() => button?.click());
    expect(panel?.hidden).toBe(true);
  });

  it("explains itself on hover", () => {
    const el = draw([{ kind: "debate", items: [row] }]);
    expect(el.querySelector(".marg-shut-button")?.getAttribute("title")).toMatch(/From Debate mode/);
  });

  it("puts a Debate row's link beside the button, never inside it", () => {
    const el = draw([{ kind: "debate", items: [row] }]);
    const button = el.querySelector<HTMLButtonElement>(".marg-shut-button");
    expect(button?.textContent).toContain("disputes");
    act(() => button?.click());
    const link = el.querySelector<HTMLAnchorElement>(".marg-open a");
    expect(link?.href).toBe("https://elsewhere.example/a");
    expect(link?.rel).toContain("noopener");
    expect(button?.contains(link ?? null)).toBe(false);
  });

  it("counts several of a kind on its shut line", () => {
    const works = ["a", "b", "c"].map((id) => ({ id, title: `Work ${id}`, why: "w" })) as unknown as CitedWork[];
    const el = draw([{ kind: "citation", items: works }]);
    expect(el.querySelector(".marg-shut-button")?.textContent).toContain("3 works");
  });

  it("draws a lone bookmark as a line with nothing to open", () => {
    const bookmark = { id: "b", blockId: "spya-aaaaa1", createdAt: "t", status: "none" } as unknown as MarginComment;
    const el = draw([{ kind: "comment", items: [bookmark] }]);
    expect(el.querySelector(".marg-shut-button")).toBeNull();
    expect(el.querySelector(".marg-shut")?.textContent).toContain("Bookmark");
  });
});
