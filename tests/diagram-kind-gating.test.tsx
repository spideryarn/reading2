// @vitest-environment jsdom
/**
 * **Diagram is in everybody's bar; four of its five pictures are not.**
 *
 * The gate moved down a level on 2026-09-04, on a reader's report
 * (SPIDERYARN-READING2-13):
 *
 * > We have this idea of experimental features. The only diagram sub-mode that
 * > is good enough to show everyone is the sketch mode. The other ones should
 * > be only visible to people who have experimental features on, because they
 * > don't work so well yet.
 *
 * So Diagram is `experimental: false` in `MODE_CATALOG` (src/mode-catalog.ts)
 * and `KIND_UI`'s rows carry the flag instead, and both rows of controls are
 * drawn by one rule —
 * src/web/experimental-visibility.ts. This file is that rule seen from the chip
 * row's end; tests/dock-experimental-modes.test.tsx is the bar's end.
 *
 * ## What is *not* asserted here, and must not be read into it
 *
 * **None of this is a gate.** Hiding a chip hides a control and authorises
 * nothing: `?diagram=trail` still selects Trail for a reader with the switch
 * off, which is the third test below and is deliberate. What actually stops
 * money being spent is `access` — a visitor gets no picker and is pinned to
 * `force` (tests/public-network-trace.test.tsx) — and `requireUser` on the
 * endpoints. docs/project/security-map.md.
 *
 * And **arriving buys nothing**: the default is now `sketch`, whose empty state
 * is an invitation carrying the price. The assertion for that lives in
 * tests/public-network-trace.test.tsx § *does not draw one for an owner who
 * merely arrives at the sketch*, where there is a network trace to prove it
 * with; this file only pins the default itself.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Tree } from "../src/types.js";
import { DIAGRAMS } from "../src/web/diagram.js";
import { DiagramPanel, visibleKinds } from "../src/web/DiagramPanel.js";
import { visibleModes } from "../src/web/Dock.js";
import { diagramParam } from "../src/web/params.js";
import { resetActivations } from "../src/web/activation.js";
import { jobEngine } from "../src/web/jobEngine.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

const BLOCKS: Block[] = [
  {
    id: "spya-b0" as BlockId,
    tag: "p",
    kind: "text",
    text: "The mind is not a machine that can be taken apart and reassembled at will.",
    words: 14,
    html: "<p>first</p>",
    gistable: true,
  },
  {
    id: "spya-b1" as BlockId,
    tag: "p",
    kind: "text",
    text: "A second paragraph, about something else entirely.",
    words: 7,
    html: "<p>second</p>",
    gistable: true,
  },
];

function article(): { root: SummaryNode; blocks: Block[] } {
  const blocks = BLOCKS.slice();
  const tree = {
    version: "1",
    generator: "t",
    slug: "s",
    rootId: "n1",
    nodes: {
      n1: {
        id: "n1",
        depth: 0,
        parent: null,
        children: [],
        range: [blocks[0]?.id, blocks[1]?.id],
        title: "Section n1",
        gist: "Gist for n1",
      },
    },
  } as unknown as Tree;
  const summary = buildSummaryTree(tree, blocks);
  if (!summary) throw new Error("fixture tree is unusable");
  return { root: summary, blocks };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;

/**
 * Nothing exists yet and nothing is running — the state a reader meets, and the
 * one where a panel that spent on arrival would be caught by the POST count in
 * the network trace file rather than here.
 */
function serving(): void {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/advance")) {
      return new Response(JSON.stringify({ job: null, ran: null, busy: false, done: true }), {
        status: 200,
      });
    }
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    if (u.includes("/api/sketch/") || u.includes("/api/illustrated/")) {
      return new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 200 });
  });
  jobEngine.start("reader-1");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = vi.fn(() => "blob:spideryarn/plate-1");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  jobEngine.reset();
  resetActivations();
  serving();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The chips actually in the DOM, left to right. */
