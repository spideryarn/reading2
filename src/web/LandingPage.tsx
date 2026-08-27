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
 * Anything claimed here has to stay true of what is built: the list of features
 * is what exists today, not a roadmap.
 *
 * ## The Alpha sign
 *
 * *"Also include a very prominent 'Alpha' sign"* — Greg, 2026-08-27. It is a
 * badge beside the wordmark **and** a full-width strip under it, because the
 * one thing a stranger must not conclude from a page with a screenshot on it is
 * that this is a product they can sign up for. Access is one allowlisted email
 * (docs/project/auth.md), so the alternative to saying so is a Google button
 * that works and then refuses them.
 *
 * ## One screenshot, and why there is only one
 *
 * The plan was four — the zoom, a glossary card, an explanation over a selected
 * sentence, and the force diagram. Only the first was captured. Chrome's window
 * went `visibilityState: "hidden"` partway through the session, which paints
 * every capture solid black, and nothing available from this side can raise an
 * occluded window (two Chrome instances were running and AppleScript reaches
 * only the other one). Greg's call was to take one more run at it and then stop
 * rather than keep grinding, so the other three features are described in prose
 * below instead of shown.
 *
 * **Adding them later is a small job**: capture at the same aspect ratio as
 * `zoom.jpg`, drop the files in `assets/`, and use the `Shot` component that is
 * already here. tests/landing-assets.test.ts checks the shape of whatever is
 * imported, so a shot taken at the wrong window size fails loudly instead of
 * making the page jump as it loads. Note that a capture is a JPEG rather than a
 * PNG — that is what the browser tool produces, and re-encoding it as a PNG
 * quadruples the bytes for no picture that anybody can tell apart.
 *
 * The article in the shot is *The Mythology of AI Consciousness*, which is on
 * the public web and has nothing sensitive in it. Imported rather than dropped
 * in `public/` so Vite hashes it and a redeploy cannot serve a stale one.
 *
 * Styled with Tailwind utilities, which is the rule for chrome rather than a
 * preference — see docs/project/web-client.md § Tailwind and shadcn. Note the
 * `tw:` prefix on every class; unprefixed names do nothing here.
 */
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SignInControls } from "./SignInControls.js";
import zoomShot from "./assets/zoom.jpg";

/**
 * The width and height every screenshot is captured at.
 *
 * One pair of numbers rather than one per file, because a figure whose stated
 * shape disagrees with its image is a layout that jumps once the image lands —
 * the exact thing the `width`/`height` attributes are there to prevent. On a
 * `width: 100%` image those attributes do nothing else: they reserve the
 * aspect ratio and that is all. Any shot added later must match, which is what
 * tests/landing-assets.test.ts enforces.
 */
const SHOT_W = 1245;
const SHOT_H = 815;

/** One screenshot, with the sentence that says what you are looking at. */
function Shot({
  src,
  alt,
  title,
  children,
  eager = false,
}: {
  src: string;
  alt: string;
  title: string;
  children: React.ReactNode;
  eager?: boolean;
}) {
  return (
    <figure className="tw:my-12">
      <img
        src={src}
        alt={alt}
        width={SHOT_W}
        height={SHOT_H}
        /* The first shot is the one above the fold and the point of the page;
           any others can wait until they are scrolled to. */
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

/** One of the things the app does, in the list under "What it does". */
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

      <Shot
        src={zoomShot}
        alt="The reading view: three columns of increasingly detailed summary beside the article's own prose."
        title="One article, every level of detail at once."
        eager
      >
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

      <H2>What else it does</H2>
      <p>
        One spine carries all of it — every block of the article has a stable id — so the rest come
        cheap:
      </p>
      <ul className="tw:mt-4 tw:flex tw:flex-col tw:gap-4">
        <Feature name="A glossary written from this piece.">
          Every term the article leans on, underlined wherever it appears. Point at one and the card
          says two things: what the author means by it here, and what you need to bring to it from
          outside.
        </Feature>
        <Feature name="Ask at the point of confusion.">
          Select a sentence and the model explains it — from the surrounding argument, and from the
          web when it needs to. The answer starts arriving in a second or two, and the article never
          leaves the screen.
        </Feature>
        <Feature name="The shape of the argument.">
          Six diagrams in the band beside the prose. Three draw the article’s tree. Three draw its
          sections as a graph, joined by the distinctive words they share — the one relationship a
          table of contents cannot hold.
        </Feature>
        <Feature name="Search, summaries, and a chat that cites.">
          Find a passage by its exact words or by what it says, marked in the prose. Summarise the
          whole piece, or any part of it, at a length you pick. Ask a question and every claim in
          the answer links back into the article.
        </Feature>
      </ul>

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
        Spideryarn — alpha. The screenshot is of <em>The Mythology of AI Consciousness</em> by Anil
        Seth, read in Spideryarn.
      </footer>
    </main>
  );
}
