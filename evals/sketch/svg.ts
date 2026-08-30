/**
 * **A Sketch scene as a standalone `.svg` file**, so a prompt can be judged by
 * looking at what it drew rather than by reading its JSON.
 *
 * This is the harness's sink for `paintScene`; the browser panel is the other
 * one, and both take the *same* primitives, so what is looked at here is what
 * would be drawn there.
 *
 * ## Why the colours are written out rather than left to CSS
 *
 * The app paints a primitive from its class name, and the hue arrives through
 * `--cat-rgb` — one indirection, no colour named in any component
 * (docs/project/colour-scales.md). The first version of this file did the same
 * and the pictures came out **entirely black**, which looked like the painter
 * being broken and was not: `rsvg-convert` is librsvg, and librsvg does not
 * resolve CSS custom properties. `rgb(var(--sk) / 0.15)` is not an error there,
 * it is a colour that fails to parse, and a shape with an unparseable fill is
 * painted with the initial value, which is black on a near-black ground.
 *
 * So this file resolves class + tone to explicit presentation attributes. It is
 * a real duplication of what `styles.css § sketch` will say, and it is confined
 * to `attrsFor` below so there is one place to check. The palette is the eight
 * from `styles/colourscales.css`, written out.
 *
 *   npx tsx evals/sketch/run.ts …        writes .svg
 *   rsvg-convert -w 1100 x.svg > x.png   rasterises it
 */
import { paintScene, wrap, type Painted, type Prim } from "../../src/sketch-paint.js";
import type { Sketch, SketchScene } from "../../src/sketch-scene.js";

/** From styles/colourscales.css — Okabe–Ito, lifted for a dark ground. */
const CAT: [number, number, number][] = [
  [86, 180, 233],
  [232, 112, 58],
  [47, 191, 149],
  [240, 228, 66],
  [92, 143, 232],
  [222, 143, 188],
  [232, 163, 59],
  [201, 201, 201],
];

const PAGE = "#252525";
const INK = "#f7f7f7";
const INK_SOFT = "#b8b8b8";
const INK_FAINT = "#8f8f8f";
const RULE = "#3f3f3f";

const hue = (tone: number | undefined) => CAT[tone ?? 7] ?? (CAT[7] as [number, number, number]);
const rgba = (tone: number | undefined, a: number) => {
  const [r, g, b] = hue(tone);
  return `rgba(${r},${g},${b},${a})`;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * **Class + tone → presentation attributes.** The one place this file duplicates
 * the app's stylesheet; keep it and `styles.css § sketch` in step by hand.
 */
function attrsFor(cls: string, tone: number | undefined): string {
  const has = (c: string) => cls.split(" ").includes(c);
  const out: string[] = [];
  const dash =
    has("sk-edge-dashed") || has("sk-shape-note")
      ? "6 4"
      : has("sk-edge-dotted")
        ? "1.5 3.5"
        : has("sk-region-dashed")
          ? "5 4"
          : null;

  if (has("sk-shape")) {
    out.push(`fill="${rgba(tone, has("sk-shape-note") ? 0.09 : 0.16)}"`);
    out.push(`stroke="${rgba(tone, 0.62)}"`, 'stroke-width="1.2"');
    if (has("sk-shape-note")) out.push('stroke-dasharray="3 3"');
  } else if (has("sk-note-fold")) {
    out.push('fill="none"', `stroke="${rgba(tone, 0.5)}"`, 'stroke-width="1"');
  } else if (has("sk-region")) {
    out.push(`fill="${has("sk-region-dashed") ? "none" : rgba(tone, 0.07)}"`);
    out.push(`stroke="${rgba(tone, 0.24)}"`, 'stroke-width="1"');
  } else if (has("sk-bracket")) {
    out.push('fill="none"', `stroke="${rgba(tone, 0.5)}"`, 'stroke-width="1.5"');
  } else if (has("sk-head")) {
    out.push(`fill="${rgba(tone, 0.8)}"`, 'stroke="none"');
  } else if (has("sk-free-fill")) {
    out.push(`fill="${rgba(tone, 0.12)}"`, `stroke="${rgba(tone, 0.32)}"`, 'stroke-width="1"');
  } else if (has("sk-edge") || has("sk-free")) {
    out.push('fill="none"', `stroke="${rgba(tone, 0.62)}"`, 'stroke-width="1.5"');
    out.push('stroke-linecap="round"', 'stroke-linejoin="round"');
  } else if (has("sk-text")) {
    out.push(`fill="${INK}"`);
  } else if (has("sk-sub")) {
    out.push(`fill="${INK_FAINT}"`);
  } else if (has("sk-region-label")) {
    out.push(`fill="${rgba(tone, 0.95)}"`, 'font-weight="500"', 'letter-spacing="0.07em"');
  } else if (has("sk-label-plate")) {
    out.push(`fill="${PAGE}"`, 'stroke="none"');
  } else if (has("sk-edge-label")) {
    out.push(`fill="${INK_FAINT}"`);
  } else if (has("sk-label")) {
    out.push(`fill="${has("sk-label-lg") ? INK : has("sk-label-xs") ? INK_FAINT : INK_SOFT}"`);
    if (has("sk-label-lg")) out.push('font-weight="600"');
    if (has("sk-label-xs")) out.push('letter-spacing="0.06em"');
  }

  if (dash && !has("sk-shape-note")) out.push(`stroke-dasharray="${dash}"`);
  if (has("sk-muted")) out.push('opacity="0.5"');
  return out.join(" ");
}

function prim(p: Prim): string {
  const a = attrsFor(p.cls, p.tone);
  switch (p.t) {
    case "rect":
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" ${a}/>`;
    case "ellipse":
      return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" ${a}/>`;
    case "poly":
      return `<polygon points="${p.points}" ${a}/>`;
    case "path":
      return `<path d="${p.d}" ${a}/>`;
    case "text": {
      const up = p.cls.includes("sk-region-label") || p.cls.includes("sk-label-xs");
      const t = up ? p.text.toUpperCase() : p.text;
      return `<text x="${p.x}" y="${p.y}" font-size="${p.px}" text-anchor="${p.anchor}" ${a}>${esc(t)}</text>`;
    }
  }
}

function body(painted: Painted): string {
  const out: string[] = [];
  for (const p of painted.behind) out.push(prim(p));
  for (const p of painted.links) out.push(prim(p));
  for (const n of painted.nodes) {
    // The group is what carries the click in the app; here it only carries the
    // title, which is what a hover shows in any SVG viewer.
    const tip = [n.node.text, n.node.sub, n.node.detail, n.node.block ? `→ ${n.node.block}` : null]
      .filter(Boolean)
      .join(" — ");
    out.push("<g>");
    if (tip) out.push(`<title>${esc(tip)}</title>`);
    for (const p of n.prims) out.push(prim(p));
    out.push("</g>");
  }
  for (const p of painted.front) out.push(prim(p));
  return out.join("\n");
}

const FONT = `<style>text { font-family: "Geist", "Helvetica Neue", Arial, sans-serif; }</style>`;

/**
 * A caption, wrapped, as `<text>` lines from `y` downwards.
 *
 * SVG does not wrap, which is the thing this whole codebase's diagram notes
 * keep saying and which this file forgot: the first run's caption ran off the
 * right edge with "…and closes in a loo" and no error anywhere. Same character
 * estimate the painter uses, so the two cannot disagree about what fits.
 */
function lines(text: string, x: number, y: number, px: number, fill: string, weight?: string): string {
  const perLine = Math.max(1, Math.floor((760 - x * 2) / (px * 0.53)));
  return wrap(text, perLine, 3)
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * px * 1.3}" font-size="${px}" fill="${fill}"` +
        `${weight ? ` font-weight="${weight}"` : ""}>${esc(line)}</text>`,
    )
    .join("\n");
}

