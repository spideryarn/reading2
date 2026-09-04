/**
 * **The Access & Sharing card, in every state, with nothing behind it.**
 *
 * A throwaway page whose entire purpose is that it is **not behind the auth
 * gate** — the same trick `preview-composer.tsx` and `preview-profile.tsx` use,
 * and for the same reason: the real card lives on `/metadata/:slug` for a
 * signed-in owner, which a browser agent cannot reach, and the one thing tests
 * cannot check about a card is whether it looks like a card.
 *
 * Nothing here talks to the server. `sharing` is a literal, and the only
 * request the component can make needs a button press.
 *
 *   npm run dev  →  http://localhost:<vite's port>/preview-sharing.html
 *
 * `localhost`, not `127.0.0.1`: vite binds IPv6, so the numeric form refuses
 * the connection on a perfectly healthy server.
 */
import { createRoot } from "react-dom/client";

import { AccessSharing } from "./AccessSharing.js";
import { CARD } from "./card.js";
/**
 * **`tailwind.css` alone, exactly as `main.tsx` does — and NOT the pair the
 * other two preview pages import.**
 *
 * Without a stylesheet at all, a preview page mounts the real component and
 * renders it as browser defaults, which is a picture that tells you nothing
 * true (docs/project/browser-testing.md § A preview page that never imported
 * the stylesheet). But the fix that page records — import both, in that order —
 * is the thing `tailwind.css`'s own header and `main.tsx`'s comment both warn
 * against in as many words: `tailwind.css` pulls `styles.css` in inside
 * `@layer app`, and importing the two side by side leaves the second copy
 * **unlayered**, where it outranks every Tailwind utility.
 *
 * This card is almost entirely Tailwind utilities, so a preview with the
 * cascade upside-down is a screenshot of a page that does not exist — and
 * **that is measured, not feared.** With both sheets the chips came out in a
 * different face at a different size, and the top row wrapped "The arc" onto a
 * second line that production does not have. Half an hour of screenshots taken
 * this way were quietly wrong about the one thing a screenshot is for.
 *
 * `preview-profile.tsx` and `preview-composer.tsx` still import both, and
 * docs/project/browser-testing.md still tells you to — it records the fix for
 * importing *no* stylesheet and reaches for the pair, one line after quoting
 * the very comment that says the pair does not work. GPT Sol found the
 * contradiction, 2026-09-04.
 */
import "./tailwind.css";
import type { ArticleSharing } from "../types.js";

const AVAILABLE = {
  arc: true,
  tweets: false,
  glossary: true,
  ideas: true,
  quotes: false,
  timeline: true,
  sketch: true,
};

const CASES: { what: string; sharing: ArticleSharing | undefined }[] = [
  {
    what: "private — the usual first sight",
    sharing: {
      visibility: "private",
      publicAt: null,
      personalised: ["glossary"],
      available: AVAILABLE,
    },
  },
  {
    what: "already shared",
    sharing: {
      visibility: "public",
      publicAt: "2026-09-01T09:30:00.000Z",
      personalised: ["glossary", "ideas"],
      available: AVAILABLE,
    },
  },
  { what: "we could not check", sharing: undefined },
];

function Page() {
  return (
    /* **`metadata-page`, because that is the class the real card renders
       inside** (Metadata.tsx), and a preview that skips its component's page
       container is a preview that can be wrong about anything that container
       styles. This one was: until 2026-09-04 `.metadata-page button` carried a
       `font` rule, so every button here drew in the UA's Arial while the real
       page drew Geist — and it was *this page* that was used to report the
       typeface as an app-wide bug. It was not app-wide; the Metadata page had
       been exempt for a day. docs/project/browser-testing.md § A preview page
       is not the page it previews. */
    <main className="metadata-page tw:mx-auto tw:max-w-3xl tw:px-5 tw:py-10 tw:font-sans">
      <h1 className="tw:mb-1 tw:text-lg tw:text-foreground">Access &amp; sharing</h1>
      <p className="tw:mb-8 tw:text-sm tw:text-ink-faint">
        Nothing here is connected to anything. What to look at: whether Share reads as a button,
        whether the section sits in a box like its neighbours, and whether the chips say what they
        are without a mouse.
      </p>
      {CASES.map((c) => (
        <section key={c.what} className="tw:mt-8">
          <h2 className="tw:m-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.09em] tw:text-ink-faint">
            <span
              aria-hidden="true"
              className="tw:inline-block tw:h-3.5 tw:w-[3px] tw:shrink-0 tw:rounded-full tw:bg-highlight/70"
            />
            Access &amp; sharing
            <span className="tw:ml-auto tw:normal-case tw:tracking-normal">{c.what}</span>
          </h2>
          {/* **The real `CARD`, imported** — see card.ts for why it is its own
              module. A copy of the string here would have kept the screenshots
              boxed on the day somebody deleted the wrapper in `Metadata.tsx`;
              what actually holds that wrapper in place is a test, not this
              page (tests/sharing-controls-are-controls.test.tsx). */}
          <div className={`${CARD} tw:p-4`}>
            <AccessSharing slug="preview" title="The Bitter Lesson" sharing={c.sharing} />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Page />);
