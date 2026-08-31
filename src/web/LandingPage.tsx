/**
 * The front door: what somebody who is not signed in sees.
 *
 * Greg, 2026-08-27: *"Add a simple landing page for not-logged-in users …
 * Include some of the vision/distinctiveness."* Two decisions he made when
 * asked, both of which shape this file:
 *
 *  - **The sign-in buttons are on the page**, not behind a link to `/login`.
 *    A landing page whose only control sends you somewhere else has put a click
 *    between a person and the thing they came for. So SignInControls.tsx is
 *    rendered here, near the top and again at the foot, and `/login` keeps its
 *    compact screen for password-reset landings (SignInPage.tsx).
 *  - **A deep link gets this same page.** `/read/some-article` while signed out
 *    is the landing page, not a short prompt — and the address stays in the
 *    address bar, so signing in puts you back where you were heading
 *    (auth-return.ts).
 *
 * ## Where the words come from
 *
 * docs/project/vision.md and README.md, rewritten short. This is the one page
 * in the app whose whole job is to say what the thing is, to somebody who will
 * give it about ten seconds, so the register is different from the docs it is
 * drawn from: short sentences, no hedging, one idea per line.
 *
 * **No quote from Greg here** — Greg, 2026-08-27, asked for it out and for the
 * page punchier. CLAUDE.md's "quote Greg directly" rule is about *documents*
 * capturing what he said; a stranger reading the front door has no idea who he
 * is, and a founder quote about one's own product is the softest thing you can
 * put on a page. The vision it carried is still here, in the app's voice, under
 * "The bet". The original wording is in docs/project/vision.md and CLAUDE.md,
 * which is where it belongs.
 *
 * Anything claimed here has to stay true of what is built, and that is a live
 * cost rather than a slogan: this page said "six diagrams" for a day, having
 * been written from a doc, and by the time anybody read it there were **four**
 * — Greg cut half of them on 2026-08-27 (see diagram.ts). A claim here is
 * checked against the code it describes, never against the doc about the code.
 *
 * ## The Alpha sign
 *
 * *"Also include a very prominent 'Alpha' sign"* — Greg, 2026-08-27. It is a
 * badge beside the wordmark **and** a full-width strip under it, because the
 * one thing a stranger must not conclude from a page with screenshots on it is
 * that this is a product they can sign up for. Access is one allowlisted email
 * (docs/project/auth.md), so the alternative to saying so is a Google button
 * that works and then refuses them.
 *
 * ## The screenshots
 *
 * Four, chosen by Greg on 2026-08-27, one per thing worth seeing rather than
 * one per feature: the zoom (the whole idea, above the fold), the glossary and
 * link card, search by meaning, and one of the diagrams. They are ordinary
 * macOS screen captures of a real article — *The Mythology of AI Consciousness*
 * by Anil Seth, which is on the public web and has nothing sensitive in it.
 *
 * **Each shot declares its own width and height, and they all differ.** There
 * used to be one `SHOT_W`/`SHOT_H` pair for the page, which was fine while
 * every capture came from the same browser window at the same size. Real
 * screenshots do not: two of these are portrait, one is a wide hero, one is a
 * landscape card. So the numbers live in `SHOTS` beside the file each belongs
 * to, and tests/landing-assets.test.ts reads that record and checks every entry
 * against the bytes on disk. The numbers are not decoration — see the note at
 * the foot of that test for the 1.95x-stretched front door they exist to
 * prevent, and note that they only work because tailwind.css resets `img` to
 * `height: auto`.
 *
 * **PNG, and quantised, rather than JPEG.** The first shot was a JPEG because
 * the browser automation tool produces JPEG; these came from macOS, which
 * produces PNG, and a JPEG of small light text on a near-black ground rings
 * visibly around every glyph. `pngquant` at 65–92 takes a UI screenshot — a few
 * dozen flat colours — down further than JPEG does anyway: the hero is 119 KB
 * against 280 KB as a JPEG, and all four together are under 280 KB. Anything
 * added later: capture, `pngquant --quality 65-92 --speed 1`, and downscale to
 * about twice the width it will be drawn at (the column is 720 px, so 1440).
 *
 * Imported rather than dropped in `public/` so Vite hashes them and a redeploy
 * cannot serve a stale one.
 *
 * Styled with Tailwind utilities, which is the rule for chrome rather than a
 * preference — see docs/project/web-client.md § Tailwind and shadcn. Note the
 * `tw:` prefix on every class; unprefixed names do nothing here.
 */
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SignInControls } from "./SignInControls.js";
import glossaryShot from "./assets/glossary.png";
import meaningShot from "./assets/meaning.png";
import trailShot from "./assets/trail.png";
import zoomShot from "./assets/zoom.png";

