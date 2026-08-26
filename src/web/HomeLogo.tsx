/**
 * The wordmark in the very top-left of the window, and the way home.
 *
 * Greg, 2026-08-26:
 *
 * > Get rid of "Home". Instead, add a Spideryarn logo in the very top-left of
 * > the window that takes us Home.
 *
 * Two things in one move, and both are improvements on what they replace. The
 * bottom bar's `Home` button was a word competing for space with eight other
 * words in a bar whose job is *this article*; the way out of a document is not
 * one of the things the document can be. And the app's name had nowhere to
 * live — it was tucked in the drawer header (Dock.tsx), visible only while a
 * panel that is shut nearly all the time was open. The top-left corner is where
 * every site on the web has kept both for twenty years, so it costs the reader
 * nothing to learn.
 *
 * ## Why the corner is free, which is not an accident
 *
 * On the reading view the rectangle from (0,0) to (`--spine-w`, `--bar-h`) is
 * genuinely empty at every scroll position, and it is empty for a structural
 * reason rather than a lucky one: the spine is `position: fixed` starting at
 * `top: var(--bar-h)`, and the masthead and controls bar are both inset by
 * `left: calc(var(--spine-w) + var(--mode-w))`. Nothing is ever painted there.
 * See styles.css § shell.
 *
 * **But `--spine-w` is not a constant.** layout.ts narrows the spine to 1.5rem
 * and then drops it entirely as the window shrinks (`fitView`), and at that
 * point the corner belongs to the masthead and the controls bar again. So both
 * of those reserve the space instead, with one expression written twice:
 *
 *     padding-left: max(1.5rem, calc(var(--logo-w) + 1.5rem - var(--spine-w) - var(--mode-w)))
 *
 * Both bars are positioned at `left: calc(--spine-w + --mode-w)`, so
 * `--logo-w` minus that offset is exactly how far the logo reaches into them,
 * and the `+ 1.5rem` keeps the gutter those bars have everywhere else rather
 * than letting the title start flush against the wordmark. When the spine is
 * full the whole term goes negative and the ordinary 1.5rem wins — which is
 * what makes the wide case cost nothing rather than needing a second rule.
 * Change `--logo-w` and both bars follow; change the logo's size without
 * changing the token and they will not, and the failure is a wordmark sitting
 * on top of the article's title.
 *
 * **`--spine-w: 0` is not a narrow-window curiosity**, which is the part that
 * is easy to get wrong. `fitView` turns the spine off whenever the reader hides
 * the prose (`!showText`), at any width at all, so `?text=0` on a full-size
 * screen reaches it in one keystroke. This rule has to be right rather than
 * being an edge case nobody meets — measured: logo 0→136, title starts at 160.
 *
 * It is `!showText` **and no mode band**, though. A band is laid out by
 * `fitMode`, a different function, and that one never returns `"off"` — the
 * prose is always on inside a band. So the two smallest terms cannot co-occur.
 *
 * Which makes the `--mode-w` term, today, **dead arithmetic that is still worth
 * keeping.** With a band open the spine is at least `SPINE_NARROW` (24px) and
 * the band at least `MODE_MIN` (288px), so the subtraction is 312px against a
 * 160px reach and the expression floors at 1.5rem every time. It is in there
 * because the bars are *positioned* by `--spine-w + --mode-w` and an offset
 * expression that does not mirror its own positioning is a trap for whoever
 * changes one of them. Drop `MODE_MIN` below ~112px and it starts to bind.
 *
 * ## Where it is not rendered
 *
 * The library, because that *is* home — a link to the page you are on is a
 * dead control, and the shelf already names the app in its `<h1>`. App.tsx
 * makes that choice, so this component never has to know which route it is on.
 *
 * The class names are the original app's, so its fifteen CSS-only logo
 * animations can be dropped in later as one file — see
 * docs/project/original-version/design-system.md, and the argument there for
 * not doing that yet.
 */
import { Link } from "./Link.js";
import { LIBRARY_HREF } from "./router.js";

export function HomeLogo() {
  return (
    <Link
      href={LIBRARY_HREF}
      className="logo logo-home"
      title="Spideryarn — back to the library"
    >
      {/* `alt=""` and not "Spideryarn": the wordmark beside it already says the
          name, and a screen reader reading it twice is how a decorative image
          becomes noise. The link's own text is the accessible name. */}
      <img className="logo-image" src="/spideryarn-logo.png" alt="" width={20} height={20} />
      <span className="logo-text">
        {"Spideryarn".split("").map((ch, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed string, rebuilt whole
          <span className="logo-letter" key={i}>
            {ch}
          </span>
        ))}
      </span>
    </Link>
  );
}
