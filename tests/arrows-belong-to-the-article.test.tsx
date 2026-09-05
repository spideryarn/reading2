// @vitest-environment jsdom
/**
 * **No control group on this page may eat an arrow key.**
 *
 * `docs/project/keyboard.md` says ↑ / ↓ step through the article and ← / →
 * choose the granularity stride. That was true *except* inside three
 * roving-tabindex radiogroups — the bottom bar's modes, the diagram's three
 * pictures, and the search panel's two matchers — each of which selected as it
 * traversed and called `stopPropagation` so `keynav.ts` never saw the key.
 *
 * Greg met it as a bug, 2026-08-31:
 *
 * > I don't really like the way the keyboard changes modes or sub-modes, so if
 * > it helps, we can remove that functionality. I'd rather up/down *always*
 * > moves the text, and we can use left/right for mode-specific behaviours?
 *
 * ## Why this is a test rather than three deleted handlers
 *
 * Because one of those groups **spends money when it changes**, and the plan
 * that removed the handlers is the same plan that makes selecting a mode start
 * a model call (docs/plans/260831ai-…). Arrowing along the bar was four paid
 * jobs from one keypress; arrowing onto the diagram's third chip is a
 * 121–194 second, ~$0.20 sketch. So the assertion has to outlive the deletion:
 * anybody re-adding arrow selection to any of these three has to delete a test
 * that says why, rather than restoring a convention.
 *
 * ## What is being asserted, precisely
 *
 * Two things, and the second is the one that matters:
 *
 *  1. An arrow press on a button in one of these groups changes nothing.
 *  2. It **propagates** — `keynav.ts` listens on the window, so a handler that
 *     merely stopped selecting while still calling `stopPropagation` would
 *     leave ↑ / ↓ dead in the bar, which is the actual complaint.
 *
 * Every button is its own tab stop instead, so Tab still reaches all of them
 * and Enter, Space or a click still selects. That is a deliberate departure
 * from the ARIA authoring practice for a radiogroup, and the reason is local:
 * on this page the arrows belong to the article.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock } from "../src/web/Dock.js";
import { EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";
import { RefereeViews } from "../src/web/App.js";
import type { Mode } from "../src/web/params.js";
import { REFEREE_VIEWS, type RefereeView } from "../src/web/referee-views.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Every arrow, plus the two jumps a radiogroup's keyboard also claims. */
const ARROWS = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"] as const;

/** The mode segment, with somewhere to record a mode change that should not happen. */
function paintDock(): { changes: Mode[] } {
  const changes: Mode[] = [];
  act(() => {
    root.render(
      createElement(Dock, {
        slug: "a-piece",
        view: "article" as const,
        mode: "plain" as const,
        onMode: (next: Mode) => changes.push(next),
        /* On, so the segment under test is all thirteen buttons — the arrows
           must belong to the article whichever of them is on screen, and the
           eight a default reader sees are a subset of these. */
        experimental: EXPERIMENTAL_ON,
      }),
    );
  });
  return { changes };
}

function radios(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.dock-modes [role="radio"]')];
}

/**
 * One arrow press on `el`, reported as *did it reach the window*.
 *
 * A real `KeyboardEvent` with `bubbles: true`, listened for at the window —
 * which is where `keynav.ts` listens — so a `stopPropagation` anywhere in
 * between is what this catches. `dispatchEvent` rather than a testing-library
 * helper because the thing under test is propagation itself.
 */