/**
 * The screenshots, each with the size of the file it points at.
 *
 * `file` repeats what the import above already says, and that repetition is the
 * point: it is the join tests/landing-assets.test.ts uses to put a declared
 * width and height next to real bytes on disk. The test also checks that every
 * import has an entry here, so adding a shot and forgetting its numbers fails
 * loudly rather than reserving the wrong space on the page.
 */
const SHOTS = {
  zoom: {
    src: zoomShot,
    file: "zoom.png",
    w: 1440,
    h: 715,
    alt: "Three columns of increasingly detailed summary beside the article's own prose, with a tooltip open over one section's gist.",
  },
  glossary: {
    src: glossaryShot,
    file: "glossary.png",
    w: 1342,
    h: 828,
    alt: "A card over the underlined phrase 'computational functionalism', explaining what the author means by it and where the phrase's link goes.",
  },
  meaning: {
    src: meaningShot,
    file: "meaning.png",
    w: 886,
    h: 1266,
    alt: "The search panel in 'meaning' mode, listing five passages matching the description 'descriptions of what it feels like to be conscious', each with a confidence score.",
  },
  trail: {
    src: trailShot,
    file: "trail.png",
    w: 654,
    h: 981,
    alt: "A scatter of coloured dots joined by a line, one dot per paragraph, with the current section named underneath.",
  },
} as const;

/** One screenshot, with the sentence that says what you are looking at. */
function Shot({
  shot,
  title,
  children,
  eager = false,
  width = "",
}: {
  shot: (typeof SHOTS)[keyof typeof SHOTS];
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

/** A heading, at the one size this page uses for them. */
function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="tw:mt-14 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">{children}</h2>
  );
}

/** One of the things the app does, in the list under "The rest of it". */
function Feature({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li>
      <strong className="tw:text-foreground">{name}</strong> {children}
    </li>
  );
}

