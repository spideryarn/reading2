/**
 * **One map says which icon a mode wears**, and the bar and Chat's list both
 * read it (src/web/mode-icons.ts; plan
 * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D5).
 *
 * The compiler already refuses a mode with no icon (`Record<Mode, …>`). What
 * it cannot see is a second copy growing back: an `icon:` on a Dock row, or
 * the panel importing the Dock to get one. Those are asked of the source
 * text, which is crude and enough: the two patterns are whole lines.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AlignLeft, BadgeQuestionMark, BookA, BookText, Brain, ClipboardCheck, Clock,
  Columns2, Globe, Layers, Lightbulb, MessagesSquare, Network, PanelRight,
  Quote, Route, Search,
} from "lucide-react";

import { MODES } from "../src/modes.js";
import { MODE_ICON } from "../src/web/mode-icons.js";

const read = (file: string): string => readFileSync(path.join(process.cwd(), "src/web", file), "utf8");

describe("the icon each mode wears", () => {
  it("keeps every glyph the Dock drew before the map was extracted", () => {
    expect(MODE_ICON).toEqual({
      plain: AlignLeft, structure: Columns2, summary: Layers, diagram: Network,
      skim: Route, quotes: Quote, glossary: BookA, faq: BadgeQuestionMark,
      ideas: Lightbulb, timeline: Clock, citations: BookText, referee: ClipboardCheck,
      debate: Globe, search: Search, chat: MessagesSquare, learn: Brain,
      marginalia: PanelRight,
    });
  });

  it("is given for every mode, and for nothing that is not one", () => {
    expect(Object.keys(MODE_ICON).sort()).toEqual([...MODES].sort());
    for (const mode of MODES) expect(MODE_ICON[mode], mode).toBeTruthy();
  });

  it("is read by the Dock, which keeps no icon on its own rows", () => {
    const dock = read("Dock.tsx");
    expect(dock).toContain('from "./mode-icons.js"');
    const rows = dock.slice(dock.indexOf("const MODES_UI = ["), dock.indexOf("] satisfies readonly ModeUi[]"));
    /* The control: the slice is the table, not an empty string. */
    expect(rows).toContain('mode: "learn"');
    expect(rows).not.toMatch(/^\s+icon:/m);
  });

  it("is read by Chat's panel without importing the Dock", () => {
    const panel = read("ChatPanel.tsx");
    expect(panel).toContain('from "./mode-icons.js"');
    expect(panel).not.toMatch(/from "\.\/Dock\.js"/);
  });
});
