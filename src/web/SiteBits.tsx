/**
 * The three pieces the landing page and the features page share: a screenshot
 * with its caption, a heading at the one size those pages use, and a row in a
 * list of things the app does. Lifted out of LandingPage.tsx on 2026-09-03 when
 * the features page arrived, so the two pages cannot drift into two figures.
 *
 * Styled with Tailwind utilities, the rule for chrome — docs/project/web-client.md
 * § Tailwind and shadcn. Note the `tw:` prefix on every class.
 */
import type { Shot as ShotRecord } from "./shots.js";

/** One screenshot, with the sentence that says what you are looking at. */
export function Shot({
  shot,
  title,
  children,
  eager = false,
  width = "",
}: {
  shot: ShotRecord;
  title: string;
  children: React.ReactNode;
  eager?: boolean;
  /** A max-width utility for the portrait shots, which must not fill the column. */
  width?: string;
}) {
  return (
    <figure className={`tw:my-12 ${width}`}>
      <img
        src={shot.src}
        alt={shot.alt}
        width={shot.w}
        height={shot.h}
        /* The hero is above the fold and is the point of the page; the rest can
           wait until they are scrolled to. */
        loading={eager ? "eager" : "lazy"}
        className="tw:w-full tw:rounded-lg tw:border tw:border-border tw:bg-card"
      />
      <figcaption className="tw:mt-3 tw:text-sm tw:text-muted-foreground">
        <strong className="tw:text-foreground">{title}</strong> {children}
      </figcaption>
    </figure>
  );
}

/** A heading, at the one size these pages use for them. */
export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="tw:mt-14 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">{children}</h2>
  );
}

/** One of the things the app does, in a list. */
export function Feature({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li>
      <strong className="tw:text-foreground">{name}</strong> {children}
    </li>
  );
}
