# Separate article access, reader composition and mode controllers

Status: **planned, not built.** Worktree `a1-a3-reader-composition`, branch
`worktree-a1-a3-reader-composition`, off `0977d6f6` (origin/dev, 2026-09-06).

This is items **A1** and **A3** of
[the main app architecture review](260905e-main-app-architecture-review.md#a1-extract-responsibilities-that-already-have-distinct-lifetimes),
and its checklist under *Stage: Separate article access, reader composition and mode controllers*.
That checklist is the authority; this doc is how it gets built.

It follows the shape **A2** established in
[260905h](260905h-a-mode-failure-should-leave-the-article-readable.md): a mode's controller, its
visitor twin and its hook move together into `src/web/modes/<feature>/<Feature>Mode.tsx`, keeping
their props byte-for-byte, and `App.tsx` stops knowing what is inside them.

## The problem, in one paragraph

`App.tsx` is 5,920 lines and holds five unrelated jobs: which page the path names, who is allowed to
read this article, how the reading view is composed, where the reader is in the page, and nine
feature controllers. They have different reasons to change, so every one of them is edited through
the same file, and a dozen tests read that file as a **string** to find the bit they care about. The
review's word for it is right: the problem is coordination across unrelated responsibilities, not
length. Two consequences are concrete rather than aesthetic — the band branch at the bottom of
`Reader` is seventeen sibling `&&` expressions that no compiler checks, and the `passages` selection
above it is a ternary chain whose last arm hands **nine modes that have no search in them** Search's
results.

## What gets built

Four stages, the last in two halves. Each ends green, committed and pushable.

1. **Eight mode controllers out**, into `src/web/modes/<feature>/`, in two batches of four:
   Timeline, Quotes, Debate, Glossary; then Search, Summary, Diagram, Referee. Pure moves.
2. **Chat and Remember out, deliberately last** — the counterexample that proves the design does not
   assume every mode is a list.
3. **`Reader` and the position hooks into `src/web/reader/`; the article-access unit into
   `src/web/article/`.** `App.tsx` is left as route and session composition. An AST test asserts
   that nothing under `modes/`, `reader/` or `article/` can import `App.tsx`.
4. **A3**, in two halves: **4a** one narrow publish/clear/invalid-key lifecycle helper replacing six
   copies of the same three rules, plus the Referee slot fix; **4b** a total `selectPassages`
   returning `{ found, openKey }` together, and an exhaustive `switch` at the composition point.

### Where each thing lands

| Destination | What moves |
|---|---|
| `src/web/modes/timeline/TimelineMode.tsx` | `TimelineBand`, `VisitorTimelineBand`, `useTimelineMode`, `NO_EVENTS` |
| `src/web/modes/quotes/QuotesMode.tsx` | `QuotesBand`, `VisitorQuotesBand`, `useQuotesMode`, `NO_QUOTES` |
| `src/web/modes/debate/DebateMode.tsx` | `DebateBand` |
| `src/web/modes/glossary/GlossaryMode.tsx` | `GlossaryBand`, `VisitorGlossaryBand`, `useGlossaryMode` |
| `src/web/modes/search/SearchMode.tsx` | `SearchBand`, `VisitorSearchBand`, `useSearchMode` |
| `src/web/modes/summary/SummaryMode.tsx` | `SummaryBand`, `useSummaryMode` |
| `src/web/modes/diagram/DiagramMode.tsx` | `DiagramBand` |
| `src/web/modes/referee/RefereeMode.tsx` | `RefereeBand`, `RefereeViews`, `RefereeSubMode`, `REFEREE_VIEW_TIP`, `REFEREE_VIEW_LABEL` |
| `src/web/modes/conversation/ConversationModes.tsx` | `ConversationBand`, `ConversationKind`, `isConversationThread`, `RememberBand`, `QuizSubBand` |
| `src/web/reader/Reader.tsx` | `Reader` |
| `src/web/reader/useReadingPosition.ts` | `useReadingPosition` |
| `src/web/reader/measure.ts` | `useWindowWidth`, `useRootFontPx` |
| `src/web/reader/passages.ts` | **new** — `selectPassages`, `NO_FOUND`, `PassageSlots` (stage 4b) |
| `src/web/passage-lifecycle.ts` | **new** — the publish/clear/invalid-key helper (stage 4a) |
| `src/web/article/access.ts` | `ArticleAccess`, `LOADING`, `useArticleAccess`, `resolveAccess`, `findArticle` |
| `src/web/article/ArticlePage.tsx` | `ArticlePage`, `OwnedArticle`, `OwnedReader`, `VisitorArticle` |
| `src/web/reader-capability.ts` | `NO_SEARCHES` and `OWNER_HAS_EVERYTHING` join `NO_TERMS`/`NO_THREADS` |

`EVERY_MODE_AVAILABLE` and `EMPTY_DEPTHS` have one consumer each and go with `Reader`. Every other
module constant in the file has exactly one enclosing unit — there is no shared-constant tangle,
which is why this can be a sequence of mechanical moves.

## Design decisions

### The order is bottom-up

The checklist is an inventory of what must move, not a prescription of commit order — its own A1
prose says to start with Ideas and Timeline and use Chat as the later test. Implementation follows
**dependency order**: controller batches, then Chat/Remember, then `Reader` and the position hooks,
then article access. That is also the order A2 already used for Ideas.

It has to be that way round. Access-first puts an import cycle in every intermediate commit —
`article/` renders `Reader`, which is still in `App.tsx`, which imports `article/`. ESM tolerates it;
the acceptance criterion *feature files cannot import `App.tsx`* does not. Each batch ends green and
committed; `Reader`/position and article access are separate commits, and neither contains a cycle.

**Chat and Remember move as one file, not two.** `RememberBand` renders `ConversationBand`
([`App.tsx`](../../src/web/App.tsx) § `RememberBand`), so two feature directories would mean one
feature importing another — which A1 forbids alongside importing `App.tsx`. Chat and Remember are two
compositions of one conversation controller, and `modes/conversation/ConversationModes.tsx` says so.
A neutral third home would also work and buys nothing yet. Sol F2.

### The band dispatch stays inside `Reader`, as a local function

`Reader`'s own docblock proposes a `<ModeBands>` component, and the audit priced it: **twenty-one
props if the passage state is bundled, thirty-four if not.** The review is explicit that a
sixteen-value bag is not a smaller interface, so we do not build it.

Instead the seventeen sibling `&&` expressions become one local function inside `Reader`:

```tsx
function band(): ReactNode {
  switch (mode) {
    case "plain":
    case "hierarchy":
      return null;                       // no band, and the compiler knows it
    case "timeline":
      return owner ? <TimelineBand … /> : artefacts?.timeline ? <VisitorTimelineBand … /> : null;
    …
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
}
```

It closes over `Reader`'s scope, so it threads **zero** props; it calls no hooks, so it is not a
component and the rules-of-hooks question does not arise. `plain` and `hierarchy` return `null`
explicitly rather than falling off the end. The `never` default is the idiom already in
[`visitor.ts`](../../src/web/visitor.ts) § `visitorGap`.

`<VisitorBand gap={gap}>` stays **above** the switch, unchanged: it is placed there precisely so a
mode added later cannot arrive without a visitor sentence, and folding it into fourteen cases would
undo that.

### `selectPassages` is total, and returns both halves together

Today `passages` and `openPassage` are two independent ternary chains that agree only because both
test `mode` in the same order, and both end `: found` / `: openHit`. Ten modes reach that last arm and
only one of them, Search, owns it — so **nine modes** inherit Search's results by position in the
chain. That is visible: leaving Search for Plain unmounts `SearchBand`, whose clear is a *passive*
unmount cleanup, so the prose paints Search's marks for one frame in a mode that has no search in it.

```ts
export function selectPassages(mode: Mode, slots: PassageSlots): { found: Found[]; openKey: string | null }
```

Pure, module-level, exhaustive over `Mode` with a `never` default, in `src/web/reader/passages.ts`,
and unit-testable against every mode without mounting anything. Search returns `slots.search`
explicitly; the **nine** modes with no passage producer — Plain, Hierarchy, Chat, Glossary, Summary,
Diagram, Remember, Outline and Debate — return the module constant `NO_FOUND`. **A constant and not a
fresh `[]`**, because `hitMarks`,
`hitStrength`, `hitHues` and `hitBlocks` are memos keyed on that array by identity, and a new empty
array each render would recompute every block's marks on every render. Same rule as `NO_EVENTS`,
`NO_QUOTES` and `NO_TERMS`.

The five producer slots stay five. They exist because outgoing passive cleanup must not erase
incoming layout-effect publication, which is an ownership requirement with a written history
(`App.tsx` § `ideaFound`, and [260826ac-ideas-mode](260826ac-ideas-mode.md)). The single
publication slot the review floats as an optional later simplification is **not** in this plan.

### One lifecycle helper, three rules, three shapes

Six producers hold six copies of the same three rules, and the file says so itself: *"a fix to one of
these belongs in all three"* — which said *"in both"* until Referee became the third, and is now six.
The helper takes only what is genuinely identical:

- **publish**, in a `useLayoutEffect`, before paint;
- **invalid-selection cleanup**, passive: an `openKey` no longer in `found` becomes `null`;
- **unmount clear**, passive, with no data dependencies.

Its input is discriminated three ways, because there are three real shapes and not two:

| `kind` | Producers | Inbound key | Publishes key | Invalid-key effect |
|---|---|---|---|---|
| `keyed` | Ideas, Timeline, Search, Criteria | yes, as a prop | no | yes |
| `derived` | Quotes | no — computed from `?quote=` | yes, **in the same layout effect** | no; impossible by construction |
| `unkeyed` | Claims | no | no | no; unmount clears `found` only |

**The unmount clear is a layout cleanup for every producer, not only the two that share a slot.** An
earlier draft carried a `sharesSlot` field so only Criteria and Claims got it; Sol F10 showed that
field earns nothing. What the existing comments actually warn against is folding the clear into the
*publication* effect, whose data dependencies change on every keystroke — *"its own effect, with no
dependency on the results, so it runs on unmount and only on unmount"*. That argument is about
**dependencies, not phase**: a separate unmount-only effect depending on nothing but the stable parent
setters never runs on an ordinary update, in either phase. Making it universally a layout cleanup
removes a field, removes the need for six feature hooks to know anything about reader composition, and
is strictly better for the rest: the outgoing producer's marks go before the next paint rather than
after it. The comments get amended to say *separate stable-dependency cleanup*, which is the rule,
rather than *passive*, which was only ever how it was spelled.

`derived` is not `keyed` with a flag. Quotes must write `found` and `openKey` in **one** layout
effect — *"so no paint can ever show the ring on one quote and the washes of another set"* — and must
have no invalid-key effect, because its key is recomputed rather than remembered: a quote whose block
the article has lost should resolve to a key matching no mark, not to the previous quote's.

**What the helper must not absorb**, all of it per-mode product policy with a written argument:
auto-open-first (Ideas and Timeline have it; Criteria refuses it in a comment; Search has no concept
of it); the `wantsJump` intention (Ideas and Timeline only); the *other* triggers that clear a key
(Search's matcher/find/solo/toggle-all, Quotes' bar); Glossary's `termSelections`, which is a
different currency with no push-up and no cleanup; and the band-level prop names, `openHit` /
`onOpenHit` included, which six other test files mount by.

**The hard constraint is dependency identity.** `tests/passage-mode-cleanup.test.tsx` says it
outright: the unmount effect lists `[onFound, onOpenKey]` as its dependencies, so an identity that
changed per render would make it run on **every** render instead of on the way out — and the suite
would still be green except for one assertion, the second `.crit-jump` press. The helper therefore
takes the parent's setters through and never wraps them in a fresh closure. Its own effect deps are
read off the input's fields, never the input object, which is fresh every render.

### Referee's two sub-modes share one slot — a real bug, and it goes both ways

`CriteriaBand` and `ClaimsBand` both write `refereeFound`, and **both publish in a `useLayoutEffect`
and clear in a passive `useEffect`** ([`CriteriaPanel.tsx`](../../src/web/CriteriaPanel.tsx) § 276 and
307, [`ClaimsPanel.tsx`](../../src/web/ClaimsPanel.tsx) § 257 and 264). So switching sub-mode runs the
incoming band's publication during the commit and the outgoing band's clear afterwards, and the
incoming marks are lost. This is the exact class the five mode-level slots exist to prevent, occurring
one level down where they do not reach.

Sol reproduced it in a React 19.2.8 probe matching the source effects — `criteria layout publish` →
`claims passive clear` → *settled criteria DOM empty* — and corrected one thing this plan had wrong:
the clear is not guaranteed to land after paint, so "one visible frame" understates it. The passage
marks are simply gone.

**It is symmetric, which Sol's first fix was not.** Criteria → claims loses Claims' marks by the same
mechanism, because Criteria's cleanup is passive too — Sol confirmed the reverse direction behaves
identically in the probe. The fix is therefore not "Claims is the exceptional unkeyed shape": it is
that **the unmount clear happens in a layout cleanup**, which React destroys in the mutation phase,
before it runs the incoming sibling's layout effect. The outgoing clear lands first and the incoming
publication survives. Per Sol F10 that becomes the rule for *every* producer rather than a field the
two slot-sharers set — see the helper section above.

Sol also established that Criteria and Claims are the **only** pair that can hand one slot over during
a mounted `Reader`'s lifetime: owner and visitor twins share a named slot, but changing access swaps
`OwnedArticle` for `VisitorArticle` and unmounts the whole `Reader`.

**Reproduce both directions red before fixing either, and do it without StrictMode.** This matters and
was nearly got wrong: under StrictMode React's simulated remount republishes the incoming producer
*after* the outgoing passive clear, so the settled DOM is correct and the test goes **green against
the broken code**. StrictMode is a post-fix regression variant here, never the red proof. Sol F9,
measured in a React 19.2.8 probe. Assert the marks survive the *settled* commit, not only the first.

This earns a postmortem naming the class: **one publication slot shared by two producers whose publish
and clear run in different commit phases** — and, as its own lesson, **a development-mode double-render
that hides the defect the test was written to catch**.

A sixth `Found[]` slot was the first proposal here and is not what lands: it contradicts *the five
producer slots stay five*, and it would make `Reader` subscribe to `?referee=` purely to compensate
for effect timing.

## Stages

### Stage 1 — eight mode controllers out, in two batches

Two commits, because the checklist says small batches:

- **1a** Timeline, Quotes, Debate, Glossary.
- **1b** Search, Summary, Diagram, Referee.

Into `src/web/modes/<feature>/<Feature>Mode.tsx`. **No interface changes**: same props, same hook
bodies, same effects, same comments. Constants move with their single consumer.

**Five test files import these symbols** — `passage-mode-cleanup` (`TimelineBand`, `QuotesBand`),
`glossary-band-selection` (`VisitorGlossaryBand`), and `pressing-a-chip-arms-it`, `referee-tooltips`
and `arrows-belong-to-the-article` (`RefereeViews`). `App.tsx` re-exports each only until its
importers are repointed in the same batch; no re-export survives the commit.

The other half of the stage is the tests that read `App.tsx` as a **string** and will silently stop
checking anything when their subject leaves it. A source-text test whose `indexOf` returns `-1` slices
from the end and asserts about an empty string, so several of these go **green** on a move —
[silent-success](../reusable/silent-success.md). Every one is checked by mutation before the commit.

- **Repoint or split**: `referee-copy-is-about-the-model`, `referee-band-fits`, `referee-how-card`,
  `visitor-arc-gap`, `text-alone-centring`, `spine-width`, `aimed-column`, `sanitize-client`,
  `glossary-band-wiring`, and — in stage 3 — `page-title` (it reads `App.tsx` for
  `articleWaitTitle(`, which is in `ArticlePage`).
- **Leave alone, but must still pass**: `no-raw-nul-bytes` and `eager-client-graph` already discover
  files rather than naming this one.
- `glossary-band-wiring` spans `ArticlePage`, `Reader` and several mode files. It reads each owning
  file separately; it must **not** concatenate them into a synthetic "App" source, which would make
  the anchors ambiguous again.

**`referee-copy-is-about-the-model` needs more than a repoint.** Its second discovery rule is a
non-recursive `readdirSync(WEB)`, so a nested `modes/referee/RefereeMode.tsx` is invisible to it: the
panels it imports still satisfy the first rule, every positive-count floor stays green, and the
controller itself silently leaves the scanned set. It must discover nested client files recursively,
seed the surface set with `RefereeMode.tsx` itself, and resolve relative specifiers from the importing
file rather than from `src/web`. Its mutation is an executable *"nothing in this paper…"* sentence
inserted **into `RefereeMode.tsx`**, and the expected failure must name that file — mutating an
imported panel proves nothing about the moved controller. Sol F4.

Each batch also updates its feature doc's code signposts, so no doc keeps pointing a maintainer at
`App.tsx` for a controller that has left it. Signpost corrections need no important-doc approval.

Done when: the eight controllers are gone from `App.tsx`, no re-export shims remain, and every named
test file has been mutated and seen to go red.

### Stage 2 — Chat and Remember, the counterexample

`ConversationBand` (chat *and* Remember-recall, mounted `key={mode}`), `RememberBand` (two sub-modes
behind one mode, owning `?remember=` and `?thread=` in one `useQueryStates`), `QuizSubBand`,
`ConversationKind`, `isConversationThread` — all into `modes/conversation/ConversationModes.tsx`,
one file, because `RememberBand` renders `ConversationBand`.

Deliberately last, and the point is what it has to preserve that a list-shaped mode does not: the
draft, the send-new URL update, anchored conversations, detached operation handling and the
live-conversation lifecycle. **Neither publishes passages**, so nothing in stage 4 touches them — that
is the evidence the design does not assume every mode is a list, and it gets written down here rather
than asserted.

`tests/remember-url-rules.test.tsx` and `tests/conversation-band-send-new.test.tsx` are repointed in
the same stage.

Done when: `App.tsx` holds no feature controller at all.

### Stage 3 — `Reader` and the position hooks, then the access unit

**Two commits**, in this order, because each is independently cycle-free and a good stopping point:

1. `Reader` → `src/web/reader/Reader.tsx`; `useReadingPosition` → `src/web/reader/useReadingPosition.ts`;
   `useWindowWidth` and `useRootFontPx` → `src/web/reader/measure.ts`.
2. The access unit → `src/web/article/access.ts` and `src/web/article/ArticlePage.tsx`, as one unit,
   preserving the identity fences and the one article fetch shared by the reading, metadata and
   tweets views. `useJobSession` stays above every route return in `App`. `page-title.test.ts` is
   repointed here.

Then the assertion: `tests/reader-import-direction.test.ts`, over the AST via
[`tests/helpers/ts-ast.ts`](../../tests/helpers/ts-ast.ts). It enforces **both halves** of A1's rule,
because the contract is that a feature module imports neither `App.tsx` **nor another feature**:

1. nothing under `src/web/modes/`, `src/web/reader/` or `src/web/article/` may import
   `src/web/App.tsx`, statically or dynamically;
2. nothing under `src/web/modes/<feature>/` may import anything under a *different*
   `src/web/modes/<other>/`.

Each rule gets its own mutation control, and an unresolvable local specifier fails the test loudly
rather than being dropped — a walker that has stopped walking passes every "is X absent" question.
Rule 2 is what stops the next F2: Chat/Remember was caught by reading the code, and the guard is what
catches the one nobody reads. Sol F11.

[web-client.md § Where the code is](../project/web-client.md#where-the-code-is) gets rows for
`article/`, `reader/` and the now-populated `modes/`, and its `App.tsx` row stops claiming to fetch
the article.

Done when: `App.tsx` is route choice, session subscription and persistent services, and nothing else.

### Stage 4a — A3: the passage lifecycle and the Referee fix

Split from 4b because they have different failure modes, and because the Referee fix deserves a green
stopping point before the much larger Reader harness gets built. Sol F12.

- `src/web/passage-lifecycle.ts` replaces the publish/invalid-key/unmount rules in `useIdeasMode`,
  `useTimelineMode`, `useQuotesMode`, `useSearchMode`, `CriteriaPanel` and `ClaimsPanel`.
- The Referee shared slot, **both directions, reproduced red without StrictMode first**.
- `tests/passage-mode-cleanup.test.tsx` grows a **Claims** arm (the unkeyed producer, untested
  today), a **Search** arm (different prop names, cleanup untested today), a **hand-off** case
  asserting state at the commit *before* the outgoing cleanup, and a **Referee sub-mode** case in
  both directions. Its header prose, which hard-codes "Four bands" and names the three copies, is
  rewritten.
- The postmortem, under `docs/postmortems/`.

Done when: the six copies are one helper, both Referee directions are fixed with a red-first proof
that did not rely on StrictMode, and nothing else has changed.

### Stage 4b — A3: the selection and the dispatch

- `selectPassages` in `src/web/reader/passages.ts`, total over `Mode`, `NO_FOUND` for the nine
  non-producers, with unit tests over every mode.
- The seventeen `&&` siblings become the local `band()` switch with the `never` default.
- **A Reader-level wiring test, not only the band-level harness.** This is the part a pure
  `selectPassages` test and a miniature-reader cleanup harness both miss:
  `<TimelineBand onFound={setIdeaFound} …/>` compiles, passes the band test, passes the selection
  test and passes the cleanup test, while Timeline marks nothing in the real reader. So: give Ideas,
  Timeline, Search, Criteria and Claims distinguishable published passages, drive
  **Ideas → Timeline → Search with pending work → Criteria ↔ Claims → Plain → Back**, and at every
  commit assert the actual prose marks, the selected ring and the Spine's matches agree. The same
  sequence under StrictMode and across article A → B → A. Each arm asserts its producer mounted and
  published. **Prove the test** by swapping Timeline's setter for Ideas' and requiring the failure to
  name Timeline's missing marks. Sol F1.
- `tests/glossary-band-wiring.test.ts` asserts the ternary chain by regex; its *intent* — the ring and
  the washes in one effect, and `Reader` holding the key — is re-expressed against the new shape.
- **Docs**: `new-mode.md`'s residue list currently says of the band branch *"**Nothing; this list**"*;
  after this stage the band branch and the passage selection are both compiler-checked, and that line
  changes to say so. `url-state.md` records that the mode → passage-slot mapping is now total.
- The acceptance: a fifteenth mode in `MODES` goes red in every place a policy decision is required,
  and the doc says which places those are.

Done when: adding a mode makes every required policy decision visible, and the article-access and
reading-position code is untouched by having done it.

## What this deliberately does not do

- **No `readerContext`, no whole-app context, no `<ModeBands>` with twenty-one props.** Explicit props
  stay explicit; the dispatch threads none at all.
- **No single publication slot** with owner tokens. It is the review's optional later simplification
  and earns adoption only if it deletes more machinery than it adds; today it would add.
- **No renderer table** in place of the switch. The switch is the cheaper extraction step and the
  review says so; a table is viable once the controllers have stable interfaces.
- **No lazy-loading of mode code.** A4 kept it eager on purpose and
  [`tests/eager-client-graph.test.ts`](../../tests/eager-client-graph.test.ts) holds that line.
- **No behaviour change anywhere**, except the Referee slot fix if it reproduces, and the one frame of
  stale Search marks that `selectPassages` removes.
- **No touching another job's ground**: `useColumnContext.ts`, `rows.ts`, `fonts.ts`, `scroll.ts` and
  `position.ts` are A8's; `styles.css`, `tailwind.css` and `/design` are A10's; `ChatPanel.tsx`,
  `SearchPanel.tsx` and `useVisualViewport.ts` are A5's. This job moves the **controllers** that use
  them.

## Evidence and review

Baseline on entering the worktree, `0977d6f6`: `npm run typecheck` clean; the twelve affected test
files green (153 tests). Two read-only audits produced the unit map, the cross-bucket constant census
and the forensic passage-lifecycle account this plan is built on.

**`npm run check` on the untouched tree already fails its test gate** — 6 files, 10 tests, recorded
here so nothing below is mistakenly attributed to this work. Nine are timeouts or timing assertions
under a load average of 92 with a dozen agents on the box (`admin-store` ×2, `hierarchy-deepen-wave`,
`pdf-source-parsed-once`, `store-export-fails-closed`, `chat-web-links`' linear-growth assertion, and
one `shelf-action-tooltips` timeout); the other three are `shelf-action-tooltips` assertions failing
against another agent's in-flight shelf work. None is in this job's area. Build/cycles/chain/committed
were clean; lint, knip, complexity and dupes have their usual non-gate findings.

Every stage gets a GPT Sol review, two rounds, then settled here. Overrules are written into this
section as they happen.

### Plan review, round 1 — [260906c-plan-review-sol.md](260906c-plan-review-sol.md)

Refused as written; no P0, five established P1s. All eight findings accepted, one of them extended.

| ID | Finding | Disposition |
|---|---|---|
| F1 | Band-level and pure-function tests cannot catch mis-wiring — `<TimelineBand onFound={setIdeaFound}/>` compiles and passes all three | **Fixed.** Stage 4 gains a Reader-level wiring test over the real sequence, proved by that exact mutation |
| F2 | `RememberBand` renders `ConversationBand`, so `modes/chat` + `modes/remember` is one feature importing another | **Fixed.** One `modes/conversation/ConversationModes.tsx`. Verified at `App.tsx` § `RememberBand` |
| F3 | The sixth slot contradicts *five slots stay five*; a layout unmount cleanup is smaller. Reproduced in a React 19.2.8 probe | **Fixed, and extended.** Sol scoped it to Claims as *"the exceptional unkeyed shape"*; both Referee producers publish in a layout effect and clear passively, so **criteria → claims loses Claims' marks by the same mechanism**. The discriminant is slot-sharing, not keyedness, and it is a separate input field for that reason |
| F4 | `referee-copy-is-about-the-model`'s second rule is a non-recursive `readdirSync`, so a nested `RefereeMode.tsx` silently leaves the scanned set | **Fixed.** Verified at that file's `IMPORTS_THE_DOMAIN` |
| F5 | Only `new-mode.md` was named; the checklist requires `web-client`, `url-state` and feature signposts | **Fixed**, distributed across the stages that cause each change |
| F6 | The checklist is an inventory, not an ordering constraint; stage 1 was eight controllers in one commit and stage 3 was two moves in one | **Fixed.** The "deviation" framing is gone; stage 1 is two batches and stage 3 is two commits |
| F7 | Five importers, not four; ten source-text checks, not twelve; `page-title.test.ts` omitted; `no-raw-nul-bytes` and `eager-client-graph` discover rather than name | **Fixed.** Verified `page-title.test.ts` reads `App.tsx` for `articleWaitTitle(` |
| F8 | Nine non-producer modes, not ten — Search owns the tenth | **Fixed** in both places the number appeared |

Nothing was overruled.

### Plan review, round 2 — [260906c-plan-review-sol-2.md](260906c-plan-review-sol-2.md)

Not refused; no P0 or P1. Four findings, all accepted. **Discovery is now closed on the plan**; the
per-stage reviews carry on.

| ID | Finding | Disposition |
|---|---|---|
| F9 | StrictMode **masks** the pre-fix Referee race: the simulated remount republishes the incoming producer after the outgoing clear, so a StrictMode red proof goes green against broken code | **Fixed.** The red proof is non-StrictMode in both directions; StrictMode is a post-fix regression variant only. Measured by Sol in a React 19.2.8 probe |
| F10 | The `sharesSlot` field is unnecessary — the flicker comments forbid folding the clear into the *publication* effect, not the layout phase | **Fixed.** Every producer's separate unmount-only clear becomes a layout cleanup; the field is gone, and six feature hooks stop needing to know anything about reader composition |
| F11 | The import guard enforced half the contract — `App.tsx` but not feature-to-feature | **Fixed.** Rule 2 added, with its own mutation control |
| F12 | Stage 4 combined a lifecycle refactor, a user-visible fix, the selection, the dispatch and a large harness | **Fixed.** Split into 4a (lifecycle + Referee + postmortem) and 4b (selection + dispatch + wiring harness + docs) |
| F13 | "Seven controllers", listing eight | **Fixed** in three places |

Sol also confirmed three things it was asked to attack and could not: the React layout-cleanup
ordering claim holds for distinct sibling component types; Criteria and Claims are the **only** pair
that can hand one slot over within a mounted `Reader`; and stage 3's first commit is cycle-free.
