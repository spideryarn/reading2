/**
 * A throwaway page for looking at the Sketch diagram in a browser.
 *
 * It mounts the **real** `SketchView` with the real stylesheet, inside a
 * `.reader .mode-band` so the band is the width it actually is — and it does it
 * outside the auth gate, because `/api/sketch/:slug` needs a session and a
 * browser agent has none. `fetch` is stubbed to serve one real scene off disk,
 * so `useSketch`, `readSketch` and `paintScene` are all the shipping code.
 *
 * Two widths side by side, because the whole open question about this picture
 * is whether it survives a narrow band: 288px is `MODE_MIN`, and 400px is
 * `MODE_IDEAL`, which is what a laptop actually gives it.
 *
 * Delete this file, preview-sketch.html and preview-sketch-fixture.json when
 * the check is done; nothing links to any of them.
 */
import { createRoot } from "react-dom/client";
import { SketchView } from "./SketchView.js";
import { MODE_IDEAL, MODE_MIN, SPINE_W } from "./layout.js";
import type { Block, BlockId } from "../types.js";
import fixture from "./preview-sketch-fixture.json";
import "./styles.css";
import "./tailwind.css";

const { sketch, blockIds } = fixture as { sketch: unknown; blockIds: string[] };

/** Only `id` is read by `SketchView` — `blocks.map(b => b.id)`. */
const BLOCKS = blockIds.map((id) => ({ id }) as Block);

/* The one stub. `useStepJob` also polls `/api/jobs`; an empty list keeps the
   panel out of its "a job is running" branch. */
const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/sketch/")) {
    return new Response(JSON.stringify({ sketch, stale: false, outdated: false, profileChanged: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/api/jobs")) {
    return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/profile")) {
    return new Response(JSON.stringify({ profile: null }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return real(input, init);
}) as typeof window.fetch;

/** A second slug, so the "nobody has drawn this one" state can be seen too. */
window.fetch = ((orig) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/sketch/never-drawn")) return new Response("{}", { status: 404 });
    return orig(input, init);
  }) as typeof window.fetch)(window.fetch);

/**
 * One band, at one width.
 *
 * **NOT inside a `.reader`**, which was the first version and was wrong in a way
 * worth writing down because it looked exactly like the component being broken:
 * `.reader` reserves the band's width as *padding*, because the real
 * `.mode-band` is `position: fixed` and sits over the top of it. An `aside`
 * nested in there and made `static` lands in the padded content box, which is
 * two pixels wide — so the picture rendered fourteen nodes into a 0×0 svg and
 * the empty state wrapped one word per line. Nothing in the console, nothing in
 * React, and a screenshot that reads as "the diagram does not draw".
 *
 * So the container here is a plain box the size the band actually gets, with
 * the two custom properties on it, and `.mode-band`'s own positioning turned
 * off. The tokens still matter: `styles.css § sketch` does not read them, but
 * the shell rules around it do.
 */
function Band({ width, slug, label }: { width: number; slug: string; label: string }) {
  return (
    <div>
      <p style={{ fontFamily: "var(--font-ui)", fontSize: "0.7rem", color: "var(--ink-faint)", margin: "0 0 0.3rem" }}>
        {label} — {width}px
      </p>
      <aside
        className="mode-band diag"
        style={
          {
            "--mode-w": `${width}px`,
            "--spine-w": `${SPINE_W}px`,
            position: "static",
            width,
            height: 860,
            display: "flex",
            flexDirection: "column",
            border: "1px dashed var(--rule)",
          } as React.CSSProperties
        }
      >
        <SketchView slug={slug} blocks={BLOCKS} atRow={40} onJump={(id: BlockId) => console.log("jump", id)} />
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <div style={{ display: "flex", gap: "1.5rem", padding: "1rem", alignItems: "flex-start", background: "var(--page)" }}>
    <Band width={MODE_MIN} slug="noema" label="narrowest the band gets" />
    <Band width={MODE_IDEAL} slug="noema" label="what a laptop gives it" />
    <Band width={MODE_IDEAL} slug="never-drawn" label="nobody has drawn one" />
  </div>,
);
