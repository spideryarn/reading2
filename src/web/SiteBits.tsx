/**
 * The furniture the landing page and the features page share: the top bar, the
 * footer, a framed screenshot, headings, a bento tile, and the two calls to
 * action. Lifted out of LandingPage.tsx on 2026-09-03 when the features page
 * arrived, so the two pages cannot drift into two figures — and widened on
 * 2026-09-03 (afternoon) when both pages were redesigned.
 *
 * ## The visual language lives in CSS, not here
 *
 * Every `site-*` class is defined in one block at the foot of styles.css, with
 * the reasoning beside it. That is deliberate: these are used on both pages, so
 * they are a *system*, and docs/project/design-css-overview.md § Which
 * mechanism owns what puts a system in that file rather than in a utility
 * string repeated down two components. `tw:` utilities stay for per-element
 * nudges, which is what they are good at.
 *
 * ## The posture was Greg's call, against advice
 *
 * Full modern-SaaS — glow, display type, a tilt, a bento, scroll-reveal — chosen
 * 2026-09-03 over the two more restrained options, both of which had been
 * recommended to him on brand grounds. The plan says so in full, including who
 * argued what: docs/plans/260903g-redesign-the-signed-out-marketing-pages.md.
 *
 * ## Two rules that are easy to break here
 *
 * **A claim on these pages is checked against the code, never against a doc
 * about the code.** The page said "six diagrams" for a day, having been written
 * from a doc, when there were four.
 *
 * **The words are Greg's**, and every sentence on both pages carries a comment
 * naming its source, or `[tissue]` for the connecting lines an agent wrote —
 * docs/project/positioning.md § Whose words. Restructuring is allowed to move a
 * sentence; it is not allowed to rewrite one.
 *
 * How to shoot the pictures these components frame, and what makes a shot bad:
 * docs/project/marketing-pages.md.
 */
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "./Link.js";
import { FEATURES_HREF, PRIVACY_HREF } from "./router.js";
import type { Shot as ShotRecord } from "./shots.js";

/** The width the page shell runs to. Prose inside it stays much narrower. */
export const SHELL = "tw:mx-auto tw:w-full tw:max-w-6xl tw:px-6";

/**
 * The bar at the top of both pages: wordmark left, three links right.
 *
 * It is sticky and translucent, and it grows a hairline border only once the
 * page has scrolled — done in CSS with `animation-timeline: scroll()`, so there
 * is no scroll listener and no React state to get wrong. Where that is
 * unsupported it simply stays borderless, which is the right look at the top of
 * the page and an acceptable one below it.
 */
export function SiteNav({ here }: { here: "home" | "features" }) {
  const link =
    "tw:text-sm tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:text-foreground";
  return (
    <nav className="site-nav">
      {/* The shell's own `px-6` is halved below `sm`, and the gap with it.
          `whitespace-nowrap` on both halves stops the bar wrapping to three
          lines at 390px — "Spideryarn / Reading", the pill, "Sign / in" — but
          nowrap alone turns a wrap into a sideways scroll, and at the 320px
          reflow width the measured content needs about 331px. Narrower padding
          and a smaller gap buy the 11px back. Cross-family review, finding 4. */}
      <div
        className={`tw:mx-auto tw:flex tw:h-14 tw:w-full tw:max-w-6xl tw:items-center tw:justify-between tw:gap-3 tw:px-3 tw:sm:gap-6 tw:sm:px-6`}
      >
        <Link
          href="/"
          className="tw:flex tw:shrink-0 tw:items-center tw:gap-2.5 tw:whitespace-nowrap tw:no-underline"
          aria-label="Spideryarn Reading, home"
        >
          <span className="tw:font-prose tw:text-base tw:font-medium tw:text-foreground">
            Spideryarn <span className="tw:text-highlight">Reading</span>
          </span>
          <span className="tw:hidden tw:rounded-full tw:border tw:border-highlight/50 tw:px-2 tw:py-px tw:text-[0.6rem] tw:font-semibold tw:uppercase tw:tracking-widest tw:text-highlight tw:sm:inline">
            Beta
          </span>
        </Link>
        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-4 tw:whitespace-nowrap tw:sm:gap-5">
          {here === "features" ? (
            <Link href="/" className={link}>
              Home
            </Link>
          ) : (
            <Link href={FEATURES_HREF} className={link}>
              Features
            </Link>
          )}
          <Link href={PRIVACY_HREF} className={`${link} tw:hidden tw:sm:inline`}>
            Privacy
          </Link>
          {/* The panel it jumps to only exists on the landing page, so from
              `/features` this needs the path as well as the fragment. As a bare
              `#sign-in` it was a link that visibly did nothing — cross-family
              review, finding 3.

              A plain `<a>`, deliberately, not `Link`: `navigate()` in router.ts
              ends with `window.scrollTo({ top: 0 })` and never looks at the
              hash, so routing this in-page would land a reader at the top of the
              home page — a link that goes to the right document and the wrong
              place, which is the harder version of the bug to notice. A whole
              page load, once, is the honest answer. */}
          <a href={here === "home" ? "#sign-in" : "/#sign-in"} className={link}>
            Sign in
          </a>
        </div>
      </div>
    </nav>
  );
}

