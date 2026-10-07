// @vitest-environment jsdom
/**
 * **A bigger target for a finger, drawn the same size** — `.tap-target`
 * (src/web/styles/tap-target.css), the close cross's invisible hit area made
 * generic. Greg, 2026-10-07, on the UI sweep's question 2: *"yes to all as you
 * see fit"*, to "give each the invisible larger hit area the close cross
 * already has (40px to the finger, drawn the same size). Where two would
 * overlap, the row grows instead." docs/plans/261007h-… § F5a.
 *
 * What is pinned:
 *
 *  - the class draws its `::after` **only under `(any-pointer: coarse)`** —
 *    nothing changes for a mouse — centred on the control and at least 40px
 *    unless the control's own rule bounds it;
 *  - each control the sweep measured as small at 390 carries it: Quotes' ⓘ
 *    (both kinds of row), a bare passage id, /profile's and Metadata's
 *    section headings, "Forgot your password?" and "back to sign in";
 *  - **a passage id's target is bounded**: ids sit 3px apart in a chip row and
 *    on consecutive lines of a chat answer, so it grows vertically and only to
 *    1.3rem (20.8px), never sideways (GPT Sol's plan review, R15);
 *  - **a phrase link and a missing id do not take it** — a phrase is already
 *    a line of text tall and can wrap, where an inline box's `::after` would
 *    span from its first fragment to its last; a missing id is not a link;
 *  - **Quotes' ⓘ and its id stack under a coarse pointer**, so the row grows
 *    instead of the ⓘ's 40px reaching the id 2px beside it.
 *
 * ## What this does NOT prove
 *
 * That a finger lands where it should. This reads text; the overlap checks
 * (`elementFromPoint` 15px out from each control, and at the edge between
 * neighbours) were taken in a real browser at 390 with a touch pointer and are
 * in the plan's § What landed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "../src/types.js";
import { readerCssNoComments } from "./helpers/stylesheets.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
      signUp: async () => ({ data: {}, error: null }),
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
}));

const { BlockLinkProvider } = await import("../src/web/BlockLinkCard.js");
const { BlockRef } = await import("../src/web/BlockRef.js");
const { Section } = await import("../src/web/PageSection.js");
const { SignInControls } = await import("../src/web/SignInControls.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(import.meta.dirname, "..");

/** Every `@media (any-pointer: coarse)` block's body — this query only. */
function anyCoarse(css: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/@media\s*\(\s*any-pointer:\s*coarse\s*\)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out.join("\n");
}

/** The declarations of the first rule whose selector list names `selector`. */
function declsFor(css: string, selector: string): string | undefined {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = (m[1] ?? "").split(",").map((s) => s.trim());
    if (list.includes(selector)) return m[2] ?? "";
  }
  return undefined;
}

/** Every top-level rule — outside any `@media` — as `selector { decls }`. */
function topLevel(css: string): string {
  let out = "";
  let depth = 0;
  let inMedia = false;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("@media", i) && depth === 0) inMedia = true;
    const ch = css[i];
    if (ch === "{") depth++;
    if (!inMedia) out += ch;
    if (ch === "}") {
      depth--;
      if (depth === 0) inMedia = false;
    }
  }
  return out;
}

