/**
 * **The spider and the ten letters of the name, the markup every animated copy
 * of the wordmark shares.**
 *
 * styles/logo-animations.css keys all thirteen animations off `.logo-letter`
 * and `.logo-image` (inside `.logo-mark`), and useLogoAnimation offers the
 * letter ones only where it finds a drawn `.logo-letter` in its host
 * (logo-animation.ts § lettersDrawn). So *which pages get the full set* is a
 * question about markup, and this file is the one answer to it. Until
 * 2026-09-29 the letters were typed out three times (HomeLogo, DockHome, the
 * /design gallery) and the marketing `Wordmark` and the shelf's heading had
 * none, which is why only `/contact` and its siblings played the whole set.
 * Greg, 2026-09-29: *"reuse the animated logo+sitename in most other pages"*.
 * docs/plans/260929c-back-links-become-icons-with-tooltips-and-one-animated-wordmark-reused.md.
 *
 * **The wrapper round the letters stays the caller's**, deliberately:
 * `.logo-text` is hidden below 731px (styles/narrow-window.css) and
 * `.dock-btn-label` belongs to the bar's fit ladder, and both are the reason
 * design-logo.md § The two mount points exists. Put `LogoLetters` in a wrapper
 * of its own with nothing else in it — the stagger is `:nth-child` over
 * exactly these ten.
 */

/** The ten letters, as the only children the caller's wrapper should hold. */
export function LogoLetters() {
  return (
    <>
      {"Spideryarn".split("").map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed string, rebuilt whole
        <span className="logo-letter" key={i}>
          {ch}
        </span>
      ))}
    </>
  );
}

/**
 * The spider, in the `.logo-mark` box the mark animations draw against
 * (logo-animations.css § `.logo-mark`). `alt=""` because the name is always
 * beside it or in the host's label: a screen reader saying it twice is noise.
 *
 * `className` is for the image's size and nothing else; the default is the
 * 20px every copy but the shelf's uses.
 */
export function LogoMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className="logo-mark">
      <img
        className={className ? `logo-image ${className}` : "logo-image"}
        src="/spideryarn-logo.png"
        alt=""
        width={size}
        height={size}
      />
    </span>
  );
}
