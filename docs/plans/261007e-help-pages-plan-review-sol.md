Not ready. The basic Markdown-page design fits the codebase, but the plan misses three established P1 integrations and one established search regression. I reviewed against base commit `67a6b9c`; no files were changed. The requested baseline test passes: 32/32.

## Findings

### R1 — P1 — Established: command-bar Help disappears from model-picked commands

The plan changes contextual Help URLs from `/help#glossary` to `/help/mode-glossary` and says callers follow automatically.

That is false for command identity:

- [`pickKey`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/command-match.ts:380>) strips `?` and `#`, but not pathname segments. Today all contextual Help rows become `page:/help`; afterward they become IDs such as `page:/help/mode-glossary`.
- The generated catalogue contains only `page:/help` ([generated catalogue](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/command-pick-catalogue.generated.json:1945>)).
- The server discards browser rows absent from that catalogue ([command-pick-call.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/command-pick-call.ts:67>)).
- Existing tests explicitly pin fragment Help URLs to `page:/help` ([command-pick-catalogue.test.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/command-pick-catalogue.test.ts:181>), [command-bar-pick.test.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/command-bar-pick.test.tsx:300>)).

Change the plan to canonicalize every `/help` and `/help/<page>` command row to `page:/help`, while retaining its real `href` for navigation. Add path-form catalogue and command-pick tests.

### R2 — P1 — Established: feedback loses its page label on every Help subpage

The server-side feedback classifier recognizes only exact `/help`:

- [`FIXED_PAGES`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/feedback-page.ts:53>) contains `/help`, while [`feedbackPageLabel`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/feedback-page.ts:91>) rejects other paths.
- The corresponding contract currently treats `/help/extra` as not found ([feedback-page.test.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/feedback-page.test.ts:41>)).

After the router recognizes `/help/spine`, feedback submitted there will have no page label.

Change the plan to normalize recognized Help subpaths to the safe label `/help`. Do not echo arbitrary segments into stored labels. Update the feedback route-parity tests for a real and an unknown Help segment.

### R3 — P1 — Established: deleting the three TSX content files breaks unrelated contract tests

The plan deletes `help-topics.tsx`, `help-modes.tsx`, and `help-faq.tsx`, but only schedules a rewrite of `help-page.test.tsx`. Other independent witnesses import or read those files:

- [`annotate-dialog-copy.test.tsx`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/annotate-dialog-copy.test.tsx:21>)
- [`dictation-double-stop-sends.test.tsx`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/dictation-double-stop-sends.test.tsx:51>)
- [`command-bar-double-stop.test.tsx`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/command-bar-double-stop.test.tsx:67>)
- [`citations-panel.test.tsx`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/citations-panel.test.tsx:10>)
- [`search-thorough-duration-copy.test.ts`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/search-thorough-duration-copy.test.ts:20>)
- [`public-readable-sharing-page.test.tsx`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/public-readable-sharing-page.test.tsx:548>)
- [`spine-reading.test.ts`](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/spine-reading.test.ts:476>)

These tests connect Help promises to the features they describe; simply deleting them would lose useful contracts.

Add their migration to S2. Give tests a Vite-compatible helper that exposes parsed Markdown or plain text, then retain the existing assertions against that representation.

### R4 — P1 — Established: the planned search behavior leaves incorrect reader-facing advice

The plan deliberately keeps title-and-keyword-only search and excludes Markdown bodies. Current Help’s no-results message recommends browser Find because it “searches the text of every section” ([HelpPage.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/help/HelpPage.tsx:419>)); a test pins this claim ([help-page.test.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/help-page.test.tsx:321>)).

That is true on the current single page but false after splitting the content: browser Find searches only the current document.

Change the plan either to:

- index Markdown body text at lower weight, or
- explicitly remove the cross-page browser-Find advice and update its test.

The first option better preserves the reader’s existing ability to find text they remember.

### R5 — P1 — Reasoned: client-side page and fragment arrivals need an explicit rerun mechanism

