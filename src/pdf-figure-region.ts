/**
 * **Which drawing, if any, belongs to a caption on a page with no picture in
 * it** — the pure half of recovering a figure that is drawn rather than
 * pictured.
 *
 * docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md, § Which pages are
 * eligible and § Finding the rectangle, with GPT Sol's follow-up
 * (260912a-…-f1-question-sol.md, F11–F13) and Fable's ruling on it folded in.
 * Its governing rule is 260906a's, and every doubt below resolves the same way:
 *
 * > A missing figure is visible; a wrong one is not.
 *
 * So this module mostly **refuses**, and it says why in two layers: a
 * `reason` the manifest records (`not-eligible` stays `no-raster` there,
 * `not-located` and `too-complex` are words of their own) and a `detail` the
 * tests pin, so each rule can be argued with on its own.
 *
 * **The ownership decision is one function, `ownsBand`**, and whether it may
 * join drawings that do not touch into one figure is one constant,
 * `ADMIT_DISCONNECTED_DRAWINGS`. The report's Figure 2 is two separate
 * lattices; Sol's F14 argues no geometry can tell that from one lattice beside
 * an unrelated diagram, and Fable ruled on 2026-09-12 to admit them — with
 * three refusals that narrow what "a drawing beside it" can be.
 *
 * **No pdf.js, no PDF, no PDFium.** The input is what the page layout read
 * (src/pdf-figure-layout.ts) hands back — boxes in PDF points, origin at the
 * bottom left, bigger y higher up the page — and every adversarial layout is a
 * synthetic test in tests/pdf-figure-region.test.ts. The same split
 * src/pdf-figures.ts makes, for the same reason: the lifetime of a worker has
 * nothing to teach a rule.
 */

/** A rectangle in PDF points, origin at the bottom left of the page. */
export interface PageBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * One painted path's box — and whether the path *is* that box: a single
 * closed, axis-aligned rectangle, which is what a boxed equation, a sidebar or
 * a callout is drawn with.
 */
export interface InkBox extends PageBox {
  readonly rect?: boolean;
}

/**
 * One text run exactly as pdf.js's `getTextContent()` reports it: its string,
 * its text matrix (the last two numbers are where its baseline starts), and its
 * extent along and across the baseline.
 */
export interface PageTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
}

/** Everything the rules need to know about one page. */
export interface PageLayout {
  /** pdf.js's view box, `[x0, y0, x1, y1]`. */
  readonly view: readonly [number, number, number, number];
  /** Degrees, as the page declares it. */
  readonly rotate: number;
  /**
   * The box of every **painted** path, through the current transform. A path
   * that only sets a clip paints nothing and is not here.
   */
  readonly ink: readonly InkBox[];
  /** The text layer, in content-stream order. */
  readonly text: readonly PageTextItem[];
  /** Length of the operator list. */
  readonly operators: number;
  /** `constructPath` operators, painted or not. */
  readonly paths: number;
  /** Image operators of any kind — bitmap, inline, repeated, mask. */
  readonly imageOps: number;
  /**
   * `shadingFill` operators: paint that covers whatever the clip is, which the
   * operator list does not give us.
   */
  readonly shadings: number;
}

export interface DrawnFigureInput {
  layout: PageLayout;
  /** The block's own `<figcaption>` text, as the article carries it. */
  caption: string;
  /** How many figure markers the article puts on this page. */
  markersOnPage: number;
  /**
   * Whether the page's resources — walked through Form XObjects — hold an
   * image, which is the only place an image pdf.js dropped for size is still
   * visible (src/pdf-figure-read.ts § 1). Read with pdf-lib, by the caller.
   */
  imageInResources: boolean;
  /** `ownsBand`'s switch. Production passes nothing and gets `ADMIT_DISCONNECTED_DRAWINGS`. */
  admitDisconnected?: boolean;
}

