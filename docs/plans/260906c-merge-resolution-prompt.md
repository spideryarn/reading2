# Merge resolution for review — `dev` into `worktree-a1-a3-reader-composition`

**What I need from you.** I have not edited anything. This is the proposal, before the edit, per
`docs/reusable/git-resolve-merge-conflicts.md`. Tell me where the resolution below is wrong, and
especially where it is *plausibly* wrong — a resolution that compiles and passes tests while having
silently dropped one side's intent is the failure mode I am afraid of here.

## The two sides

My branch is stages 1a–4b of
`docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md`: items A1 and
A3 of the architecture review. It splits `src/web/App.tsx` (5,920 lines) into sixteen files —
article access, `Reader` and its position hook, the mode controllers, and last of all Chat/Remember.
`App.tsx` is now 407 lines. The governing rule for the split was **move functions without changing
interfaces first**, and that rule is why this merge is tractable at all; see below.

- 8 commits on my side; **198** commits landed on `dev` underneath me.
- Merge base `0977d6f6`.
- `git merge-tree` reports **11 conflicting files**.

Two large pieces of other people's work are in those 198 commits and account for most of the
conflicts:

1. **A10** split `src/web/styles.css` (15,489 lines) into ~38 sheets under `src/web/styles/`, and
   introduced `tests/helpers/stylesheets.ts` (`readerCss()`, `readerCssNoComments()`) so that a test
   reads *the reading-view sheets as a set* rather than one path.
2. **A5** worked the mode surface: `MODE_TARGET` in `src/web/activation.ts`, and
   `tests/every-mode-draws-its-surface.test.tsx` with `SPENDS` and `DRAWS` tables total over `Mode`.

## Ten of the eleven conflicts are the same shape

In each, **both sides improved different halves of the same statement**: dev re-pointed the
stylesheet half, I re-pointed the source-file half. My proposed resolution for all ten is to keep
both halves. I want you to check that claim rather than accept it.


### The doc conflicts


#### `docs/project/diagram.md`

**Proposed:** Keep my `DiagramMode.tsx` mode-controller citation **and** dev's two new stylesheet paths (`styles/diagram.css`, `styles/diagram-drift.css`). Neither side contradicts the other.

```diff
<<<<<<< HEAD
  [`src/web/DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx), with
  [`src/web/modes/diagram/DiagramMode.tsx`](../../src/web/modes/diagram/DiagramMode.tsx)
  as the mode controller that mounts it,
  `§ diagram mode` and `§ drift and trail` in
  [`src/web/styles.css`](../../src/web/styles.css).
