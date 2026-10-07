// @vitest-environment jsdom
/**
 * **A guide answer's chip pressing itself** — plan
 * docs/plans/261007o-the-guide-acts-without-a-press-and-opens-every-new-article.md,
 * Item 1. CommandChip.tsx's effect, with the act handed in through
 * `GuideActContext` (src/web/guide-acts.ts) as the guide's conversation hands it.
 *
 * What this pins: the first chip that only moves the reader runs, once, and no
 * other; a chip that spends, writes or searches neither runs nor uses the act
 * up; StrictMode's second effect run does not run it twice; an act already
 * spent runs nothing; a chip the reader cannot see spends the act without
 * running; and with no act, nothing runs on render, as before.
 *
 * jsdom has no `Element.prototype.checkVisibility` (checked below), so `isShown`
 * falls back to the ancestors' computed `display`, which inline style answers.
 */
import { act, createElement, type ReactNode, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CitedMarkdown } from "../src/web/Cited.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor, ModeTarget } from "../src/web/command-proposal.js";
import { type GuideAct, GuideActContext } from "../src/web/guide-acts.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const BLOCK = "spya-k3m9qt";
const BLOCKS = new Map([[BLOCK, "The paragraph."]]);
const CLOSE: ActionOutcome = { kind: "close" };

const target = (key: string, generates: boolean): ModeTarget => ({ key, label: key, description: "A mode.", generates });
const MODES = new Map<string, ModeTarget>([
  ["mode:structure", target("mode:structure", false)],
  ["mode:quotes", target("mode:quotes", false)],
  ["mode:glossary", target("mode:glossary", true)],
  ["mode:search", target("mode:search", false)],
]);

const STRUCTURE = "[cmd:mode:mode%3Astructure]";
const QUOTES = "[cmd:mode:mode%3Aquotes]";
const GLOSSARY = "[cmd:mode:mode%3Aglossary]";
const SEARCH = "[cmd:mode:mode%3Asearch]";
const JUMP = "[cmd:jump-first:the%20method]";
const QUICK = "[cmd:quick-search:imaging%20method]";
const FIND = "[cmd:find:imaging]";
const BOOKMARK = `[cmd:bookmark:${BLOCK}]`;

function spies() {
  return {
    mode: vi.fn((_p: { key: string }) => CLOSE),
    "jump-first": vi.fn(() => CLOSE),
    "quick-search": vi.fn(() => CLOSE),
    find: vi.fn(() => CLOSE),
    bookmark: vi.fn(async () => CLOSE),
  };
}

function executor(runners: ReturnType<typeof spies>): CommandExecutor {
  return { runners, sources: { modes: MODES } };
}

/** An answer whose tokens are each on a line of their own. */
const answer = (...tokens: string[]): string => ["Here is where to go.", "", ...tokens].join("\n");

function paint(text: string, commands: CommandExecutor, guide: GuideAct | null, wrap?: (n: ReactNode) => ReactNode): void {
  const cited = createElement(CitedMarkdown, { text, blocks: BLOCKS, onJump: () => {}, links: true, commands });
  const provided = createElement(GuideActContext.Provider, { value: guide }, cited);
  act(() => {
    root.render(wrap ? wrap(provided) : provided);
  });
}

const chips = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];
const fresh = (): GuideAct => ({ messageId: "spya-ans001", used: false });

it("runs in a DOM with no checkVisibility, so isShown reads computed display (the premise of the hidden case)", () => {
  expect(typeof (Element.prototype as { checkVisibility?: unknown }).checkVisibility).toBe("undefined");
});

describe("the first chip that only moves the reader", () => {
  it("runs a non-generating mode once, and a second such chip in the same answer not at all", () => {
    const r = spies();
    const guide = fresh();
    paint(answer(STRUCTURE, QUOTES), executor(r), guide);
    expect(chips()).toHaveLength(2);
    expect(r.mode).toHaveBeenCalledTimes(1);
    expect(r.mode.mock.calls[0]?.[0].key).toBe("mode:structure");
    expect(guide.used).toBe(true);
  });

  it("runs a jump-first once, and not the mode after it", () => {
    const r = spies();
    paint(answer(JUMP, STRUCTURE), executor(r), fresh());
    expect(r["jump-first"]).toHaveBeenCalledTimes(1);
    expect(r.mode).not.toHaveBeenCalled();
  });

  it("does not run again when the answer redraws with the same act", () => {
    const r = spies();
    const guide = fresh();
    const commands = executor(r);
    paint(answer(STRUCTURE), commands, guide);
    paint(answer(STRUCTURE), { ...commands }, guide);
    expect(r.mode).toHaveBeenCalledTimes(1);
  });
});