/** Why a page is not the narrow case this route exists for. */
export type NotEligible =
  | "several-markers"
  | "several-captions"
  | "image-op"
  | "image-resource"
  | "rotated"
  | "offset-view-box";

/** Which ceiling a page is over. */
export type TooComplex = "operators" | "paths";

/** Why the band above the caption is not provably the caption's figure. `ownsBand`'s answers. */
export type NotOwned =
  | "no-ink"
  | "other-ink-in-band"
  | "disconnected"
  | "too-many-components"
  | "small-component"
  | "boxed-text"
  | "foreign-text";

/** Why no region could be proved to be this caption's. */
export type NotLocated =
  | "empty-caption"
  | "caption-not-found"
  | "caption-ambiguous"
  | "caption-mid-line"
  | "unbounded-ink"
  | "page-sized-ink"
  | "ink-crosses-band"
  | NotOwned
  | "off-page"
  | "too-small"
  | "too-large"
  | "prose-in-region";

type Refusal =
  | { ok: false; reason: "not-eligible"; detail: NotEligible }
  | { ok: false; reason: "too-complex"; detail: TooComplex }
  | { ok: false; reason: "not-located"; detail: NotLocated };

export type DrawnFigureVerdict = { ok: true; region: PageBox } | Refusal;

/* ------------------------------------------------------------------ *
 * The numbers
 * ------------------------------------------------------------------ */

/**
 * The most operators a page may have and still be tried.
 *
 * **A guard against the obvious runaway, not a security boundary** — one
 * operator can still be expensive to render (Sol F3; the plan's § Security).
 * Measured 2026-09-12: the report's MDPI page is 1,382 operators and the arXiv
 * paper's two figure pages about 3,170 and 2,380, so this is fifteen times the
 * busiest real page. A dense matplotlib scatter can pass it; that is the point
 * of calling it a guard.
 */
export const MAX_PAGE_OPERATORS = 50_000;

/**
 * The most `constructPath` operators a page may have. The same pages have 59,
 * 553 and 458; this is thirty-six times the most.
 */
export const MAX_PAGE_PATHS = 20_000;

/**
 * How much of the caption has to be found on the page, in normalised
 * characters. Enough that a body sentence beginning "Figure 2 shows…" is not
 * the caption; short enough that the renderer's line breaking and a
 * transcription's small liberties late in a long caption do not matter.
 */
export const CAPTION_MATCH_CHARS = 60;

/** A line with at least this many words… */
export const PROSE_MIN_WORDS = 8;
/** …spanning at least this fraction of the page width, is prose. */
export const PROSE_MIN_WIDTH_FRACTION = 0.3;

/**
 * The top and bottom fraction of the page where a running header's or
 * footer's rule and text live. MDPI's rule sits at y = 771 of 842 on the
 * report's page, and its header text at 779.
 */
export const FURNITURE_MARGIN_FRACTION = 0.12;
/** A rule is at most this thick… */
export const RULE_MAX_THICKNESS_PT = 2;
/** …and at least this fraction of the page wide. A figure's own short line is not a rule. */
export const RULE_MIN_WIDTH_FRACTION = 0.5;

/**
 * A single path this big in **both** directions is a border, a watermark or a
 * background, and the page is refused rather than the path trimmed.
 */
export const PAGE_SIZED_FRACTION = 0.8;

/**
 * Two things closer than this are touching — two drawings are one, a line of
 * text is a drawing's label. MDPI's brace labels sit half a point from the
 * lattice nodes they name; a column gutter is twelve points or more.
 */
export const TOUCH_GAP_PT = 6;

/**
 * Points of page the renderer draws round the region (src/pdf-figure-render.ts
 * uses this constant, not a copy of it). Path boxes do not include a stroke's
 * width, so a line along the region's edge is half outside it without this —
 * and anything within it will be in the picture, so the text and prose checks
 * below look at the region *with* it.
 */
export const CROP_PAD_PT = 4;

