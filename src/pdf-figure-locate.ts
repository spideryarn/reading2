/**
 * **A model says where a refused figure is, and a rule decides whether to
 * believe it** — stage 2 of
 * docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md.
 *
 * The bitmap route pairs a caption with a picture only when the page proves
 * they belong together (src/pdf-figures.ts § 3). A figure whose caption is a
 * title drawn *inside* its picture, or whose transcript page is one off, or
 * whose page holds two pictures, is refused there, correctly, because the page
 * alone cannot say which picture is whose. A person looking at the page can.
 * So for those figures, and only those (Greg, 2026-09-28: *"For now let's just
 * do it for figures that fail"*), a vision model is shown the claimed page and
 * its neighbours and asked for the page and box of the figure with this
 * caption.
 *
 * ## The answer is a claim, and `judgeLocatedBox` is what it has to pass
 *
 * The picture stored is always an **embedded picture, whole** — never a crop
 * of a render — so what the model's box has to do is *point at one picture*,
 * unambiguously. Measured on the test run (the plan's table), the model boxes
 * only the chart part of a diagram with a panel beside it, 57–73% of the
 * picture, which is why the rule asks where the box lies rather than how much
 * of the picture it covers. The rule, in order:
 *
 * 1. the answer is the shape asked for, on a page we sent, with a box in range;
 * 2. every image on that page is one we can place: no inline image, mask or
 *    repeat, whose placements are not recorded (`unmeasured-image`);
 * 3. at least `INSIDE_SHARE` of the box lies inside one visible usable
 *    picture, and the box covers at least `MIN_COVER` of it;
 * 4. no other visible image holds `OTHER_SHARE` of the box, blank overlays
 *    alone excepted;
 * 5. that picture is painted exactly once, and nothing in force changed how it
 *    shows — a soft mask, a blend (`unmeasured-image`);
 * 6. it is not the size of the page (`background`) and no other picture sits
 *    within `ASSEMBLY_GAP_PT` of it (`assembly`);
 * 7. its clip is exact, and cuts it only within `PAGE_FRAME_PT` of the page's
 *    edge (`clipped`);
 * 8. no other figure in the article has that picture — compared by what it
 *    is, not by pdf.js's name for it (`already-taken`).
 *
 * ## What it cannot do: tell a right answer from a wrong one
 *
 * **A tight box around the wrong picture passes**, when that picture is one
 * clean picture on its page — the rule checks the geometry of the answer, not
 * its truth (GPT Sol, stage 2 plan review, finding 1). Rules 4 and 6 refuse
 * the layouts where a wrong answer is most likely to *look* right — a box
 * straddling two pictures, one panel of a composite, a page background — and
 * the test run's 30 calls, over two-picture pages and three negative controls,
 * chose no wrong picture. That is the evidence the residual risk is small, not
 * a proof that it is absent, and the plan says so to Greg.
 *
 * ## What v1 does not do
 *
 * A figure drawn with vector paths is refused (`not-one-picture`): a box on a
 * page with no picture has nothing to point at, and checking it against vector
 * ink would need the drawn route's ownership rules applied to a region nobody
 * measured. Nor a picture cropped inside the page, a rotated page, or a page
 * two away.
 */

import { openRouterJson } from "./ai-call.js";
import { PDF_FIGURE_LOCATOR_MODEL } from "./models.js";
import type { ImagePaint } from "./pdf-figure-paint.js";
import type { PageBox } from "./pdf-figure-region.js";

/** At least this much of the model's box must lie inside the one picture it points at. */
export const INSIDE_SHARE = 0.8;
/** …and the box must cover at least this much of that picture, so a label-sized box does not choose a page-sized picture. */
export const MIN_COVER = 0.3;
/** No other visible image may hold this much of the box. */
export const OTHER_SHARE = 0.05;
/** A picture showing more than this share of the page is a background or a scan. */
export const BACKGROUND_SHARE = 0.8;
/**
 * Two pictures closer than this, in points, are taken to be panels of one
 * figure. The essay's second picture on a page is 117 pt or more away, across
 * prose; panels of a composite touch or nearly do.
 */
export const ASSEMBLY_GAP_PT = 12;
/**
 * A clip may cut the picture only this close to the page's edge, in points —
 * half an inch. Chrome clips a printed page to its print frame, measured 10 pt
 * inside the edge on the essay; a cut further in is a crop the page meant.
 */
