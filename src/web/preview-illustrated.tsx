/**
 * A throwaway page for checking the Illustrated full-screen overlay's new
 * text column in a real browser — SPIDERYARN-READING2-1P.
 *
 * jsdom has no CSS, so the unit tests that cover `IllustratedView.tsx`'s
 * markup cannot tell you whether `.ill-aside` actually sits beside
 * `.ill-in-full` at 1080px and above, or that it disappears below it. This
 * page mounts the **real** `IllustratedView` with the real stylesheet, with
 * `window.fetch` stubbed to serve one fake plate — so `useIllustrated`,
 * `readStoredIllustrated` and the CSS in `styles.css § the brief, as a column
 * beside the plate` are all the shipping code.
 *
 * Unlike preview-sketch.tsx, this is **not** rendered inside a narrow
 * `.mode-band`: the thing under test is the `<dialog class="ill-full">`
 * overlay, which is `position: fixed` at the top layer and sized off the
 * viewport regardless of what DOM box it was opened from. So the component is
 * mounted in a plain, full-width container and the overlay is opened by
 * pressing the real `.ill-zoom` "Enlarge" button, exactly as a reader would.
 *
 * Delete this file and preview/preview-illustrated.html when the check is done;
 * nothing links to either.
 */
import { createRoot } from "react-dom/client";
import { IllustratedView } from "./IllustratedView.js";
import type { Block, BlockId } from "../types.js";
import "./tailwind.css";

const SLUG = "preview-illustrated";

/** A verbatim sentence the vignette's quote is a contiguous run of, so
    `findQuote(text, quote, undefined, "spaced")` in `illustrated-plate.ts`
    matches it exactly rather than by the forgiving pass. */
const BLOCK_TEXT =
  "The committee's first attempt to reorganize the archive nearly buried itself " +
  "under its own good intentions, producing three competing indexes that agreed " +
  "with each other only by accident, and nobody had the nerve to say which one " +
  "was actually in charge.";

const BLOCKS: Block[] = [
  { id: "spya-a1b2c3" as BlockId, text: BLOCK_TEXT } as Block,
];

/** About 330 words, the length `plate.prompt` actually runs to in a measured
    run — see IllustratedView.tsx § "The brief, reachable rather than in the
    way": "200–500 words". */
const PROMPT =
  "Paint this as a single illuminated page, the kind found bound into a monastic " +
  "herbal, drawn in iron-gall ink over a ground of aged vellum and finished with a " +
  "wash of verdigris and ochre. At the centre of the page stands a tall wooden " +
  "cabinet with three drawers pulled halfway open, and from each drawer spills a " +
  "different ribbon of paper, tangled together at the cabinet's foot like roots " +
  "grown too large for their pot. Above the cabinet, in the upper third of the " +
  "composition, three robed figures lean over separate lecterns, each copying " +
  "from the same open book but writing in a different script — one in a rounded " +
  "uncial, one in a narrow cursive, one in a blocky capital hand — so that the " +
  "three ribbons of paper below can be read as the record of their disagreement " +
  "made visible. A fourth figure, smaller and set slightly apart in the lower " +
  "right corner, kneels and gathers the tangled ribbons into a single spool, her " +
  "expression patient rather than triumphant, as though she has done this before " +
  "and expects to do it again. The margins carry the illustrator's usual " +
  "marginalia: a border of interlocking vines in which small birds perch, one " +
  "holding a torn scrap of paper in its beak as if it, too, has an opinion about " +
  "which index is correct. Colour throughout stays within a narrow, warm " +
  "register: ochre, verdigris, a muted red made from madder root, and the " +
  "iron-gall brown of the ink itself, with gold leaf reserved only for the spool " +
  "in the fourth figure's hands, so the eye is drawn there last rather than " +
  "first. No modern lettering appears anywhere; where words are needed they are " +
  "rendered as illegible manuscript hand rather than as legible captions, so the " +
  "picture reads as an artefact rather than a diagram with words bolted onto it.";

/**
 * A real, valid, solid-ochre PNG, 400×600 — a 2:3 portrait, generated to
 * actually BE that size rather than a 1×1 pixel with width/height attributes
 * lying about it. `.ill-plate` in styles.css sets `width: auto; height: auto`,
 * so the `<img>` lays out at its own natural pixel size and a 1×1 source
 * renders as a few CSS pixels however the `width`/`height` attributes read —
 * found the hard way, checking this very page, when the plate column was a
 * blank strip in the first screenshot taken of it.
 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAZAAAAJYCAIAAADDjiffAAAHv0lEQVR4nO3UQQ0AIBDAsNOHNBQhDwv8yJImFbDX5uwFkDDfCwAeGRaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWEDGBWIchveuM5E6AAAAAElFTkSuQmCC";

/** Decoded once at module load, not per-request — the bytes never change. */
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));

/** A real sha256 (of an arbitrary fixture string), not a made-up hex blob —
    `readImage` in illustrated-plate.ts checks it against /^[0-9a-f]{64}$/. */
const SHA256 = "d636a17b302dc9e8b622036a62edc095d79186db8c92864f2b89e17c18857637";
const EXT = "png";

const ILLUSTRATED_RAW = {
  version: "illustrated/3",
  style: "Rendered as a hand-inked antiquarian plate, muted ochre and verdigris, gold leaf reserved for one detail.",
  plates: [
    {
      sceneId: "scene-overview",
      title: "The Argument, Whole",
      prompt: PROMPT,
      vignettes: [
        {
          block: "spya-a1b2c3",
          quote:
            "three competing indexes that agreed with each other only by accident",
          depicts:
            "A tall cabinet with three drawers spilling tangled ribbons of paper, three scribes copying the same book in three different hands above it.",
        },
      ],
      image: { sha256: SHA256, ext: EXT, bytes: PNG_BYTES.length, width: 400, height: 600 },
    },
  ],
};

/* The one stub, in the same shape preview-sketch.tsx uses. The plate-bytes
   route is checked before the general artefact route, because both contain
   `/api/illustrated/`. */
const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (url.includes(`/api/illustrated/${SLUG}/${SHA256}.${EXT}`)) {
    return new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } });
  }
  if (url.includes(`/api/illustrated/${SLUG}`)) {
    return new Response(
      JSON.stringify({ illustrated: ILLUSTRATED_RAW, stale: false, outdated: false, profileChanged: false }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.includes(`/api/sketch/${SLUG}`)) {
    return new Response(
      JSON.stringify({ sketch: { scenes: [] }, stale: false, outdated: false, profileChanged: false }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.includes("/api/jobs")) {
    return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/profile")) {
    return new Response(JSON.stringify({ profile: null }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return real(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root") as HTMLElement).render(
  <div style={{ width: "100%", minHeight: "100vh", background: "var(--page)", padding: "1rem" }}>
    <p style={{ fontFamily: "var(--font-ui)", fontSize: "0.75rem", color: "var(--ink-faint)" }}>
      Press Enlarge to open the full-screen overlay this page exists to check.
    </p>
    <div style={{ width: 400, border: "1px dashed var(--rule)" }}>
      <IllustratedView
        slug={SLUG}
        blocks={BLOCKS}
        onJump={(id: BlockId) => console.log("jump", id)}
      />
    </div>
  </div>,
);
