VERDICT: **CHANGES REQUESTED**

### Findings

- **[P2, blocking] Non-default modes still change the title after mount.**

  `/read/article?mode=glossary` is served as `Article · Spideryarn`, then React changes it to `Article · Glossary · Spideryarn`.

  The rewrite preserves `?mode=` ([public-read-rewrite.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-read-rewrite.test.ts:186)), but the transport removes the query before passing only the slug to the page composer ([vercel.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:261), [page.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/page.ts:271)). The client deliberately adds every non-default mode ([page-title.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/page-title.ts:316)), matching the documented rule ([page-titles.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/page-titles.md:63)).

  The fuzz cannot find this because every generated case fixes `view: "article"` and leaves `mode` absent ([page-head.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/page-head.test.ts:471)). The missing dimension is title state, not title characters.

  Add an equality check covering every `MODES` value through the served-page path, then either give the server the validated title-relevant mode or make an explicit different product decision.

- **[P2, test gap] The first-`h1` fallback still has two unpaired implementations.**

  `loadHead` finds the first level-one heading in SQL ([public-reader.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:180)); the public article payload uses `headingTitleOf(blocks)` in TypeScript ([public-reader.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:461), [library-scalars.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-scalars.ts:144)).

  They agree today, but the new fixture covers only the final slug rung. The main fixture has both a stored title and an `h1`, so the heading fallback is bypassed; the new fixture deliberately has no `h1`. A mutation such as `level = 2` or reversed ordinal order in `PUBLIC_HEADING_TITLE` would survive.

  Add a public fixture with `title: null` and deliberately challenging headings, then compare `loadHead.title` with `/api/public/article/:slug`’s `meta.title` and a spelled-out expected first `h1`.

### The other questions

- For the default article mode, string equality is guaranteed, not probabilistic: `articleTitle` returns a non-empty, already-trimmed string, so `join()` cannot alter or drop it. I found no missing title character that breaks that restricted property.
- Description, canonical, `og:title`, and `twitter:title` have no client-side second writer. The three descriptions share one value; the two card titles share one value. `root_gist`’s gist → summary → excerpt fallback is intentionally a card-blurb rule, while the masthead displays only an actual root gist.
- I would keep the 65th code point. The client already emitted it; this merely brings the initial server title into line. There is no `<title>` length limit, and search results truncate to device width rather than a character count. `og:title` remains independent. [Google Search Central](https://developers.google.com/search/docs/appearance/title-link)
- The allowlist additions are sound. `html.ts` imports nothing and `title-text.ts` imports only that leaf; I found no Node or side-effectful dependency or meaningful bundle consequence.
- `normaliseText` is an exact extraction of the previous cleaning chain, and the constants/re-exports preserve existing imports. No unintended behavior change found there.
- Nit: `normaliseText`’s “nothing invisible” claim is too broad. U+200B survives JavaScript `\s`, despite the fuzz comment grouping it with whitespace that `\s` touches ([html.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/html.ts:78), [page-head.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/page-head.test.ts:452)). Correct the comments; this does not break server/client equality.

Verification: 148 targeted tests passed across eight relevant files; the public-shell self-test passed 46/46; all three TypeScript projects passed direct `tsc --noEmit`. I did not rerun the full database suite. No files were edited.