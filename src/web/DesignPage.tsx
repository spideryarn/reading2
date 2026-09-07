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
import type { ReactNode } from "react";
import { Circle, LoaderCircle, Search, Settings, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { builtButEmpty, providerHttpFailure, UNEXPECTED_FAILURE } from "../messages.js";
import { JobProgress } from "./JobProgress.js";
/* Type-only, and deliberately so: it is erased at build, so `/design` does not
   pull the eagerly-loaded annotator into its lazy chunk — see `SPECIMEN_OUT`. */
import type { Mark } from "./annotate.js";
import type { Job } from "../types.js";

/**
 * Two jobs that never run, so the running states can be looked at.
 *
 * `queued` and `running` differ by one field and read completely differently —
 * "Waiting for the queue…" against the step's own live label — which is the
 * kind of thing you only notice side by side.
 */
/**
 * Four jobs that are never real, so the states nobody can screenshot can be
 * looked at.
 *
 * **The dates are relative to now**, which is what makes the elapsed times
 * mean anything: `displayJob` (src/job-state.ts) works out *taking longer than
 * usual* from the running step's own clock, so a fixed timestamp would drift
 * from "2m 14s" into "eleven months" the week after it was written.
 */
const DESIGN_JOB = {
  queued: {
    id: "design-1",
    slug: "example",
    status: "queued",
    steps: [{ name: "glossary", status: "queued" }],
  },
  running: {
    id: "design-2",
    slug: "example",
    status: "running",
    steps: [
      {
        name: "glossary",
        status: "running",
        label: "Reading the article",
        detail: "batch 2 of 5",
        startedAt: new Date(Date.now() - 134_000).toISOString(),
      },
    ],
  },
  /* Past what any recorded run of this step has taken. Twenty minutes rather
     than a number just over the threshold, so the row reads the same however
     long this page is left open. */
  slow: {
    id: "design-3",
    slug: "example",
    status: "running",
    steps: [
      {
        name: "glossary",
        status: "running",
        label: "Reading the article",
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      },
    ],
  },
  stopping: {
    id: "design-4",
    slug: "example",
    status: "running",
    cancelling: true,
    steps: [
      {
        name: "glossary",
        status: "running",
        label: "Reading the article",
        startedAt: new Date(Date.now() - 42_000).toISOString(),
      },
    ],
  },
  /* **The other half of slow**, and the pair is the point. `glossary` above has
     never been timed, so past its guessed threshold it says only *this has been
     running for a while*. `sketch` has been — thirteen runs, 121–199s — so it
     both promises a duration while it runs and is allowed to call this one
     unusual. src/job-state.ts § `STEP_TIMING`. */
  slowMeasured: {
    id: "design-6",
    slug: "example",
    status: "running",
    steps: [
      {
        name: "sketch",
        status: "running",
        label: "Drawing the argument",
        startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      },
    ],
  },
  /* **Somebody else's job holding the article** was a seventh example here
     until 2026-09-02, drawn beside the button that had just been refused. A
     second, different job on one article is queued rather than refused now
     (docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
     § 1g), so it shows in this band's own `running` or `queued` shape and there
     is no second band to draw. */
} as unknown as {
  queued: Job;
  running: Job;
  slow: Job;
  slowMeasured: Job;
  stopping: Job;
};

import { Toggle } from "@/components/ui/toggle";
import { Link } from "./Link.js";
import { PILL } from "./pill.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { LIBRARY_HREF } from "./router.js";

/**
 * The real run button, with only the state under test varying.
 *
 * Every band below draws `JobProgress` itself rather than something shaped like
 * it, so a change to that component shows up here — but the eleven props it
 * takes would otherwise be eleven lines per band and the one that differs would
 * be lost in them. Everything not named here is the inert version of itself:
 * the callbacks do nothing because there is no queue behind this page.
 */
function RunButton({ label, job = null }: { label: string; job?: Job | null }) {
  return (
    <JobProgress
      job={job}
      failed={null}
      stalled={false}
      onRun={async () => {}}
      onCancel={() => {}}
      label={label}
      step="glossary"
      icon={<Search size={13} />}
      runningLabel="Finding…"
    />
  );
}

/**
 * One state of the shared band, drawn in a band the app's own width.
 *
 * **`.mode-band` is `position: fixed` and stays that way**, which is the whole
 * difficulty and the whole point. Giving it `position: static` for this page —
 * which is what `preview-chat-markdown.tsx` does, and reasonably, since it is a
 * throwaway checking one scroller — would mean the band's height, its
 * `min-height: 0` and the `flex: 1` on its scroller all stop applying, and the
 * page would be showing a shape the app never draws. So `.design-band` becomes
 * a **containing block for fixed descendants** instead (CSS containment;
 * design-page.css says how), and every declaration in `.mode-band` resolves
 * exactly as it ships.
 *
 * `--mode-w` is set there too, and in px rather than `rem`, because px is the
 * unit the band's width is arithmetic in — shell.css § `--spine-w` for what
 * happens when a rail is stated in `rem` against a number in px.
 */
function BandCase({
  state,
  real,
  note,
  head,
  children,
}: {
  /** The name a reader of this page would use. */
  state: string;
  /** The name the code uses, which is not always the same one. */
  real: string;
  note: string;
  /**
   * What sits in `.band-head`. Absent for the states with nothing to say there
   * — which is faithful: the panels render the row unconditionally and its
   * children conditionally, so an empty head with its own rule under it is what
   * a reader actually sees while a band is loading.
   */
  head?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="design-band-case">
      <figcaption>
        {state} · <code className="design-token">{real}</code>
      </figcaption>
      <div className="design-band">
        <aside className="mode-band gloss" aria-label={state}>
          <div className="band-head">{head}</div>
          {children}
        </aside>
      </div>
      <p className="design-note">{note}</p>
    </figure>
  );
}

/** Every colour token, in the groups they are reasoned about in. */
const SWATCHES: { group: string; names: string[] }[] = [
  {
    group: "Reading surface",
    names: ["--page", "--panel", "--surface-raised", "--muted", "--rule", "--rule-strong"],
  },
  { group: "Ink", names: ["--ink", "--ink-soft", "--ink-faint"] },
  {
    /* The one deliberately LIGHT surface in a dark-only app, and the one whose
       contrast figure is meaningless as printed: the ratio measured beside it is
       against our ink, and nothing of ours is ever drawn on it. What sits there
       is a stranger's picture, whose ink we do not choose and cannot see (the
       images are cross-origin, so a canvas drawn from one is tainted). It is on
       this page because a token nobody can look at is a token that drifts —
       design-css-overview.md § the light sheet under a figure. */
    group: "The sheet an article's figures are printed on",
    names: ["--figure-sheet"],
  },
  {
    group: "The orange",
    names: ["--highlight", "--highlight-ink", "--highlight-wash"],
  },
  {
    group: "shadcn surfaces (CAREFUL: --accent is a surface, not the orange)",
    names: ["--background", "--card", "--popover", "--secondary", "--accent", "--border", "--input"],
  },
  { group: "States", names: ["--ring", "--destructive", "--primary", "--primary-foreground"] },
  {
    group: "The search mark (the wash is a slate; the colour is in the rules)",
    /* `--hit-wash`, not `--hit-wash-rgb`. The `-rgb` form is three numbers, and
       this page paints its swatches with `background: var(...)` — which for a
       bare triplet is an invalid declaration that silently keeps the previous
       colour, so the chip lies and the contrast figure beside it measures
       something else. The one page whose whole job is catching that kind of
       thing should not be the page doing it. */
    names: ["--hit", "--hit-wash"],
  },
];

/**
 * The three colour scales — docs/project/colour-scales.md.
 *
 * On this page rather than only in a stylesheet because **a colour scale cannot
 * be reviewed one value at a time.** What is wrong with a ramp is always a
 * relationship: two steps that look the same, a lightness that stops climbing,
 * a middle that is louder than its ends. Every one of those is invisible in a
 * list of hex codes and obvious in a row of chips against the real ground —
 * which is also why browser-testing.md says not to judge colour from a
 * screenshot.
 *
 * Names rather than values, so the page can only ever show what the stylesheet
 * actually defines. A scale rendered from a copy of the numbers is a scale that
 * can quietly disagree with the one the app is using, which would make this
 * section worse than not having it.
 */
const SCALES: { name: string; tokens: string[]; note: string }[] = [
  {
    name: "Categorical — one per saved search",
    tokens: ["--cat-0", "--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7"],
    note:
      "Okabe–Ito, with three colours lifted for a black page and its black replaced by a light " +
      "neutral. Look for two that you cannot tell apart at this size — the marks in the prose are " +
      "2px rules, which is smaller than these chips, and small-field colour discrimination is the " +
      "worst case for any palette.",
  },
  {
    name: "Sequential — inferno, dark to hot",
    tokens: [
      "--heat-0", "--heat-1", "--heat-2", "--heat-3",
      "--heat-4", "--heat-5", "--heat-6", "--heat-7", "--heat-8",
    ],
    note:
      "The property to check is monotonic lightness: every step lighter than the one before, no " +
      "bright band in the middle. Squint, or take a greyscale screenshot — if the order survives " +
      "losing the colour, the ramp is doing its job. The first two stops are darker than the page " +
      "and are not to be painted on it.",
  },
  {
    name: "Diverging — blue to red, dark middle",
    tokens: [
      "--div-0", "--div-1", "--div-2", "--div-3",
      "--div-4", "--div-5", "--div-6", "--div-7", "--div-8",
    ],
    note:
      "The middle is the quietest step, not the loudest — which is the one change from every " +
      "published diverging scale, all of which pivot on white because they were drawn for paper. " +
      "Lightness should climb toward both ends.",
  },
  {
    name: "Diverging — red to green (use the one above instead)",
    tokens: [
      "--div-rg-0", "--div-rg-1", "--div-rg-2", "--div-rg-3",
      "--div-rg-4", "--div-rg-5", "--div-rg-6", "--div-rg-7", "--div-rg-8",
    ],
    note:
      "Here because it is what people ask for. Red–green confusion is what colour blindness " +
      "overwhelmingly is, so to a deuteranope this is a scale that gets darker in the middle and " +
      "says nothing about which side you are on. Only use it where something other than the hue " +
      "already tells the reader which end is which.",
  },
];

/** The four type stacks, and what each is allowed to be used for. */
const FACES: { token: string; used: string }[] = [
  { token: "--font-reading", used: "the article, and the reader's own words in a comment" },
  /* The table's column headers wore this until 2026-09-05, when that row lost
     its height and its labels became `.sr-only` spans — it is still in the DOM
     for the fisheye panels' geometry and for a screen reader, and sets no type
     at all now. docs/project/granularity-zoom.md § the header row. */
  { token: "--font-ui", used: "chrome: controls, masthead facts" },
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
  useDocumentTitle(pageTitle({ kind: "design" }));

  const measured = useMeasured(ALL_COLOUR_TOKENS);
  const page = measured["--page"]?.rgb ?? null;

  /**
   * The page at a reader's larger default font size.
   *
   * **On `<html>`, because there is nowhere else to put it.** `rem` is
   * root-relative by definition, so a subtree cannot be given a root of its own
   * and a `font-size` on a wrapper would move the `em`s and leave every `rem`
   * where it was — which is to say it would move almost nothing here and look
   * like a working control. The whole document moves instead, which is exactly
   * what a reader who sets 20px in their browser gets.
   *
   * What it is for: **`rem` grows and `px` does not**, and this app mixes them
   * on purpose in places where the pixel is the honest unit (shell.css §
   * `--spine-w`, the gutter's `max()` against WCAG's 24px). Anywhere a height
   * in one meets a height in the other, the agreement recorded in
   * design-css-overview.md § Controls is an agreement at a 16px root only.
   *
   * Restored on unmount, or leaving `/design` would leave the whole app at
   * 20px with nothing on screen to say why.
   */
  const [bigRoot, setBigRoot] = useState(false);
  useEffect(() => {
    if (!bigRoot) return;
    const html = document.documentElement;
    const was = html.style.fontSize;
    html.style.fontSize = "20px";
    return () => {
      html.style.fontSize = was;
    };
  }, [bigRoot]);

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
          {/* `design-sample` restates the row padding the reading view gets from
              its table, off the same --block-pad. Without it these blocks touch —
              see styles.css § THE SAMPLE ARTICLE HAS NO TABLE UNDER IT. */}
          <div className="prose design-sample">
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
                    {/* The colour goes on a CHILD of the chequerboard, not on
                        it: `background` is a shorthand and would reset the
                        board's background-image to none. styles.css explains. */}
                    <div className="design-chip">
                      <div className="design-chip-fill" style={{ background: `var(${name})` }} />
                    </div>
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

      {/* ---- the scales ------------------------------------------------- */}
      <section>
        <h2>Colour scales</h2>
        <p className="design-note">
          The three palettes that are not the brand — see{" "}
          <code className="design-token">docs/project/colour-scales.md</code>. No contrast ratios
          here, deliberately: none of these is ever text, and a ratio against{" "}
          <code className="design-token">--page</code> would be a number that looks like a verdict
          on a question nobody asked. What these are reviewed for is whether the steps are
          distinguishable from each other, which is a thing only an eye can answer.
        </p>
        {SCALES.map((scale) => (
          <div key={scale.name}>
            <h3>{scale.name}</h3>
            <p className="design-note">{scale.note}</p>
            <div className="design-scale">
              {scale.tokens.map((token) => (
                <div key={token} className="design-scale-step">
                  <div className="design-scale-chip" style={{ background: `var(${token})` }} />
                  <code className="design-token">{token.replace("--", "")}</code>
                </div>
              ))}
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
        <h2>Job progress</h2>
        <p className="design-note">
          One component — <code className="design-token">JobProgress</code> — shared by the
          glossary, the summaries and the thread. It was three private copies until 2026-08-26, two
          of them drawn with hand-written CSS that differed from each other only in two paddings and
          two colours. Every state is here because most of them only appear while a model call is in
          flight, which is exactly when nobody is looking at this page. Which state a job is in is
          decided once, in <code className="design-token">src/job-state.ts</code>, and the add card
          on the shelf reads the same answer.
        </p>
        <div className="design-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <JobProgress
            job={null}
            failed={null}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          <JobProgress
            job={DESIGN_JOB.queued}
            failed={null}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          <JobProgress
            job={DESIGN_JOB.running}
            failed={null}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          <JobProgress
            job={DESIGN_JOB.slow}
            failed={null}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          <JobProgress
            job={DESIGN_JOB.slowMeasured}
            failed={null}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Draw the argument"
            step="sketch"
            icon={<Search size={13} />}
            runningLabel="Drawing…"
          />
          <JobProgress
            job={DESIGN_JOB.running}
            failed={null}
            stalled
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          <JobProgress
            job={DESIGN_JOB.stopping}
            failed={null}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          {/* **The two failures, and they draw different buttons.** Out of
              credit is `ours`: another go makes the identical call, so there is
              no button under it at all and the sentence stands alone — the
              shelf card's rule, applied here since 2026-09-03. Busy is `retry`,
              so it gets the Retry the shelf has always had. `retry` is a real
              function on both because `retryable` is what decides, not whether
              a callback exists. */}
          <JobProgress
            job={null}
            failed={{
              message: providerHttpFailure(402).message,
              retryable: false,
              retry: () => {},
            }}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
          <JobProgress
            job={null}
            failed={{
              message: providerHttpFailure(429).message,
              retryable: true,
              retry: () => {},
            }}
            stalled={false}
            onRun={async () => {}}
            onCancel={() => {}}
            label="Find the terms"
            step="glossary"
            icon={<Search size={13} />}
            runningLabel="Finding…"
          />
        </div>
        <p className="design-note">
          <strong>The two slow ones are not the same sentence</strong>, and the difference is a rule
          rather than a wording preference. Only a step that has actually been timed may be called
          <em> longer than usual</em>; everything else gets a threshold, the same offer to stop, and
          no claim about what usual is. Both name the way out, which is the half that matters
          either way.
        </p>
        <p className="design-note">
          The one after them is the tab admitting it can{" "}
          <em>see</em> the job and cannot move it — the only line in this band that does not come off
          the server, and the reason it is muted rather than red: nothing has failed, it is still
          trying. Then a real failure message out of{" "}
          <code className="design-token">src/messages.ts</code>, not a placeholder — the failure copy
          has to be read at the width it will actually wrap at. Its rules are in
          docs/project/copy.md, and the bracketed code at the end is deliberate. There was a
          seventh — the refusal that arrived when the article already had an import running, with
          the blocking job drawn under the button. It went on 2026-09-02: a second job on one
          article is queued now rather than refused, so it appears as the queued shape above.
        </p>
      </section>

      {/* ---- the band every mode shares -------------------------------- */}
      <section>
        <h2>Shared mode surfaces</h2>
        <p className="design-note">
          The chrome every mode's panel sits in, in each of the states it has. Most of them are
          states nobody can screenshot in the app: the band is <em>loading</em> for a few hundred
          milliseconds, <em>running</em> only while a model call is in flight, and <em>stale</em>{" "}
          only for a reader whose article moved under a list they had already built. Same argument
          as the section above, one level out — that was the button, this is the band it sits in.
        </p>
        <p className="design-note">
          <strong>The names are the app's, not a vocabulary invented for this page.</strong>{" "}
          <code className="design-token">ArtefactStatus</code> in{" "}
          <code className="design-token">src/web/useAutoRun.ts</code> is{" "}
          <code className="design-token">loading | none | ready | error</code>, and every read hook
          reports it — so <em>missing</em> is <code className="design-token">none</code> and{" "}
          <em>success</em> is <code className="design-token">ready</code>. <em>Stale</em> is not a
          status at all but a flag beside a <code className="design-token">ready</code> one, and it
          has a twin — <code className="design-token">outdated</code>, for{" "}
          <em>the article is the same and we would write these differently now</em>. And{" "}
          <em>running</em> is a job on screen, which is{" "}
          <code className="design-token">JobProgress</code>'s business rather than the status's.
        </p>
        <p className="design-note">
          The shell is <code className="design-token">.mode-band</code> and the title row is{" "}
          <code className="design-token">.band-head</code> (mode-band.css); the state bodies are the{" "}
          <code className="design-token">.gloss-*</code> base classes that Ideas, Timeline, Debate,
          Quiz and Referee reuse beside their own, and whose position in the import order is
          load-bearing (glossary.css says why). <strong>Nothing here filters, scores, orders or
          attributes anything</strong> — that belongs to each feature and stays there; a design page
          drawing a fake glossary list would be showing its own drawing rather than the app's. Every
          band is at <code className="design-token">MODE_MIN</code>, the narrow end of what the
          layout will give it, because that is the width all of this has to survive.
        </p>
        <div className="design-row">
          <Toggle className={PILL} pressed={bigRoot} onPressedChange={setBigRoot}>
            Root font 20px
          </Toggle>
          <span className="design-note design-note-inline">
            The whole page moves, and that is the control working rather than overreaching — a root
            font size has no smaller scope. `rem` grows and `px` does not, so the control heights in{" "}
            <code className="design-token">design-css-overview.md § Controls</code> — 28px for a
            chip, 32px for <code className="design-token">size="sm"</code>, 36px for the default —
            are an agreement at a 16px root, and this is where you find out whether they still line
            up beside something stated in pixels.
          </span>
        </div>
        <div className="design-bands">
          <BandCase
            state="loading"
            real='status: "loading"'
            note="One quiet line, under a head row that is already drawn and still empty. There is
                  no count yet because there is nothing to count."
          >
            <p className="gloss-quiet">Looking for a glossary…</p>
          </BandCase>

          <BandCase
            state="missing"
            real='status: "none"'
            note="The offer, the honest sentence about what it costs, and the real run button —
                  JobProgress with no job and no failure."
          >
            <div className="gloss-empty">
              <p>Nobody has found the terms for this one yet.</p>
              <p className="gloss-hint">
                One model call over the whole article, and it takes tens of seconds. Found once and
                kept — you will not be asked again unless the article changes.
              </p>
              <div className="gloss-run">
                <RunButton label="Find the terms" />
              </div>
            </div>
          </BandCase>

          <BandCase
            state="running"
            real="a Job on screen"
            note="The same box with the same component in it: the button is gone, and what replaces
                  it is the step's own label, the clock and Stop, with the progress detail on a line
                  of its own."
          >
            <div className="gloss-empty">
              <p>Nobody has found the terms for this one yet.</p>
              <div className="gloss-run">
                <RunButton label="Find the terms" job={DESIGN_JOB.running} />
              </div>
            </div>
          </BandCase>

          <BandCase
            state="error"
            real='status: "error"'
            note="A read that failed, which is not a run that failed. This one is the GET, and it
                  sits above whatever the band still has; a run's failure is drawn by JobProgress
                  instead, in the section above. Real copy out of src/messages.ts, so it wraps at
                  the width it will really wrap at."
          >
            <p className="gloss-error">{UNEXPECTED_FAILURE.message}</p>
          </BandCase>

          <BandCase
            state="stale"
            real='stale, beside status: "ready"'
            head={<span className="gloss-count">24 terms</span>}
            note="A banner on its own raised ground rather than a strip across the top, with the run
                  button inside it. The triangle is the only orange on this surface."
          >
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These terms describe an older version of the article.
              </p>
              <div className="gloss-run">
                <RunButton label="Find them again" />
              </div>
            </div>
          </BandCase>

          <BandCase
            state="success"
            real='status: "ready"'
            head={<span className="gloss-count">24 terms</span>}
            note="The head carries a count and the body is the scroller — flex: 1, min-height: 0,
                  overflow-y: auto. That geometry is shared; what goes inside it is the feature's,
                  and is deliberately not drawn here."
          >
            <div className="gloss-list">
              <p className="gloss-quiet">
                The feature's own list goes here. Its filtering, its scoring, its chronology and its
                provenance are not chrome, and are not on this page.
              </p>
            </div>
          </BandCase>

          <BandCase
            state="built, and empty"
            real='status: "ready", nothing in it'
            head={<span className="gloss-count">0 terms</span>}
            note="The state absence cannot express — a run that happened and came back with
                  nothing. One sentence for it, shared: builtButEmpty in src/messages.ts, which
                  three panels call."
          >
            <p className="gloss-quiet">{builtButEmpty("A glossary")}</p>
          </BandCase>

          <BandCase
            state="a long label"
            real="the stress case"
            head={
              <h2>
                Why the second half of that sentence is the part everybody forgets, and what it costs
              </h2>
            }
            note="Two different answers in one band, and only one of them was decided. The head cuts
                  to a single line with an ellipsis, which .band-head h2 sets on purpose for Chat's
                  thread titles. The button does not: shadcn's Button is whitespace-nowrap and
                  shrink-0, so a long label overflows the band instead of wrapping — clipped here by
                  the cell, and in the app it runs out over the article."
          >
            <div className="gloss-empty">
              <div className="gloss-run">
                <RunButton label="Find the terms again, using your reader profile" />
              </div>
            </div>
          </BandCase>
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
          <code className="design-token">LoaderCircle</code>: one open arc, still legible at 10px.
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
          One unit is 17px × 1.4 ≈ 23.8px, and the gaps are thirds of it. Two thirds between
          paragraphs; a full unit above a heading, a third below it — a heading belongs to what
          follows it.
        </p>
        <div className="design-panel design-rhythm">
          <p>The paragraph that ends the previous section.</p>
          <h3>A heading, which should sit closer to the text below than above</h3>
          <p>The paragraph the heading introduces.</p>
          <p>And a second one, one unit further down.</p>
        </div>
      </section>

      <section>
        <h2>Marks in the prose</h2>
        <p className="design-note">
          The four things that can be drawn over the author's words, and what happens where they
          overlap. <strong>Search fills; quotes outline.</strong> A quote's stroke weight is its
          priority — heavy above the bar's default, light below it — so running your eye down an
          article finds the passages worth stopping at. Every specimen below is built by the real{" "}
          <code>annotateHtml</code>, not written out by hand, which is the only way this page can
          show the case that actually matters: one quote containing an <code>&lt;em&gt;</code>{" "}
          becomes <em>three</em> sibling marks, and three closed boxes would read as three quotes.
          If the outlines below have visible seams at the italic words, the end-cap rules have
          broken.
        </p>
        <div className="design-panel">
          <div className="prose design-sample">
            {SPECIMEN_MARKS.map((s, i) => (
              <div key={s.label}>
                <p className="design-note">{s.label}</p>
                {/* The real annotator's output, pasted rather than computed —
                    see `SPECIMEN_OUT`. It is our own markup, from our own
                    function, over our own fixture string: no article, no user
                    content, nothing that has been near a network.

                    **A `div`, because the specimen is already a whole `<p>`.**
                    This was a `<p>`, which makes `<p><p>…</p></p>` — the parser
                    closes the outer one and the result is a sibling with
                    different spacing from every other paragraph on the page,
                    which on a page whose whole job is showing what the reader
                    sees is the worst place to have it. GPT Sol, 2026-09-07. */}
                <div dangerouslySetInnerHTML={{ __html: SPECIMEN_OUT[i] ?? "" }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * **The prose-mark specimens, as the real annotator's output pasted in.**
 *
 * Written out rather than produced by calling `annotateHtml` here, and the
 * reason is a bundle boundary rather than taste: `/design` is a lazily-loaded
 * route, `annotate.ts` is eagerly loaded by the reader, and
 * `tests/eager-client-graph.test.ts` fails a module that becomes reachable from
 * both without somebody having decided it should be. Importing the annotator for
 * six specimens is not that decision.
 *
 * **So the copy is checked instead of trusted.** `tests/annotate.test.ts` runs
 * the same inputs through `annotateHtml` and compares, so these strings cannot
 * drift from what the reading view actually draws — the same arrangement
 * `tests/valence.test.ts` uses to stop the direction glyphs drifting from the
 * stylesheet. If that test fails, regenerate rather than edit by hand.
 *
 * They are hand-written markup only in the sense that a photograph is: the
 * important properties — that one quote containing an `<em>` becomes three
 * sibling marks, and that only the outer two carry the end-caps — are the
 * annotator's, not ours.
 *
 * docs/project/quotes.md § The stroke; docs/project/design-css-overview.md.
 */
export const SPECIMEN_HTML =
  "<p>He rejects the idea that mind is <em>software</em> running on wet hardware, " +
  "and says so in the first paragraph.</p>";

/**
 * The marks each specimen is drawn with, in the rendered-text offset space —
 * exported so the drift test can rebuild them without restating the offsets.
 */
export const SPECIMEN_MARKS: { label: string; marks: Mark[] }[] = [
  {
    label: "A search hit — a fill, whose depth is the model's confidence",
    marks: [{ id: "h", start: 25, end: 49, kind: "hit", strength: 0.45, slot: 0 }],
  },
  {
    label: "A quote below the bar — the light stroke",
    marks: [{ id: "q", start: 25, end: 65, kind: "hit", quoteTier: 1 }],
  },
  {
    label: "A quote above the bar — the heavy stroke, and the same three fragments",
    marks: [{ id: "q", start: 25, end: 65, kind: "hit", quoteTier: 2 }],
  },
  {
    label: "Two abutting quotes — the caps are inset so they stay two",
    marks: [
      { id: "q1", start: 0, end: 19, kind: "hit", quoteTier: 2 },
      { id: "q2", start: 19, end: 65, kind: "hit", quoteTier: 1 },
    ],
  },
  {
    /* **This label used to say "both channels, neither lost", and the page was
       visibly disproving it.** The fragments that also carry `data-wash` get
       `padding-bottom: 2px` to make room for the hue band, so they are 2px
       taller and the quote's bottom rule steps down where the search hit begins
       and back up where it ends. Named here rather than quietly claimed
       otherwise — /design exists to show what the reader gets, so a specimen
       advertising a property it does not have is the worst thing on it.
       Not reachable in the reading view today (one mode's marks at a time);
       260907c § The step where a quote crosses a search hit. */
    label: "A quote over a search hit — both channels drawn, but see the 2px step in the lower rule",
    marks: [
      { id: "h", start: 33, end: 78, kind: "hit", strength: 0.45, slot: 0 },
      { id: "q", start: 25, end: 65, kind: "hit", quoteTier: 2 },
    ],
  },
  {
    label: "The quote the reader pressed — a white stroke and a momentary wash",
    marks: [{ id: "q", start: 25, end: 65, kind: "hit", quoteTier: 2, open: true }],
  },
];

/** `annotateHtml(SPECIMEN_HTML, marks)` for each of the above, in the same order. */
export const SPECIMEN_OUT: string[] = [
  '<p>He rejects the idea that <mark class="hit" data-hit="h" data-wash="" data-hues="1" style="--hit-a:0.450;--h0:var(--cat-0-rgb)">mind is </mark><em><mark class="hit" data-hit="h" data-wash="" data-hues="1" style="--hit-a:0.450;--h0:var(--cat-0-rgb)">software</mark></em><mark class="hit" data-hit="h" data-wash="" data-hues="1" style="--hit-a:0.450;--h0:var(--cat-0-rgb)"> running</mark> on wet hardware, and says so in the first paragraph.</p>',
  '<p>He rejects the idea that <mark class="hit" data-hit="q" data-quote="1" data-quote-start="">mind is </mark><em><mark class="hit" data-hit="q" data-quote="1">software</mark></em><mark class="hit" data-hit="q" data-quote="1" data-quote-end=""> running on wet hardware</mark>, and says so in the first paragraph.</p>',
  '<p>He rejects the idea that <mark class="hit" data-hit="q" data-quote="2" data-quote-start="">mind is </mark><em><mark class="hit" data-hit="q" data-quote="2">software</mark></em><mark class="hit" data-hit="q" data-quote="2" data-quote-end=""> running on wet hardware</mark>, and says so in the first paragraph.</p>',
  '<p><mark class="hit" data-hit="q1" data-quote="2" data-quote-start="" data-quote-end="">He rejects the idea</mark><mark class="hit" data-hit="q2" data-quote="1" data-quote-start=""> that mind is </mark><em><mark class="hit" data-hit="q2" data-quote="1">software</mark></em><mark class="hit" data-hit="q2" data-quote="1" data-quote-end=""> running on wet hardware</mark>, and says so in the first paragraph.</p>',
  '<p>He rejects the idea that <mark class="hit" data-hit="q" data-quote="2" data-quote-start="">mind is </mark><em><mark class="hit" data-hit="h q" data-wash="" data-quote="2" data-hues="1" style="--hit-a:0.450;--h0:var(--cat-0-rgb)">software</mark></em><mark class="hit" data-hit="h q" data-wash="" data-quote="2" data-hues="1" style="--hit-a:0.450;--h0:var(--cat-0-rgb)" data-quote-end=""> running on wet hardware</mark><mark class="hit" data-hit="h" data-wash="" data-hues="1" style="--hit-a:0.450;--h0:var(--cat-0-rgb)">, and says so</mark> in the first paragraph.</p>',
  '<p>He rejects the idea that <mark class="hit" data-hit="q" data-quote="2" data-quote-start="" data-hit-open="">mind is </mark><em><mark class="hit" data-hit="q" data-quote="2" data-hit-open="">software</mark></em><mark class="hit" data-hit="q" data-quote="2" data-quote-end="" data-hit-open=""> running on wet hardware</mark>, and says so in the first paragraph.</p>',
];
