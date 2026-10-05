// @vitest-environment jsdom
/**
 * **Structure says so when it is showing the author's headings instead of the
 * model's structure, and the owner can ask for the fuller one again.**
 *
 * A long document's structure is asked for in slices, and when they fail the
 * step falls back to a tree built from the headings with no model
 * (docs/project/structure-step.md § The fallback). Until 2026-10-05 nothing on
 * screen said that had happened. docs/project/structure.md § When it is only
 * the headings.
 *
 * Three things, each of which is a way this could quietly be wrong:
 *
 * - the line is keyed on `tree.provisional`, never on absent gists, and it is
 *   drawn in **all three** presentations — the columns, the list, Expanded;
 * - a **visitor** gets the line and no control, and mounts nothing that POSTs
 *   or polls (tests/visitor-gaps.test.ts is the rule);
 * - the owner's press is a `structure` job **forced by name**: unforced, the
 *   step sees a tree and skips, and the reader watches a run change nothing.
 *
 * `useJobs` is mocked whole, as in tests/step-job-force.test.tsx, so the body
 * the queue was handed is the assertion and a completion can be delivered by
 * hand.
 */
import { NuqsAdapter } from "nuqs/adapters/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId, Job, NodeId, StepName, Tree, TreeNode } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Posted {
  slug: string;
  steps: StepName[];
  force?: StepName[];
}
const queue = vi.hoisted(() => ({
  posted: [] as { slug: string; steps: string[]; force?: string[] }[],
  /** Every `onFinished` a mounted `useJobs` was handed, so a test can end a job. */
  listeners: new Set<(job: unknown) => void>(),
  mounts: 0,
}));

vi.mock("../src/web/useJobs.js", async () => {
  const { useEffect } = await import("react");
  return {
    useJobs: (_cadence: string, onFinished?: (job: unknown) => void) => {
      useEffect(() => {
        queue.mounts += 1;
        if (onFinished) queue.listeners.add(onFinished);
        return () => {
          if (onFinished) queue.listeners.delete(onFinished);
        };
      }, [onFinished]);
      return {
        jobs: [],
        loaded: true,
        error: null,
        driverFailures: {},
        lastFailure: () => null,
        run: async (request: Posted) => {
          queue.posted.push(request);
          return { id: `job${queue.posted.length}` };
        },
        retry: async () => null,
        cancel: async () => {},
      };
    },
  };
});

const { StructureBand } = await import("../src/web/modes/structure/StructureMode.js");
const { StructureNotice } = await import("../src/web/StructureNotice.js");
const { structureColumnsBand } = await import("../src/web/layout.js");
const { buildSections } = await import("../src/web/position.js");
const { buildGeometry } = await import("../src/web/tree.js");

/* One part with two sections: enough for either face to have rows. */
function fixture(provisional: boolean): { tree: Tree; blocks: Block[] } {
  const id = (n: number) => `spya-h${String(n).padStart(4, "0")}` as BlockId;
  const blocks: Block[] = [0, 1, 2, 3].map((n) => ({
    id: id(n),
    tag: "p",
    kind: "text",
    text: `block ${n}`,
    words: 2,
    html: `<p>block ${n}</p>`,
    gistable: true,
  }));
  const node = (over: Partial<TreeNode> & Pick<TreeNode, "id" | "range" | "title">): TreeNode =>
    ({ depth: 1, parent: "n-r", children: [], ...over }) as TreeNode;
  const nodes: Record<NodeId, TreeNode> = {
    "n-r": node({ id: "n-r", depth: 0, parent: null, children: ["n-a", "n-b"], range: [id(0), id(3)], title: "Root" }),
    "n-a": node({ id: "n-a", range: [id(0), id(1)], title: "FIRST HEADING" }),
    "n-b": node({ id: "n-b", range: [id(2), id(3)], title: "SECOND HEADING" }),
  };
  return {
    tree: {
      version: "1",
      generator: "test",
      slug: "t",
      rootId: "n-r",
      nodes,
      ...(provisional ? { provisional: "headings" as const } : {}),
    },
    blocks,
  };
}

let bandWidth = 0;
let host: HTMLDivElement;
let root: Root;
let restoreWidth: () => void;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("mode-band") ? bandWidth : 0;
    },
  });
  restoreWidth = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  queue.posted.length = 0;
  queue.listeners.clear();
  queue.mounts = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restoreWidth();
  vi.unstubAllGlobals();
  bandWidth = 0;
  window.history.replaceState(null, "", "/");
});

const edge = () => structureColumnsBand(16).min;

function mount({ provisional, owner }: { provisional: boolean; owner: boolean }) {
  const { tree, blocks } = fixture(provisional);
  const geometry = buildGeometry(tree, blocks);
  const article = { tree, blocks, navLabelStatus: "ready" } as unknown as Article;
  act(() => {
    root.render(
      <NuqsAdapter>
        <StructureBand
          slug="an-article"
          owner={owner}
          article={article}
          leafDepth={geometry.leafDepth}
          sections={buildSections(geometry, blocks)}
          layoutKey="k"
          supplementOf={geometry.supplementOf}
          arcByRow={null}
          proseBeside
          rootFontPx={16}
          onJump={() => {}}
        />
      </NuqsAdapter>,
    );
  });
}