/** The orange button. One per page, and it is the only filled thing on it. */
export function PrimaryCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="site-cta site-cta-primary">
      {children}
      <ArrowRight size={16} />
    </a>
  );
}

/** The outlined button beside it. */
export function GhostCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="site-cta site-cta-ghost">
      {children}
    </Link>
  );
}

/**
 * A screenshot, framed so it reads as a raised object rather than a hole in the
 * page. `.site-frame` carries the border, the lift and — the load-bearing part —
 * an inset highlight along the top edge, which is what actually separates a dark
 * screenshot from a dark page.
 */
export function Frame({
  shot,
  eager = false,
  hero = false,
  className = "",
}: {
  shot: ShotRecord;
  eager?: boolean;
  /** The one shot above the fold: gets the lit edge, and is never lazy. */
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={`site-frame ${hero ? "site-frame-hero" : ""} ${className}`}>
      <img
        src={shot.src}
        alt={shot.alt}
        width={shot.w}
        height={shot.h}
        /* Above the fold and the point of the page; everything else can wait
           until it is scrolled to. */
        loading={eager || hero ? "eager" : "lazy"}
        decoding={hero ? "sync" : "async"}
      />
    </div>
  );
}

/**
 * One landscape screenshot at the full width of the shell, with its caption in
 * a narrow block above it.
 *
 * **This is deliberately not a two-column text-beside-image row**, which is what
 * it was for the first hour of the redesign and which the surveyed marketing
 * sites mostly do. Their screenshots are of dashboards, where the shape is the
 * point; ours are of *text*, and a 1440px-wide capture drawn 689px wide renders
 * the app's own prose at 48% — legible as a texture and not as words. A page
 * selling careful reading cannot show unreadable reading.
 *
 * So: the picture gets the whole shell (1152px, about 80% scale) and the words
 * go above it. The rhythm comes from `offset`, which nudges alternate captions
 * to the right, rather than from swapping sides.
 */
