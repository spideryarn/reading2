/**
 * **The shell of the five pages people are sent to that read as documents** —
 * `/help`, `/changelog`, `/privacy`, `/contact` and `/opensource`: a narrow
 * `<main>` with a 24px title, and above it whichever way home the reader has.
 *
 * **Signed in, the corner logo.** `App.tsx` draws `HomeLogo` beside each of
 * these, so the page draws nothing of its own and its `<main>` keeps the
 * 3.5rem the logo sits in.
 *
 * **Signed out, `SiteNav`** — the bar Home, Features, Pricing and Sign-in
 * wear — since 2026-10-07 (plan 261007h, F4b). Until then a stranger got a
 * lone house icon here and the full bar one click away, so the signed-out site
 * looked like two sites. The titles stay 24px: these are documents, not heroes.
 *
 * Four things here are deliberate (GPT Sol, plan review R13):
 *
 *  - **Which shell is `SignedInShell`'s answer, not `useSession()`'s.** A
 *    session call is a subscription of its own that starts at `loading`, so a
 *    signed-in reader would see the bar for a frame. `App` renders nothing at
 *    all until the session is known, so this has the timing the house had.
 *  - **The bar is outside `<main>`**, which is `max-w-2xl` or `5xl`; the bar
 *    runs the full width with its own `max-w-6xl` row, as on the marketing
 *    pages.
 *  - **Its `.site` wrapper is `display: contents`.** `SiteNav`'s colours come
 *    from the `--site-*` tokens declared on `.site`, and custom properties
 *    inherit through a box-less element. A real box would paint `.site`'s
 *    background, and — worse — would be the sticky bar's containing block, so
 *    the bar would scroll away with a 56px-tall parent. Wrapping the whole
 *    page in `.site` instead would zero every heading's and paragraph's UA
 *    margin (styles/site.css § No preflight), restyling three long documents.
 *  - **The top padding is the shell's.** Signed in it is the corner logo's
 *    3.5rem; signed out the bar is in flow and already 3.5rem tall plus a
 *    hairline (`tw:h-14` in `SiteNav`), so the page takes a smaller gap under it rather
 *    than both. `floor` pages stretch to the window less the bar, so a short
 *    page (`/contact`) does not scroll by exactly the bar's height. Anchors on
 *    these pages land at `scroll-mt-20` (80px), which clears the 56px bar, and
 *    Help's sticky contents column already sits 3.5rem down.
 */
import { useContext, type ComponentPropsWithoutRef } from "react";

import { SignedInShell } from "./BackLink.js";
import { SiteNav, type DocumentHere } from "./SiteBits.js";

export function DocumentPage({
  here,
  floor = false,
  className,
  children,
  ...main
}: {
  /** Which page this is, so the bar drops a link to it (`/privacy`). */
  here: DocumentHere;
  /** Stretch to the window, for a page whose `SiteFooter` sits on the floor. */
  floor?: boolean;
  /** `<main>`'s width, gutters and type — not its top padding or height. */
  className: string;
} & Omit<ComponentPropsWithoutRef<"main">, "className">) {
  const signedIn = useContext(SignedInShell);
  if (signedIn) {
    const height = floor ? "tw:min-h-dvh" : "";
    return (
      <main {...main} className={`${className} ${height} tw:pt-[calc(3.5rem_+_var(--safe-top))]`}>
        {children}
      </main>
    );
  }
  /* The bar's 3.5rem row plus its 1px bottom border (`.site-nav` in
     styles/site.css); without the pixel `/contact` scrolled by exactly one. */
  const height = floor ? "tw:min-h-[calc(100dvh_-_3.5rem_-_1px)]" : "";
  return (
    <>
      <div className="site tw:contents">
        <SiteNav here={here} signedIn={false} />
      </div>
      <main {...main} className={`${className} ${height} tw:pt-10`}>
        {children}
      </main>
    </>
  );
}
