/**
 * A throwaway page for looking at the **waiting and failing** states of Diagram
 * mode in a browser, which is the only place they can be looked at.
 *
 * Everything about these states is a few pixels of chrome — an 11px spinner on
 * a 10.5px line, an underlined button in the middle of a sentence, a flex
 * direction. All of that renders perfectly whatever it looks like, so a test
 * can say the spinner is in the DOM and nothing but an eye can say it is on the
 * text's baseline.
 *
 * Six bands, each a **real** `DiagramPanel` or `SketchView` with the real
 * stylesheet, at the width the band actually gets. `fetch` is stubbed per slug,
 * so `useSimilar`, `useProjection` and `useSketch` are all the shipping code and
 * the states are reached the way a reader reaches them.
 *
 * Follows preview-sketch.tsx, including its finding: **not** inside a
 * `.reader`, which reserves the band's width as padding and renders everything
 * into a 0×0 box.
 *
 * Delete this file and preview-diagram-wait.html when the check is done;
 * nothing links to either.
 */
import { createRoot } from "react-dom/client";
import { DiagramPanel } from "./DiagramPanel.js";
import { SketchView } from "./SketchView.js";
import { MODE_IDEAL, MODE_MIN, SPINE_W } from "./layout.js";
import { buildSummaryTree } from "./tree.js";
import type { Block, BlockId, Tree } from "../types.js";
import "./tailwind.css";

const WORDS = [
  "falconry hawking jesses gauntlet quarry stooping austringer merlin cadge",
  "geology basalt sediment tectonic strata outcrop metamorphic granite schist",
  "baking sourdough hydration levain crumb proving banneton scoring autolyse",
  "sailing halyard leeward tacking spinnaker keel bosun rigging clew",
];

const BLOCKS: Block[] = WORDS.map((text, i) => ({
  id: `spya-b${i}` as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(" ").length,
  html: `<p>${text}</p>`,
  gistable: true,
}));

const mk = (id: string, depth: number, parent: string | null, kids: string[], a: number, b: number) => ({
  id, depth, parent, children: kids,
  range: [BLOCKS[a]?.id, BLOCKS[b]?.id],
  title: `Section ${id}`,
  ...(depth < 2 && { gist: `What section ${id} is about, in one line.` }),
});

const ROOT = buildSummaryTree(
  {
    version: "1", generator: "p", slug: "p", rootId: "n1",
    nodes: {
      n1: mk("n1", 0, null, ["n2", "n3"], 0, 3),
      n2: mk("n2", 1, "n1", [], 0, 1),
      n3: mk("n3", 1, "n1", [], 2, 3),
    },
  } as unknown as Tree,
  BLOCKS,
);
if (!ROOT) throw new Error("fixture tree is unusable");

/** A `sketch` job the queue says is running, for the last band. */
const RUNNING = {
  id: "j1",
  slug: "sk-busy",
  status: "running",
  steps: [{ name: "sketch", status: "running", label: "Reading the whole article" }],
};

/* **Every node needs an `id`, and an edge names ids rather than text.** The
   first version of this fixture had neither: `readSketch` dropped every item
   as unreadable, kept the scene, and the band rendered a header over an empty
   `<svg>` holding one `<title>`. A browser pass reported it as the panel being
   broken, which is exactly what a fixture that lies looks like from outside. */