export function Showcase({
  shot,
  title,
  children,
  eyebrow,
  offset = false,
  eager = false,
  under = false,
}: {
  shot: ShotRecord;
  title: string;
  children: ReactNode;
  eyebrow?: string;
  /** Indent the caption, so consecutive showcases do not march. */
  offset?: boolean;
  eager?: boolean;
  /**
   * This showcase sits under a group `H2` that has already made the point, so
   * its own title drops to an `h3` at label size. Without it `/features` reads
   * "Ask, in place." and then "Select a sentence." in two headings the same
   * size, one above the other, which looks like a mistake because it is one.
   *
   * **It sets the heading level as well as the size**, and that is the point of
   * having one flag rather than two: on the landing page there are no group
   * headings, so a showcase title is a top-level section and must be an `h2` —
   * hard-coding `h3` there jumped the outline straight from `h1` to `h3` for
   * every screen reader (cross-family review, finding 7). Visual reuse must not
   * decide document structure on its own.
   */
  under?: boolean;
}) {
  const Heading = under ? "h3" : "h2";
  return (
    <section className={`site-reveal ${under ? "tw:my-10" : "tw:my-16"}`}>
      {/* Indented, not right-aligned. A ragged LEFT edge on a five-line
          paragraph costs the reader the one fixed point their eye returns to on
          every line, which is a strange thing to do on a page about reading. */}
      <div className={`tw:max-w-[52ch] ${offset ? "tw:lg:ml-auto" : ""}`}>
        {eyebrow ? <p className="site-eyebrow tw:mb-3">{eyebrow}</p> : null}
        <Heading
          className={
            under ? "tw:mb-2 tw:font-prose tw:text-lg tw:text-foreground" : "site-h2 tw:mb-3"
          }
        >
          {title}
        </Heading>
        <p className="tw:text-[0.98rem] tw:leading-relaxed tw:text-muted-foreground">{children}</p>
      </div>
      <Frame shot={shot} eager={eager} className="tw:mt-6" />
    </section>
  );
}

/**
 * One of the tall portrait panels — the 720-wide band shots — with its caption.
 *
 * It sets no width of its own, because it is used two ways: three across inside
 * a `Gallery`, and alone inside a `tw:max-w-sm` wrapper. A width here would
 * have to be overridden in one of them, and an overridden width is how two
 * pages end up with two figures again.
 */
export function Portrait({
  shot,
  title,
  children,
}: {
  shot: ShotRecord;
  title: string;
  children: ReactNode;
}) {
  return (
    <figure className="tw:m-0">
      <Frame shot={shot} />
      <figcaption className="tw:mt-4 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        <strong className="tw:text-foreground">{title}</strong> {children}
      </figcaption>
    </figure>
  );
}

/**
 * Three portraits across, so six band shots take one screen rather than six.
 *
 * This is most of what took `/features` from 11,000px to something a person
 * will scroll to the end of — the page was thirteen full-width screenshots
 * stacked, and the tall ones were the worst of it.
 */
export function Gallery({ children }: { children: ReactNode }) {
  return (
    <div className="site-reveal tw:my-10 tw:grid tw:gap-7 tw:sm:grid-cols-2 tw:lg:grid-cols-3">
      {children}
    </div>
  );
}

/** A heading, at the one size these pages use for them. */
export function H2({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  return (
    <div className="site-reveal tw:mt-20 tw:mb-5">
      {eyebrow ? <p className="site-eyebrow tw:mb-3">{eyebrow}</p> : null}
      <h2 className="site-h2">{children}</h2>
    </div>
  );
}

/**
 * One of the things the app does, as a tile in the bento.
 *
 * `span` is the tile's width in a six-column grid: the default is a third,
 * `wide` a half, `featured` the whole row. Below 900px the grid is two columns
 * and only `featured` still spans; below 640px it is one.
 */
export function Tile({
  name,
  children,
  span = "",
}: {
  name: string;
  children: ReactNode;
  span?: "" | "wide" | "featured";
}) {
  return (
    <div className={`site-panel site-panel-hover tw:p-5 ${span}`}>
      <h3 className="tw:mb-2 tw:font-prose tw:text-base tw:text-foreground">{name}</h3>
      <p className="tw:text-sm tw:leading-relaxed tw:text-muted-foreground">{children}</p>
    </div>
  );
}

/** A row in a plain list, where a tile would be too much furniture. */
export function Feature({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li>
      <strong className="tw:text-foreground">{name}</strong> {children}
    </li>
  );
}

/* **`SiteFooter` was here until 2026-09-03**, and it is now the general one in
   SiteFooter.tsx, which these two pages call with `variant="marketing"` to keep
   the spacing this design chose. Two components with one name and the same job
   arrived on the same day in two worktrees and met at a merge; Greg's call was
   one component. The provenance sentence — every picture is a real article read
   in Spideryarn — did not move: it is each page's own child text, because it is
   a promise about *these pages* rather than a fact about the site.
   docs/project/marketing-pages.md § Say what the pictures are. */