/**
 * The region's shortest side, at least — half an inch — and, since Fable's
 * ruling, **each separate drawing's** as well: a smaller one in the band is an
 * ornament, a logo or a stray mark, and refuses the page.
 */
export const MIN_REGION_SIDE_PT = 36;
/** The region's area, at most, as a fraction of the page's. */
export const MAX_REGION_AREA_FRACTION = 0.75;

/**
 * The most separate drawings one figure may be made of. Six panels is a large
 * multi-panel figure; more is more likely a page of unrelated marks. Fable's
 * ruling, 2026-09-12.
 */
export const MAX_INK_COMPONENTS = 6;

/**
 * **Whether `ownsBand` may make one figure of drawings that do not touch.**
 *
 * The report's own Figure 2 is two lattices side by side with sixty points of
 * white between them, so `false` refuses the figure the route was built for.
 * GPT Sol's F14 argues that `true` cannot be made sound by geometry alone —
 * one lattice beside an unrelated diagram can have the same boxes. **Fable
 * ruled on 2026-09-12 to admit them**, narrowed by `ownsBand`'s three component
 * refusals; this is the one line that changes if that is ever reversed, and
 * tests/pdf-figure-region.test.ts runs both settings.
 */
export const ADMIT_DISCONNECTED_DRAWINGS = true;

/** Slack for "on the line" comparisons between two engines' floats. */
const EPS_PT = 1;

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The rectangle of the drawing that belongs to this caption, or why there is
 * not one we can stand behind.
 *
 * The order is the plan's: eligibility (is this the narrow case at all), the
 * ceilings (is it too heavy to try), then locating — `bandFor` finds the
 * caption and bounds the band above it, `ownsBand` decides whether everything
 * in that band is this one figure, and the sanity bounds come last.
 */
export function locateDrawnFigure(input: DrawnFigureInput): DrawnFigureVerdict {
  const read = bandFor(input);
  if (!read.ok) return read;
  const owned = ownsBand(read.band, {
    admitDisconnected: input.admitDisconnected ?? ADMIT_DISCONNECTED_DRAWINGS,
  });
  if (!owned.ok) return notLocated(owned.detail);
  const region = owned.region;

  /* Rule 6: sanity. */
  const [vx0, vy0, vx1, vy1] = input.layout.view;
  const pageWidth = vx1 - vx0;
  const pageHeight = vy1 - vy0;
  if (region.x0 < vx0 - EPS_PT || region.y0 < vy0 - EPS_PT || region.x1 > vx1 + EPS_PT || region.y1 > vy1 + EPS_PT) {
    return notLocated("off-page");
  }
  if (width(region) < MIN_REGION_SIDE_PT || height(region) < MIN_REGION_SIDE_PT) return notLocated("too-small");
  if (width(region) * height(region) > MAX_REGION_AREA_FRACTION * pageWidth * pageHeight) {
    return notLocated("too-large");
  }
  const crop = padded(region);
  if (read.prose.some((box) => intersects(crop, box))) return notLocated("prose-in-region");
  return { ok: true, region };
}

/**
 * **Everything up to the ownership question**: eligibility, the ceilings, the
 * caption, the band above it and what lies in it — or the first rule that
 * refused. Exported so the component measurements the ruling asked for can be
 * taken on real pages with the same code that decides them.
 */