=======
  [`src/web/DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx),
  `§ diagram mode` in [`src/web/styles/diagram.css`](../../src/web/styles/diagram.css) and
  `§ drift and trail` in [`src/web/styles/diagram-drift.css`](../../src/web/styles/diagram-drift.css).
>>>>>>> origin/dev
```


#### `docs/project/quotes.md`

**Proposed:** Keep my `QuotesMode.tsx` citation (`QuotesBand`, `VisitorQuotesBand`, `useQuotesMode`) and dev's `styles/quotes.css`. **Note dev's side asserts `QuotesBand` is in `App.tsx`, which my side has made false** — so here my half must win outright rather than merge.

```diff
<<<<<<< HEAD
[`src/web/search-hits.ts`](../../src/web/search-hits.ts),
[`src/web/modes/quotes/QuotesMode.tsx`](../../src/web/modes/quotes/QuotesMode.tsx)
(`QuotesBand`, `VisitorQuotesBand`, `useQuotesMode`), and `§ quotes mode` at the end of
[`src/web/styles.css`](../../src/web/styles.css). Tests:
=======
[`src/web/search-hits.ts`](../../src/web/search-hits.ts), `QuotesBand` in
[`src/web/App.tsx`](../../src/web/App.tsx), and `§ quotes mode` in
[`src/web/styles/quotes.css`](../../src/web/styles/quotes.css). Tests:
>>>>>>> origin/dev
```


#### `docs/project/summaries.md`

**Proposed:** Keep my `SummaryMode.tsx` citation and dev's `styles/summary.css`.

```diff
<<<<<<< HEAD
[`src/web/modes/summary/SummaryMode.tsx`](../../src/web/modes/summary/SummaryMode.tsx) (the mode
controller that mounts it), [`buildSummaryTree`](../../src/web/tree.ts) in `src/web/tree.ts` (the
shape it draws), and `§ summary mode` at the end of
[`src/web/styles.css`](../../src/web/styles.css). **There is no stage**, no artefact and no route:
everything on screen arrives inside the article payload.
=======
[`buildSummaryTree`](../../src/web/tree.ts) in `src/web/tree.ts` (the shape it draws), and
`§ summary mode` in [`src/web/styles/summary.css`](../../src/web/styles/summary.css). **There is no
stage**, no artefact and no route: everything on screen arrives inside the article payload.
>>>>>>> origin/dev
```


#### `docs/project/new-mode.md`

**Proposed:** **Union of rows.** This is the table of compiler-checked totals over `Mode`. Mine adds `band()`'s switch and `selectPassages`; dev adds `MODE_TARGET` and `SPENDS`/`DRAWS`, and improves the `BAND_SAYS` row's description. All four rows should stand. This is the one doc conflict where I think there is a *semantic* question underneath — see Q2 below.

```diff
<<<<<<< HEAD
| `BAND_SAYS` | [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) |
| `band()`'s `switch` | [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx) — **which band the mode opens**, and it is a `switch` with a `never` default rather than a `Record`, because each arm is JSX with its own gates. A mode with no arm is a compile error; a mode that deliberately has no band says `return null` in its own case, as `plain` and `hierarchy` do |
| `selectPassages` | [`src/web/reader/passages.ts`](../../src/web/reader/passages.ts) — **which passage slot the prose marks, the ring and the rail are drawn from.** Same `never` default. A mode with no passage producer answers `NO_FOUND` explicitly; nine do |
=======
| `BAND_SAYS` | [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) — what a **visitor** is shown |
| `MODE_TARGET` | [`src/web/activation.ts`](../../src/web/activation.ts) — **whether pressing it spends money.** Total since 2026-09-06, over a tagged union: `fixed` carries the target, `delegated` carries **an arming function** (Diagram, whose target is whatever `?diagram=` says), `none` carries the reason in a sentence. A `delegated` row holding a *name* rather than a function was the first draft and GPT Sol refused it — nothing consumes a string, so a mode could claim delegation with no arming path anywhere |
| `SPENDS` and `DRAWS` | [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx) — what an **owner's** press buys, and what the band actually draws. Both independently written, never derived from the tables above. `DRAWS` is total over `Mode` with no exclusions — a mode that draws no band says so as a `kind: "none"` row **carrying the positive control**, what is on screen instead. It was keyed `Exclude<Mode, NO_BAND_MODES>` until GPT Sol's F21 on 2026-09-06, and that one list both excused a mode from the table and skipped it at run time, so a mode added to it was checked by nothing |
>>>>>>> origin/dev
```


#### `docs/project/url-state.md`

**Proposed:** **Take dev's side whole**, then correct one phrase in it: its closing sentence says *"The override is per-call in `App.tsx`"*, and that code is now in `Reader`. Dev's version subsumes the paragraph I edited (it documents a jump-history feature that did not exist when I wrote mine).

```diff
<<<<<<< HEAD
The one exception is **clicking a gist to jump**, which pushes. That is a scroll, but it is a
deliberate act — you flung yourself across the article and may well want that undone. The override is
per-call in `Reader`, not in the parser.
=======
The exception is **a deliberate jump**, which pushes. That is a scroll, but you flung yourself
across the article and may well want it undone. Clicking a gist is the original case; choosing a
question out of the comments drawer is another, added 2026-09-06
([comments.md § Opening a question is a jump](comments.md#opening-is-a-jump)) — and the dialog's
Prev/Next deliberately are *not*, because stepping through twenty questions must not cost twenty
presses of Back. The override is per-call in `App.tsx`, not in the parser.

#### The pushed entry says where you came from

Since 2026-09-06 a jump does not only push: it also **rewrites the entry it is leaving** so that
`?at=` names where the reader was actually standing, and puts a stamp on `history.state` naming that
same place. That is what lets [`ReturnChip.tsx`](../../src/web/ReturnChip.tsx) offer *↩ back to
&lt;section&gt;* on a home-screen PWA, where there is no browser Back to press —
[260906g](../plans/260906g-back-to-where-you-jumped-from.md).

Three things about it are worth knowing before you touch anything near here:

- **The origin is measured, not read.** `?at=` is the wrong thing to stamp, in three separate ways:
  it is absent at the top, it deliberately holds a stale fine block while the reader moves inside one
  section (§ The unit is a section), and a jump's `throttle(0)` *cancels* the write queued behind the
  300ms debounce rather than flushing it. `measureOrigin` ([`keynav.ts`](../../src/web/keynav.ts))
  asks the layout instead.
- **Both writes belong to `watchHistoryWrites`** ([`router.ts`](../../src/web/router.ts)), not to the
  caller, and that is not a stylistic choice: nuqs keeps pending updates in a `Map` keyed by
  parameter name, so two `setAt` calls in one tick are not a transaction — the second overwrites the
  first, one push lands, and the predecessor rewrite silently never happens.
- **A push strips the stamp unless a jump armed it.** nuqs hands `pushState` the *current* entry's
  state verbatim, so without the strip a `cols` or `mode` toggle after a jump would inherit that
  jump's origin and the chip would promise a return it cannot make.

Nothing about it rides along in a shared link: the record lives on `history.state`, per entry, which
is why it is not a `?from=` parameter. The stamp is not a parameter and so is not in § The
parameters; the one place it is written down is
[`jump-history.ts`](../../src/web/jump-history.ts).
>>>>>>> origin/dev
```


### The test conflicts


#### `tests/aimed-column.test.ts`

**Proposed:** Keep dev's `readerCssNoComments()` **and** my `src/web/reader/Reader.tsx` read, dropping dev's `app` binding. Both sides made the same class of fix to different halves.

```diff
<<<<<<< HEAD
const css = readFileSync(new URL("../src/web/styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const tsx = readFileSync(new URL("../src/web/TableView.tsx", import.meta.url), "utf8");
/* The reading view, which left `App.tsx` for src/web/reader/Reader.tsx on
   2026-09-06. Named here so that a subject which moves again fails on the read
   rather than on an assertion against the wrong file. */
const reader = readFileSync(new URL("../src/web/reader/Reader.tsx", import.meta.url), "utf8");
=======
/* The reading-view sheets as a set. Named `src/web/styles.css` until
   2026-09-06, when that file became thirty-eight `@import` lines: a rule that
   moves between sheets must go on being found, and one that is *deleted* must
   still fail. tests/helpers/stylesheets.ts. */
const css = readerCssNoComments();
const tsx = readFileSync("src/web/TableView.tsx", "utf8");
const app = readFileSync("src/web/App.tsx", "utf8");
>>>>>>> origin/dev
```


#### `tests/referee-band-fits.test.ts`

**Proposed:** Keep dev's `readerCss()` and my `BAND_FILE`/`BAND_SOURCE` pointing at `src/web/modes/referee/RefereeMode.tsx`; drop dev's `APP` binding.

```diff
<<<<<<< HEAD
const CSS = readFileSync("src/web/styles.css", "utf8");
const BAND_FILE = "src/web/modes/referee/RefereeMode.tsx";
const BAND_SOURCE = readFileSync(BAND_FILE, "utf8");
=======
/* The reading-view sheets as a set rather than one path — `src/web/styles.css`
   has held nothing but `@import`s since 2026-09-06. */
const CSS = readerCss();
const APP = readFileSync("src/web/App.tsx", "utf8");
>>>>>>> origin/dev
```


#### `tests/text-alone-centring.test.ts`

**Proposed:** Keep dev's `readerCssNoComments()` and my `reader` binding; drop dev's `app`.

```diff
<<<<<<< HEAD
const css = stripBlockComments(read("../src/web/styles.css"));
/* The reading view, which left `App.tsx` for src/web/reader/Reader.tsx on
   2026-09-06. The read is what fails if it moves again — an assertion pointed
   at the wrong file would simply stop finding what it is looking for. */
const reader = stripLineComments(stripBlockComments(read("../src/web/reader/Reader.tsx")));
=======
/* The reading-view sheets as a set, not one path: since 2026-09-06 a rule can
   move between them without changing, and a test that named the file it used to
   be in would go green over nothing. tests/helpers/stylesheets.ts. */
const css = readerCssNoComments();
const app = stripLineComments(stripBlockComments(read("../src/web/App.tsx")));
>>>>>>> origin/dev
```


#### `tests/sanitize-client.test.ts`

**Proposed:** **Keep both, and this is the one I least want to get wrong.** Dev added a real exemption to the scan (`article: Article` as a parameter annotation, delimiter-sensitive, with a GPT Sol finding behind the delimiter) plus an honest note about what the scan does and does not prove. I moved the subject from `App.tsx` to `src/web/article/access.ts` and added `indexOf` anchor assertions so a rename cannot make the slice silently empty. Dev's docblock + dev's exemption + my `ACCESS` source + my anchor checks.

```diff
<<<<<<< HEAD
       sanitised — it hands its payload to the doorway. */
    const start = ACCESS.indexOf("async function resolveAccess");
    const end = ACCESS.indexOf("async function findArticle");
    /* Both anchors, checked before the slice. `indexOf` returning -1 would make
       `slice` read from the end of the file and the two assertions below would
       then hold against nothing — docs/reusable/silent-success.md. */
    expect(start, "resolveAccess must exist in src/web/article/access.ts").toBeGreaterThan(-1);
    expect(end, "findArticle must follow it there").toBeGreaterThan(start);
    const doorway = ACCESS.slice(start, end);
=======
       sanitised — it hands its payload to the doorway.

       **One exemption, added 2026-09-06**: `article: Article` immediately
       followed by `)` or `,` — a parameter annotation and nothing else. Stage E
       gave `resolveAccess` two answers to build, the first draw and the one
       with the article's own images in it, and the thing that builds both takes
       an `(article: Article)` parameter. A declaration cannot be a source of an
       unsanitised payload, where every other right-hand side can.

       **The delimiter is load-bearing and the first draft did not have it.**
       Exempting the bare word let `{ article: Article }` and
       `{ article: Article as Article }` through as value expressions — GPT Sol
       found it. `article: found.article` still fails, which is the assignment
       this test exists for.

       **And be honest about what this proves.** It is a wiring check, not a
       data-flow proof: `const article = found.article; return { …, article }`
       has always passed it, because the shorthand is matched by shape and not by
       origin. An AST check would be the real thing. The scan's value is that a
       *deletion* or a *rename* — the two ways this has actually broken, twice —
       cannot be silent. */
    const doorway = APP.slice(
      APP.indexOf("async function resolveAccess"),
      APP.indexOf("async function findArticle"),
    );
>>>>>>> origin/dev
```