const SKETCH = {
  version: 1,
  title: "The shape of it",
  caption: "Three arguments that converge",
  scenes: [
    {
      id: "overview", title: "The shape of it", height: 600,
      items: [
        { kind: "node", id: "claim", shape: "box", x: 180, y: 60, w: 220, h: 60, text: "the claim", size: "sm", block: "spya-b0", tone: 0 },
        { kind: "node", id: "evidence", shape: "box", x: 180, y: 240, w: 220, h: 60, text: "the evidence", size: "sm", block: "spya-b2", tone: 1 },
        { kind: "edge", from: "claim", to: "evidence", via: "line", line: "solid", arrow: "end" },
      ],
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/* **The slug is the state.** Each band gets its own, so one stub serves all six
   and the page needs no props threaded through the panel. */
const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/profile")) return json({ profile: null });
  /* `useSketch` asks whether this reader has a profile. Unstubbed it fell
     through to the real server, which 401s outside the auth gate — noise in the
     console that a browser pass reasonably read as the cause of an empty band. */
  if (url.includes("/api/reader")) return json({ reader: null, profile: null });
  if (url.includes("/advance")) return json({ job: RUNNING, ran: null, busy: false, done: true });
  /* **`/api/jobs` carries no slug**, so the first version's `url.includes(
     "sk-busy")` was never true and the queue always came back empty — which is
     why the Sketch band showed no busy line at all. There is one article on
     this page, so the list is simply the one running job. */
  if (url.includes("/api/jobs")) return json({ jobs: [RUNNING] });

  const slug = url.split("/").pop() ?? "";
  if (url.includes("/api/similar/") || url.includes("/api/projection/")) {
    if (slug.endsWith("-wait")) return new Promise<Response>(() => {});
    if (slug.endsWith("-fail")) return json({ error: "This account is not allowed to use the embedding model [E_MODEL_FORBIDDEN]" }, 403);
  }
  if (url.includes("/api/sketch/")) return json({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false });
  return real(input, init);
}) as typeof window.fetch;

/**
 * **The band's own element is `position: fixed`, and six of them collide.**
 *
 * `DiagramPanel` renders its own `<aside class="mode-band diag">`, and
 * `.mode-band` is fixed — which is right in the app, where exactly one band is
 * ever on screen. Six live instances on one page all pin to the same corner and
 * stack, so only the last-painted one is visible and the other five sit under
 * it invisibly. The first version of this harness put `position: static` on a
 * *wrapper* aside of its own, which did nothing at all to the panel's, and a
 * browser pass had to switch five elements off by hand to see anything.
 *
 * The override below is scoped to this page and reaches the real element.
 */
const OVERRIDE = `
.pv-band { position: relative; }
.pv-band .mode-band {
  position: static;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 1px dashed var(--rule);
}
`;

function Band({ width, children, label }: { width: number; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontFamily: "var(--font-ui)", fontSize: "0.7rem", color: "var(--ink-faint)", margin: "0 0 0.3rem", maxWidth: width }}>
        {label} — {width}px
      </p>
      <div
        className="pv-band"
        style={{
          "--mode-w": `${width}px`,
          "--spine-w": `${SPINE_W}px`,
          width,
          height: 560,
          display: "flex",
          flexDirection: "column",
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

const panel = (slug: string, kind: "force" | "drift") => (
  <DiagramPanel
    access={{ kind: "owner" }}
    slug={slug}
    root={ROOT}
    kind={kind}
    onKind={() => {}}
    atRow={1}
    onJump={(id: BlockId) => console.log("jump", id)}
    blocks={BLOCKS}
    axis="spread"
    onAxis={() => {}}
    hue="section"
    onHue={() => {}}
  />
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <>
  {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant string in a throwaway preview page, with no input of any kind reaching it */}
  <style dangerouslySetInnerHTML={{ __html: OVERRIDE }} />
  <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", padding: "1rem", alignItems: "flex-start", background: "var(--page)" }}>
    <Band width={MODE_MIN} label="Force, embeddings in flight">{panel("force-wait", "force")}</Band>
    <Band width={MODE_MIN} label="Force, embeddings refused">{panel("force-fail", "force")}</Band>
    <Band width={MODE_IDEAL} label="Force, embeddings refused (wider)">{panel("force-fail", "force")}</Band>
    <Band width={MODE_MIN} label="Drift, projection in flight">{panel("drift-wait", "drift")}</Band>
    <Band width={MODE_MIN} label="Drift, projection refused">{panel("drift-fail", "drift")}</Band>
    <Band width={MODE_MIN} label="Sketch, a redraw under way">
      <SketchView slug="sk-busy" blocks={BLOCKS} atRow={1} onJump={() => {}} />
    </Band>
  </div>
  </>,
);
