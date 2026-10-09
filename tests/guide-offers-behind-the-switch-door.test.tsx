// @vitest-environment jsdom
/**
 * **A Referee chip works in the guide with the switch off, as a press, and
 * stays plain text in ordinary Chat** — plan
 * docs/plans/261009w-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md,
 * GPT Sol's F1, F3 and F6 on it.
 *
 * The real rows (src/web/chip-door.ts), the real doors and runners
 * (src/web/command-runners.ts), the real thread swap (CommandChip.tsx §
 * `ChatCommandsFor`) and the real chip (Cited.tsx → CommandChip.tsx). Only the
 * Dock's activators are spies, which is where Reader.tsx hands the press over.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modeToken } from "../src/guide.js";
import type { ThreadKind } from "../src/types.js";
import { CitedMarkdown } from "../src/web/Cited.js";
import { ChatCommands, ChatCommandsFor, useChatCommands } from "../src/web/CommandChip.js";
import { chipDoorRows, guideDoorRows, type SubNav } from "../src/web/chip-door.js";
import { commandId } from "../src/web/command-match.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";
import { modeDoor, withModeDoor } from "../src/web/command-runners.js";
import { type GuideAct, GuideActContext } from "../src/web/guide-acts.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAV: SubNav = { diagram: "force", learn: undefined };
const REFEREE = modeToken("mode:referee");
const CRITERIA = modeToken("submode:referee:criteria");

const keys = (rows: readonly Parameters<typeof commandId>[0][]): string[] => rows.map(commandId);

describe("the rows", () => {
  it("leave Referee out of chat's door with the switch off, and put it and its sub-modes in the guide's", () => {
    const chat = chipDoorRows({ experimentalOn: false, mode: undefined, marginOpen: false, subNav: NAV });
    expect(keys(chat)).not.toContain("mode:referee");
    const guide = keys(guideDoorRows(chat, NAV));
    expect(guide).toContain("mode:referee");
    expect(guide).toContain("submode:referee:criteria");
    expect(guide).toContain("submode:referee:hidden");
    expect(guide).not.toContain("mode:diagram");
    for (const key of keys(chat)) expect(guide).toContain(key);
  });

  it("keep chat's door as it was while the reader is in Referee with the switch off", () => {
    const chat = chipDoorRows({ experimentalOn: false, mode: "referee", marginOpen: false, subNav: NAV });
    expect(keys(chat)).not.toContain("mode:referee");
  });

  it("hold each key once when the switch is on and Referee is already in chat's door", () => {
    const chat = chipDoorRows({ experimentalOn: true, mode: undefined, marginOpen: false, subNav: NAV });
    expect(keys(chat)).toContain("mode:referee");
    const guide = keys(guideDoorRows(chat, NAV));
    expect(new Set(guide).size).toBe(guide.length);
  });
});

describe("the chip, end to end", () => {
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

  function setup() {
    const activators = {
      mode: vi.fn(),
      sub: vi.fn(),
      modeUnarmed: vi.fn(),
      subUnarmed: vi.fn(),
    };
    const rows = chipDoorRows({ experimentalOn: false, mode: undefined, marginOpen: false, subNav: NAV });
    const door = (of: typeof rows) =>
      modeDoor(
        of,
        { mode: (c) => activators.mode(c.mode), sub: (c) => activators.sub(c.sub) },
        { mode: (c) => activators.modeUnarmed(c.mode), sub: (c) => activators.subUnarmed(c.sub) },
      );
    const chat = withModeDoor({ runners: {}, sources: {} }, door(rows));
    const executor: CommandExecutor = { ...chat, guide: withModeDoor(chat, door(guideDoorRows(rows, NAV))) };
    return { activators, executor };
  }

  /** An answer in a thread of this kind, drawn the way ChatPanel's `Answer` draws it. */
  function paint(kind: ThreadKind, executor: CommandExecutor, text: string, guide: GuideAct | null = null): void {
    const Answer = () =>
      createElement(CitedMarkdown, {
        text,
        blocks: new Map(),
        onJump: () => {},
        links: true,
        commands: useChatCommands() ?? undefined,
      });
    act(() => {
      const answer = createElement(GuideActContext.Provider, { value: guide }, createElement(Answer));
      root.render(
        createElement(ChatCommands, { executor, children: createElement(ChatCommandsFor, { kind, children: answer }) }),
      );
    });
  }
  const chips = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];

  it("draws Referee as a chip in a guide thread, and a press opens it, armed, through the Dock's activator", () => {
    const { activators, executor } = setup();
    paint("guide", executor, `For your report:\n\n${REFEREE}`);
    expect(chips()).toHaveLength(1);
    act(() => chips()[0]?.click());
    expect(activators.mode).toHaveBeenCalledWith("referee");
    expect(activators.modeUnarmed).not.toHaveBeenCalled();
  });

  it("opens a Referee sub-mode the same way", () => {
    const { activators, executor } = setup();
    paint("guide", executor, `Start with your criteria:\n\n${CRITERIA}`);
    act(() => chips()[0]?.click());
    expect(activators.sub).toHaveBeenCalledWith({ mode: "referee", view: "criteria" });
  });

  it("never opens it by itself, even as the answer's one act", () => {
    const { activators, executor } = setup();
    const guide: GuideAct = { messageId: "spya-ans001", used: false, made: new Set() };
    paint("guide", executor, `For your report:\n\n${REFEREE}`, guide);
    expect(chips()).toHaveLength(1);
    expect(activators.modeUnarmed).not.toHaveBeenCalled();
    expect(activators.mode).not.toHaveBeenCalled();
  });

  it("leaves the same token as plain text in ordinary Chat", () => {
    const { activators, executor } = setup();
    paint("chat", executor, `For your report:\n\n${REFEREE}`);
    expect(chips()).toHaveLength(0);
    expect(activators.mode).not.toHaveBeenCalled();
  });
});