export const PAGE_FRAME_PT = 36;

/** A page as the model was shown it: its number and its view box in points. */
export interface SentPage {
  page: number;
  view: PageBox;
}

/** A decoded picture, named as `RasterCandidate` names it. */
export interface PictureRef {
  page: number;
  key: string;
}

/**
 * A usable picture, with an `identity` that says what it *is*: a hash of its
 * decoded bytes and shape, so that one image painted on two pages, or embedded
 * twice under two names, is one picture (GPT Sol, finding 5).
 */
export interface UsablePicture extends PictureRef {
  identity: string;
}

export interface LocateInput {
  /** The parsed JSON the model returned — unchecked, which is this function's job. */
  answer: unknown;
  sent: readonly SentPage[];
  /** Pictures `classifyRaster` calls usable. Only these can be chosen. */
  usable: readonly UsablePicture[];
  /** Pictures `classifyRaster` calls blank — transparent overlays — which rule 4 ignores. */
  blank: readonly PictureRef[];
  /** Every image paint on the pages sent (`readPdfRasters().paints`). */
  paints: readonly ({ page: number } & ImagePaint)[];
  /** The identities of pictures another figure in the article already has. */
  taken: readonly string[];
}

export type LocateRefusal =
  /** The model answered that no figure on these pages has this caption. */
  | "model-found-none"
  /** The answer was not `{page, box_2d}` with a whole page number and four numbers. */
  | "unreadable-answer"
  /** A box outside 0–1000, or with no area. */
  | "bad-box"
  /** A page we did not show it. */
  | "page-not-sent"
  /** An image on the page we cannot place, or a picture whose appearance was changed. */
  | "unmeasured-image"
  /** The box does not point at exactly one visible picture — rules 3 and 4. */
  | "not-one-picture"
  | "painted-twice"
  | "background"
  | "assembly"
  | "clipped"
  | "already-taken";

export type LocateVerdict =
  | { status: "chosen"; page: number; key: string; identity: string }
  | { status: "refused"; reason: LocateRefusal };

/** The model's answer, judged. Pure: plain boxes in, a verdict out. */
export function judgeLocatedBox(input: LocateInput): LocateVerdict {
  const refuse = (reason: LocateRefusal): LocateVerdict => ({ status: "refused", reason });

  const answer = readAnswer(input.answer);
  if (answer === "unreadable") return refuse("unreadable-answer");
  if (answer === "none") return refuse("model-found-none");
  const [ymin, xmin, ymax, xmax] = answer.box;
  if (![ymin, xmin, ymax, xmax].every((n) => n >= 0 && n <= 1000) || ymin >= ymax || xmin >= xmax) {
    return refuse("bad-box");
  }
  const sent = input.sent.find((s) => s.page === answer.page);
  if (!sent) return refuse("page-not-sent");

  const { view } = sent;
  const box = boxOnPage(answer.box, view);
  const boxArea = area(box);

  /* What of each paint shows: the page and the clip, and nothing at all for a
     clip that is empty. */
  const here = input.paints
    .filter((p) => p.page === sent.page)
    .map((p) => ({ paint: p, visible: p.clip ? meet(meet(p.box, view), p.clip) : EMPTY }));
  const shows = (v: PageBox) => area(v) > 0;
  const blankHere = (key: string | null) =>
    key !== null && input.blank.some((b) => b.page === sent.page && b.key === key);
  const usableHere = (key: string | null) =>
    key === null ? undefined : input.usable.find((u) => u.page === sent.page && u.key === key);

  /* Rule 2. */
  /* `other` operators have placeholder boxes, not trustworthy placements — a
     repeat can paint on-page even when its recorded unit square is off-page.
     Their presence anywhere on the chosen page therefore vetoes the page. */
  if (here.some(({ paint }) => paint.op !== "xobject")) return refuse("unmeasured-image");

  /* Rule 3: the picture the box points into. */
  const pointedAt = here.filter(({ paint, visible }) => {
    if (!usableHere(paint.key) || !shows(visible)) return false;
    const inside = area(meet(visible, box));
    return inside >= INSIDE_SHARE * boxArea && inside >= MIN_COVER * area(visible);
  });
  const keys = new Set(pointedAt.map(({ paint }) => paint.key));
  if (keys.size !== 1) return refuse("not-one-picture");
  const key = pointedAt[0]?.paint.key as string;
  const picture = usableHere(key) as UsablePicture;

  /* Rule 4: nothing else showing in the box, bar a blank overlay. */
  const intruder = here.some(
    ({ paint, visible }) => paint.key !== key && !blankHere(paint.key) && area(meet(visible, box)) >= OTHER_SHARE * boxArea,
  );
  if (intruder) return refuse("not-one-picture");

  /* Rule 5. */
  const own = here.filter(({ paint }) => paint.key === key);
  if (own.length !== 1) return refuse("painted-twice");
  const only = own[0] as (typeof here)[number];
  if (!only.paint.appearanceExact) return refuse("unmeasured-image");

  /* Rule 6. */
  if (area(only.visible) > BACKGROUND_SHARE * area(view)) return refuse("background");
  const neighbour = here.some(
    ({ paint, visible }) =>
      paint.key !== key && !blankHere(paint.key) && shows(visible) && gap(visible, only.visible) < ASSEMBLY_GAP_PT,
  );
  if (neighbour) return refuse("assembly");

  /* Rule 7: a cut only where the page's print frame would make one. */
  if (!only.paint.clipExact || !cutOnlyNearEdge(meet(only.paint.box, view), only.visible, view)) return refuse("clipped");

  /* Rule 8. */
  if (input.taken.includes(picture.identity)) return refuse("already-taken");

  return { status: "chosen", page: sent.page, key, identity: picture.identity };
}

