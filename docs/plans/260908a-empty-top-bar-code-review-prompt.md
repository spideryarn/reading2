# Review the code, now that it is built

You reviewed the plan for this and returned "do not build as written" with three P1s. This is the
second pass, on the **built code**, and it is the one that counts — a plan-stage review cannot see
a `PATCH` that writes one field and then rejects the request.

Be adversarial. I want findings, not encouragement. **The repo root is the current working
directory**; read whatever you need.

## What to read

- **The diff**: `/tmp/claude-1000/-home-greg-code-spideryarn2/355c2209-407c-49ce-bcb4-f7b26e528310/scratchpad/fb2e-code.diff`
  (`src/web` and `tests` only — the docs are separate)
- **The plan, rewritten after your review**:
  `docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md`. Its § What the
  review changed says what I did with each of your five findings, and § How we knew carries the
  measurements.
- **Your plan review**: `docs/plans/260908a-empty-top-bar-plan-review-sol.md`

## What I did with your findings

1. **P1, the forged `.controls`** — confirmed, and the sanitiser is worse than you said: running it
   over `<div id="root"><div class="reader"><p class="controls">a decoy</p><aside class="mode-band">band</aside></div></div>`
   returns it **byte-for-byte**, `id` and all. So I did **not** use `#root > .reader`, because a
   forged chain matches that too. Instead:
   - JS: `controlsBar()` in `src/web/scroll.ts` — first `.reader` in document order, then
     `:scope > .controls`. Four call sites converted, plus `ViewportProbe`.
   - CSS: `:where(.reader) > .controls`, which closes the ordinary decoy and **not** a forged
     `.reader` wrapper. Measured: that case still reserves 44px. I judged that acceptable and
     documented it, because the cost is a cosmetic strip on the publisher's own article.
   - `.mode-band` in the guard is left unscoped, on the argument that a forgery there can only hold
     the bar down.
   - **I did not touch `src/sanitize-policy.ts`**, which is a defence under `docs/project/security-map.md`
     and which `docs/project/feedback-reports.md` says an unattended run writes up rather than
     edits. It is in § What this leaves for Greg.
2. **P1, `commentError` in the predicate** — removed; `BarContents` has no such field.
3. **P1, `title` and the accessible name** — I used neither. Three carriers: a visible
   `.dock-count.failed` mark, an `sr-only` node via a new `note` prop on `DockTab`
   (`aria-describedby`), and a `.dock-drawer-error` sentence in the drawer. `aria-label` stays
   "Comments".
4. **P2, verification** — § How we knew, including a browser probe of all seven cascade states at
   `--safe-top` 0 and 47.
5. **P2, `display: none`** — you were right; the bullet is rewritten with reasons that hold.

## What I most want you to attack

1. **`controlsBar()`.** Is "first `.reader` in document order is necessarily ours" actually true on
   every page that mounts a reading view — including `PublicPages.tsx`, `Metadata.tsx`,
   `Tweets.tsx`, `DesignPage.tsx` and `FeatureBoundary`'s fallback? Is there a page with no
   `.reader` where a bare query used to find something and now finds nothing, changing behaviour?
2. **`barHasContent` against the JSX it must complement.** Read `src/web/layout.ts` and the
   `{showBar && …}` block in `src/web/reader/Reader.tsx` side by side. Is there **any** combination
   of props where the predicate says false and the JSX would have rendered something, or vice
   versa? `ViewOnlyChip`, the granularity pills, the paragraph pill and its notice — and anything I
   have not noticed.
3. **The CSS.** Does the ladder still resolve as the table claims now that `BAR` is
   `:where(.reader) > .controls`? Check `narrow-window.css`'s `@media` block and `design-page.css`'s
   `--bar-bottom: 0px` for interference. Does `preview-colour.tsx` / `preview-timeline.tsx`, which
   set `--bar-bottom` inline, still behave?
4. **The Dock changes.** The `note` prop and `aria-describedby`: floating-ui's `useRole` also sets
   `aria-describedby` on this trigger while the card is open. Is the interaction acceptable, or does
   one silently destroy the other in a way that leaves the failure unannounced? Is
   `CommentsChip`'s extraction behaviour-preserving? Does `fitSignature`'s new `own.error` term
   actually reach every call site that matters (`Dock.tsx:1294`)?
5. **What removing 44px of sticky flow box does.** Scroll anchoring, `?at=` restoration, deep links,
   `.reader::before`, the masthead's sticky interaction, `fitView`. I claim nothing; tell me if
   something breaks.
6. **The tests.** Do they assert the thing, or the implementation? I moved two fixtures in
   `bar-motion.test.tsx` and `mobile-chrome.test.ts` into a `.reader` — is that a test bending to
   fit the code, or the code being right and the fixture having been wrong? Is
   `tests/a-failed-comment-write-is-said-on-the-dock.test.tsx` complete, and can any of it pass
   against a broken implementation?
7. **Anything I have got wrong, or any comment in the diff that asserts something untrue.** There
   are a lot of new comments; several make load-bearing claims. Check them.

Answer with numbered findings, each with a severity (P0/P1/P2), the file and line, and what you
would do instead. **Also say explicitly whether you think this is safe to land on `dev`**, and if
not, what would have to change first. If a claim is unsupported, say "you have not shown this"
rather than guessing.
