// @vitest-environment jsdom
/**
 * **The guide's next steps, drawn** — src/web/GuideNextSteps.tsx, plan
 * docs/plans/261009r-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md.
 *
 * Each kind becomes a press through machinery that already exists: an ask
 * sends the words, a mode is `chipFor`'s chip, a search is the quick-search
 * chip for the words in an editable box, share and archive go to Metadata.
 * None presses itself; a stored run is checked again before anything is drawn.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ToolRun } from "../src/types.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor, ModeTarget } from "../src/web/command-proposal.js";

const went: string[] = [];
vi.mock("../src/web/router.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/router.js")>();
  return { ...real, navigate: (href: string) => went.push(href) };
});

const { ChatCommands } = await import("../src/web/CommandChip.js");
const { GuideNextSteps, STEP_WORDS } = await import("../src/web/GuideNextSteps.js");
const { GuideActContext } = await import("../src/web/guide-acts.js");

let host: HTMLDivElement;
let root: Root;
const sent: string[] = [];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  went.length = 0;
  sent.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const CLOSE: ActionOutcome = { kind: "close" };
const BLOCKS = new Map([["spya-k3m9qt", "The paragraph."]]);
const target = (key: string, label: string, generates: boolean): ModeTarget => ({ key, label, description: "A mode.", generates });
const MODES = new Map<string, ModeTarget>([
  ["mode:structure", target("mode:structure", "Structure", false)],
  ["submode:summary:brief", target("submode:summary:brief", "Summary › Brief", true)],
]);

function spies() {
  return { mode: vi.fn((_p: { key: string }) => CLOSE), "quick-search": vi.fn((_p: { words: string }) => CLOSE) };
}

const answer = (tools: ToolRun[], over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: "spya-ans001", role: "assistant", text: "Start with the abstract.", createdAt: "2026-10-09T09:00:00.000Z", status: "done", tools, ...over }) as ChatMessage;
const offered = (steps: unknown): ToolRun => ({ name: "offer_next_steps", label: "offered next steps", status: "done", steps } as ToolRun);

function paint(message: ChatMessage | undefined, runners = spies()): ReturnType<typeof spies> {
  const executor: CommandExecutor = { runners, sources: { modes: MODES } };
  act(() => {
    root.render(
      createElement(ChatCommands, {
        executor,
        children: createElement(GuideNextSteps, { slug: "a-piece", message, blocks: BLOCKS, onAsk: (w: string) => sent.push(w) }),
      }),
    );
  });
  return runners;
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
const byText = (text: string) => buttons().find((b) => b.textContent?.includes(text));

describe("the guide's next steps", () => {
  it("draws an ask as its words in full, and a press sends exactly them", () => {
    paint(answer([offered([{ kind: "ask", words: "Help me pick what to read closely" }])]));
    const ask = byText("Help me pick what to read closely");
    expect(ask).toBeDefined();
    act(() => ask?.click());
    expect(sent).toEqual(["Help me pick what to read closely"]);
  });

  it("draws a mode as its chip, which opens only on a press", async () => {
    const runners = paint(answer([offered([{ kind: "mode", mode: "submode:summary:brief" }])]));
    await act(async () => {});
    expect(runners.mode).not.toHaveBeenCalled();
    const chip = host.querySelector<HTMLButtonElement>("button.cmd-chip");
    expect(chip?.textContent).toContain("Summary › Brief");
    await act(async () => chip?.click());
    expect(runners.mode).toHaveBeenCalledWith(expect.objectContaining({ key: "submode:summary:brief" }));
  });

  it("never presses a mode itself, even drawn inside an answer's unspent act", async () => {
    const runners = spies();
    const executor: CommandExecutor = { runners, sources: { modes: MODES }, openModeUnarmed: runners.mode };
    const act0 = { messageId: "spya-ans001", used: false, made: new Set<string>(["mode:structure"]) };
    act(() => {
      root.render(
        createElement(
          GuideActContext.Provider,
          { value: act0 },
          createElement(ChatCommands, {
            executor,
            children: createElement(GuideNextSteps, {
              slug: "a-piece",
              message: answer([offered([{ kind: "mode", mode: "mode:structure" }])]),
              blocks: BLOCKS,
              onAsk: () => {},
            }),
          }),
        ),
      );
    });
    await act(async () => {});
    expect(host.querySelector("button.cmd-chip")).not.toBeNull();
    expect(runners.mode).not.toHaveBeenCalled();
    expect(act0.used).toBe(false);
  });

  it("draws no group at all when every step is a mode this page will not open", () => {
    paint(answer([offered([{ kind: "mode", mode: "mode:debate" }])]));
    expect(host.querySelector('[aria-label="Next steps"]')).toBeNull();
  });

  it("draws nothing for a mode this page will not open, rather than its raw token", () => {
    paint(answer([offered([{ kind: "mode", mode: "mode:debate" }, { kind: "share" }])]));
    expect(host.textContent).not.toContain("[cmd:");
    expect(host.querySelectorAll("button.cmd-chip")).toHaveLength(0);
    expect(byText(STEP_WORDS.share)).toBeDefined();
  });

  it("runs a search for the words the reader left in the box", async () => {
    const runners = paint(answer([offered([{ kind: "search", words: "attention heads" }])]));
    const box = host.querySelector<HTMLInputElement>("input[type=search]");
    expect(box?.value).toBe("attention heads");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(box, "multi-head attention");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(runners["quick-search"]).not.toHaveBeenCalled();
    const chip = host.querySelector<HTMLButtonElement>("button.cmd-chip");
    expect(chip?.textContent).toContain("multi-head attention");
    await act(async () => chip?.click());
    expect(runners["quick-search"]).toHaveBeenCalledWith(expect.objectContaining({ words: "multi-head attention" }));
  });

  it("takes share to Metadata's sharing card, and archive to Metadata, writing nothing", () => {
    paint(answer([offered([{ kind: "share" }, { kind: "archive" }])]));
    act(() => byText(STEP_WORDS.share)?.click());
    act(() => byText(STEP_WORDS.archive)?.click());
    expect(went).toHaveLength(2);
    expect(went[0]).toMatch(/^\/read\/a-piece\/metadata\?(.*&)?section=access-sharing/);
    expect(went[1]).toMatch(/^\/read\/a-piece\/metadata/);
    expect(went[1]).not.toContain("section=");
  });

  it("draws the last offer only, at most three, and nothing it does not recognise", () => {
    paint(
      answer([
        offered([{ kind: "share" }]),
        offered([{ kind: "publish" }, { kind: "ask", words: "a" }, { kind: "ask", words: "b" }, { kind: "ask", words: "c" }, { kind: "ask", words: "d" }]),
      ]),
    );
    expect(buttons().map((b) => b.textContent)).toEqual(["a", "b", "c"]);
  });

  it("draws nothing for another tool's run, an unfinished answer, or a stopped one", () => {
    const steps = [{ kind: "share" }];
    for (const message of [
      answer([{ name: "offer_to_save", label: "x", status: "done", steps } as ToolRun]),
      answer([offered(steps)], { status: "pending" }),
      answer([offered(steps)], { stopped: true }),
      answer([offered(steps)], { truncated: true }),
      answer([{ ...offered(steps), status: "error" }]),
      undefined,
    ]) {
      paint(message);
      expect(buttons()).toHaveLength(0);
    }
  });
});
