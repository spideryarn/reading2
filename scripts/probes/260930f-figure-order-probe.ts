/**
 * **Does the illustrator honour "Image 1 / Image 2"?** — a paid probe for
 * docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md.
 *
 * GPT Sol's plan review, finding 7: the wire sends an ordered array of
 * anonymous images, and the envelope's numbering is only prose, so looking at
 * one paper's chart cannot tell "drew the figure it was given" from "drew
 * something like the caption". So: two pictures nobody could confuse — one
 * large red circle, three blue triangles — with captions that do NOT describe
 * them, placed left and right by label. Run once as an overview (figures only)
 * and once as a zoom plate (style plate first, then the figures, swapped).
 *
 *   npx tsx scripts/probes/260930f-figure-order-probe.ts <outDir>
 *
 * About $0.14, on the ledger under scope `eval`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

const outDir = process.argv[2] ?? "evals/results/illustrated-figure-order";

function picture(draw: (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void): string {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 800, 600);
  draw(ctx);
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}

const redCircle = picture((ctx) => {
  ctx.fillStyle = "#d01010";
  ctx.beginPath();
  ctx.arc(400, 300, 220, 0, Math.PI * 2);
  ctx.fill();
});
const blueTriangles = picture((ctx) => {
  ctx.fillStyle = "#1030d0";
  for (const x of [150, 400, 650]) {
    ctx.beginPath();
    ctx.moveTo(x, 150);
    ctx.lineTo(x - 110, 450);
    ctx.lineTo(x + 110, 450);
    ctx.closePath();
    ctx.fill();
  }
});

const { loadEnvLocal } = await import("../../src/env.js");
loadEnvLocal();
const { drawWithGateway, imagePrompt } = await import("../../src/illustrated.js");
const { collectSpend } = await import("../../src/ai-spend.js");
const { costStore } = await import("../../src/store/ai-calls.js");
const { environmentOwnerId } = await import("../../src/owner.js");

/* Captions that say nothing about shape or colour, so a correct plate can only
   have come from the bytes. */
const A = { label: "FIGURE A", caption: "Figure 1. Results of the first experiment." };
const B = { label: "FIGURE B", caption: "Figure 2. Results of the second experiment." };
const captions = [
  { where: "the left-hand panel", title: "FIRST" },
  { where: "the right-hand panel", title: "SECOND" },
];

await mkdir(outDir, { recursive: true });
const { result, report } = await collectSpend(
  async () => {
    const overview = await drawWithGateway({
      prompt: imagePrompt(
        "An antique map page divided into two framed panels side by side. The left-hand panel holds FIGURE A, redrawn as an engraving. The right-hand panel holds FIGURE B, redrawn as an engraving. Warm parchment, sepia ink.",
        captions,
        { stylePlate: false, figures: [A, B] },
      ),
      aspectRatio: "2:3",
      resolution: "1K",
      references: [{ dataUrl: redCircle }, { dataUrl: blueTriangles }],
    });
    const style = `data:${overview.mediaType};base64,${Buffer.from(overview.image).toString("base64")}`;
    const zoom = await drawWithGateway({
      prompt: imagePrompt(
        "A different page of the same atlas: a single tall hanging scroll filling the page, with a ship at sea at its foot. At the TOP of the scroll, FIGURE B, redrawn as a woodcut. At the BOTTOM of the scroll, just above the ship, FIGURE A, redrawn as a woodcut.",
        captions,
        { stylePlate: true, figures: [B, A] },
      ),
      aspectRatio: "2:3",
      resolution: "1K",
      references: [{ dataUrl: style }, { dataUrl: blueTriangles }, { dataUrl: redCircle }],
    });
    return { overview, zoom };
  },
  {
    attribution: { scopeKind: "eval", ownerId: environmentOwnerId() },
    sink: (row) => costStore.record(row),
  },
);

await writeFile(path.join(outDir, "overview.png"), result.overview.image);
await writeFile(path.join(outDir, "zoom.png"), result.zoom.image);
console.log(`wrote ${outDir}/overview.png and zoom.png`);
console.log("expected: overview — red circle LEFT, blue triangles RIGHT;");
console.log("          zoom     — blue triangles at the TOP of a scroll, red circle at the BOTTOM, in the overview hand.");
console.log(JSON.stringify(report));
