/**
 * `/design` — every primitive this app has, on one page, against the real ground.
 *
 * Borrowed from the original app, which had `app/design/page.tsx` doing the
 * same job in 378 lines. Their doc's verdict was *"worth copying, cheaply"*
 * (docs/project/original-version/design-system.md § The live design reference
 * page), and Greg agreed on 2026-08-25.
 *
 * ## What it is for
 *
 * It catches the one class of regression tests cannot see: a token changes,
 * every component still renders, nothing throws, and one variant nobody
 * happened to look at is now unreadable. That failure mode is real here — three
 * shadcn components and ~1,800 lines of hand-written CSS all hang off a single
 * token file — and it has already happened twice, both times recorded in
 * web-client.md: the focus ring that went to 1.84:1 contrast, and the toggle
 * whose ON state lost its orange to a `background-color: transparent` in the
 * wrong layer. Both were invisible until someone looked at the real page.
 *
 * So the rule for this file is: **render the thing, do not describe it.** A
 * swatch is a real div with the real variable on it. A button is the real
 * component. Nothing here may hard-code a colour or a font — if it did, it
 * would keep looking right after the token that feeds it broke, which is the
 * exact failure it exists to catch.
 *
 * ## What it deliberately is not
 *
 * Not a component gallery with props tables, not a Storybook, and above all not
 * the original app's `logoplay/` — 2,807 lines and 1,911 lines of CSS for
 * fifteen hover animations on a wordmark, in a repo whose mobile layout was
 * never finished. That is the cautionary tale this file sits next to.
 *
 * ## Reading it
 *
 * Do not judge colour from a screenshot (docs/project/browser-testing.md).
 * Contrast figures below are computed in the browser from the *resolved*
 * values, which is the only way to check them that cannot lie about what the
 * cascade actually produced.
 */
import { useEffect, useState } from "react";
import { Circle, LoaderCircle, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Link } from "./Link.js";
import { PILL } from "./pill.js";
import { LIBRARY_HREF } from "./router.js";

/** Every colour token, in the groups they are reasoned about in. */
const SWATCHES: { group: string; names: string[] }[] = [
  {
    group: "Reading surface",
    names: ["--page", "--panel", "--surface-raised", "--muted", "--rule", "--rule-strong"],
  },
  { group: "Ink", names: ["--ink", "--ink-soft", "--ink-faint"] },
  {
    group: "The orange",
    names: ["--highlight", "--highlight-ink", "--highlight-wash"],
  },
  {
    group: "shadcn surfaces (CAREFUL: --accent is a surface, not the orange)",
    names: ["--background", "--card", "--popover", "--secondary", "--accent", "--border", "--input"],
  },
  { group: "States", names: ["--ring", "--destructive", "--primary", "--primary-foreground"] },
];

/** The four type stacks, and what each is allowed to be used for. */
const FACES: { token: string; used: string }[] = [
  { token: "--font-reading", used: "the article, and the reader's own words in a comment" },
  { token: "--font-ui", used: "chrome: controls, masthead facts, column headers" },
  { token: "--font-mono", used: "counts and anything that wants to line up" },
  { token: "--font-id", used: "block ids, and only block ids" },
  { token: "--font-brand", used: "the wordmark, and only the wordmark" },
];

/**
 * Resolve every colour token to an sRGB triple, and measure the contrast.
 *
 * Two browser facts make this fiddlier than it looks, and getting either wrong
 * produces a page that renders perfectly and reports nothing — which is worse
 * than reporting a wrong number, because an empty column reads as "no problems
 * here".
 *
 * 1. `getComputedStyle(el).getPropertyValue('--x')` returns the *declared*
 *    text: `var(--background)`, or `oklch(0.145 0 0)`. It does not resolve the
 *    variable and it does not convert. Painting the value onto a real element
 *    and reading `color` back is what forces the resolution.
 *
 * 2. **The resolved value is still not rgb.** Chrome serializes a computed
 *    colour in the colour space it was authored in, so `--page` comes back as
 *    the string `"oklch(0.145 0 0)"`. Every token in this app is authored in
 *    OKLCH, so a naive `rgba?\(…\)` regex matches *none* of them and every
 *    ratio comes out null. The first version of this file did exactly that.
 *
 * A 1x1 canvas is the fix and it is the honest one: `fillStyle` runs the
 * browser's own colour parser, and `getImageData` hands back the sRGB bytes the
 * screen is actually painting — including the gamut clamping the screen does,
 * which a hand-written OKLCH-to-sRGB conversion would have to reimplement and
 * could disagree with.
 */
type Rgb = [number, number, number];