describe("a chip that does more than move the reader", () => {
  it.each([
    ["a quick search", QUICK, "quick-search"],
    ["a find", FIND, "find"],
    ["a bookmark", BOOKMARK, "bookmark"],
    ["a mode that generates", GLOSSARY, "mode"],
    ["Search", SEARCH, "mode"],
  ] as const)("does not run %s, and leaves the act for a later eligible chip", (_name, token, runner) => {
    const r = spies();
    const guide = fresh();
    paint(answer(token, QUOTES), executor(r), guide);
    expect(chips()).toHaveLength(2);
    if (runner === "mode") {
      expect(r.mode).toHaveBeenCalledTimes(1);
      expect(r.mode.mock.calls[0]?.[0].key, "only the later, eligible mode").toBe("mode:quotes");
    } else {
      expect(r[runner]).not.toHaveBeenCalled();
      expect(r.mode).toHaveBeenCalledTimes(1);
    }
    expect(guide.used).toBe(true);
  });

  it("leaves the act unused when no chip in the answer is eligible", () => {
    const r = spies();
    const guide = fresh();
    paint(answer(QUICK, GLOSSARY, BOOKMARK), executor(r), guide);
    expect(guide.used).toBe(false);
    for (const spy of Object.values(r)) expect(spy).not.toHaveBeenCalled();
  });
});

describe("when the act must not happen", () => {
  it("runs once under StrictMode", () => {
    const r = spies();
    /* A probe, so this test cannot pass merely because StrictMode did not
       re-run effects in this build of React. */
    let probeRuns = 0;
    const Probe = () => {
      useEffect(() => {
        probeRuns += 1;
      }, []);
      return null;
    };
    paint(answer(STRUCTURE), executor(r), fresh(), (n) =>
      createElement(StrictMode, null, createElement(Probe), n),
    );
    expect(probeRuns, "StrictMode ran mount effects twice").toBe(2);
    expect(r.mode).toHaveBeenCalledTimes(1);
  });

  it("runs nothing when the act is already used", () => {
    const r = spies();
    paint(answer(STRUCTURE, JUMP), executor(r), { messageId: "spya-ans001", used: true });
    expect(r.mode).not.toHaveBeenCalled();
    expect(r["jump-first"]).not.toHaveBeenCalled();
  });

  it("runs nothing inside a hidden ancestor, and spends the act so it cannot run when shown", () => {
    const r = spies();
    const guide = fresh();
    const commands = executor(r);
    paint(answer(STRUCTURE), commands, guide, (n) => createElement("div", { style: { display: "none" } }, n));
    expect(chips()).toHaveLength(1);
    expect(r.mode).not.toHaveBeenCalled();
    expect(guide.used).toBe(true);
    /* The band comes back with the same answer and the same act. */
    paint(answer(STRUCTURE), commands, guide, (n) => createElement("div", { style: { display: "block" } }, n));
    expect(r.mode).not.toHaveBeenCalled();
  });

  it("runs nothing with no act in context (null)", () => {
    const r = spies();
    paint(answer(STRUCTURE, JUMP), executor(r), null);
    expect(chips()).toHaveLength(2);
    expect(r.mode).not.toHaveBeenCalled();
    expect(r["jump-first"]).not.toHaveBeenCalled();
  });

  it("runs nothing with no provider at all", () => {
    const r = spies();
    act(() => {
      root.render(
        createElement(CitedMarkdown, {
          text: answer(STRUCTURE, JUMP),
          blocks: BLOCKS,
          onJump: () => {},
          links: true,
          commands: executor(r),
        }),
      );
    });
    expect(chips()).toHaveLength(2);
    expect(r.mode).not.toHaveBeenCalled();
    expect(r["jump-first"]).not.toHaveBeenCalled();
  });

  it("does not run a chip that is disabled here (no runner), and does not spend the act on it", () => {
    const r = spies();
    const guide = fresh();
    const { mode: _gone, ...rest } = r;
    paint(answer(STRUCTURE, JUMP), { runners: rest, sources: { modes: MODES } }, guide);
    expect(chips()[0]?.disabled).toBe(true);
    expect(r["jump-first"], "the next eligible, enabled chip acts").toHaveBeenCalledTimes(1);
  });
});