export function bandFor(
  input: DrawnFigureInput,
): { ok: true; band: BandContents; prose: PageBox[] } | Refusal {
  const { layout } = input;
  const lines = textLines(layout.text);

  /* 1. Exactly one figure marker on the page. Sol F1: side-by-side figures over
     stacked captions defeat any band rule, so two captions are deferred. */
  if (input.markersOnPage !== 1) return notEligible("several-markers");
  /* 1b. And exactly one *printed* figure-caption opening, which is not the same
     claim: the marker is the transcription's reading of the page, and a caption
     it missed is still a caption whose drawing the band rule could take. Sol
     F13. Counted over every line, upright or not — and only where the number
     is followed by a delimiter, so "Figure 2." and "Fig. 3:" count and a body
     line that begins "Figure 2 shows…" does not. */
  if (lines.filter((l) => PRINTED_CAPTION_START.test(l.text.normalize("NFKD").trim())).length !== 1) {
    return notEligible("several-captions");
  }
  /* 2. No image of any kind — in the operator list or in the resources. Sol F2:
     an image the bitmap route declined is never handed to a second decoder. */
  if (layout.imageOps > 0) return notEligible("image-op");
  if (input.imageInResources) return notEligible("image-resource");
  /* 3. An ordinary geometry. Anything else is refused rather than reconciled
     across two coordinate engines (Sol F7); the renderer checks PDFium's page
     size against this view box as the third half of the same rule. */
  if (((layout.rotate % 360) + 360) % 360 !== 0) return notEligible("rotated");
  const [vx0, vy0, vx1, vy1] = layout.view;
  if (Math.abs(vx0) > 0.01 || Math.abs(vy0) > 0.01) return notEligible("offset-view-box");
  /* 4. Not too heavy to try. */
  if (layout.operators > MAX_PAGE_OPERATORS) return tooComplex("operators");
  if (layout.paths > MAX_PAGE_PATHS) return tooComplex("paths");

  const page: Page = { width: vx1 - vx0, height: vy1 - vy0, top: vy1, bottom: vy0 };

  /* Paint whose extent we do not know cannot be proved to be anybody's. */
  if (layout.shadings > 0) return notLocated("unbounded-ink");
  /* Rule 3, second half: a border or a watermark refuses the page. */
  if (
    layout.ink.some(
      (b) => width(b) >= PAGE_SIZED_FRACTION * page.width && height(b) >= PAGE_SIZED_FRACTION * page.height,
    )
  ) {
    return notLocated("page-sized-ink");
  }

  /* Rule 1: the caption, not a mention of it. */
  const found = findCaption(input.caption, layout.text, lines);
  if (!found.ok) return notLocated(found.detail);
  const captionLines = found.lines;
  const captionTop = Math.max(...captionLines.map((l) => l.box.y1));
  const column = {
    x0: Math.min(...captionLines.map((l) => l.box.x0)),
    x1: Math.max(...captionLines.map((l) => l.box.x1)),
  };
  const others = lines.filter((l) => !captionLines.includes(l));

  /* Rule 2: the ceiling. */
  const isProse = (l: Line): boolean =>
    l.upright && l.words >= PROSE_MIN_WORDS && width(l.box) >= PROSE_MIN_WIDTH_FRACTION * page.width;
  const isCaptionLike = (l: Line): boolean => l.upright && ANY_CAPTION_START.test(l.text);
  let ceiling = page.top;
  for (const line of others) {
    if (line.box.y0 < captionTop - EPS_PT) continue;
    if (!(line.box.x0 < column.x1 && column.x0 < line.box.x1)) continue;
    if (isProse(line) || isCaptionLike(line)) ceiling = Math.min(ceiling, line.box.y0);
  }

  /* Rule 3, first half: a running header's rule is not ink. */
  const ink = withoutFurniture(layout.ink, page);

  /* Everything drawn in the band — and nothing may be half in it. */
  const bandInk: InkBox[] = [];
  for (const box of ink) {
    const overlaps = box.y1 > captionTop + EPS_PT && box.y0 < ceiling - EPS_PT;
    if (!overlaps) continue;
    const inside = box.y0 >= captionTop - EPS_PT && box.y1 <= ceiling + EPS_PT;
    if (!inside) return notLocated("ink-crosses-band");
    bandInk.push(box);
  }
  const bandText = others
    .filter((l) => l.box.y1 > captionTop + EPS_PT && l.box.y0 < ceiling - EPS_PT)
    .map((l) => ({ box: l.box, label: !isProse(l) && !isCaptionLike(l) }));

  return {
    ok: true,
    band: {
      column,
      ink: bandInk,
      text: bandText,
    },
    prose: others.filter((l) => isProse(l) || isCaptionLike(l)).map((l) => l.box),
  };
}

