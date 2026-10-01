// @vitest-environment jsdom
/* Marginalia's question notes say what they are on hover. Greg, 2026-10-01
   (SPIDERYARN-READING2-84): "There are vertical lines now next to some blocks.
   What are they for? They should ideally have tooltips to explain themselves."
   A question note is drawn with a rule down its left edge, beside only the
   blocks that open a part. docs/plans/261001l-…. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MarginNotesSlot } from "../src/web/marginalia/MarginaliaColumn.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

function question(depth: number): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const nextRoot = createRoot(host);
  root = nextRoot;
  act(() =>
    nextRoot.render(<MarginNotesSlot notes={[{ kind: "question", depth, text: "Why?" }]} />),
  );
  const el = host.querySelector<HTMLElement>(".marg-question");
  if (!el) throw new Error("no question note was drawn");
  return el;
}

describe("a question note", () => {
  it("says, on hover, that it is the question a part answers", () => {
    expect(question(1).getAttribute("title")).toMatch(/question this part of the article answers/);
  });

  it("says the whole piece, for the article's own question", () => {
    expect(question(0).getAttribute("title")).toMatch(/question the whole article answers/);
  });
});