const notice = () => host.querySelector(".struct-notice");
const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".struct-notice button")).find(
    (b) => b.textContent?.trim() === label,
  );
const LINE = "These section names are the document's own headings and opening words.";

describe("the line, in each of Structure's three presentations", () => {
  it("is in the two columns", () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: false });
    expect(host.querySelector(".mode-band.struct")).not.toBeNull();
    expect(notice()?.textContent).toContain(LINE);
  });

  it("is in the list", () => {
    bandWidth = edge() - 60;
    mount({ provisional: true, owner: false });
    expect(host.querySelector(".mode-band.outln")).not.toBeNull();
    expect(notice()?.textContent).toContain(LINE);
  });

  it("is in Expanded", () => {
    window.history.replaceState(null, "", "/?structure=expanded");
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: false });
    expect(host.querySelector(".mode-band.outln.outln-expanded")).not.toBeNull();
    expect(notice()?.textContent).toContain(LINE);
  });

  /* The control: a line that showed on every article would pass all three. */
  it("is not there for an ordinary tree, in either face", () => {
    for (const width of [edge() + 100, edge() - 60]) {
      bandWidth = width;
      mount({ provisional: false, owner: true });
      expect(notice(), `at ${width}px`).toBeNull();
    }
  });
});

describe("Try again", () => {
  it("is offered to the owner", () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: true });
    expect(button("Try again")).toBeDefined();
  });

  it("is not offered to a visitor, who mounts no queue at all", () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: false });
    expect(notice()).not.toBeNull();
    expect(host.querySelectorAll(".struct-notice button")).toHaveLength(0);
    expect(notice()?.textContent).not.toContain("again");
    expect(queue.mounts, "a visitor's Structure subscribed to the job queue").toBe(0);
  });

  it("starts a structure job forced by name, and nothing else", async () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: true });
    await act(async () => {
      button("Try again")?.click();
    });
    expect(queue.posted).toEqual([
      { slug: "an-article", steps: ["structure"], force: ["structure"] },
    ]);
  });

  it("says to reload when the job finishes, and asks for the arc again unforced", async () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: true });
    await act(async () => {
      button("Try again")?.click();
    });
    const done = {
      id: "job1",
      slug: "an-article",
      status: "done",
      steps: [{ name: "structure", label: "Building the structure", status: "done" }],
    } as unknown as Job;
    await act(async () => {
      for (const hear of [...queue.listeners]) hear(done);
    });
    expect(notice()?.textContent).toContain("Reload the page");
    expect(button("Reload")).toBeDefined();
    expect(button("Try again")).toBeUndefined();
    /* The arc is joined to the tree by block range, so a re-cut tree silently
       drops its sentences (src/pipeline.ts § `STEPS.arc.stamp`). Unforced: the
       step's own stamp decides, so a tree that came back the same buys nothing. */
    expect(queue.posted.slice(1)).toEqual([{ slug: "an-article", steps: ["arc"] }]);
  });

  /* GPT Sol's code review, F1: `useStepJob` announces a job another tab
     started. The tree did change, so the reload is true advice here too; the
     arc is the other tab's to ask for, and asking twice is two jobs. */
  it("says to reload for a run another tab started, and asks for no arc", async () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: true });
    const done = {
      id: "job7",
      slug: "an-article",
      status: "done",
      steps: [{ name: "structure", label: "Building the structure", status: "done" }],
    } as unknown as Job;
    await act(async () => {
      for (const hear of [...queue.listeners]) hear(done);
    });
    expect(notice()?.textContent).toContain("Reload the page");
    expect(queue.posted).toEqual([]);
  });

  it("asks for the arc once, however many runs are heard to finish", async () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: true });
    await act(async () => {
      button("Try again")?.click();
    });
    const done = (id: string) =>
      ({
        id,
        slug: "an-article",
        status: "done",
        steps: [{ name: "structure", label: "Building the structure", status: "done" }],
      }) as unknown as Job;
    await act(async () => {
      for (const hear of [...queue.listeners]) hear(done("job1"));
    });
    await act(async () => {
      for (const hear of [...queue.listeners]) hear(done("job2"));
    });
    expect(queue.posted.filter((p) => p.steps.includes("arc"))).toHaveLength(1);
  });

  it("ignores somebody else's article finishing", async () => {
    bandWidth = edge() + 100;
    mount({ provisional: true, owner: true });
    const other = {
      id: "job9",
      slug: "another-article",
      status: "done",
      steps: [{ name: "structure", label: "Building the structure", status: "done" }],
    } as unknown as Job;
    await act(async () => {
      for (const hear of [...queue.listeners]) hear(other);
    });
    expect(button("Try again")).toBeDefined();
    expect(queue.posted).toEqual([]);
  });
});

describe("StructureNotice on its own", () => {
  it("draws nothing for a value this build does not know", () => {
    act(() => {
      root.render(
        <StructureNotice
          provisional={"something-newer" as unknown as "headings"}
          slug="an-article"
          owner
        />,
      );
    });
    expect(host.textContent).toBe("");
  });
});