Both App arms currently use the constant `routeKey="help"` ([App.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/App.tsx:617>)), so `LazyPage` can retain the same mounted Help component across `/help/spine` → `/help/questions#faq` ([LazyPage.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/LazyPage.tsx:211>)).

The existing arrival effect runs only on mount and listens for native `hashchange` ([HelpPage.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/help/HelpPage.tsx:190>)). The internal router uses `pushState`/`replaceState`, which does not emit `hashchange` ([router.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/router.ts:1418>)).

Require either a page-specific route key such as `help:${page}`, or an arrival effect keyed to page and fragment changes. Test in-app navigation, Back/Forward, an old topic link, a retired mode alias, and the FAQ redirect—not only direct mounts.

### R6 — P2 — Reasoned: crawlers cannot reliably observe the deferred `noindex`

`/help/<page>` will receive the catch-all `X-Robots-Tag: noindex`, but `robots.txt` disallows it. The site-page code explicitly explains that linked noindex pages must remain crawlable so crawlers can read that instruction ([site-pages.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/site-pages.ts:192>)).

Because `/help` will link to the child pages, a crawler can discover those URLs while being forbidden from fetching their `noindex` header.

Keep them out of `SITE_PAGES` and the sitemap, but add `/help/` to the crawlable-noindex allow-list and cover a real child such as `/help/spine` in the public-shell checks.

### R7 — P3 — Established: the deployment cross-reference has a stale step number

No edit to `overseer.md` is needed: deployment step 4 points to the stable Help maintenance heading ([overseer.md](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/docs/project/overseer.md:564>)).

However, that target currently calls itself the brief for “step 3” ([help-page.md](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/docs/project/help-page.md:87>)). Correct it to step 4 during the already-planned rewrite.

## Answers to the six questions

1. **`?raw` imports:** No fundamental Vite, Vitest, or typecheck trap. Both TypeScript configurations include `vite/client`, and the client boundary scanner permits relative imports within `src/web`. Existing raw imports establish the mechanism ([ChangelogPage.tsx](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/src/web/ChangelogPage.tsx:119>)). Markdown files will also be inspected by the reader-cost leakage test ([no-ai-cost-for-readers.test.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/no-ai-cost-for-readers.test.ts:125>)). Do not expect ordinary Node/`tsx` code to import `?raw`; keep that representation inside Vite/Vitest.

2. **Direct `/help/spine`:** Yes. It misses the exact `/help` rewrite and reaches `shell.html` through the catch-all ([vercel.json](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/vercel.json:38>)). Once `parseRoute` recognizes it, App’s signed-out Help arm draws it. Nothing refuses it. It correctly receives the catch-all noindex header, subject to R6’s crawler issue.

3. **Old links:** A client-side replace is sufficient for serving them, provided route/page changes rerun arrival handling as in R5. Navigation callers use `helpHref` or `HELP_HREF`; I found no separate caller hand-building anchored Help links. The non-navigation assumptions in command identity and feedback still need R1 and R2.

4. **Page grain:** One page per mode is right. For general topics, one page per topic is also the simpler shape: grouping short topics would require another anchor-to-page mapping like the FAQ exception and weaken the typed one-anchor/one-page rule. Keeping FAQs together is sensible.

5. **Deploy step:** Yes, it still holds without changing `overseer.md`; retain the target heading and commands in `help-page.md`. Fix the stale step number under R7.

6. **Search-engine deferral:** It will not make the sitemap or current public-shell loop fail. `/help/<page>` remains outside `SITE_PAGES`, and an existing test already treats `/help/reading` as never indexable ([site-pages.test.ts](</var/tmp/spideryarn-worktrees/fbucftjt-help-pages-and-help-icon/tests/site-pages.test.ts:66>)). It is not fully safe to ship as written because robots prevents crawlers from seeing `noindex`; make the small allow-list change in R6.

VERDICT: not ready