export function LandingPage() {
  useDocumentTitle(pageTitle({ kind: "landing" }));

  return (
    <main className="tw:mx-auto tw:max-w-3xl tw:px-6 tw:py-12 tw:font-sans tw:text-[0.95rem] tw:leading-relaxed tw:text-muted-foreground">
      <header>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
          <h1 className="tw:font-prose tw:text-5xl tw:text-foreground">Spideryarn</h1>
          <span className="tw:rounded-full tw:border-2 tw:border-highlight tw:px-4 tw:py-1 tw:text-lg tw:font-semibold tw:uppercase tw:tracking-widest tw:text-highlight">
            Alpha
          </span>
        </div>

        <p className="tw:mt-4 tw:font-prose tw:text-xl tw:text-foreground">
          AI that helps you read harder things, not fewer of them.
        </p>

        {/* The strip. See the file header: the badge alone is decoration, and
            the thing a stranger has to be told is that they cannot get in. */}
        <p className="tw:mt-6 tw:rounded-md tw:border tw:border-highlight/40 tw:bg-highlight/10 tw:px-4 tw:py-3 tw:text-sm tw:text-foreground">
          <strong>This is an alpha.</strong> A working experiment, not a product. Rough edges, no
          support, and sign-in is one short invite list while it is being built.
        </p>
      </header>

      <section className="tw:mt-10 tw:rounded-lg tw:border tw:border-border tw:bg-card/50 tw:p-6">
        <SignInControls />
      </section>

      <Shot shot={SHOTS.zoom} title="One article, every level of detail at once." eager>
        Sideways is how much detail; down is where you are in the piece. Move left or right and the
        text expands or contracts without you losing your place. The far right is always the
        author’s own words.
      </Shot>

      <H2>The problem</H2>
      <p>
        Every AI reading tool makes the same move: compress. Paste an article, get bullets, done.
        Great for triage. Corrosive for understanding.
      </p>
      <p className="tw:mt-4">
        You come away with a fluent impression and none of the texture. No argument you could
        reconstruct. No sentence you could quote. No sense of where the author was strong and where
        they were hand-waving. The summary didn’t support the reading — it replaced it.
      </p>

      <H2>The bet</H2>
      <p className="tw:my-6 tw:border-l-2 tw:border-highlight tw:pl-5 tw:font-prose tw:text-lg tw:text-foreground">
        Make deep reading <em>cheaper</em>, not optional.
      </p>
      <p>
        Skim the whole shape in seconds. Drop into the real prose exactly where it matters. Stay
        oriented at whatever altitude you are flying. Ask your question at the moment of confusion,
        without leaving the page. Finish holding something.
      </p>

      <H2>Every term the piece leans on</H2>
      <p>
        The words an author assumes you already have are where a hard piece loses you — and looking
        one up means leaving. So they are underlined where they stand, and the card comes to you.
      </p>
      <Shot shot={SHOTS.glossary} title="What the author means, and what you have to bring.">
        Two things, because they are two different problems: the sense this piece is using, written
        from this piece, and the background you need from outside it. If the phrase is also a link,
        the same card says where it goes — one card, not two racing for the same three words.
      </Shot>

      <H2>Search by what a passage says, not what it says exactly</H2>
      <p>
        Two matchers behind one box. <strong className="tw:text-foreground">words</strong> finds the
        string. <strong className="tw:text-foreground">meaning</strong> takes a description —{" "}
        <em>descriptions of what it feels like to be conscious</em> — and finds the passages that do
        that, whatever words they happened to use.
      </p>
      <Shot
        shot={SHOTS.meaning}
        title="Every hit says how sure, and where."
        width="tw:mx-auto tw:max-w-sm"
      >
        The number is the model’s own guess rather than a measurement, so the panel says so out loud
        and hands you the slider. Hits are marked in the prose too, and the spine paints one lane
        per question — the thing a list of thirty passages cannot show you.
      </Shot>

      <H2>The rest of it</H2>
      <p>
        One spine carries all of this — every block of the article has a stable id — so the rest
        come cheap:
      </p>
      <ul className="tw:mt-4 tw:flex tw:flex-col tw:gap-4">
        <Feature name="Ask at the point of confusion.">
          Select a sentence and the model explains it — from the surrounding argument, and from the
          web when it needs to. The answer starts arriving in a second or two, and the article never
          leaves the screen.
        </Feature>
        <Feature name="A sentence on every part of it.">
          The whole piece, each of its parts and each of its sections, one line each, as deep into
          the article as you ask. It is on the page before anybody has paid for a model call.
        </Feature>
        <Feature name="A chat that cites.">
          Ask a question and every claim in the answer links back into the article. It can search
          the piece, pull a passage, or go to the web — and it cannot summarise for you, on purpose.
        </Feature>
        <Feature name="Anything you can read.">
          A URL, or a PDF off your own machine. Both come out as the same article.
        </Feature>
      </ul>

      <H2>And a picture of the shape</H2>
      <p>
        Four diagrams in the band beside the prose, one per kind of thing to say.{" "}
        <strong className="tw:text-foreground">tree</strong> is the outline.{" "}
        <strong className="tw:text-foreground">force</strong> joins sections by the distinctive
        words they share — the one relationship an outline cannot hold. And two put one dot per
        paragraph, placed by what that paragraph is about.
      </p>
      <Shot
        shot={SHOTS.trail}
        title="trail: reading order as a line through meaning."
        width="tw:mx-auto tw:max-w-[19rem]"
      >
        Both axes are meaning, so a long jump is a change of subject. Dots far apart really are far
        apart; dots close together may differ in what the projection threw away — which the strip
        says in words rather than in a percentage.
      </Shot>

      <H2>Three commitments</H2>
      <ul className="tw:mt-3 tw:flex tw:flex-col tw:gap-4">
        <Feature name="The text is the destination, not the raw material.">
          Every generated line is a door into the prose, never a wall in front of it. We don’t
          quietly rewrite the author: generated text stays at generated altitudes, and the rightmost
          level is verbatim, always.
        </Feature>
        <Feature name="Nothing the model says floats free.">
          Every block has a stable id, and anything the model asserts is tied to one. The passage it
          came from is one press away.
        </Feature>
        <Feature name="A reading tool, not a writing or chat tool.">
          The article never leaves the screen. When a design call is close, the tiebreak is: which
          option leaves more of the thinking with the reader?
        </Feature>
      </ul>

      <H2>And deliberately not</H2>
      <p>
        “Read this in 2 minutes.” Streaks, nudges, anything optimising for time-in-app. Confident
        generated claims with no path back to the source.
      </p>

      <section className="tw:mt-14 tw:rounded-lg tw:border tw:border-border tw:bg-card/50 tw:p-6">
        <p className="tw:mb-5 tw:text-sm">
          On the invite list? Sign in — your shelf is where you left it.
        </p>
        <SignInControls />
      </section>

      <footer className="tw:mt-14 tw:border-t tw:border-border tw:pt-5 tw:text-xs tw:text-ink-faint">
        Spideryarn — alpha. Every screenshot is of <em>The Mythology of AI Consciousness</em> by Anil
        Seth, read in Spideryarn.
      </footer>
    </main>
  );
}
