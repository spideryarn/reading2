/**
 * A throwaway page for the two things 2026-08-30's Diagram change did, both of
 * which are a handful of pixels and neither of which a test can look at.
 *
 * 1. **The scatter's caveat as an icon** rather than four lines of prose above
 *    the picture. What has to be looked at is that it lands at the right-hand
 *    end of the control row, that the row does not grow a second line at the
 *    narrow width, and that the card is readable when it opens.
 * 2. **The blank that could not end.** The left-hand band starts on Sketch;
 *    press Drift on it. Before the callback-ref fix that left an empty box for
 *    good, with the strip above it reporting a projection that had landed.
 *
 * Follows preview-diagram-wait.tsx exactly, including its two findings: not
 * inside a `.reader` (which reserves the band's width as padding and renders
 * everything into a 0×0 box), and an override that reaches the panel's own
 * `position: fixed` element rather than a wrapper of ours.
 *
 * Delete this file and preview-diag-note.html when the check is done.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DiagramPanel } from "./DiagramPanel.js";
import type { DiagramKind } from "./diagram.js";
import { MODE_IDEAL, MODE_MIN } from "./layout.js";
import { buildSummaryTree } from "./tree.js";
import type { Block, BlockId, Tree } from "../types.js";
import "./styles.css";
import "./tailwind.css";

const WORDS = [
  "falconry hawking jesses gauntlet quarry stooping austringer merlin cadge",
  "geology basalt sediment tectonic strata outcrop metamorphic granite schist",
  "baking sourdough hydration levain crumb proving banneton scoring autolyse",
  "sailing halyard leeward tacking spinnaker keel bosun rigging clew",
  "cartography contour datum azimuth graticule isobath hachure planimetric",
  "brewing mash tun sparge hopback krausen flocculation attenuation",
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
      n1: mk("n1", 0, null, ["n2", "n3"], 0, 5),
      n2: mk("n2", 1, "n1", [], 0, 2),
      n3: mk("n3", 1, "n1", [], 3, 5),
    },
  } as unknown as Tree,
  BLOCKS,
  null,
);
if (!ROOT) throw new Error("fixture tree is unusable");

/* The numbers are the shape of a real answer on a real article, scaled down:
   most of the article placed, a fifth of it not, and two components holding
   about a sixth of the variation between them. */
const PROJECTION = {
  model: "voyageai/voyage-4",
  blocks: 6,
  k: 2,
  variance: [0.101, 0.062],
  skipped: { tooShort: 12, nonProse: 5, capped: 0 },
  points: BLOCKS.map((b, i) => ({
    id: b.id,
    x: Math.cos(i * 1.1) * 0.3,
    y: Math.sin(i * 0.8) * 0.2,
    c: i % 2,
  })),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/profile")) return json({ profile: null });
  if (url.includes("/api/reader")) return json({ reader: null, profile: null });
  if (url.includes("/api/jobs")) return json({ jobs: [] });
  if (url.includes("/api/projection/")) return json(PROJECTION);
  if (url.includes("/api/similar/")) return json({ model: "m", blocks: 6, eligible: 6, omitted: 0, pairs: [] });
  if (url.includes("/api/sketch/")) return json({ sketch: null, stale: false, outdated: false, profileChanged: false });
  return real(input, init);
}) as typeof window.fetch;

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

function Band({ width, label, from }: { width: number; label: string; from: DiagramKind }) {
  /* The chips are live, so the Sketch → Drift press that used to leave a blank
     for good can actually be made here. */
  const [kind, setKind] = useState<DiagramKind>(from);
  const [hue, setHue] = useState<"section" | "progress" | "topic">("section");
  const [axis, setAxis] = useState<"spread" | "lanes">("spread");
  return (
    <div>
      <p style={{ fontFamily: "var(--font-ui)", fontSize: "0.7rem", color: "var(--ink-faint)", margin: "0 0 0.3rem", maxWidth: width }}>
        {label} — {width}px, now on “{kind}”
      </p>
      <div
        className="pv-band"
        style={{ "--mode-w": `${width}px`, width, height: 560, display: "flex", flexDirection: "column" } as React.CSSProperties}
      >
        <DiagramPanel
          slug="pv"
          root={ROOT}
          kind={kind}
          onKind={setKind}
          atRow={1}
          onJump={(id: BlockId) => console.log("jump", id)}
          blocks={BLOCKS}
          axis={axis}
          onAxis={setAxis}
          hue={hue}
          onHue={setHue}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <>
    {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant string in a throwaway preview page, with no input of any kind reaching it */}
    <style dangerouslySetInnerHTML={{ __html: OVERRIDE }} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", padding: "1rem", alignItems: "flex-start", background: "var(--page)" }}>
      <Band width={MODE_MIN} label="opens on Sketch — press Drift" from="sketch" />
      <Band width={MODE_MIN} label="Drift, projection landed (narrowest band)" from="drift" />
      <Band width={MODE_IDEAL} label="Trail, projection landed" from="trail" />
    </div>
  </>,
);