const EMPTY: PageBox = { x0: 0, y0: 0, x1: 0, y1: 0 };

/**
 * `box_2d` as page points. It runs from the top left of the image we rendered,
 * which is the page's view box — its own origin, not (0, 0) on a cropped page.
 */
function boxOnPage([ymin, xmin, ymax, xmax]: readonly [number, number, number, number], view: PageBox): PageBox {
  const w = view.x1 - view.x0;
  const h = view.y1 - view.y0;
  return {
    x0: view.x0 + (xmin / 1000) * w,
    x1: view.x0 + (xmax / 1000) * w,
    y0: view.y1 - (ymax / 1000) * h,
    y1: view.y1 - (ymin / 1000) * h,
  };
}

/**
 * **The answer's page and box, for the composite route** — read and checked
 * exactly as `judgeLocatedBox` reads them (rule 1), or `null`. The composite
 * route (`judgeLocatedRegion`, src/pdf-figure-region.ts) is asked only after
 * `judgeLocatedBox` refused for what was *in* the box, so a `null` here never
 * happens in practice; it is the same check, not a second one.
 */
export function answeredBox(answer: unknown, sent: readonly SentPage[]): { page: number; box: PageBox } | null {
  const read = readAnswer(answer);
  if (read === "unreadable" || read === "none") return null;
  const [ymin, xmin, ymax, xmax] = read.box;
  if (![ymin, xmin, ymax, xmax].every((n) => n >= 0 && n <= 1000) || ymin >= ymax || xmin >= xmax) return null;
  const page = sent.find((s) => s.page === read.page);
  return page ? { page: page.page, box: boxOnPage(read.box, page.view) } : null;
}

/**
 * The refusals that are about **what is in the box** rather than about the
 * answer or the picture — several pictures, a picture with neighbours, a
 * drawing with no picture at all. For these the box may still be right, and
 * the composite route is asked to render it. docs/plans/261001q § Stage 2.
 */
export const COMPOSITE_REFUSALS: ReadonlySet<LocateRefusal> = new Set<LocateRefusal>([
  "not-one-picture",
  "assembly",
  "unmeasured-image",
]);

/**
 * Whether every side on which `shown` is smaller than `onPage` is cut within
 * `PAGE_FRAME_PT` of the page's own edge on that side. One point of slack for
 * a side that is not cut at all.
 */
function cutOnlyNearEdge(onPage: PageBox, shown: PageBox, view: PageBox): boolean {
  const cut = (a: number, b: number) => Math.abs(a - b) > 1;
  if (cut(shown.x0, onPage.x0) && shown.x0 - view.x0 > PAGE_FRAME_PT) return false;
  if (cut(shown.y0, onPage.y0) && shown.y0 - view.y0 > PAGE_FRAME_PT) return false;
  if (cut(shown.x1, onPage.x1) && view.x1 - shown.x1 > PAGE_FRAME_PT) return false;
  if (cut(shown.y1, onPage.y1) && view.y1 - shown.y1 > PAGE_FRAME_PT) return false;
  return true;
}

