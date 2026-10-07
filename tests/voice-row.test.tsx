// @vitest-environment jsdom
/**
 * **The voice row: one height, and Send keeps its place** (queue item
 * qi-zm95p9we, plan 261007m S5).
 *
 * Chat and Learn draw the same microphone and Live button, and Greg,
 * 2026-10-07: *"controls that do the same job should look the same in every
 * mode, though use your judgment"*. Two things were off. The microphone and
 * Live were 26px beside a 36px Send in both modes. And in Learn, where the
 * voice controls share a line with Send under the tall box, a narrow band
 * (390, or the iPad's 288px column, or a longer state such as "Writing it
 * down…") pushed Send onto a line of its own: a flex row decides its line
 * breaks before it shrinks anything, so the last item is the one that goes.
 *
 * So the voice controls are one group, `.chat-voice`. In Chat it is
 * `display: contents` and changes nothing; in Learn it is the row's growing
 * item, which wraps inside itself, and Send stays at the end of the line.
 * Learn's "Talk" label stays: it is deliberate (GPT Sol, 261007h R20).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatThread } from "../src/types.js";
import type { LiveApi } from "../src/web/live/useLiveConversation.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-10-07T10:00:00.000Z";
const THREAD_ID = "spya-k3m9qt";

function thread(kind: "chat" | "learn"): ChatThread {
  return {
    id: THREAD_ID,
    title: "A conversation",
    createdAt: AT,
    updatedAt: AT,
    kind,
    messages: [
      { id: "spya-usr2aa", role: "user", text: "a question", createdAt: AT, status: "done" },
      { id: "spya-ans2aa", role: "assistant", text: "An answer.", createdAt: AT, status: "done" },
    ],
  };
}

function fakeLive(phase: LiveApi["phase"]): { api: LiveApi; finish: () => void } {
  let release!: () => void;
  const done = new Promise<void>((r) => {
    release = r;
  });
  const api = {
    phase,
    error: null,
    lines: [],
    pointers: [],
    tools: [],
    hearing: false,
    speaking: false,
    seen: {},
    placement: null,
    inputLevel: { current: 0.5 },
    measuringInput: true,
    quietInput: false,
    deviceLabel: "MacBook Pro Microphone",
    playbackBlocked: false,
    enableAudio: async () => { },
    thinking: false,
    pendingTools: [],
    notice: null,
    hasUnsavedLines: false,
    threadId: THREAD_ID,
    start: () => {},
    stop: () => {
      return done;
    },
    say: () => {},
    stall: null,
    reconnect: () => {},
    step: null,
    reconnecting: false,
    talkMode: "hands-free" as LiveApi["talkMode"],
    enterTapToTalk: () => {},
    talk: () => {},
    doneTalking: () => {},
  } satisfies LiveApi;
  return { api, finish: () => release() };
}


let host: HTMLDivElement;
let root: Root;

function paint(kind: "chat" | "learn") {
  const t = thread(kind);
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind,
        loaded: true,
        loadFailed: false,
        threads: [t],
        threadId: t.id,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: true,
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
        live: fakeLive("idle").api,
        onStartLive: () => undefined,
      }),
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the voice row", () => {
  for (const kind of ["chat", "learn"] as const) {
    it(`groups ${kind}'s voice controls and leaves Send outside the group`, () => {
      paint(kind);
      const group = host.querySelector(".chat-composer .chat-voice");
      expect(group, "the voice group").not.toBeNull();
      expect(group?.querySelector(".chat-live-btn"), "Live is in it").not.toBeNull();
      expect(group?.querySelector(".chat-send"), "Send is not").toBeNull();
      expect(host.querySelector(".chat-composer .chat-send")).not.toBeNull();
    });
  }
});

/* ---- the stylesheet ---- */

const CSS = readFileSync(join(import.meta.dirname, "..", "src", "web", "styles", "mode-band.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function decls(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(CSS);
  if (!m) throw new Error(`no rule ${selector}`);
  const out = new Map<string, string>();
  for (const d of (m[1] ?? "").split(";")) {
    const at = d.indexOf(":");
    if (at > 0) out.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
  }
  return out;
}

describe("the voice row's geometry", () => {
  it("draws the microphone and Live at Send's height, in the composer only", () => {
    expect(decls(".chat-send").get("height")).toBe("var(--control-h)");
    expect(decls(".chat-composer .prof-mic").get("height")).toBe("var(--control-h)");
    expect(decls(".chat-composer .prof-mic").get("width")).toBe("var(--control-h)");
    expect(decls(".chat-composer .chat-live-btn").get("height")).toBe("var(--control-h)");
  });

  it("makes the group nothing in Chat and the growing, wrapping item in Learn", () => {
    expect(decls(".chat-voice").get("display")).toBe("contents");
    const learn = decls(".learn .chat-voice");
    expect(learn.get("display")).toBe("flex");
    expect(learn.get("flex-wrap")).toBe("wrap");
    /* A zero basis, so the row never breaks a line for the group's sake and
       Send stays on it; the group takes the rest of the line and wraps
       inside it. */
    expect(learn.get("flex")).toBe("1 1 0");
    expect(learn.get("min-width")).toBe("0");
  });

  it("lets Learn's Live button and experimental engine picker wrap inside the space beside Send", () => {
    /* The outer group has a zero basis, but an unwrapping .chat-live still
       overflows that group at 288px. Its two controls must break independently.
       Chat keeps its existing row. This checks the CSS contract, not layout. */
    expect(decls(".chat-live").get("flex-wrap")).toBeUndefined();
    const live = decls(".learn .chat-live");
    expect(live.get("flex-wrap")).toBe("wrap");
    expect(live.get("min-width")).toBe("0");
    expect(live.get("max-width")).toBe("100%");
  });
});