async function chips(on: boolean, kind: (typeof DIAGRAMS)[number]): Promise<string[]> {
  const { root: tree, blocks } = article();
  await act(async () => {
    root.render(
      <DiagramPanel
        access={{ kind: "owner" }}
        experimental={on}
        slug="s"
        root={tree}
        kind={kind}
        onKind={() => {}}
        atRow={0}
        onJump={() => {}}
        blocks={blocks}
        axis="spread"
        onAxis={() => {}}
        hue="section"
        onHue={() => {}}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  return [...host.querySelectorAll("[data-diag-kind]")].map(
    (el) => el.getAttribute("data-diag-kind") ?? "?",
  );
}

describe("which pictures the chip row offers", () => {
  it("is the sketch alone for a reader who has not asked for the unfinished ones", () => {
    expect(visibleKinds(false, "sketch")).toEqual(["sketch"]);
  });

  it("is all five once the switch is on, in Greg's order", () => {
    expect(visibleKinds(true, "sketch")).toEqual([...DIAGRAMS]);
    /* Illustrated immediately right of Sketch, because three refusal sentences
       in that panel say "the chip one to the left". */
    const on = visibleKinds(true, "sketch");
    expect(on.indexOf("illustrated")).toBe(on.indexOf("sketch") + 1);
  });

  /**
   * **A hidden picture never breaks a shared link.** `?diagram=illustrated` is
   * an address somebody copied out of their own window; the reader who opens it
   * has to see the picture *and* a checked chip for it, because the row is a
   * `role="radiogroup"` and a group announcing one-of-these with none of them on
   * is worse than an extra chip. Same rule, same reason, as `?mode=timeline`
   * with the switch off — Dock.tsx § visibleModes.
   */
  it("adds whichever picture the URL names, however unfinished", () => {
    expect(visibleKinds(false, "illustrated")).toEqual(["sketch", "illustrated"]);
    expect(visibleKinds(false, "trail")).toEqual(["trail", "sketch"]);
  });

  it("draws one chip with the switch off and five with it on", async () => {
    expect(await chips(false, "sketch")).toEqual(["sketch"]);
    expect(await chips(true, "sketch")).toEqual([...DIAGRAMS]);
  });

  it("draws the picture the URL names for a reader with the switch off, and checks it", async () => {
    expect(await chips(false, "illustrated")).toEqual(["sketch", "illustrated"]);
    const checked = [...host.querySelectorAll("[data-diag-kind]")].filter(
      (el) => el.getAttribute("aria-checked") === "true",
    );
    expect(checked.map((el) => el.getAttribute("data-diag-kind"))).toEqual(["illustrated"]);
  });
});

describe("the mode itself", () => {
  /**
   * The other half of the move: the gate came off Diagram at the same moment it
   * went onto four of its pictures. If this ever goes red on its own, somebody
   * has hidden the mode again and left the sketch — the picture the reader asked
   * for — behind two switches.
   */
  it("is in the bar for a reader who has asked for nothing", () => {
    const modes = visibleModes(false, undefined).map((m) => m.mode);
    expect(modes).toContain("diagram");
    /* **And nothing here about which other modes are hidden.** This used to
       carry its own literal list of them, which named `quotes` for a day after
       it was promoted and never learned about `debate` at all — and stayed
       green throughout, because a stale name in a `not.toContain` loop is a
       weaker assertion rather than a failing one. The classification has one
       home, tests/dock-experimental-modes.test.tsx § BEHIND_THE_SWITCH, which
       compares identities and so fails in both directions. GPT Sol,
       2026-09-06. */
  });

  /**
   * **One default, not two.** `sketch` whether the switch is on or off, so a
   * pasted link and a fresh arrival land on the same picture and nobody has to
   * reason about which reader they are. Force held this until 2026-09-04 and is
   * now one of the hidden four, which would have made the default invisible to
   * most readers. params.ts § diagramParam.
   */
  it("opens on the sketch", () => {
    expect(diagramParam.defaultValue).toBe("sketch");
  });
});