function notEligible(detail: NotEligible): Refusal {
  return { ok: false, reason: "not-eligible", detail };
}
function tooComplex(detail: TooComplex): Refusal {
  return { ok: false, reason: "too-complex", detail };
}
function notLocated(detail: NotLocated): Refusal {
  return { ok: false, reason: "not-located", detail };
}

interface Page {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

/**
 * A printed figure-caption opening, as Sol's F13 asks it to be counted:
 * "Figure 3.", "Fig. 3:", "Figure 3a —" at the start of a line — the number
 * **followed by a delimiter**, which is what separates a caption from a
 * sentence about it. The three real captions this was checked against open
 * "Figure 2." (MDPI) and "Figure 1:" / "Figure 2:" (arXiv).
 */
const PRINTED_CAPTION_START = /^(fig(ure)?\.?)\s*\d+[a-z]?\s*[.:|—–-]/i;
/** The plan's ceiling test: any caption, figure or table, however punctuated. */
const ANY_CAPTION_START = /^\s*(figure|fig\.?|table)\s*\d/i;

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

/** What lies in the band between a caption and the prose above it. */
export interface BandContents {
  /** The caption's horizontal extent: drawings over it are where the figure starts. */
  column: { x0: number; x1: number };
  /** Every painted box wholly inside the band, running headers' rules already removed. */
  ink: readonly InkBox[];
  /**
   * Every text line overlapping the band other than the caption's own, and
   * whether it could be a label — short, not prose, not another caption.
   */
  text: readonly { box: PageBox; label: boolean }[];
}

/** One separate drawing in the band: ink chained by touching, and the labels that touch it. */
export interface InkComponent {
  box: PageBox;
  ink: InkBox[];
  labels: number;
  /** One closed axis-aligned rectangle — however many times painted — with text inside it. */
  boxedText: boolean;
}

export type Ownership = { ok: true; region: PageBox } | { ok: false; detail: NotOwned };

/**
 * **Is everything in the band this one figure — and if so, where is it?**
 *
 * The plan's rules 4 and 5, Sol's F12, and Fable's ruling, as the one function
 * the ownership question lives in. In order:
 *
 * 1. The drawings over the caption's column start the figure; any drawing that
 *    touches a drawing already in it joins it. Touching is box to box, never
 *    "inside the region's rectangle" — a rectangle has an empty middle, and
 *    something sitting in it that touches nothing is exactly what must not be
 *    swept in.
 * 2. **Every drawing in the band has to have joined**, or the page is refused:
 *    a sidebar, an ornament, a neighbouring column's rules.
 * 3. What joined is then looked at as its separate drawings (`inkComponents`).
 *    Unless `admitDisconnected` there must be exactly one. There may never be
 *    more than `MAX_INK_COMPONENTS`; each must be at least
 *    `MIN_REGION_SIDE_PT` on each side on its own; and none may be a single
 *    closed rectangle with text inside it — a boxed equation, a sidebar, a
 *    callout (Sol F11). Fable's ruling: the three things "a separate drawing
 *    beside the figure" most often is when it is not part of it.
 * 4. A short line of text touching one of the figure's drawings is its label,
 *    and joins it. **Any other line of text inside the padded crop refuses the
 *    page** (Sol F12): a `DRAFT` watermark between two panels, an equation —
 *    text PDFium would draw into the picture. Text outside the crop, such as
 *    the other column's prose beside a half-width figure, is not in the
 *    picture and refuses nothing.
 */
export function ownsBand(
  band: BandContents,
  options: { admitDisconnected: boolean } = { admitDisconnected: ADMIT_DISCONNECTED_DRAWINGS },
): Ownership {
  const { ink } = band;
  const taken = ink.map((b) => b.x0 < band.column.x1 && band.column.x0 < b.x1);
  const queue = taken.flatMap((t, i) => (t ? [i] : []));
  if (queue.length === 0) return { ok: false, detail: "no-ink" };
  while (queue.length > 0) {
    const from = ink[queue.pop() as number] as InkBox;
    for (let j = 0; j < ink.length; j++) {
      if (!taken[j] && touches(from, ink[j] as InkBox)) {
        taken[j] = true;
        queue.push(j);
      }
    }
  }
  if (taken.some((t) => !t)) return { ok: false, detail: "other-ink-in-band" };

  const components = inkComponents(band);
  if (!options.admitDisconnected && components.length > 1) return { ok: false, detail: "disconnected" };
  if (components.length > MAX_INK_COMPONENTS) return { ok: false, detail: "too-many-components" };
  if (components.some((k) => width(k.box) < MIN_REGION_SIDE_PT || height(k.box) < MIN_REGION_SIDE_PT)) {
    return { ok: false, detail: "small-component" };
  }
  if (components.some((k) => k.boxedText)) return { ok: false, detail: "boxed-text" };

  let region = ink.reduce<PageBox>((acc, b) => union(acc, b), ink[0] as InkBox);
  const labels = band.text.filter((t) => t.label && ink.some((b) => touches(b, t.box)));
  for (const label of labels) region = union(region, label.box);

  /* Sol F12: text that is not the figure's label and that PDFium would draw
     into the picture. Text beside the region but outside the crop — the other
     column's prose, a running header — is not in the picture and claims
     nothing; foreign *ink* anywhere in the band was refused above. */
  const crop = padded(region);
  if (band.text.some((line) => !labels.includes(line) && intersects(crop, line.box))) {
    return { ok: false, detail: "foreign-text" };
  }
  return { ok: true, region };
}

/**
 * The band's ink as separate drawings: boxes chained by touching within `gap`,
 * each with the label lines that touch it folded into its extent. A label does
 * not join two drawings — it belongs to each it touches — because a caption's
 * word between two panels is not evidence the panels are one.
 *
 * `gap` is a parameter so the ruling's measurement can be taken at several;
 * the rules use `TOUCH_GAP_PT`.
 */
export function inkComponents(band: BandContents, gap: number = TOUCH_GAP_PT): InkComponent[] {
  const { ink } = band;
  const component = ink.map(() => -1);
  const groups: InkBox[][] = [];
  for (let i = 0; i < ink.length; i++) {
    if (component[i] !== -1) continue;
    const id = groups.length;
    const members: InkBox[] = [];
    component[i] = id;
    const queue = [i];
    while (queue.length > 0) {
      const at = queue.pop() as number;
      const from = ink[at] as InkBox;
      members.push(from);
      for (let j = 0; j < ink.length; j++) {
        if (component[j] === -1 && touches(from, ink[j] as InkBox, gap)) {
          component[j] = id;
          queue.push(j);
        }
      }
    }
    groups.push(members);
  }
  return groups.map((members) => {
    let box = members.reduce<PageBox>((acc, b) => union(acc, b), members[0] as InkBox);
    let labels = 0;
    for (const line of band.text) {
      if (line.label && members.some((b) => touches(b, line.box, gap))) {
        box = union(box, line.box);
        labels += 1;
      }
    }
    return { box, ink: members, labels, boxedText: isBoxedText(members, band.text) };
  });
}

/**
 * One closed axis-aligned rectangle — painted once, or filled and stroked as
 * two paths over the same corners — with a line of text inside it.
 */
function isBoxedText(members: readonly InkBox[], text: BandContents["text"]): boolean {
  const first = members[0];
  if (!first || !members.every((b) => b.rect && sameBox(b, first))) return false;
  return text.some(
    (t) => t.box.x0 >= first.x0 - EPS_PT && t.box.x1 <= first.x1 + EPS_PT && t.box.y0 >= first.y0 - EPS_PT && t.box.y1 <= first.y1 + EPS_PT,
  );
}

function sameBox(a: PageBox, b: PageBox): boolean {
  return (
    Math.abs(a.x0 - b.x0) <= EPS_PT &&
    Math.abs(a.y0 - b.y0) <= EPS_PT &&
    Math.abs(a.x1 - b.x1) <= EPS_PT &&
    Math.abs(a.y1 - b.y1) <= EPS_PT
  );
}

/* ------------------------------------------------------------------ *
 * The caption
 * ------------------------------------------------------------------ */

/**
 * Letters and digits only, lower case, ligatures and accents unfolded — so a
 * caption split across runs, broken with a hyphen, or set with an "ﬁ" ligature
 * reads the same as the transcription's. NFKD does the unfolding; the class
 * does the rest.
 */
function normalise(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Where on the page the caption is — as the lines it occupies — or why it is
 * not there to be found.
 *
 * **Matched over the runs in content order, not over lines**, because a
 * superscript or a font change breaks a line into runs at a different baseline
 * and content order is what puts them back. The match has to be the only one
 * on the page, and it has to begin a line: a caption does, and a sentence that
 * happens to quote one does not.
 */
function findCaption(
  caption: string,
  items: readonly PageTextItem[],
  lines: readonly Line[],
): { ok: true; lines: Line[] } | { ok: false; detail: NotLocated } {
  const needle = normalise(caption).slice(0, CAPTION_MATCH_CHARS);
  if (!needle) return { ok: false, detail: "empty-caption" };

  let hay = "";
  const spans: { start: number; end: number; item: PageTextItem }[] = [];
  for (const item of items) {
    if (!isUpright(item)) continue;
    const text = normalise(item.str);
    if (!text) continue;
    spans.push({ start: hay.length, end: hay.length + text.length, item });
    hay += text;
  }

  const at = hay.indexOf(needle);
  if (at < 0) return { ok: false, detail: "caption-not-found" };
  if (hay.indexOf(needle, at + 1) >= 0) return { ok: false, detail: "caption-ambiguous" };

  const first = spans.find((s) => s.start === at);
  const firstLine = first && lineOf(lines, first.item);
  if (!first || !firstLine || Math.abs(itemBox(first.item).x0 - firstLine.box.x0) > EPS_PT) {
    return { ok: false, detail: "caption-mid-line" };
  }
  const matched: Line[] = [];
  for (const span of spans) {
    if (span.end <= at || span.start >= at + needle.length) continue;
    const line = lineOf(lines, span.item);
    if (line && !matched.includes(line)) matched.push(line);
  }
  return { ok: true, lines: matched };
}

/* ------------------------------------------------------------------ *
 * Text lines
 * ------------------------------------------------------------------ */

interface Line {
  box: PageBox;
  text: string;
  words: number;
  upright: boolean;
  items: PageTextItem[];
}

/** How far a run's baseline may sit from its line's, as a fraction of its size — superscripts included. */
const SAME_LINE_FRACTION = 0.5;
/** How wide a gap between two runs of one line may be, as a fraction of their size. Less than any gutter. */
const WORD_GAP_FRACTION = 0.8;

/**
 * Runs gathered into lines: same baseline, near each other. Upright runs only
 * share a line; a sideways run — an axis label, an arXiv margin stamp — is a
 * line of its own, which can be a figure's label but never prose or a caption.
 */
function textLines(items: readonly PageTextItem[]): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const box = itemBox(item);
    const upright = isUpright(item);
    const size = Math.max(item.height, 1);
    let into: Line | undefined;
    if (upright) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i] as Line;
        if (!line.upright) continue;
        const last = line.items[line.items.length - 1] as PageTextItem;
        const baseline = (last.transform[5] ?? 0) - (item.transform[5] ?? 0);
        if (Math.abs(baseline) > SAME_LINE_FRACTION * size) continue;
        const gap = Math.max(box.x0 - line.box.x1, line.box.x0 - box.x1);
        if (gap > WORD_GAP_FRACTION * size) continue;
        into = line;
        break;
      }
    }
    if (into) {
      into.box = union(into.box, box);
      into.text += ` ${item.str}`;
      into.items.push(item);
    } else {
      lines.push({ box, text: item.str, words: 0, upright, items: [item] });
    }
  }
  for (const line of lines) line.words = line.text.trim().split(/\s+/).length;
  return lines;
}