function measure(names: string[]): Record<string, { css: string; rgb: Rgb | null }> {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  // `willReadFrequently` because this reads back once per token.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const out: Record<string, { css: string; rgb: Rgb | null }> = {};
  for (const n of names) {
    probe.style.color = "";
    probe.style.color = `var(${n})`;
    const css = getComputedStyle(probe).color;
    let rgb: Rgb | null = null;
    if (ctx) {
      // A fillStyle the parser rejects is silently IGNORED — it keeps its
      // previous value rather than throwing — so the canvas is cleared first
      // and an unparseable colour shows up as fully transparent rather than as
      // whatever the last token happened to be.
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] !== undefined && d[3] > 0) rgb = [d[0] as number, d[1] as number, d[2] as number];
    }
    out[n] = { css, rgb };
  }
  probe.remove();
  return out;
}

/** WCAG relative luminance, from sRGB bytes. */
function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function ratio(a: Rgb | null, b: Rgb | null): number | null {
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function useMeasured(names: string[]): Record<string, { css: string; rgb: Rgb | null }> {
  const [map, setMap] = useState<Record<string, { css: string; rgb: Rgb | null }>>({});
  useEffect(() => {
    setMap(measure(names));
  }, [names]);
  return map;
}

const ALL_COLOUR_TOKENS = SWATCHES.flatMap((s) => s.names);

export function DesignPage() {
  const measured = useMeasured(ALL_COLOUR_TOKENS);
  const page = measured["--page"]?.rgb ?? null;

  return (
    <main className="design">
      <header className="design-head">
        <h1>Design reference</h1>
        <p>
          Every primitive, on the real ground, with the real tokens. If something here looks wrong,
          it is wrong everywhere. <Link href={LIBRARY_HREF}>Back to the shelf</Link>.
        </p>
      </header>

      {/* ---- type ------------------------------------------------------- */}
      <section>
        <h2>The reading column</h2>
        <p className="design-note">
          One face for the article and the chrome alike — Geist, self-hosted. Hierarchy is size and
          weight only. If the heading below is not visibly the same face as the paragraph, the
          woff2 failed to load and everything has fallen through to the system stack.
        </p>
        <div className="design-panel">
          <div className="prose">
            <h2>How markets learn, and how slowly</h2>
            <p>
              The first thing to notice is that prices already contain most of what anyone knows,
              which is why the interesting question is never <em>what does the market think</em> but{" "}
              <strong>how long did it take to think it</strong>. A quotation reads differently:
            </p>
            <blockquote>
              The market can remain irrational longer than you can remain solvent — and the second
              half of that sentence is the part people forget.
            </blockquote>
            <p>
              Inline <code>code</code> sits inside the paragraph without changing its leading. A
              link to <a href="https://example.com">somewhere else</a> is orange and underlined.
            </p>
            <pre>
              <code>{`// wide enough to need its own scrollbar rather than the page's
const veryLongIdentifierName = computeSomethingExpensive(withArgument, andAnother, andAThird);`}</code>
            </pre>
            <figure>
              <figcaption>
                A caption is set to a shorter measure than the body, so it reads as belonging to the
                figure rather than as more prose that happens to sit beneath it.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section>
        <h2>Faces</h2>
        <table className="design-table">
          <tbody>
            {FACES.map((f) => (
              <tr key={f.token}>
                <td>
                  <code className="design-token">{f.token}</code>
                </td>
                <td style={{ fontFamily: `var(${f.token})`, fontSize: "1.0625rem" }}>
                  Hamburgefonstiv 0123
                </td>
                <td className="design-note">{f.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Weight axis</h2>
        <p className="design-note">
          Geist is variable, so these are real weights rather than the browser faking two of them.
          Body copy sits at 450, not 400 — light text on a dark ground optically thins.
        </p>
        <div className="design-panel">
          {[300, 400, 450, 500, 600, 700, 800].map((w) => (
            <p
              key={w}
              style={{
                fontFamily: "var(--font-reading)",
                fontSize: "1.0625rem",
                fontWeight: w,
                margin: "0 0 0.3rem",
              }}
            >
              {w} — the market can remain irrational longer than you can remain solvent
            </p>
          ))}
        </div>
      </section>

      {/* ---- colour ----------------------------------------------------- */}
      <section>
        <h2>Colour</h2>
        <p className="design-note">
          Ratios are measured against <code className="design-token">--page</code> in this browser,
          through a 1×1 canvas — the browser's own parser on the browser's own sRGB output, so these
          describe what the cascade actually produced rather than what a token file says. AAA for
          extended reading is 7:1; AA is 4.5:1; a focus indicator needs 3:1. The string under each
          name is the raw computed value: it will read <code className="design-token">oklch(…)</code>,
          because that is how these are authored and how Chrome serializes them.
        </p>
        {SWATCHES.map((group) => (
          <div key={group.group}>
            <h3>{group.group}</h3>
            <div className="design-swatches">
              {group.names.map((name) => {
                const m = measured[name];
                const r = ratio(m?.rgb ?? null, page);
                return (
                  <div key={name} className="design-swatch">
                    <div className="design-chip" style={{ background: `var(${name})` }} />
                    <code className="design-token">{name}</code>
                    <span className="design-note">{m ? m.css : "measuring…"}</span>
                    {/* Never silently blank: a token that could not be measured
                        says so, because an empty cell reads as "fine". */}
                    <span className="design-note">
                      {r === null
                        ? m
                          ? "did not resolve"
                          : ""
                        : `${r.toFixed(2)}:1 on --page`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* ---- components ------------------------------------------------- */}
      <section>
        <h2>Buttons</h2>
        <p className="design-note">
          Every variant and size shadcn generated, including the ones nothing in the app uses yet —
          those are precisely the ones a token change breaks unseen.
        </p>
        <div className="design-row">
          {(["default", "secondary", "outline", "ghost", "link", "destructive"] as const).map(
            (v) => (
              <Button key={v} variant={v}>
                {v}
              </Button>
            ),
          )}
        </div>
        <div className="design-row">
          {(["sm", "default", "lg"] as const).map((s) => (
            <Button key={s} size={s}>
              size {s}
            </Button>
          ))}
          <Button size="icon" aria-label="settings">
            <Settings />
          </Button>
          <Button disabled>disabled</Button>
        </div>
      </section>

      <section>
        <h2>Toggles</h2>
        <p className="design-note">
          <strong>Top row: shadcn's Toggle as generated.</strong> Its ON state is{" "}
          <code className="design-token">bg-accent</code>, and in this palette{" "}
          <code className="design-token">--accent</code> is a raised dark <em>surface</em>, not the
          brand orange — so ON is dark grey on a near-black page. Not an error, not visibly broken,
          just the signal quietly gone. That is what it is supposed to look like here, and it is why
          nothing in the app uses the bare component.
        </p>
        <div className="design-row">
          <Toggle>off</Toggle>
          <Toggle defaultPressed>on — grey, as generated</Toggle>
          <Toggle disabled>disabled</Toggle>
        </div>
        <p className="design-note">
          <strong>Bottom row: the granularity pills</strong>, which is the toggle this app actually
          renders — the same component with <code className="design-token">PILL</code> over it
          (imported from <code className="design-token">pill.ts</code>, not restated here).{" "}
          <strong>These must be orange when ON.</strong> They were not, for a while: a preflight
          rule in the wrong layer beat them with{" "}
          <code className="design-token">background-color: transparent</code>, the class was on the
          element, twMerge had resolved it correctly, and it was simply outranked. Press one.
        </p>
        <div className="design-row">
          <Toggle className={PILL}>off</Toggle>
          <Toggle className={PILL} defaultPressed>
            on — orange
          </Toggle>
          <Toggle className={PILL} disabled>
            disabled
          </Toggle>
        </div>
      </section>

      <section>
        <h2>Focus</h2>
        <p className="design-note">
          Tab through this row. The ring is the app's orange at 7.3:1, not shadcn's grey at 1.84:1,
          and it is drawn at full opacity — at half even this orange measures 2.6:1.
        </p>
        <div className="design-row">
          <Button variant="outline">first</Button>
          <Toggle className={PILL}>second</Toggle>
          <a className="block-ref" href="#top">
            spya-k3m9qt
          </a>
        </div>
      </section>

      <section>
        <h2>Icons and the spinner</h2>
        <p className="design-note">
          Lucide at stroke 1.75. The scale is 10 / 13 / 14 / 16 / 20 — sized at the call site, never
          in CSS. <code className="design-token">LoaderCircle</code>, not{" "}
          <code className="design-token">Loader2</code>: one open arc, still legible at 10px.
        </p>
        <div className="design-row design-icons">
          {[10, 13, 14, 16, 20].map((n) => (
            <span key={n} className="design-icon-cell">
              <Search size={n} strokeWidth={1.75} />
              <Circle size={n} strokeWidth={1.75} />
              <LoaderCircle className="cmt-spinner" size={n} />
              <em className="design-note">{n}px</em>
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2>Vertical rhythm</h2>
        <p className="design-note">
          One unit is 17px × 1.4 ≈ 23.8px. One unit between paragraphs; one and a half above a
          heading, three quarters below it — a heading belongs to what follows it.
        </p>
        <div className="design-panel design-rhythm">
          <p>The paragraph that ends the previous section.</p>
          <h3>A heading, which should sit closer to the text below than above</h3>
          <p>The paragraph the heading introduces.</p>
          <p>And a second one, one unit further down.</p>
        </div>
      </section>
    </main>
  );
}