/** The distance between two boxes, zero if they touch or overlap. */
function gap(a: PageBox, b: PageBox): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

type ReadAnswer = "unreadable" | "none" | { page: number; box: [number, number, number, number] };

function readAnswer(value: unknown): ReadAnswer {
  if (!value || typeof value !== "object") return "unreadable";
  const { page, box_2d: box } = value as { page?: unknown; box_2d?: unknown };
  if (page === null && box === null) return "none";
  if (typeof page !== "number" || !Number.isSafeInteger(page)) return "unreadable";
  if (!Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return "unreadable";
  }
  return { page, box: box as [number, number, number, number] };
}

function meet(a: PageBox, b: PageBox): PageBox {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

function area(b: PageBox): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}


/* ------------------------------------------------------------------ *
 * Asking
 * ------------------------------------------------------------------ */

/** One page as the model is shown it: its number, and the whole page rendered. */
export interface LocatePage {
  page: number;
  png: Uint8Array;
}

/**
 * **The model call, as the collector sees it** — injected, so every test runs
 * without one and `collectPdfFigures` cannot spend money unless its caller
 * handed it something that does. `{ ok: false }` is a call that did not come
 * back usable (refused, timed out, not configured); `answer` is the parsed
 * JSON, for `judgeLocatedBox` to doubt.
 */
export type FigureLocator = (
  request: { caption: string; pages: readonly LocatePage[] },
  signal: AbortSignal,
) => Promise<{ ok: true; answer: unknown } | { ok: false }>;

/** The answer's shape, enforced by the provider (`strict`) and checked again by `judgeLocatedBox`, which is the one that counts. */
export const LOCATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["page", "box_2d"],
  properties: {
    page: { type: ["integer", "null"] },
    box_2d: { type: ["array", "null"], items: { type: "integer" } },
  },
} as const;

/**
 * What the model is asked — the test run's wording, unchanged, because that is
 * what the 30 calls in the plan measured.
 *
 * The caption is the article's own figcaption, text a stranger chose. It can
 * ask for anything; what it can get is a page number and four integers, which
 * `judgeLocatedBox` holds to the pictures actually on the pages we sent.
 */
export function locatePrompt(caption: string, pages: readonly { page: number }[]): string {
  return (
    `These are ${pages.length} consecutive pages of a PDF: ` +
    `${pages.map((p, i) => `image ${i + 1} is page ${p.page}`).join(", ")}.\n` +
    `A figure in this document has this caption or title: "${caption}".\n` +
    "The caption may be printed beside the figure, or it may be a title drawn inside the picture itself.\n" +
    "Find the one figure it belongs to, on these pages. Give its page, and box_2d as [ymin, xmin, ymax, xmax] " +
    "normalised 0-1000 on that page's image, around the figure's picture only: include any title or labels drawn " +
    "inside the picture, exclude the prose around it and any separately printed caption. " +
    'If no figure on these pages has this caption or title, answer {"page": null, "box_2d": null}.'
  );
}

/** The real locator: `PDF_FIGURE_LOCATOR_MODEL` through the gateway, metered as `pdf-figure-locate`. */
export const openRouterFigureLocator: FigureLocator = async (request, signal) => {
  let json: unknown;
  try {
    const call = await openRouterJson(
      "pdf-figure-locate",
      {
        model: PDF_FIGURE_LOCATOR_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: locatePrompt(request.caption, request.pages) },
              ...request.pages.map((p) => ({
                type: "image_url",
                image_url: { url: `data:image/png;base64,${Buffer.from(p.png).toString("base64")}` },
              })),
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "figure_location", strict: true, schema: LOCATE_SCHEMA },
        },
      },
      { signal },
    );
    json = call.json;
  } catch {
    /* Refused, aborted, not configured: the figure keeps the answer it had.
       Nothing of the error is kept — it can carry the provider's words. */
    return { ok: false };
  }
  const content = (json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message
    ?.content;
  if (typeof content !== "string") return { ok: false };
  try {
    return { ok: true, answer: JSON.parse(content) };
  } catch {
    return { ok: true, answer: null };
  }
};
