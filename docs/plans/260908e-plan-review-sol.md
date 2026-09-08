## Verdict: build it with changes

The diagnosis and core selector are right. The prompt’s two-arm version should not be built; the working-tree plan has already correctly dropped `:focus-within`, but still has two material errors.

1. `.band-covers` is the right state

For application-generated markup, `.reader.band-covers .mode-band` is true exactly when the band covers the prose:

- With a band open, `fitView` always calls `fitMode`.
- `fitMode` returns `modeW: 0` exactly through `bandCoversProse`; otherwise `modeW >= MODE_MIN`.
- `?spine=0` is handled correctly: the boundary is 688px without the spine and 700px with it.
- `?text=0` does not break this: a band forces prose on.
- Hierarchy and Plain may have `.band-covers`, but render no `.mode-band`, so the descendant selector stays false.
- Outline-the-band goes through `fitMode`; outline-the-table has no band.

See [layout.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/layout.ts:375) and [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/reader/Reader.tsx:1767).

2. The specificity claim is wrong

`.reader.band-covers .mode-band` is `(0,3,0)` inside `:has()`. Adding the outer `:root` makes the guard `(0,4,0)`, not `(0,3,0)`. `.dock:focus-within` itself is `(0,2,0)`; only the complete old `:root:has(.dock:focus-within)` selector is `(0,3,0)`.

Likewise, the narrowed transition selector becomes `(0,5,0)`, not `(0,3,0)`. Neither increase currently breaks the cascade, but the plan and test must not claim specificity was preserved.

Use this spelling:

```css
:where(.reader.band-covers) .mode-band
```

That preserves the exact match while keeping the guard and transition at their old specificity. The test’s parenthesis-count assertion would reject this valid fix and does not actually prove specificity; replace it with an exact selector assertion or a real specificity calculation. See [the current test](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/tests/the-dock-hides-in-a-mode-beside-the-article.test.ts:121).

The install-hint selector itself does remain `(0,3,0)`: everything inside `:where()` contributes zero.

3. Do not keep `.mode-band:focus-within`

It is not a keyboard-visible signal. Search autofocuses its input on mount, and Chat does likewise, so this branch pins the dock for essentially the whole lifetime of those modes. It recreates the original proxy bug under a new name. [SearchPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/SearchPanel.tsx:437)

The working-tree plan now records browser evidence and drops this arm; that is the right correction. If keyboard occlusion needs protection later, use the existing visual-viewport measurement rather than focus.

If the focus arm were retained, the transition rule would also need it: focus acquired while `data-bars="hidden"` changes the band’s `bottom` immediately while the dock takes 180ms to arrive. That reintroduces the transient gap. With the focus arm dropped, narrowing `transition: none` to the covering case is correct:

- Covering mode: the dock is forced back and must arrive immediately.
- Side-by-side mode entered while hidden: the dock remains hidden.
- Subsequent scroll reversal: the ordinary 180ms reveal is wanted.
- Reduced motion still snaps through the global duration override.

4. I do not find a demonstrated stranded side-by-side state

A hidden state requires the document to have reached at least the first-screen threshold and then moved downward. Switching to a side-by-side mode narrows the prose and therefore does not normally make that document shorter. A cold URL load starts without `data-bars`; a same-page URL transition preserves a document that was already scrollable. Reduced motion changes animation, not reachability.

Contained scrolling inside some panels does not strand the reader because the article remains exposed beside the panel. The unresolved case is an already-hidden dock plus an actual iOS soft keyboard; the focus proxy does not solve it correctly. That uncertainty should remain explicit.

The plan should, however, correct “every band scroller sets `overscroll-behavior: contain`.” Glossary, Search, Quotes, Chat, and Referee have scrolling elements without it—for example [glossary.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/glossary.css:246) and [search.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/search.css:170). “Several covering-mode scrollers contain overscroll” is enough for the safety argument.

5. The install hint wants a different condition

Its real condition is “the dock is displaced,” not “the band covers.” The dock can be pinned by drawer, dock focus, install-hint focus, or three dialogs as well as by a covering band. Copying only the band condition means the dock can return while the hint remains translated off-screen. That contradicts “the hint goes wherever the dock goes.”

The clean third option is to set an inherited `--install-hint-transform` beside `--dock-bottom` in the hidden rule and the existing pin guard, then have `.install-hint` consume it. That gives the dock and hint one cascade decision instead of duplicating the entire guard selector.

6. The historical diagnosis is correct

The flat `.mode-band` guard was added on 2026-08-31. Commit `089269a4` on 2026-09-06 introduced `MODE_PROSE_FLOOR`, moving the covering boundary from 844/832px to 700/688px without changing that guard. The sibling report independently confirms that `data-bars` reaches `hidden`; CSS alone was pinning the dock.

So: retain the semantic `band-covers` fix, drop the focus proxy, preserve specificity with `:where()`, couple the install hint to actual dock state, and correct the overscroll claim and static test.