function press(el: HTMLElement, key: string): boolean {
  let reached = false;
  const spy = () => {
    reached = true;
  };
  window.addEventListener("keydown", spy);
  act(() => {
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  window.removeEventListener("keydown", spy);
  return reached;
}

describe("the bottom bar's mode segment", () => {
  it("does not change mode on any arrow key", () => {
    const { changes } = paintDock();
    const first = radios()[0];
    expect(first).toBeDefined();
    for (const key of ARROWS) press(first as HTMLElement, key);
    expect(changes).toEqual([]);
  });

  it("lets every arrow through to the window, so keynav still steps the article", () => {
    paintDock();
    const first = radios()[0];
    expect(first).toBeDefined();
    for (const key of ARROWS) {
      expect(press(first as HTMLElement, key), `${key} was swallowed by the bar`).toBe(true);
    }
  });

  /**
   * **The half the deletion could quietly take away.** A roving tabindex is one
   * tab stop for the whole group, which is only reachable *because* the arrows
   * move within it. Take the arrows away and leave the roving tabindex, and
   * thirteen of the fourteen modes cannot be reached by keyboard at all — a
   * worse outcome than the one being fixed, and invisible to a mouse.
   */
  it("gives every mode its own tab stop", () => {
    paintDock();
    const found = radios();
    expect(found.length).toBeGreaterThan(1);
    for (const el of found) {
      expect(el.tabIndex, `${el.getAttribute("aria-label")} is not tabbable`).toBe(0);
    }
  });

  /* The claim the group still makes, and it is the one worth keeping: exactly
     one of these is on. Fourteen buttons where only one ever lights up read as
     fourteen toggles you could turn on together — styles.css § the modes
     segment says the same thing about the hairline frame. */
  it("is still a radiogroup with exactly one checked", () => {
    paintDock();
    expect(host.querySelector('.dock-modes[role="radiogroup"]')).not.toBeNull();
    const checked = radios().filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
  });

  it("still selects on a click", () => {
    const { changes } = paintDock();
    const second = radios()[1];
    expect(second).toBeDefined();
    act(() => (second as HTMLElement).click());
    expect(changes).toHaveLength(1);
  });
});

/**
 * **Referee mode's sub-modes**, which are the newest copy of the pattern
 * and therefore the likeliest place for the deleted arrow handler to come back
 * (docs/plans/260831an-referee-mode-for-peer-reviewers.md).
 *
 * The sweep below would catch a `tabIndex={x ? 0 : -1}` or an `onKeyDown`
 * textually. This is the behavioural half: the band is on screen, focus is on a
 * chip, and every arrow still reaches the window — which is where `keynav.ts`
 * listens and therefore the only thing that decides whether ↑ / ↓ still step the
 * article while Referee mode is open.
 *
 * `RefereeViews` rather than `RefereeBand`: the band owns `?referee=` and would
 * want a nuqs adapter around it, where this component is a pure function of two
 * props. The URL half is covered in tests/referee-mode.test.ts.
 */
describe("referee mode's sub-modes", () => {
  function paintViews(selected: RefereeView = "criteria"): { changes: RefereeView[] } {
    const changes: RefereeView[] = [];
    act(() => {
      root.render(
        createElement(RefereeViews, {
          view: selected,
          onView: (next: RefereeView) => changes.push(next),
        }),
      );
    });
    return { changes };
  }

  function chips(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('.ref-views [role="radio"]')];
  }

  it("does not change sub-mode on any arrow key", () => {
    const { changes } = paintViews();
    const first = chips()[0];
    expect(first).toBeDefined();
    for (const key of ARROWS) press(first as HTMLElement, key);
    expect(changes).toEqual([]);
  });

  it("lets every arrow through to the window, so keynav still steps the article", () => {
    paintViews();
    const first = chips()[0];
    expect(first).toBeDefined();
    for (const key of ARROWS) {
      expect(press(first as HTMLElement, key), `${key} was swallowed by the referee band`).toBe(
        true,
      );
    }
  });

  it("gives every sub-mode its own tab stop", () => {
    paintViews();
    const found = chips();
    expect(found).toHaveLength(REFEREE_VIEWS.length);
    for (const el of found) expect(el.tabIndex, `${el.textContent} is not tabbable`).toBe(0);
  });

  it("is a radiogroup with exactly one checked", () => {
    paintViews("claims");
    expect(host.querySelector('.ref-views[role="radiogroup"]')).not.toBeNull();
    const checked = chips().filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toBe("Claims");
  });

  it("still selects on a click", () => {
    const { changes } = paintViews();
    const second = chips()[1];
    expect(second).toBeDefined();
    act(() => (second as HTMLElement).click());
    expect(changes).toEqual(["claims"]);
  });
});

/**
 * **Every other switcher in the app, swept rather than named.**
 *
 * There were five of these, not three: the bottom bar's modes, the diagram's
 * three pictures, the diagram's option rows, the sketch's scene chips, and the
 * search matchers. Four had been copied from the first one, comment and all,
 * and the fifth was found only by grepping for the role — which is the argument
 * for a sweep rather than a list. A sixth would be copied from one of these.
 *
 * The rule, stated as something a regex can check: **no `role="radio"` element
 * in the client may carry a keyboard handler, and every one must be its own tab
 * stop.** A roving `tabIndex={x ? 0 : -1}` is inseparable from arrow
 * navigation — it is one tab stop for the group and only navigable *because*
 * the arrows move within it — so catching either half catches the pattern.
 *
 * ## What this deliberately does NOT forbid
 *
 * **The diagram picture's `role="tree"`**, whose ↑ / ↓ step one node and take
 * the article with them (diagram.md § the step bar). That is content
 * navigation, not a mode switch: it moves the reader through the article the
 * way ↑ / ↓ are supposed to, rather than swapping what the band contains. It is
 * also the one remaining beneficiary of `keynav.ts`'s `defaultPrevented` rule
 * (keyboard.md § a widget that already handled the key keeps it). Greg asked
 * for *modes and sub-modes* to stop taking the keys, and this is neither.
 *
 * Textual, and crude on purpose — the same call `tests/doc-links.test.ts`
 * makes. It cannot prove behaviour. What it can do is fail the moment somebody
 * pastes the pattern back in, which is how all four copies arrived.
 */
describe("no switcher anywhere in the client eats an arrow key", () => {
  /** Every `.tsx` under src/web, which is where a radiogroup could be. */
  function clientFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(at);
        else if (entry.name.endsWith(".tsx")) out.push(at);
      }
    };
    walk("src/web");
    return out;
  }

  /**
   * The props of each `role="radio"` element, as written.
   *
   * From the role to the end of the opening tag, found by walking to the first
   * `>` that is **not inside a `{…}` expression** — because
   * `tabIndex={on ? 0 : -1}` contains no `>` but an inline arrow function does,
   * and a naive `indexOf(">")` stops in the middle of one.
   *
   * **Only where the role starts its own line**, which is how every JSX prop in
   * this codebase is written and is what tells a real attribute from prose
   * about one: DiagramPanel.tsx explains itself with the words
   * `<button role="radio">` in a docstring, and Dock.tsx's `biome-ignore` line
   * argues about `<input type="radio">`. Matching those would fail the sweep
   * over a comment, which is the way a test like this gets deleted rather than
   * fixed.
   */
  function radioProps(src: string): string[] {
    const found: string[] = [];
    for (let at = src.indexOf('role="radio"'); at !== -1; at = src.indexOf('role="radio"', at + 1)) {
      const lineStart = src.lastIndexOf("\n", at) + 1;
      if (src.slice(lineStart, at).trim() !== "") continue;
      let depth = 0;
      let end = at;
      for (; end < src.length; end++) {
        const ch = src[end];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) break;
      }
      found.push(src.slice(at, end));
    }
    return found;
  }

  const FILES = clientFiles().map((file) => [file, readFileSync(file, "utf8")] as const);

  it("finds the switchers it is meant to be sweeping", () => {
    const withRadios = FILES.filter(([, src]) => src.includes('role="radio"'));
    /* Five as of 2026-08-31. A lower bound, not the number: this fails if the
       walk silently stops finding files, which is the way a sweep like this
       goes quietly green. */
    expect(withRadios.length).toBeGreaterThanOrEqual(4);
  });

  it("gives every radio its own tab stop", () => {
    for (const [file, src] of FILES) {
      for (const props of radioProps(src)) {
        expect(props, `${file}: a roving tabindex is back`).toContain("tabIndex={0}");
      }
    }
  });

  it("puts no keyboard handler on a radio", () => {
    for (const [file, src] of FILES) {
      for (const props of radioProps(src)) {
        expect(props, `${file}: a radio is handling keys again`).not.toContain("onKeyDown");
        expect(props, `${file}: a radio is handling keys again`).not.toContain("onKeyUp");
      }
    }
  });

  /* `nextModeIndex` — the wrapping arithmetic all five shared — is deleted, and
     nothing asserts that here on purpose: the export is gone, so an import of it
     is a compile error, and `npm run typecheck` is the check that already says
     so. A grep would only catch this file's own prose about the removal. */
});
