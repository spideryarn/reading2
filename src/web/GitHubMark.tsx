/**
 * GitHub's Octocat mark, drawn in the current text colour.
 *
 * **It is a component rather than a Lucide import because Lucide has no
 * GitHub icon.** [icons.md](../../docs/project/icons.md) says Lucide and only
 * Lucide, and that stands — but Lucide dropped its brand glyphs before the v1
 * we are on, so `lucide-react@1.34.0` exports nothing matching `/github/i`.
 * There is no icon to import and no second icon library to add; there is one
 * path, and this is where it lives.
 *
 * Beside `GoogleMark.tsx` and for the same reason it gives: inline SVG rather
 * than a file in `public/`, because an icon that 404s leaves a control that
 * still looks clickable and nobody notices until somebody mentions the empty
 * square.
 *
 * **`fill="currentColor"`, unlike `GoogleMark`.** Google's is a four-colour
 * asset that may not be recoloured; GitHub's is a monochrome mark, published
 * as one to be used in exactly this way, so it takes the colour of whatever
 * row it sits in and goes faint with it. That is the whole difference between
 * the two files.
 *
 * The path is GitHub's own 16×16 mark.
 */
export function GitHubMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
