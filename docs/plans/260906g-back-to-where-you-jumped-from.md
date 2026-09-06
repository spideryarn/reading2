# Back to where you jumped from

Status as of 2026-09-06: **every stage, every review and the docs are done** — evidence:
`src/web/ReturnChip.tsx` and `src/web/comment-jump.ts` exist, `Spine.tsx` draws a `.spine-from` mark
for a jump origin, and every stage has been through a cross-family review whose findings are all
either fixed or written down below as deliberately not.

**Six cross-family reviews, five refusals and one acceptance** —
[round 1](260906g-plan-review-sol.md) and [round 2](260906g-plan-review2-sol.md) on the plan, then
[round 3](260906g-stage-a-review-sol.md), [round 4](260906g-stage-b-review-sol.md),
[round 5](260906g-stage-b2-review-sol.md) and [round 6](260906g-stage-c-review-sol.md) on the code
of Stages A, B, B2 and C. What each changed is in
[§ What the reviews changed](#what-the-reviews-changed).
Thirty-one findings over six rounds, all accepted, none overruled — the fourth and sixth also
re-checked earlier rounds' fixes rather than trusting them, and each found one still open.

A reader clicks a glossary term, lands three thousand words away, and cannot find their way home.
On a desktop browser they press Back and it mostly works. Added to an iOS home screen — which is
how Greg reads — there is no Back to press.

## What Greg asked for

> When I reopen an article, I'd like it to reopen in the state & position I was last in. The same
> goes if I open Tweets or Metadata or similar that open in a new page. In fact, perhaps we can go a
> step further - I often find that if I click on something (e.g. a Glossary term) it takes me to a
> new location in the Text, and then it's hard to find my way back to where I was before (especially
> if I'm using the app where it's shared to my home screen on mobile, so there's no Back button. How
> can we improve this? I suppose we could have a Back to previous location button, perhaps with a
> dropdown that lists those previous locations. Or ask Fable if it can come up with a better
> solution. Maybe also indicate previous locations in the Spine, probably fading over time, so only
> the most recent few are really visible
>
> — Greg, 2026-09-06

Three asks, in very different states.

## Ask 1 — reopen where you left it: **already built, already deployed**

[260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
landed it on 2026-09-05 (`a04dc7f5`, an ancestor of `origin/main`):
[`last-view.ts`](../../src/web/last-view.ts) copies the query string into `localStorage` under the
slug and replays it at a bare address. Nothing to do here.

**Three ways it can look broken, and the third is probably the one Greg is hitting:**

- A link carrying *any* article parameter beats the memory outright — deliberate, or a link you sent
  somebody would open somewhere else on their machine.
- `?mode=chat`, `?mode=diagram` and `?mode=remember` are remembered as *no mode*, because arriving
  in them starts a conversation or a paid model call.
- **iOS gives a home-screen web app storage separate from Safari's.** Our own
  [`install-hint.ts`](../../src/web/install-hint.ts) records this, for the install hint. So an
  article read in Safari and reopened from the Home Screen has no memory of the reader, and vice
  versa. No local-only design can fix it.

That third one is the argument for cross-device resume, and it is **out of scope here** — see
[§ Deliberately not in this plan](#deliberately-not-in-this-plan).

## Ask 2 — Tweets and Metadata

Half built, and the halves are different things:

- Article → Metadata → back **already keeps your place in the article**. `carriedSearch`
  ([`router.ts`](../../src/web/router.ts)) strips only `panel=` and keeps every other pair
  byte-for-byte, so `?at=` travels both ways
  ([`Metadata.tsx`](../../src/web/Metadata.tsx), [`Tweets.tsx`](../../src/web/Tweets.tsx)).
- Your scroll position *within* Tweets or Metadata is not remembered, and neither is which of the
  three pages you were last on.

**That second half is deferred to a plan of its own** — see
[§ Deliberately not in this plan](#deliberately-not-in-this-plan). It looked like a small stage and
is not: neither page has anything this app can address. Tweets are `{ text, chars }` with **no ids
at all**, keyed by array position and rebuilt wholesale when the article's fingerprint changes
([`src/tweets.ts`](../../src/tweets.ts), [`Tweets.tsx`](../../src/web/Tweets.tsx)); Metadata's
sections are keyed by labels, not block ids. So "remember the position by block id", which is what
the rest of the app does, is not available on either page, and the review was right that the stage
had no implementable identity contract.

## Ask 3 — finding your way back after a jump

**Most of the mechanism already exists.** This is the central finding and it decides the shape.

[url-state.md § Position replaces history](../project/url-state.md#position-replaces-history-deliberate-acts-push)
already draws the line Greg would otherwise have to draw by hand:

- Scrolling, arrow keys ([`keynav.ts`](../../src/web/keynav.ts)) and swipe-steps
  ([`swipe.ts`](../../src/web/swipe.ts)) write `?at=` with a **debounced replace**, or write nothing
  at all. They never add a history entry, deliberately: *"a stride you take twenty times must not
  cost twenty presses of Back"*.
- `jumpTo` ([`App.tsx`](../../src/web/App.tsx)) writes it with `history: "push"` and
  `limitUrlUpdates: throttle(0)`. Almost every "go there" funnels through it as `onJump` — the
  glossary, ideas, quotes, the timeline, search hits, spine bands, gist items, `BlockRef` citations,
  the article's own internal links, the diagram panel.

So the *policy* — which movements are undoable — is already implemented, tested and documented, and
that is the thing not to rebuild. What is missing is three smaller things, and the reviews found all
three:

1. **A Back the reader can press** in a `"display": "standalone"` shell
   ([`public/site.webmanifest`](../../public/site.webmanifest)).
2. **A predecessor entry that actually names where they were.** It often does not — see Stage A.
3. **Comment navigation, which moves the reader just as far and pushes nothing** — see Stage B2.

### The decision: expose the stack that exists, do not build a second one

Fable was asked for a better shape than "button + dropdown + fading spine trail" and reached the
same conclusion arrived at independently here: **do not build a parallel history**. A second stack
would have to re-derive which movements count as jumps, and the two would drift the first time
somebody added a mode.

**The simpler option passed over: a `?from=` parameter.** The obvious way to record where you came
from, and wrong here for two reasons. It would ride along in every link a reader shares, pointing a
stranger's chip at a place they have never been; and it would need clearing rules of its own at
every navigation, a second contract beside the one `carriedSearch` already keeps. The browser's
stack already holds this fact per entry, for free, and survives a reload.

**The option that cannot be taken: read the history stack.** JavaScript can see `history.length` and
nothing else in it. That is why the dropdown Greg imagined needs a record of our own, and why it is
deferred rather than built: repeated presses of the chip walk the chain backwards, which is the
dropdown's function without its machinery.

### Why not the fading spine trail

Greg floated marks in the spine, fading over time. Recommended **against** in that form, for two
reasons — and a third that was offered first and does not hold up.

- **Simpler first.** A trail needs a history store of our own, with retention and decay rules,
  because the browser's stack cannot be read. Stage C's machinery does not remove any of that: it
  draws *one* mark from a stamp that is already there.
- **Rail density.** It is a 12px strip already carrying the bands, the you-are-here marker and one
  lane per active search ([`spine-marks.ts`](../../src/web/spine-marks.ts)). A decaying trail is
  ambient information with no action attached and a legend the reader would have to learn.

The argument first given here was the rail's own stated rule — that it *"acquires marks when the
reader asks for them and at no other time"* ([`Spine.tsx`](../../src/web/Spine.tsx)) — and the Stage
C review was right that it is the **weakest** of the three: every entry in the trail would also have
originated in a jump the reader asked for, so the rule does not actually exclude it. Left in as a
correction rather than quietly swapped, because the plan was leaning on it.

The single-mark version earns its place, because it answers something the chip's label cannot —
*how far did I come?* **One faint tick at the block you jumped from, drawn only while the chip is
up.** Same datum as the chip, so nothing to keep in sync, no new colour, no decay curve, no second
lane. That is Stage C.

## What the reviews changed

Three rounds, three **refusals**, eighteen findings, all eighteen accepted after being checked
against the source. Nothing was overruled. Round two settled the one question round one left open —
how the transaction can be atomic against nuqs's setter queue — by reading the queue rather than
reasoning about it, which is why F11 specifies a code shape and not a principle. Round three read
the code that shape produced, and is below.

### Round 1 — [260906g-plan-review-sol.md](260906g-plan-review-sol.md)

GPT Sol, high effort, 2026-09-06. **Verdict: refuse**, on F1–F4. The two that changed the design
most are F1 and F4.

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | P1 — `?at=` is not the location being left, so the predecessor entry often names somewhere else: it is `null` at the top of the article, it deliberately holds a stale fine-grained block while you scroll within one section, and a jump's `throttle(0)` **cancels** the queued scroll write rather than flushing it | **Accepted.** Verified at [`position.ts` § `positionToWrite`](../../src/web/position.ts) — `if (atTop) return { at: null }` and `if (visible === sectionContaining(…, held)) return null`. The origin is now **measured** at jump time, not read from `?at=`. Stage A |
| F2 | P1 — hiding the chip when origin and destination share a section suppresses a real return: a citation five paragraphs away is a genuine pushed jump inside one section | **Accepted.** The hide rule is gone; the chip lives exactly as long as the entry's stamp. Simpler, and it was my own suspicion #2 |
| F3 | P1 — nuqs passes the **current** `history.state` into `pushState`, so an unstamped push *inherits* the previous entry's stamp and the chip appears on a `cols`/`mode`/`sort` entry promising a return it cannot make | **Accepted.** Independently found by the research pass. Every push now clears the stamp unless freshly armed |
| F4 | P1 — not every deliberate jump uses `jumpTo`: `goToComment` moves the reader arbitrarily far by calling `scrollToBlock` directly, and `?note=` replaces | **Accepted.** Verified at [`App.tsx`](../../src/web/App.tsx) — the drawer's selection and the dialog's Prev/Next both call it. Stage B2 |
| F5 | P2 — Stage D has no implementable identity contract | **Accepted**, and the stage is deferred to its own plan. See Ask 2 above |
| F6 | P2 — no reactive store for `history.state`: `useAddress` snapshots `pathname + search`, so two entries with the same URL and different stamps do not re-render | **Accepted.** A `useJumpOrigin` store, and the push is suppressed when origin and target are the same block. [`router.ts`](../../src/web/router.ts) records the same class of bug from 2026-09-04 |
| F7 | P3 — `pushAddress` does not exist; the function is `navigate` | **Accepted.** Corrected throughout |

Sol also considered and dismissed two of my own suspicions: `settleAddress`/`liftStrandedText`
rewriting the address on arrival is *not* a defect, because preserving an entry-bound stamp across a
same-path canonical rewrite is correct; and it could not establish a path where a stamp survives
while its predecessor entry alone disappears. `tests/url-state.test.ts` passed 67/67 in its sandbox.

### Round 2 — [260906g-plan-review2-sol.md](260906g-plan-review2-sol.md)

**Verdict: refuse**, on F8 and F10 as established P1s, with F9 a third unless reversing the
documented behaviour of comment stepping were an explicit product decision. It is not, so F9 is
accepted too.

| ID | Finding | Disposition |
|----|---------|-------------|
| F8 | P1 — **jumping from the top returns you below the top.** At `scrollY = 0` every row is below the reading line, but `measureRow()` still answers `0`, because `activeSectionIndex` initialises to zero and clamps there. So the predecessor would be rewritten to the first block, and Back would `scrollToBlock` it — aligning that row under the sticky chrome instead of restoring the actual top, losing the masthead | **Accepted.** The origin becomes `{ kind: "top" } \| { kind: "block"; blockId }` — the house's "let the types catch it" rule rather than a guard. `top` removes `?at=` from the predecessor rather than setting it |
| F9 | P1 — **Stage B2 as written turns Prev/Next into the scroll-history the contract rejects.** Twenty questions spread through an article would make roughly twenty entries. [comments.md § Reading order](../project/comments.md#reading-order) says the arrows *"write no position state of their own"*, explicitly like `keynav.ts` | **Accepted**, and verified in that doc before acting. The two intents split: selecting a question from the drawer is an arbitrary jump and pushes; the dialog's arrows do not. The stamp survives their replaces, so after stepping through several questions the chip still returns to where the reader **entered** the traversal — which is a better answer than either half alone |
| F10 | P1 — **"same block" does not mean "no movement".** `jumpTo` does the history write and `scrollToBlock` as independent statements, so suppressing only the push still moves the reader. A tall paragraph can cross the reading line with its top well above the viewport, and search deliberately calls `onJump` even when the result is visible | **Accepted.** The whole jump aborts — before `synced`, before the setter, before `scrollToBlock`. The visible cost is that clicking a search result for the paragraph you are already reading now does nothing, which is deliberate |
| F11 | P2 — **the atomic shape was still unspecified, and both shapes I had offered were broken.** nuqs stores pending updates by key with `Map.set`, so a second `setAt` in one tick *overwrites* the first rather than queueing; any push option upgrades the combined flush to a push; and `throttle(0)` still schedules the flush for a later task. Two setters would have produced one destination push and silently **no** predecessor rewrite | **Accepted**, and this is the finding that saved the stage. The wrapper now owns the pair — see Stage A. Note it also softened the plan's wording: the History API cannot roll back if the second native call throws, so this is *"performed synchronously as one wrapper-owned operation"*, not *"written together or not at all"* |
| F12 | P2, reasoned — **the chip can persist for the rest of a long reading session**, since ordinary scrolling replaces the entry while preserving its stamp. Truthful, but on a phone it permanently occupies reading space after the reader has chosen to go on | **Accepted.** A small dismiss control that strips only the current entry's stamp with a `replaceState`. Explicit dismissal cannot re-create F2, because no valid return disappears without the reader asking |

On my three round-2 suspicions: rewriting `?at=` at jump time is **defensible and strengthens**
"the URL is always current" — it records a truthful, finer block immediately before leaving, and
adds nothing shareable; the `isBlockOnScreen` guard is **not** enough for comment stepping (F9); and
never hiding the chip is semantically sound, but explicit dismissal is safer than any distance- or
section-based rule that would try to guess.

### Round three: the code

[The Stage A review](260906g-stage-a-review-sol.md), against commit `25a16a38`. **A third refusal**,
and worth more than the first two: a plan review cannot find a wrapper that writes one entry and
drops the other. Six findings, all six checked and accepted.

| ID | Finding | What changed |
|----|---------|--------------|
| F13 | P1 — **the masthead is misclassified as the first block.** `measureOrigin` asked `window.scrollY <= stickyOffset()`, copying `positionToWrite`. But the masthead scrolls away *above* the first row, so there is a band several hundred pixels deep where the reader is past the offset and no row has reached the reading line — and `measureRow()` clamps to row 0 throughout it. Reproduced at `scrollY = 100` with the first row at `top = 200` | **Accepted.** The question is put to the rows instead: has the first one crossed the line? That is the fact `measureRow` already reads, so the two cannot drift. F8 again, inside the window F8's own fix left open. `positionToWrite` keeps the old test deliberately — a lagging `?at=` names a block the reader can see, while a jump origin is a promise to put them back exactly |
| F14 | P1 — **an abandoned arm can be claimed by a later unrelated push.** The push is up to 320ms away on an older Safari, and an ordinary navigation in that window makes nuqs abandon it — but the arm survived. Sol's sequence: arm, navigate away, come Back, then an ordinary mode push that happens to keep `at=B` wears an origin from before the reader ever left | **Accepted.** The arm now carries the whole address it was set at and is spent only by a push made from *that* address, and every `popstate` throws it away. Getting back to an article cannot be done without changing the address on the way, which is what makes the check a usable proxy for "the reader has not been anywhere since" |
| F15 | P2 — **`isPlainObject` destroyed valid foreign state.** `typeof x === "object"` is true of a `Date`, a `Map`, a typed array and every class instance; spreading one into `{}` throws its data away, and the empty result was then stored as `null` | **Accepted.** A strict check: `Object.prototype` or a null prototype, nothing else. Nothing in this repo writes such a state today, and a browser restoring one must not lose it to a chip |
| F16 | P2 — **the predecessor was rewritten before the destination was known to be stampable.** Half a pair: a truthful predecessor and no chip to reach it with | **Accepted.** `canStamp` is asked before anything is written; an unstampable state gets an ordinary push and no rewrite |
| F17 | P2 — **the atomicity test did not establish what it claimed.** React batches, so two ordinary writes in one task render as one update too; Sol reproduced the same single render from a plain replace-then-push. The test would not have caught a dropped `__nuqs__` marker | **Accepted**, and confirmed by mutation: dropping the marker from the predecessor write leaves the render test green. A second test now taps *between* the two patches and asserts the pair and both markers. The render test stays as the user-visible check |
| F18 | P3 — **the plan contradicted the committed source** in four places: the status line, the arm "consumed in a `finally`", a `scrollY === 0` the test cannot observe, and the batching claim F17 disproved | **Accepted**, all four corrected above |

Sol also confirmed what it could not fault: the four permitted suites pass, and no same-path replace
in the app — `last-view`, the canonical rewrites, ordinary query replaces — discards a stamp it
should have kept.

### Round four: Stage B, and whether round three's fixes held

[The Stage B review](260906g-stage-b-review-sol.md), against `6e270bf2`. **A fourth refusal**, on
three P1s. It was also asked to re-check F13–F18 rather than take them on trust, and found five of
the six closed — F18 was not, and its remaining defects are corrected above.

| ID | Finding | What changed |
|----|---------|--------------|
| F19 | P1 — **a chained jump leaves the previous chip up for 50–320ms.** `beginJump` scrolls immediately and the push lands later, so in that window the page is moving towards C while the entry underneath still says "back to A". Pressing the chip there goes back one place further than the reader meant *and* cancels the jump they just asked for. Reproduced against nuqs 2.10.0 | **Accepted**, with a different fix from the one suggested. Sol proposed holding the scroll until the push commits; that was refused because nuqs **abandons** a queued write when the page navigates, which would turn an abandoned push into a tap that silently does nothing — a worse failure, and the exact class [silent-success.md](../reusable/silent-success.md) names. Instead the chip withholds its claim while a jump is armed: `isJumpArmed`, and a listener set in `jump-history.ts` so the store hears about an arm, which is not a history write and would otherwise go unnoticed |
| F20 | P1 — **the × cancelled a queued position write.** The captured `replaceState` is nuqs's own wrapper, which runs `sync()` for any write not marked `__nuqs__` — and `sync()` calls `spinQueueResetMutex()` *before* noticing the search string has not changed. So dismissing while the scroll spy's 300ms `?at=` replace was pending threw it away, and nothing retried: `synced.current` had already moved on. The address went on naming the section the reader had left, so a reload or a shared link returned to it | **Accepted.** The dismissal wears nuqs's marker, so nuqs skips `sync()` altogether. Confirmed by mutation: without the marker the queued write to block 28 never lands and the address stays on block 25 |
| F21 | P1 — **the offline strip covers the chip.** The strip is full width at `bottom: dock-space + hint-h` and z-index 97; the chip sat 0.75rem above the same edge at z-index 46. At 390px the offline sentence wraps to two lines and covers it completely — and internal jumps and Back go on working offline, so the way back is exactly what a reader offline still needs | **Accepted.** A `--return-chip-h` variable on the `--hint-h` pattern, and the strip stands above the chip rather than on it. The chip's height is the constant here because it is deliberately one truncating line; the strip's is not, because it wraps. **The first fix was still wrong, and only a browser said so** — see below |
| F18 | P3 — **still not closed**: four contradictions in the plan and one in a test comment | **Accepted**, all five corrected |

The three suspicions were closed rather than confirmed: `useJumpOrigin`'s cache has no defect;
`useArticleAccess` refuses a previous slug's payload synchronously, so there is no paint combining a
new entry's stamp with the old article's sections; and the empty-title fallback is the right trade.

### Round five: Stage B2

[The Stage B2 review](260906g-stage-b2-review-sol.md), against `c09d4db1`. **A fifth refusal**, on
three P1s — and the through-line is that all three are the *history* being right while the *page*
does nothing, which is the one shape this whole feature can least afford: a chip is a promise about
movement.

| ID | Finding | What changed |
|----|---------|--------------|
| F10 | P1 — **the same finding again, in the path B2 created.** `isBlockOnScreen` requires the whole row to fit between the bars, so a paragraph *taller than the viewport* can never satisfy it at any scroll position — and stepping between two questions inside one jolted to its top, the exact case the guard exists to prevent. Reproduced with a row at `top=-300, bottom=1200` | **Accepted.** A row *crossing the reading line* now counts as where the reader is — the same line `measureRow` uses for "which item am I in", so the two cannot disagree |
| F22 | P1 — **an on-screen step did not stop the glide about to carry it away.** A step to a far question starts a 200ms glide; while it passes a nearer one the reader presses Prev; the note changes and the glide carries serenely on, leaving the question they asked for off screen. `scrollToBlock` is also where an in-flight animation is cancelled, and the on-screen branch does not go through it | **Accepted.** `abandonScroll` — `cancel` with none of its other duties, since the reader has not taken over and nothing new is starting |
| F23 | P1 — **selecting an orphan comment pushed without moving.** A comment whose block went in a re-extraction is deliberately kept and sorted to the end of the drawer; its row is not in the document, so `scrollToBlock` returns at its missing-row guard while the push has already happened. `history.length` 1 → 2, scroll count 0 — a chip offering the way back from a journey that never happened | **Accepted**, and the harness was as much at fault as the code: the test recorded every `scrollToBlock` **call** as a scroll, while the real one returns without moving. The decision now has three answers rather than two, and `nowhere` opens the dialog and does nothing else |
| F24 | P2 — the seventh closure declares `id: BlockId` and receives a comment id; it compiles only because `BlockId` is an alias for `string` | **Accepted.** `string`, with a comment saying why that closure moves nothing |
| F25 | P3 — `url-state.md` still called clicking a gist "the one exception" | **Accepted.** The exception is *a deliberate jump*, with the gist and the drawer as its two examples and the arrows as the deliberate non-example |
| F26 | P3 — two sentences in `comments.md` overstated the implementation | **Accepted**: the arrows add no history *entries* rather than writing no history, and both paths check where the passage is *before moving* rather than asking `isBlockOnScreen` *first* — they open the note first |

Sol confirmed the six call sites are wired correctly today, and — asked for a cheap type-level
guarantee that an arrow closure cannot call the pushing path — said plainly that there is none worth
having: both intents consume the same comment id and both have side effects, so a discriminated
action would document the intent without preventing the wrong one being chosen. **The gap stands,
recorded rather than papered over**, and the cheap protection it named is an App-level wiring test
rather than a type.

### Round six: Stage C — **accepted**

[The Stage C review](260906g-stage-c-review-sol.md), against `1df91b3b`. The first acceptance in six
rounds: no established P0 or P1 in the implementation. Five findings, all taken.

| ID | Finding | What changed |
|----|---------|--------------|
| F27 | P2 — **the new suite leaked jump stamps between its own tests.** A same-path replace preserves the stamp on purpose, so `beforeEach` reset the address and not the entry, and a later test mounted with the previous test's mark already drawn. Established by running the file with `--sequence.shuffle.tests --sequence.seed=2` | **Accepted**, and it was worse than reported: three of the four suites in this feature had it, not one. All four now call `dismissJumpOrigin()` in `beforeEach`, and all four pass under three shuffle seeds. This is also the trap that caught the orphan test being written the same evening — the same fact, met twice in an hour |
| F28 | P3 — the plan's header claimed four reviews and twenty-one findings at a commit that added the fifth, and called every stage built while three P1s stood against Stage B2 | **Accepted**, corrected here |
| F29 | P3 — the rail's comment said only a jump, Back or dismissal re-renders it; Forward and a stamp-stripping push do too | **Accepted** |
| F30 | P3 — the same comment called `top` and an unresolvable stamp "two cases where the chip stands without a mark", but only `top` keeps the chip | **Accepted** |
| F31 | P3 — this plan overstated the pre-existing `.spine-match` bug as "clipped away" | **Accepted** — what is lost is the 3px floor, not the mark |

Sol also answered the product question properly, and against the plan: **one mark is still the right
v1**, but not for the reason § Why not the fading spine trail gave first. That section is corrected
above.

#### F21's fix was wrong the first time, and the browser is what caught it

Worth writing down, because it is the argument for the browser check being a step rather than a
formality. `--return-chip-h` was first set to the chip's **height**, 2.5rem, measured correctly at
38.78px. But the chip's own `bottom` stands it 0.75rem off the edge below, so what the strip needs
is the *room the chip occupies*, not its height — and the strip went on clipping the top 7px of the
button. Nothing in the suite could see it: the rule is arithmetic in CSS variables, and it
reproduced identically at 390px and 1280px, so it was not the wrap it looked like.

Measured with both elements really on screen — the chip from a real spine-band jump, the strip from
a real `offline` event through `watchConnection` — the rectangles now clear each other by 1.2px at
both widths, and `elementFromPoint` **2px in from the button's top edge** returns the button rather
than the strip. That top-edge probe is the one that found the bug; the centre probe passed
throughout, and a screenshot looked fine at normal zoom the whole time.

The gap is counted inside the variable rather than in `.offline-strip`'s rule, which was checked
too: with no chip drawn, `--return-chip-h` computes to `0px` and the strip's bottom edge sits
exactly where it always did.

## What the research turned up

A separate read-only pass over `node_modules/nuqs` and the client, before the review:

- **nuqs 2.10.0 is state-transparent.** `dist/adapters/react.js:16` calls
  `pushState/replaceState.call(history, history.state, marker, url)` — it hands back whatever state
  is there, never constructs its own, never parses one. Its `"__nuqs__"` marker is the *title*
  argument, not a state property.
- **So a replace preserves the stamp for free**, which was the piece of Stage A I trusted least.
- **And a push inherits it**, which is F3.
- **Patch order:** `main.tsx` calls `enableHistorySync()` (nuqs) then `watchHistoryWrites()`, so ours
  is the **outer** wrapper and sees every call first — it can substitute the state argument before
  nuqs's wrapper runs. Only two patchers exist in the tree.
- **Nothing reads `event.state`** off a popstate listener anywhere in `src/web`, so nothing breaks
  when these calls start carrying a real object instead of `null`.
- **The label** is `Section.title` — required on every `TreeNode`, "2–6 words". Resolve a block id
  with `rowOf` → `activeSectionIndex` → `sections[i].title`
  ([`position.ts`](../../src/web/position.ts)). `sectionContaining` is the wrong helper: it returns
  the section's blockId, not the `Section`. `App.tsx` already calls `buildSections` — reuse it.
- **The chip's placement.** Closest precedent is `.cmt-dialog` (`styles.css`), a small fixed panel
  pinned above the dock at `bottom: calc(var(--dock-space) + …)`. Mirror it to
  `left: calc(1.25rem + var(--safe-left))` and take z-index **46** — the `.install-hint` band, above
  the mode band and below the drawer — not the dialogs' 70.

## Stages

Each ends green and committable. Value is front-loaded: Stages A + B alone solve the reported
problem.

### Stage A — the jump transaction — **built, 2026-09-06**

The predecessor entry must name where the reader actually was, and the stamp must agree with it.

- [x] New [`src/web/jump-history.ts`](../../src/web/jump-history.ts): the stamp and the arm, pure
      functions over an opaque history-state object — read ours, write it, strip it while preserving
      every foreign key, leaving `null` rather than `{}` when nothing is left. **Pure for a hard
      reason, not a tidy one.** The first cut also had `measureOrigin` and `beginJump` here, which
      gave it an import of keynav.ts — and router.ts imports this file. router.ts is on
      `SHARED_WITH_READER`, so that one edge dragged keynav, scroll, position, tree, safe-area and
      supplement into the lazily-loaded /admin and /design bundles, for a chip nobody on those pages
      can see. `tests/eager-client-graph.test.ts` caught it and named all six. The two DOM functions
      now live in [`keynav.ts`](../../src/web/keynav.ts) beside `measureRow`, which is the
      measurement they use; `jump-history.ts` is the one line added to `SHARED_WITH_READER`.
- [x] **The origin is measured, not read**, and it is **not always a block**:

      ```ts
      type JumpOrigin = { kind: "top" } | { kind: "block"; blockId: BlockId };
      ```

      At the moment of a jump, take the block crossing the reading line — `measureRow()` in
      [`keynav.ts`](../../src/web/keynav.ts) returns exactly this, over every `tr[data-block]`
      rather than only section rows. **Not `?at=`**, for the three reasons in F1. But **if the
      first `tr[data-block]` has not itself crossed the reading line the origin is `top`**, and the
      predecessor rewrite *removes* `?at=` rather than setting it — F8, because `measureRow()`
      answers `0` at the top of the article whether or not any row has reached the line, and a
      `scrollToBlock` on the first block lands under the sticky chrome rather than at the top.
      (The draft asked `window.scrollY <= stickyOffset()` here, copying `positionToWrite`. F13 is
      why it does not: the masthead scrolls away above the first row, leaving a band hundreds of
      pixels deep where that test says "a block" and no row has arrived.)

- [x] **One transaction, owned by the wrapper** (F11). `jumpTo` arms
      `{ pathname, from, origin, target }` — `from` being the whole address at the moment of asking,
      which F14 added — and makes **exactly one** nuqs call: the destination push. When `watchHistoryWrites`
      intercepts the matching armed push it synchronously calls its **captured inner**
      `replaceState` to rewrite the current entry to the origin, then its **captured inner**
      `pushState` with the destination and the stamped state; it emits `NAVIGATED` once after the
      pair rather than once per call. The arm is matched against its expected pathname and target,
      so an unrelated push cannot consume it.

      Two details the plan got wrong and the code settled. The arm is consumed **before** either
      native call, not in a `finally`: taking it first means a throw from one of them cannot leave
      it behind for whatever the app does next. And whether the destination state can carry a stamp
      at all is settled before anything is written, because the predecessor rewrite is the
      irreversible half (F16).

      **Two `setAt` calls would not have worked**, which is why this is spelled out: nuqs keys
      pending updates with `Map.set`, so the second overwrites the first, any push option upgrades
      the combined flush to a push, and `throttle(0)` still defers the flush to a later task. The
      result would have been one destination push and no predecessor rewrite — a silent success of
      exactly the shape [silent-success.md](../reusable/silent-success.md) is about.

      "Captured inner", because calling `history.replaceState` here would recurse through our own
      wrapper. And this is *synchronous and wrapper-owned* rather than atomic: the History API
      offers no rollback if the second native call throws.
- [x] **Every same-path push strips the inherited stamp** and adds one only when a jump has just
      armed an origin (F3). An unarmed push clears rather than inherits.
- [x] `replaceState` preserves the current entry's stamp — free, via nuqs, but pinned by a test so
      it stays free.
- [x] A pathname change clears: an excursion belongs to one article.
- [x] **When the measured origin is the target block, abort the whole jump** — before `synced`,
      before the setter, before `scrollToBlock` (F6b, sharpened by F10). Suppressing only the
      history write would still move the reader, because those are independent statements today and
      a tall paragraph can cross the reading line with its top well above the viewport. The visible
      consequence is that clicking a search result for the paragraph you are already reading does
      nothing; that is deliberate and wants a comment at the abort saying so, or somebody will
      "fix" it.
- [x] The wrapper is `watchHistoryWrites` ([`router.ts`](../../src/web/router.ts)), which is the
      single choke point for both nuqs's writes and `navigate`'s. `navigate` goes on passing `null`
      state and no longer needs to know anything: the wrapper substitutes, which is one fewer caller
      that can get the rule wrong.
- [x] Tests, red first — `tests/jump-history.test.ts`: strip-and-preserve, the arm-and-consume
      handshake, a `cols`/`mode`/`sort` push after a jump carrying **no** stamp, a replace after a
      jump carrying **one**, jumping within a section after manual scrolling, jumping while the
      300ms position replace is pending, and both variants of `JumpOrigin` round-tripping through
      the stamp. Two of them assert more than a stamp's existence:
      - **from the top**: the predecessor URL has **no** `?at=`, which is the branch the restore
        effect takes to `scrollToTop()`. Not the resulting `scrollY === 0`, which jsdom cannot
        observe — a test that claimed it would be claiming more than it checks.
      - **the F10 abort**: `scrollToBlock` was **not called**, not merely that no entry appeared
- [x] Mutate the finished code at the end of the stage and check the suite notices — red-first only
      tests the diff ([silent-success.md](../reusable/silent-success.md)).

#### What was built, and the two things the code says that the plan could not

Everything above, in [`jump-history.ts`](../../src/web/jump-history.ts) (the stamp, the handshake),
[`keynav.ts`](../../src/web/keynav.ts) (`measureOrigin`, `beginJump`) and
[`router.ts`](../../src/web/router.ts) (the wrapper, `addressAt`).
`beginJump` makes the one nuqs call that was already there — `setAt(target, { history: "push",
limitUrlUpdates: throttle(0) })` — so App.tsx's `jumpTo` is four lines and owns no address logic.
`blockHref` (BlockRef.tsx) now delegates to `addressAt` rather than building the string itself,
because the address written into the predecessor entry and a permalink to that block must be the
same string or Back and the link go to different places.

**The evidence for the atomic shape, since F11 named it but could not test it — and it took two
tests, because the obvious one proves less than it looks.** § never renders the intermediate origin
mounts nuqs and React and records every `?at=` React is rendered with; the destination is the only
one that appears. That is the user-visible claim, and it is **not** evidence of the construction:
React batches, so two ordinary history writes in one task would render as one update too and the
test would pass just the same (F17). So § performs the pair beneath nuqs taps *between* the two
patches — under ours, over nuqs's — and pins the pair itself: one replace carrying the origin, one
push carrying the destination, **both wearing nuqs's `"__nuqs__"` marker**, which is what makes
nuqs's patch skip its `sync()` and hand the hooks a single update. Only that second test fails when
the marker is dropped from one of the writes; the render test goes on passing, which is exactly the
shape of a check that shares an assumption with the code
([silent-success.md](../reusable/silent-success.md)). § discards a position write pins the last
piece: a scroll write
still inside its 300ms debounce is aborted by the jump's own `throttle(0)`, so it cannot land on the
entry the jump just pushed.

**One nuqs fact this stage had to learn the hard way, and it is now written into App.tsx too.**
`throttle(0)` does not write the URL on the spot. The queue resets its `timeMs` to nuqs's own
default — 50ms outside Safari — and `push` only ever *raises* it, so a `throttle(0)` cannot lower
the floor: the write lands within ~50ms, on a later task. Nothing in the app minds, but a test that
waited one tick for it passed or failed depending on how slow the previous test had been, which is a
coin toss wearing a green tick. `tests/jump-history.test.ts` § settled waits past the whole window
and says why.

**`scrollY` is not observable in jsdom**, which has no layout and whose `window.scrollTo` is a
no-op — which is why the checklist above says what the top-of-the-article test asserts instead.

### Stage B — the chip — **built, 2026-09-06**

- [x] `useJumpOrigin`: a `useSyncExternalStore` hook whose snapshot includes the validated stamp and
      which subscribes to **both** `popstate` and the `NAVIGATED` event (F6). `useAddress` is not
      enough — two entries can share a URL and differ only in state.
- [x] `src/web/ReturnChip.tsx`: a small pill, bottom left, above the `Dock`, reading
      `↩ back to <section>`. It borrows `.cmt-dialog`'s *bottom arithmetic*, mirrored to the left;
      the z-index is 46, which is `.install-hint`'s number and not that dialog's 70 — chrome about
      the reading session rather than a dialog.
- [x] Drawn **exactly when** the current entry carries a stamp naming a block this article has —
      no section-equality hide rule (F2). Pressing Back, or any push that clears the stamp, removes
      it.
- [x] Pressing it calls `history.back()` and **nothing else** — popstate → nuqs →
      `useReadingPosition` already does the scroll.
- [x] A stamped block the article no longer has (re-extraction) hides the chip rather than pointing
      at nothing — the same graceful nothing `scrollToBlock` gives a stale `?at=`.
- [x] An origin of `{ kind: "top" }` reads **"↩ back to the beginning"** rather than naming a
      section (F8).
- [x] **A dismiss control** (F12): a small × that strips only the current entry's stamp with a
      `replaceState`. The chip is otherwise honest for as long as the stamp is on the entry, which
      can be the rest of a long session — and an *inferred* hide rule is what F2 already refused, so
      the escape has to be one the reader asks for.
- [x] Tests: the gate, the label (both origin variants), that a `cols` push after a jump draws no
      chip, and that dismissing strips the stamp without adding a history entry.
      `tests/return-chip.test.tsx`, twelve of them. Four mutations of the finished code at the end
      of the stage, each caught: dropping `NAVIGATED` from the subscription (six red), dismissing
      through the wrapper instead of under it (one), naming the first section for a `top` origin
      (one), and labelling an unresolvable stamp instead of hiding it (one).
- [x] Browser check in a Sonnet subagent at phone width, per
      [browser-control.md](../project/browser-control.md). Playwright on the box, at 390×844, on
      "Cargo Cult Science": a glossary term and a spine band both draw the chip; the press returns
      the reader to `scrollY` 0 and the chip goes; the × leaves the URL and the scroll alone and
      **Back afterwards still reaches the entry before the jump**. The spine's right edge is at
      x=12 and the chip's left at x=20. The home-indicator case was checked by injecting
      `--safe-bottom: 34px` — the technique `scripts/safe-area-check.ts` uses, since the real
      insets are `0px` on every machine we develop on — and the chip stayed clear of the dock as it
      grew. **Not seen on a real phone**, which is the one thing that check cannot claim.

#### What was built, and the four things the code says that the plan could not

[`ReturnChip.tsx`](../../src/web/ReturnChip.tsx) is the pill and the label;
[`router.ts`](../../src/web/router.ts) holds `useJumpOrigin` and `dismissJumpOrigin`;
[`position.ts`](../../src/web/position.ts) gained `sectionIndexContaining`, which is
`sectionContaining`'s walk with the answer stopping one step earlier — the spy wants the section's
first block, the chip wants its title, and there must not be two walks that can disagree about which
section a block is in.

**`useJumpOrigin` is in router.ts, not beside the chip, and `NAVIGATED` is why.** The event is not
exported and should not be: `subscribe` — the private function behind `useAddress`, `useRoute` and
`onAddressChange` — already listens for it *and* `popstate`, which is exactly the pair F6 asks for.
Exporting the event name to let another module rebuild that subscription would be a second copy of
the same three lines. So the hook sits with the other two history-backed stores, one screen below
the wrapper that writes the stamp, and `jump-history.ts` stays free of React.

**The snapshot has to be a cached object.** `useSyncExternalStore` compares snapshots with
`Object.is`, so returning a freshly parsed `{ kind, blockId }` on every call renders for ever —
which is why `useAddress` and `useRoute` both snapshot strings and say so. The caller here wants an
object, so the identity is held instead, keyed on a serialisation.

**The dismiss has to get *underneath* our own wrapper, and the naive version is a silent success.**
`watchHistoryWrites`'s `replaceState` re-applies the stamp it finds on `history.state` rather than
trusting the caller's argument, deliberately — the scroll spy rewrites `?at=` about once a second
passing `null` state, and trusting it would erase the chip the moment the reader moved. So a
`replaceState(withStamp(history.state, null), …)` is a no-op that looks exactly like a working
button. `dismissJumpOrigin` calls the `replaceState` captured when we patched, and falls back to
whatever is on `history` when the wrapper was never installed, where there is nothing to get under.

**`left: 1.25rem` is right only in the mode it was measured in.** It clears the 12px spine, but the
mode band takes real width from that same edge on a wide window, and a chip in a flat gutter would
sit inside an open chat panel. The rule uses `calc(var(--spine-w) + var(--mode-w) + var(--safe-left)
+ 0.5rem)` — the expression `.reader`'s padding, `.masthead`, `.controls` and `td.pin-left` all
already use for "after the furniture on the left" — which comes to the same 20px where the plan
measured it. Everything else is as specified: `.cmt-dialog`'s bottom arithmetic mirrored, z-index 46.

Two smaller ones. `rowOf` now comes out of `useReadingPosition` rather than being rebuilt in the
chip: it is a `Map` over every block in the article, and two of them kept in step by nothing is the
kind of thing that goes wrong quietly. And a section whose title is empty draws
**"↩ back to where you were"** rather than nothing — the return is valid and only its *name* is
missing, which is not the case F2 refused to suppress.

### Stage B2 — opening a question is a jump; stepping between them is not — **built, 2026-09-06**

Both paths called `goToComment`, and F9 is that they are two different intents wearing one
function. Splitting them was the whole stage.

- [x] **Opening a question from the drawer is an arbitrary jump** and goes through the transaction
      when it moves the page. The call sites are the two `onOpenComment` closures in
      [`App.tsx`](../../src/web/App.tsx) (the owner's and the visitor's).
- [x] **The dialog's Prev/Next do not push** — the four `onPrev`/`onNext` closures in the same file.
      They keep replacing `?note=` and scrolling, exactly as
      [comments.md § Reading order](../project/comments.md#reading-order) says: *"Like keynav.ts, it
      writes no position state of its own"*. Twenty questions must not cost twenty presses of Back.
- [x] **The stamp survives those replaces**, which is what makes the split better than either half:
      after stepping through several questions the chip still points at the place the reader
      **entered** the traversal from, not at the previous question.
- [x] When the target is already on screen, nothing moves and nothing is pushed — the existing
      deliberate behaviour, and the reason two comments in one paragraph do not jolt.
- [x] Tests: drawer selection of an off-screen question adds **one** entry; **ten** off-screen
      Prev/Next steps add **none**, and the chip still names where the traversal began.
      [`tests/comment-jump.test.ts`](../../tests/comment-jump.test.ts), eight of them, red first
      against the unsplit behaviour. Three mutations of the finished code, each caught: the drawer
      scrolling instead of jumping (four red), dropping the `isBlockOnScreen` guard (two), and the
      arrows writing an entry of their own (two, including the stamp one).

#### What was built, and the three things the code says that the plan could not

The two behaviours are [`src/web/comment-jump.ts`](../../src/web/comment-jump.ts) rather than two
closures in `App.tsx`, because **the only assertion that can tell them apart is the entry count**,
and a test of a closure written out again in the test file would have proved nothing about the app.
`App.tsx` keeps two one-line `useCallback`s, `openCommentFromDrawer` and
`stepToNeighbouringComment`, and the six call sites the plan named were all six there.

**There is a *third* `onOpenComment`, and it is not a call site of this.** `TableView`'s, wired to
`openCommentDialog` — the `Bookmark` in the gutter beside a commented block. It only sets `?note=`
and never moves the page, which is right: the reader pressed a control attached to the block, so
the block is on screen by construction. Left alone. (Its declared parameter is `BlockId` while what
it is handed is a *comment* id. Harmless — both are spideryarn ids and `parseAsBlockId` is
`createParser<string>` — but the type is a lie, and worth a minute the next time anything near it
moves.)

**`?note=` and `?at=` land on one entry only because they are set in the same tick**, and that is
nuqs's queue rather than anything this code does: pending updates are merged into one flush and any
push option upgrades the whole flush to a push. Across two ticks a drawer selection would cost two
presses of Back, with the first taking the reader to a dialog about a paragraph they can no longer
see. § puts the note and the position on the same entry is the test, and it checks the *predecessor*
after a step back rather than only the entry count.

**The drawer inherits F10's trade, in one reachable case.** A comment on a paragraph tall enough to
be crossing the reading line with its top above the viewport is *not* `isBlockOnScreen`, so the old
code scrolled to it; `beginJump` now aborts the whole jump, because origin and target are the same
block and moving the reader irreversibly is the thing F10 refused. So choosing that comment from the
drawer opens its dialog and moves nothing. Same trade, same reason, and the same fix if it ever
matters: a finer origin than a block id.

**Stepping cannot push, structurally — but nothing stops the wiring changing.** `stepToComment` has
no `jumpTo` in scope, so no edit *inside* it can reintroduce F9. What no type can refuse is
`App.tsx` calling `jumpToComment` from an arrow closure instead, and the test suite pins the module
rather than the wiring. The comment at the call sites says so; a reviewer is the check.

### Stage C — one tick in the spine — **built, 2026-09-06**

- [x] A single faint mark at the origin block, drawn only while the chip is up, and none at all for a `{ kind: "top" }` origin (F8), through the rail's
      existing mark machinery ([`spine-marks.ts`](../../src/web/spine-marks.ts)).
- [x] It must not take a search lane or move the search marks sideways.
- [x] Test the arithmetic, not the pixels — that is what `spine-marks.ts` is a separate module for.
      `tests/spine-marks.test.ts` § `jumpOriginMark` is the five-case arithmetic;
      `tests/spine-jump-origin.test.ts` is the ten things about the mark that are not arithmetic
      and are all invisible — the gate, the lane, and the paint order.
- [x] Three mutations of the finished code at the end of the stage, each caught: dropping the `top`
      case (three red), keeping a mark whose row the page no longer has (two), and rendering the
      mark after the search marks instead of before them (one).

#### What was built, and the three things the code says that the plan could not

`jumpOriginMark` in [`spine-marks.ts`](../../src/web/spine-marks.ts), a `.spine-from` element in
[`Spine.tsx`](../../src/web/Spine.tsx), and one rule in `styles.css`. **No edit to `App.tsx` at
all**, which is the first of the three.

**The rail subscribes to the stamp itself.** `matches` is a prop because it is derived from search
state that lives in `App`; the jump origin is not, so `Spine` calls `useJumpOrigin` exactly as
`ReturnChip` does. That makes the mark and the chip **one fact with two views** rather than two
things kept in step — the × strips the stamp and both go, with neither knowing the other exists —
and it keeps `App` out of a re-render it has no use for. It does *not* put the rail back on the
scroll path, which is the thing that component is careful about: `jumpOriginSnapshot` caches the
object it returns, so the scroll spy's `?at=` replace fires the store's listener about once a second
and changes nothing.

**The mark needed `.spine-here`'s clamp, and for a sharper reason than the ring did.** The 3px floor
grows the box downward from `top`, so a mark placed in the last rows of the article grows out of
`.spine { overflow: hidden }` and disappears — and a jump made from the end of a long piece is
exactly the one whose reader is furthest from home. Same `--from-top` custom property, same
`min()` in the stylesheet, same reason it cannot be a `calc()` written inline (jsdom's CSSOM mangles
it into a string every assertion would agree with). **`.spine-match` had the same bug**, and the
precise statement of it is Sol's rather than the first draft's (F31): the clip does not remove the
mark, it removes the **3px floor** — the overflow cuts the box back to the row's own proportional
height, so a final block that is short enough disappears and one that is merely small is left as a
sliver. Confirmed in a browser on `antikythera-mechanism-spya-zhxrzm`, whose last block is a short
citation: a mark for a word unique to it was drawn at `top: 798.9, bottom: 801.9` against a rail
ending at 800, so two thirds of it was outside. Fixed in its own commit rather than inside Stage C,
which was told not to disturb the search marks.

**"Takes no lane" is a shape, not a discipline.** The origin is not a `SpineMark`: that type carries
a `lane` and an `rgb`, and lanes are *packed* by `laneOrder`, so anything holding one has to be given
a track out of the same 10px gutter and every search shifts sideways to make room. Returning
`{ top, height }` from a different function into a different element makes that impossible rather
than merely avoided, and the test pins the search mark's whole inline style across a jump.

### Docs

- [x] [url-state.md § Position replaces history](../project/url-state.md#position-replaces-history-deliberate-acts-push)
      gains the transaction and the chip: the same section, because it is the same rule. Done as a
      sub-section under the gist-jump exception, since that exception is the thing it extends. It
      says the three things a future reader would otherwise reverse-engineer — that the origin is
      *measured* rather than read, that both writes belong to the wrapper because two nuqs setters in
      one tick are not a transaction, and that a push strips the stamp unless a jump armed it.
- [x] **[reading-view-overview.md](../project/reading-view-overview.md): nothing, deliberately.**
      That file is a map of *docs*, and this feature has no doc of its own — its facts live in
      `url-state.md` and in [`jump-history.ts`](../../src/web/jump-history.ts)'s header, which is one
      home each. Its existing line for `url-state.md` already promises "which push history and which
      replace", which is exactly where a reader looking for this would go. Adding a second home for
      the same fact is what [documentation-policy.md](../reusable/documentation-policy.md) refuses,
      and an entry point's wording is a rule needing Greg's approval — not worth spending on a line
      that would restate a link already there.
- [x] [comments.md](../project/comments.md) if Stage B2 changes what stepping between questions
      means for Back. It did, for half of it: § Reading order gained
      [§ Opening a question is a jump](../project/comments.md#opening-is-a-jump), which says which
      half of the old sentence still holds and which no longer does.

## Deliberately not in this plan

- **A dropdown of previous locations.** Repeated presses walk the chain. Build a list only if Greg
  asks for one after using the chip.
- **The fading multi-mark trail.** Argued against above. Stage C is the part worth having.
- **Tweets and Metadata remembering their own position** (F5). A plan of its own, which must decide
  three things this one cannot: where a remembered "last page" is consumed without making a bare
  `/read/<slug>` open something other than the reader; stable keys for Metadata's sections; and
  whether tweets gain persistent ids or use a `(sourceHash, index)` pair that is discarded the
  moment the thread is regenerated.
- **Cross-device resume.** A schema change, and hard to reverse, so Greg's call rather than one to
  slip in. The design when it is wanted: a `last_view` column beside `lastOpenedAt` on the shelf
  row, written debounced from `writeLastView`, read **only** as the fallback when local storage has
  nothing. It slots under `last-view.ts` unchanged, and `REMEMBERED` / `NEVER_REMEMBERED` already
  say what may travel. Flagged because the iOS storage split above means this will stop being
  optional sooner than 260905d assumed.
- **Forward.** Untouched; the stamps live on the entries, so it keeps working on its own.

## References

- [260906g-plan-review-sol.md](260906g-plan-review-sol.md) — the review that reshaped this, and
  [260906g-plan-review-prompt.md](260906g-plan-review-prompt.md) that asked for it.
- [url-state.md](../project/url-state.md) — the contract this extends, especially
  § Position replaces history and § Reopening an article where you left it.
- [260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md) —
  what shipped for ask 1, and what it deferred.
- [`position.ts`](../../src/web/position.ts) — `positionToWrite`, whose three deliberate rules are
  why the origin has to be measured rather than read.
- [granularity-zoom.md](../project/granularity-zoom.md) — the spine, for Stage C.
- [block-ids.md](../project/block-ids.md) — why the stamp is a block id and not an offset.
- [reading-view-overview.md](../project/reading-view-overview.md),
  [comments.md](../project/comments.md), [touch.md](../project/touch.md).