function lineOf(lines: readonly Line[], item: PageTextItem): Line | undefined {
  return lines.find((l) => l.items.includes(item));
}

function isUpright(item: PageTextItem): boolean {
  const [a = 0, b = 0, c = 0, d = 0] = item.transform;
  return a > 0 && d > 0 && Math.abs(b) <= 1e-3 * a && Math.abs(c) <= 1e-3 * d;
}

/**
 * A run's box on the page. Upright, it is the baseline origin, the advance and
 * the size; otherwise the parallelogram the text matrix makes of the same two
 * lengths, boxed.
 */
function itemBox(item: PageTextItem): PageBox {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  const w = Math.max(item.width, 0);
  const h = Math.max(item.height, 0);
  if (isUpright(item)) return { x0: e, y0: f, x1: e + w, y1: f + h };
  const along = Math.hypot(a, b) || 1;
  const across = Math.hypot(c, d) || 1;
  const ux = (a / along) * w;
  const uy = (b / along) * w;
  const vx = (c / across) * h;
  const vy = (d / across) * h;
  const xs = [e, e + ux, e + vx, e + ux + vx];
  const ys = [f, f + uy, f + vy, f + uy + vy];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/* ------------------------------------------------------------------ *
 * Furniture
 * ------------------------------------------------------------------ */

/**
 * The ink, less a running header's or footer's rule.
 *
 * A rule is thin, wide, in the top or bottom margin band — **and touches no
 * other ink**, which is the clause the plan's one-line rule needed: the top
 * edge of a figure's own frame is thin, wide and can sit in the same band, and
 * trimming it would crop the figure. Only what stands alone is furniture.
 */
function withoutFurniture(ink: readonly InkBox[], page: Page): InkBox[] {
  const margin = FURNITURE_MARGIN_FRACTION * page.height;
  const ruleShaped = (b: PageBox): boolean =>
    height(b) <= RULE_MAX_THICKNESS_PT &&
    width(b) >= RULE_MIN_WIDTH_FRACTION * page.width &&
    (b.y0 >= page.top - margin || b.y1 <= page.bottom + margin);
  const rules = ink.filter(ruleShaped);
  const rest = ink.filter((b) => !ruleShaped(b));
  const furniture = new Set(rules.filter((r) => !rest.some((b) => touches(r, b))));
  return ink.filter((b) => !furniture.has(b));
}

/* ------------------------------------------------------------------ *
 * Boxes
 * ------------------------------------------------------------------ */

function width(b: PageBox): number {
  return b.x1 - b.x0;
}
function height(b: PageBox): number {
  return b.y1 - b.y0;
}
function union(a: PageBox, b: PageBox): PageBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
/** The region as the renderer will draw it. */
function padded(b: PageBox): PageBox {
  return { x0: b.x0 - CROP_PAD_PT, y0: b.y0 - CROP_PAD_PT, x1: b.x1 + CROP_PAD_PT, y1: b.y1 + CROP_PAD_PT };
}
/** Within `gap` of each other on both axes. */
function touches(a: PageBox, b: PageBox, gap: number = TOUCH_GAP_PT): boolean {
  return b.x0 <= a.x1 + gap && a.x0 <= b.x1 + gap && b.y0 <= a.y1 + gap && a.y0 <= b.y1 + gap;
}
/** Overlapping by more than the float slack, on both axes. */
function intersects(a: PageBox, b: PageBox): boolean {
  return b.x0 < a.x1 - EPS_PT && a.x0 < b.x1 - EPS_PT && b.y0 < a.y1 - EPS_PT && a.y0 < b.y1 - EPS_PT;
}
