# The origin URL under the masthead title, and rich tooltips for the marks beside it

> Show the url from which the original came (if there is one) right underneath the title in the
> masthead. I know we have the view-the-original button, but I think it's important that we are
> prominent about the origin. And improve the tooltips to use our rich tooltips
>
> — Greg, 2026-09-06

Status: **built, reviewed and verified**, 2026-09-06. Branch `worktree-masthead-origin-url`.
Nothing outstanding.

The letter is `e` rather than the `c` that `scripts/plan-name.ts` offered: three same-day plans were
sitting uncommitted in the primary checkout, and that script reads committed files only.

## What changed

**`OriginMark` became `OriginLine`** (`src/web/Masthead.tsx`). It was a 28px glyph beside the title —
an ↗ out to the publisher, a ⬆ for an upload, a ⁇ for an article with no address — with its sentence
in a `title` attribute. It is now a line of text under the title:

| state | drawn |
|---|---|
| has a web address | `↗ example.com/2026/the-piece`, linking out, host solid and path faded |
| owner, PDF, no address | `⬆ Uploaded from a file` |
| owner, not a PDF, no address | `⁇ No web address was recorded` |
| visitor, no address | nothing at all |

The last row is unchanged and is the one the [existing
test](../../tests/masthead-origin.test.tsx) exists for: a visitor's absent `PublicMeta.url` means
*either* an upload *or* an address `publicSourceUrl` withheld, and the two are indistinguishable
from the client.

**Both marks' tooltips became `ControlTip`s.** The origin line's card names the host and says the
thing a reader cannot work out by clicking — the page was read once, at ingest, so what is there now
may differ. The sharing mark's card was a bare string, which inherited `body`'s 1rem because
`.tooltip` deliberately sets no font-size, and had nowhere to put the word *Shared* or *Private*.
Two new constants in `src/messages.ts` carry its second paragraph.

## The decision worth recording: the glyph went rather than gaining a sibling

Greg's instruction acknowledges the existing control — *"I know we have the view-the-original
button"* — so keeping it was the safe reading. It was not the right one. With the line added, the
URL case would have had **three** affordances for one address inside two lines: the title (a link
since the masthead existed), the ↗ mark, and the line. And the glyph answered neither of Greg's two
instructions on this feature: *"make it clear that it was uploaded"* (2026-08-30) was answered with a
shape whose meaning lives in a tooltip, and *"prominent about the origin"* cannot be done by a 14px
arrow.

The title stays a link, because it always has been and costs nothing.

## The simpler option passed over

**Show the whole URL as one plain string, no host/path split.** Rejected on measurement rather than
taste: a real article URL is longer than the masthead on a laptop and much longer on a phone, so
something has to be cut, and a naive truncation cuts from the end of the *host* forward when the
line is a single shrinking flex item. The host is the half that answers the reader's question. So
the line is a flex row in which only `.origin-path` may shrink, and the ellipsis is on it
(`src/web/styles.css` § `.origin`). That is one extra span and four extra CSS declarations.

**Also passed over: the fetch date in the card** (`meta.fetchedAt` is right there). It would need a
date formatter this component does not have, and the sentence it supports — *the page may have
changed since* — is true and useful without a number.

## Accessibility, and the shape that was rejected twice before

The upload / unrecorded line is a statement, not a control, so its tooltip is unreachable by
keyboard. `tabIndex` on a plain element is refused by biome (`a11y/noNoninteractiveTabindex`) and a
`<button>` would promise that Enter does something. Both were tried and rejected in
`AccessSharing.tsx`'s inventory chips for exactly these reasons, so this follows that file's
conclusion: a plain `<span>` with `cursor: help` and the sentence in an `sr-only` span, permanently
in the accessibility tree rather than only while the panel is open.

The link keeps an `aria-label` (*"View the original at example.com"*) distinct from its visible text,
because an address read aloud is a string of syllables that does not announce it goes anywhere.

## What the cross-family review caught, and it was worth having

GPT Sol, 2026-09-06, on the built code. Six findings, all applied. Three of them are the reason this
section exists — none was visible on a normal article, and none would have been found by looking.

1. **The line could show a different address from the one it linked to.** `pathOf` stripped a
   trailing slash from `pathname + search + hash` as one string, so `example.com/a?next=/` displayed
   as `example.com/a?next=` — a *different query*. Same for a fragment ending in a slash. And the
   host came from `hostOf`, which reports `URL.hostname` and so dropped a non-default port:
   `example.com:8443/p` drew as `example.com/p`. On the one line in the app whose whole job is
   provenance, that is the single thing it may not do.
2. **A malformed URL became a new visible-text sink.** `webSource`'s allowlist is a
   `/^https?:\/\//` regex rather than a parse, so `https://[bad` reaches the masthead — and an
   *imported* article's metadata goes straight into the row. The first version printed it. React
   escapes it, so it was never markup; it could still be a screenful of bidi controls under the
   title. It falls back to the words *View the original* now, keeping the link and losing only the
   text.
3. **A 253-character hostname overflowed the masthead.** `.origin-host` was `flex: none`, and
   `max-width: 100%` on the parent does not constrain a non-shrinking child. The host takes a
   last-resort ellipsis now, once the path has collapsed.

Also: one tooltip made a promise that is false (*"re-adding the piece from its URL would fill this
in"* — deduplication has nothing to match an existing row against, so it would adopt or create a
different article); one restated its own first paragraph; and five comments across the repo were
stale. All fixed. Sol agreed the glyph should go, and found no new URL-scheme or markup sink.

`addressParts` and the CSS carry the reasoning at the point of the code, and
`tests/masthead-origin.test.tsx` has a test that would go red for each of the first two.

## How it was verified

- `npm run typecheck` green; `npx biome check` clean on every touched file, with no new diagnostic.
- `npm test` on the final tree: **733 files passed, 3 failed** — `admin-store.test.ts` (passes
  alone; contention on the shared box) and `cold-start-lazy-imports` / `pdf-bundle-trace`, which
  fail with *"api-dist/vercel.js is missing — run `npm run build`"* in any fresh worktree.
- A browser pass at 1280px and 390px, **twice** — once before the review's fixes and once after,
  because adding `overflow: hidden` to a baseline-aligned flex item can move its baseline. Measured
  rather than eyeballed: `.origin-host` scrollWidth === clientWidth (176px, never cut) while
  `.origin-path` truncates 433px into 86px; `iconCenterY === hostCenterY` at both widths; a
  254-character host clamps to 286px with `document.scrollWidth === window.innerWidth`; a
  213-character tooltip head wraps at exactly 352px instead of stretching the card. No console
  errors.

## Where it is written down

- [`src/web/Masthead.tsx`](../../src/web/Masthead.tsx) § `OriginLine` — the reasoning, including why
  the glyph went
- [`docs/project/web-client.md`](../project/web-client.md) — the masthead row
- [`docs/project/tooltips.md`](../project/tooltips.md) — `Masthead.tsx` is a listed customer now, and
  the only tooltip in the app whose trigger is a line of text
- [`tests/masthead-origin.test.tsx`](../../tests/masthead-origin.test.tsx) — the same assertions,
  moved from `aria-label` to visible text, plus one new test for the address itself
