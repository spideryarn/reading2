# An article's own `title` attributes, shown in our card and marked as the author's

Queue item `qi-ra2qwnfk`, from Greg's reply `spya-y0xzwm` to
[q-z2c269](../user-feedback/questions/q-z2c269.md) (report `spya-q04h98`, plan
[261017g](261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md)).

> I'm inclined towards C. It sounds like we think this could be valuable content. Or I suppose we
> could just trust that our glossary will catch it...? We should indicate that it's author provided
> if we do keep this. It's not worth huge amounts of complexity for, though. So I guess I'm leaning
> towards keeping it, but use your judgment.
>
> — Greg, 2026-10-18 (spya-y0xzwm)

## What is there now

Since 261017g every tooltip *our* code draws is our card. What is left is an article's own `title`
attribute: DOMPurify keeps it, so the prose shows the browser's grey box over it.

**Measured on the local store, 2026-10-18** (281,843 blocks; `data/titles-survey.ts`, not
committed): 169,972 elements carry a `title` — 131k links, 38k spans, 576 images, 382 `<abbr>`,
25 iframes. Most say nothing the reader cannot already see:

- the title is the link's or the span's own text (`<abbr title="circa">` is not, `<a title="Leo">Leo</a>` is);
- the title restates the address — every Wikipedia link (`/wiki/Ancient_Corinth`, *Ancient Corinth*);
- COinS metadata (`<span class="Z3988" title="ctx_ver=Z39.88-2004&…">`), never meant for a person;
- empty.

With those four set aside, **24,725 remain** (14.5k links, 9.6k spans, 377 abbr, 142 img), and they
are worth having: gwern's link titles are the citation the link stands for (*'Scaling Laws for
Neural Language Models', Kaplan et al 2020* on the words *science*); his date and inflation spans
(*1981 was 45 years ago.*); Wikipedia's *Freely accessible* on a DOI; an arXiv paper's section
names on its cross-references; `<abbr>` expansions. Greg's glossary question: the glossary is the
model's account of the piece's terms and covers none of these — a citation, a date note, an
expansion the author chose — so it does not replace them.

## The change (option C)

1. **The policy renames `title` to `data-author-title`**, in `installArticlePolicy`'s
   `afterSanitizeAttributes` hook (src/sanitize-policy.ts), on every element except `<iframe>`, whose
   `title` is its accessible name, not a tooltip. `data-author-title` joins `ARTICLE_DATA_ATTRS` as a
   third family, *the author's own words, moved off `title`*. One policy, so both bindings do it,
   `tests/sanitize-client.test.ts`'s byte-for-byte equality holds, and a second pass is a no-op.
   - **Forging it is not a hole, and that is why it may be a kept name rather than a reserved one.**
     An article that ships `data-author-title="…"` gets exactly what `title="…"` would have given it:
     its own words, labelled as its own. Nothing of ours is claimed. The allowlist test's "no browser
     code trusts a kept name" list gains it, with that reason.
   - **An element whose only name was its `title`** (an icon link with no text and no `aria-label`)
     gets `aria-label` from it, so a screen reader still hears it — 261017g's rule for our own.
   - **`SANITIZER_VERSION` is not bumped.** An artefact cleaned under 8 is not unsafe: a `title` is
     kept text, and the browser pass renames it at ingress anyway. Bumping would re-sanitise every
     stored article on its next server read for nothing. Said in the version history.
2. **Existing articles get it at render** — the browser binding runs on every load — without being
   re-imported (Greg, spya-r8arjm: no re-import). New imports store the renamed attribute.
3. **The one server reader of `title` on block html**, `anchorsOf` in src/bibliography.ts (a link's
   label, used to match a citation), reads `data-author-title` and falls back to `title`, since stored
   blocks from before this change still carry the old name.
4. **The prose card shows it.** `ProseHoverCard` reads `closest("[data-author-title]")`, keeps it only
   if `authorTitleWorthShowing` (a small pure function, src/web/author-title.ts) says it adds
   something — the four exclusions above — and draws one section: a `prose-card-label` *from the
   article* in our voice, then the words in the author's (`voice-author`, fonts.md), clipped at 300
   characters. It sits above the link half, since it is usually the author's description of the
   link. The selector gains `.prose [data-author-title]` so a titled `<abbr>` or `<span>` opens a card
   by itself; nothing changes for touch (a native `title` never showed under a finger either).
5. **Docs**: security-map.md's sanitiser row says the policy renames `title`; tooltips.md says where
   the author's hover text went; the q-z2c269 bookkeeping.

## What it costs and what it does not do

- **Exports and the MCP payload carry `data-author-title` instead of `title`** on newly imported
  articles. Nothing reads it there; the words are not lost.
- **A screen reader loses a link's or a span's `title` as a description** (an `<abbr>`, an unnamed
  link and an unnamed image keep theirs — see Sol's finding 2 below).
- The filter is a heuristic. It errs to *show* (a redundant title costs one line in a card that is
  already opening); the one wholesale case it guards against is Wikipedia's.

## The simpler options passed over

- **A — leave it.** No code, but the grey box stays on 24k elements that are worth reading, and on a
  link it sits next to our card.
- **B — strip `title`.** One line, and every one of those 24k goes, including gwern's citations.
- **Rename at ingress, outside the policy**, as src/web/external-links.ts does for `target`. Avoids
  touching the defence, but maths.ts puts changed blocks back through the policy, which would strip
  our attribute again, and the stored html would still carry `title`. The policy is the one place
  that sees every path.

## GPT Sol's plan review, and what changed

[Review](261018n-author-title-plan-review-sol.md): *proceed with fixes*, five findings, all taken.

1. **P1, block ids.** A text-less block's identity is its attributes (`emptyKey`, src/blocks.ts), so a
   stored `<hr title="thin">` and a new `<hr data-author-title="thin">` stopped matching and the rule
   would re-mint. Fixed in the key, which spells `title` as the new name;
   `tests/empty-blocks-keep-their-ids.test.ts` went red first. Sol also suggested bumping
   `SANITIZER_VERSION`; not done, because with the key fixed nothing stored is wrong, and the bump's
   rule is "an artefact could now be wrong".
2. **P2, accessibility.** Beyond the empty link: an `<img>` with no `alt` gets `aria-label`
   (not one with `alt=""`, which is decorative), and an `<abbr>` gets `aria-description`. Other
   elements' titles, which were only ever a description, are not copied into ARIA — that would be
   170k repeats, mostly Wikipedia page names.
3. **P2, cross-references.** A titled `<span>` round a `mark.xref` would have opened our card beside
   BlockLinkCard. Such an element gives up its hover text.
4. **P2, the filter.** Visible-text comparison now ignores only case, spacing and outer quotes, so
   `C++` over `C` is kept; the address comparison stays aggressive.
5. **P3, parity.** Six title cases joined `tests/sanitize-client.test.ts`'s corpus (each namespace, a
   forged copy, the iframe). A real Chrome check was done by a browser subagent: no `[title]` left in
   two articles' prose, the card drawn in Source Serif 4.

## Verification

- `tests/sanitize.test.ts`: `title` becomes `data-author-title`; iframe keeps `title`; an empty-text
  link gains `aria-label`; idempotent. Red before the hook.
- `tests/sanitize-allowlist.test.ts`: the pinned lists.
- `tests/author-title.test.ts`: each exclusion, and a gwern citation kept.
- `tests/bibliography*.test.ts`: a link label from either name.
- Browser: a Sonnet subagent hovers a gwern link and an `<abbr>` on the local dev server — card shows
  *from the article* in the author's face, no grey box.