/** How tall `lines` came out, so what follows can start under it. */
function linesHeight(text: string, x: number, px: number): number {
  const perLine = Math.max(1, Math.floor((760 - x * 2) / (px * 0.53)));
  return wrap(text, perLine, 3).length * px * 1.3;
}

/** One scene on its own, with its caption above it. */
export function sceneSvg(scene: SketchScene, heading?: string): string {
  const painted = paintScene(scene);
  /* Wrapped, like `sketchSvg`'s. This function kept the one-line version for a
     round after the other was fixed, so the per-scene images clipped their
     captions while the stacked one did not — the same bug in the same file,
     surviving because only one of the two calls it was being looked at. */
  const capH = heading && scene.caption ? linesHeight(scene.caption, 16, 11.5) : 0;
  const top = heading ? 30 + capH + 12 : 0;
  const h = painted.height + top;
  const head = heading
    ? `<text x="16" y="24" font-size="17" fill="${INK}" font-weight="600">${esc(heading)}</text>` +
      (scene.caption ? lines(scene.caption, 16, 42, 11.5, INK_SOFT) : "")
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${painted.width} ${h}" width="${painted.width}" height="${h}">`,
    FONT,
    `<rect x="0" y="0" width="${painted.width}" height="${h}" fill="${PAGE}"/>`,
    head,
    `<g transform="translate(0 ${top})">`,
    body(painted),
    "</g>",
    "</svg>",
  ].join("\n");
}

/**
 * **Every scene stacked into one file**, which is how a run gets looked at: the
 * overview and each zoom-in, in order, on one page.
 */
export function sketchSvg(sketch: Sketch): string {
  const GAP = 28;
  const parts: string[] = [];
  let y = 46 + linesHeight(sketch.caption, 16, 12) + 20;

  for (const scene of sketch.scenes) {
    const painted = paintScene(scene);
    const capH = scene.caption ? linesHeight(scene.caption, 16, 11.5) : 0;
    const head = 22 + capH + 14;
    parts.push(
      `<g transform="translate(0 ${y})">`,
      `<line x1="16" y1="-14" x2="744" y2="-14" stroke="${RULE}"/>`,
      `<text x="16" y="14" font-size="15" fill="${INK}" font-weight="600">${esc(scene.title || scene.id)}</text>`,
      scene.caption ? lines(scene.caption, 16, 31, 11.5, INK_SOFT) : "",
      `<text x="744" y="14" font-size="10" fill="${INK_FAINT}" text-anchor="end" letter-spacing="0.06em">${esc(scene.id.toUpperCase())}</text>`,
      `<g transform="translate(0 ${head})">${body(painted)}</g>`,
      "</g>",
    );
    y += head + painted.height + GAP;
  }

  const total = y;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 ${total}" width="760" height="${total}">`,
    FONT,
    `<rect x="0" y="0" width="760" height="${total}" fill="${PAGE}"/>`,
    `<text x="16" y="28" font-size="19" fill="${INK}" font-weight="600">${esc(sketch.title)}</text>`,
    lines(sketch.caption, 16, 46, 12, INK_SOFT),
    ...parts,
    "</svg>",
  ].join("\n");
}