describe("the class", () => {
  const css = readerCssNoComments();
  const coarse = anyCoarse(css);

  it("draws an invisible, centred, at-least-40px ::after under (any-pointer: coarse)", () => {
    const after = declsFor(coarse, ".tap-target::after");
    expect(after, "no `.tap-target::after` inside @media (any-pointer: coarse)").toBeDefined();
    expect(after).toMatch(/content:\s*""/);
    expect(after).toMatch(/position:\s*absolute/);
    /* Centred on the control, never stretched from one corner. */
    expect(after).toMatch(/left:\s*50%/);
    expect(after).toMatch(/top:\s*50%/);
    expect(after).toMatch(/translate:\s*-50%\s+-50%/);
    /* At least the control's own box, and at least 40px unless bounded. */
    expect(after).toMatch(/width:\s*max\(\s*100%\s*,\s*var\(--tap-w,\s*40px\)\s*\)/);
    expect(after).toMatch(/height:\s*max\(\s*100%\s*,\s*var\(--tap-h,\s*40px\)\s*\)/);
    /* The control is what the pseudo-element is positioned against. */
    expect(declsFor(coarse, ".tap-target")).toMatch(/position:\s*relative/);
  });

  it("changes nothing for a mouse: no ::after and no position outside the query", () => {
    const outside = topLevel(css);
    expect(outside).not.toMatch(/\.tap-target/);
  });

  it("bounds a passage id's target: no wider than the id, 1.3rem tall", () => {
    const ref = declsFor(coarse, ".block-ref.tap-target");
    expect(ref, "no bound for `.block-ref.tap-target` under the coarse query").toBeDefined();
    expect(ref).toMatch(/--tap-w:\s*0px/);
    expect(ref).toMatch(/--tap-h:\s*1\.3rem/);
  });

  it("stacks Quotes' ⓘ above its id, so the row grows instead of the targets overlapping", () => {
    const side = declsFor(coarse, ".quotes-row-side");
    expect(side, "no coarse-pointer layout for `.quotes-row-side`").toBeDefined();
    expect(side).toMatch(/flex-direction:\s*column/);
    expect(side).toMatch(/min-width:\s*40px/);
    /* The ⓘ's target reaches 11.6px below its 16.8px box (40 − 16.8 = 23.2,
       half each way); the id's own reaches 5.75px above its 9.3px one. At the
       12px root the app supports they are 12.2 and 4.3. The gap has to hold
       both. */
    const gap = /(?:^|;|\s)gap:\s*([\d.]+)px/.exec(side ?? "");
    expect(Number(gap?.[1]), "the gap between ⓘ and id is too small for both targets").toBeGreaterThanOrEqual(18);
  });
});

describe("the controls that carry it", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function mount(el: ReactElement): void {
    host = document.createElement("div");
    document.body.append(host);
    act(() => {
      root = createRoot(host);
      root.render(el);
    });
  }

  it("a bare passage id does; a phrase link and a missing id do not", () => {
    history.replaceState(null, "", "/read/x");
    const known = "spya-aaaaaa" as BlockId;
    const gone = "spya-zzzzzz" as BlockId;
    const index = new Map([[known, { section: "S", text: "t" }]]) as never;
    mount(
      <BlockLinkProvider index={index}>
        <BlockRef id={known} />
        <BlockRef id={known} className="phrase">
          a phrase
        </BlockRef>
        <BlockRef id={gone} />
      </BlockLinkProvider>,
    );
    const [bare, phrase] = [...host.querySelectorAll("a.block-ref")];
    expect(bare?.classList.contains("tap-target"), "the bare id has no tap target").toBe(true);
    expect(phrase?.classList.contains("tap-target"), "a phrase link must not take one").toBe(false);
    const missing = host.querySelector("span.block-ref-missing");
    expect(missing, "the missing id should render as a span").not.toBeNull();
    expect(missing?.classList.contains("tap-target"), "a missing id is not a link").toBe(false);
  });

  it("a collapsible section heading does", () => {
    mount(
      <Section label="Your data" keywords="x" collapsible>
        body
      </Section>,
    );
    const button = host.querySelector("h2 > button");
    expect(button?.classList.contains("tap-target")).toBe(true);
  });

  it("'Forgot your password?' and 'back to sign in' do", async () => {
    await act(async () => mount(createElement(SignInControls, { returnTo: "/" })));
    const forgot = [...host.querySelectorAll("button")].find((b) => /forgot/i.test(b.textContent ?? ""));
    expect(forgot?.classList.contains("tap-target")).toBe(true);
    await act(async () => forgot?.click());
    const back = [...host.querySelectorAll("button")].find((b) => /back to sign in/i.test(b.textContent ?? ""));
    expect(back?.classList.contains("tap-target")).toBe(true);
  });

  /* QuotesPanel's rows are not exported, so its two ⓘ buttons are read from
     source: every `quotes-why` class string has to carry the class too. */
  it("both of Quotes' ⓘ buttons do", () => {
    const src = readFileSync(path.join(ROOT, "src/web/QuotesPanel.tsx"), "utf8");
    const uses = [...src.matchAll(/className=\{`quotes-why[^`]*`\}/g)].map((m) => m[0]);
    expect(uses.length, "expected the model's row and the reader's row").toBe(2);
    for (const use of uses) expect(use).toContain("tap-target");
  });
});