#### `tests/site-footer.test.tsx`

**Proposed:** Keep my `ts-ast` import, **drop** the `CONTACT_EMAIL` import: dev's commit *'The footer row is links only; the Contact page holds the address'* removed the address from the footer, and the auto-merge already removed the `MAIL` constant that used it. Verified: zero remaining references in the merged file.

```diff
<<<<<<< HEAD
import { type AstNode, parseSource, walkAst } from "./helpers/ts-ast.js";

import { CONTACT_EMAIL } from "../src/site-text.js";
=======
>>>>>>> origin/dev
```


## The eleventh: `src/web/App.tsx`

Raw, this looks unresolvable: one conflict hunk of **5,543 lines**, because dev edited a file whose
body I moved into sixteen others. `git merge-tree` also flags a 252-line hunk over the import block.

But the split was a verbatim move, so I measured it instead of eyeballing it. I parsed base
`App.tsx`, dev's `App.tsx` and every file on my side into top-level declarations, then 3-way merged
**each declaration on its own** (`git merge-file --diff3`, ours = my moved copy, base = base
`App.tsx`, theirs = dev's `App.tsx`). Result:

- Dev's 64 diff hunks touch **12 top-level declarations**, and add 3 new ones. It removes none.
- **11 of the 12 merge with no conflict at all** into the file that now owns them:

| declaration | now lives in |
|---|---|
| `App`, `SignedIn`, `loadAdminHome`, `loadDesign` | `src/web/App.tsx` |
| `ArticlePage`, `OwnedArticle` | `src/web/article/ArticlePage.tsx` |
| `useArticleAccess`, `resolveAccess`, `findArticle` | `src/web/article/access.ts` |
| `ConversationBand` | `src/web/modes/conversation/ConversationModes.tsx` |
| `useReadingPosition` | `src/web/reader/useReadingPosition.ts` |

- **`Reader` is the only conflict**, and it is one hunk in one place: the seventeen sibling
  `{owner && mode === "x" && <XBand …/>}` expressions that my stage 4b collapsed into a single
  `{band()}` call over an exhaustive `switch`. Dev's 14 hunks to `Reader` include 13 that merge
  cleanly (a `rowOf` return from `useReadingPosition`, the `goToComment` split into
  `openCommentFromDrawer` + `stepToNeighbouringComment`, and so on). The 14th edits two of the
  seventeen siblings I deleted.

**What dev actually changed inside that hunk**, which is all that has to be ported:

1. `OutlinePanel`'s `proseBeside` comment — the layout crossover moved from iPad-portrait to phone
   (700px), so the comment's example changed. Comment only.
2. `OutlinePanel` gained a prop:
   `paragraphLabels={paragraphLabelsReady(article.navLabelStatus)}`, with a docblock explaining that
   rung 5 is withheld rather than announced.

**Proposed resolution for `App.tsx`:** resolve the conflict by taking my 407-line `App.tsx`, then
apply dev's changes declaration by declaration using the 11 clean merges above; hand-port the two
`OutlinePanel` changes into `case "outline"` of `band()` in `src/web/reader/Reader.tsx`; place dev's
three new declarations (`loadChangelog` → `App.tsx` beside the other lazy page loaders;
`ResolvedAccess` and `NO_SECOND_ANSWER` → `src/web/article/access.ts` beside `resolveAccess`); and
let the typechecker and the existing import-direction guards place dev's 8 new imports
(`FeedbackHost`/`FeedbackTrigger`, `PublicReadableSharingPage`, `ReturnChip`, `ViewportProbe`,
`rehost.js`, `beginJump` from `keynav.js`, `comment-jump.js`, `nav-labels.js`) into whichever of the
sixteen files now uses each.

## The questions I actually want answered

**Q1 — is the per-declaration 3-way merge sound, or is it a trap?** It is the step I am least sure
of. A clean merge per declaration does not prove the *file* is right: dev could have changed a
declaration in a way that depends on something else it also changed, and my splitting the file put
the two halves in different modules. Where would you look for that? My plan is (a) typecheck,
(b) the JSX-feature multiset checker I wrote for stage 4b, which counts every JSX element and prop
across the old and new trees and reported 241 features and zero diffs, (c) the full suite,
(d) `npm run check`. Is there a fifth check that would catch what those four share an assumption
about?

**Q2 — three totals over `Mode` now, written by two people who could not see each other.** Mine are
`band()`'s `switch` (which band a mode opens) and `selectPassages` (which passage slot marks the
prose), both exhaustive with a `never` default. Dev's is `DRAWS` in
`tests/every-mode-draws-its-surface.test.tsx` — independently written, deliberately not derived, and
per dev's own note it stopped being keyed `Exclude<Mode, NO_BAND_MODES>` after a Sol finding, because
that one list both excused a mode from the table and skipped it at run time. After the merge these
three must agree about all fourteen modes. Nothing in git detects a disagreement. Is `DRAWS` vs
`band()` a check I should add now, or is the duplication the point and a third assertion the wrong
move?

**Q3 — `tests/sanitize-client.test.ts`.** Dev's own comment says the scan is *"a wiring check, not a
data-flow proof"* and that an AST check would be the real thing. My side moved its subject into a
new file and added anchor assertions. Given both sides just touched it, is combining them the right
call, or is the honest move to write the AST check now while the file is already open?

**Q4 — anything in the 198 commits I should have noticed and have not?** I have looked at the 11
conflicts. The doc above warns that a conflict tells you what git *could not* merge and says nothing
about what it merged silently. Where is the silent damage most likely here, given that my change was
a file split and roughly 200 commits of other work landed across it?
