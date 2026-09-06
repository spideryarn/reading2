# Back to where you jumped from

Status as of 2026-09-06: **planned, not built** — evidence: no `jump-history.ts` in `src/web/`.
Revised twice, after two cross-family reviews that each refused the draft before them —
[round 1](260906g-plan-review-sol.md) on four established P1s,
[round 2](260906g-plan-review2-sol.md) on three more. What changed is in
[§ What the reviews changed](#what-the-reviews-changed). Discovery is now closed: twelve findings,
all accepted, none overruled.

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

Greg floated marks in the spine, fading over time. Recommended **against** in that form, and the
reason is the rail's own stated rule: it *"acquires marks when the reader asks for them and at no
other time"* ([`Spine.tsx`](../../src/web/Spine.tsx)). It is a 12px strip already carrying the
bands, the you-are-here marker and one lane per active search
([`spine-marks.ts`](../../src/web/spine-marks.ts)). A decaying trail is ambient information with no
action attached and a legend the reader would have to learn.

The single-mark version earns its place, because it answers something the chip's label cannot —
*how far did I come?* **One faint tick at the block you jumped from, drawn only while the chip is
up.** Same datum as the chip, so nothing to keep in sync, no new colour, no decay curve, no second
lane. That is Stage C.

## What the reviews changed

Two rounds, both **refusals**, twelve findings, all twelve accepted after being checked against the
source. Nothing was overruled. Round two settled the one question round one left open — how the
transaction can be atomic against nuqs's setter queue — by reading the queue rather than reasoning
about it, which is why F11 specifies a code shape and not a principle.

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

### Stage A — the jump transaction

The predecessor entry must name where the reader actually was, and the stamp must agree with it.

- [ ] New `src/web/jump-history.ts`: pure functions over an opaque history-state object — read our
      stamp, write it, strip it while preserving foreign state. No React, no DOM.
- [ ] **The origin is measured, not read**, and it is **not always a block**:

      ```ts
      type JumpOrigin = { kind: "top" } | { kind: "block"; blockId: BlockId };
      ```

      At the moment of a jump, take the block crossing the reading line — `measureRow()` in
      [`keynav.ts`](../../src/web/keynav.ts) returns exactly this, over every `tr[data-block]`
      rather than only section rows. **Not `?at=`**, for the three reasons in F1. But **if
      `window.scrollY <= stickyOffset()` the origin is `top`** and the predecessor rewrite *removes*
      `?at=` rather than setting it — F8, because `measureRow()` answers `0` at the top of the
      article whether or not any row has reached the line, and a `scrollToBlock` on the first block
      lands under the sticky chrome rather than at the top.

- [ ] **One transaction, owned by the wrapper** (F11). `jumpTo` arms `{ pathname, origin, target }`
      and makes **exactly one** nuqs call — the destination push. When `watchHistoryWrites`
      intercepts the matching armed push it synchronously calls its **captured inner**
      `replaceState` to rewrite the current entry to the origin, then its **captured inner**
      `pushState` with the destination and the stamped state; it consumes the arm in a `finally` and
      emits `NAVIGATED` once after the pair rather than once per call. The arm is matched against
      its expected pathname and target, so an unrelated push cannot consume it.

      **Two `setAt` calls would not have worked**, which is why this is spelled out: nuqs keys
      pending updates with `Map.set`, so the second overwrites the first, any push option upgrades
      the combined flush to a push, and `throttle(0)` still defers the flush to a later task. The
      result would have been one destination push and no predecessor rewrite — a silent success of
      exactly the shape [silent-success.md](../reusable/silent-success.md) is about.

      "Captured inner", because calling `history.replaceState` here would recurse through our own
      wrapper. And this is *synchronous and wrapper-owned* rather than atomic: the History API
      offers no rollback if the second native call throws.
- [ ] **Every same-path push strips the inherited stamp** and adds one only when a jump has just
      armed an origin (F3). An unarmed push clears rather than inherits.
- [ ] `replaceState` preserves the current entry's stamp — free, via nuqs, but pinned by a test so
      it stays free.
- [ ] A pathname change clears: an excursion belongs to one article.
- [ ] **When the measured origin is the target block, abort the whole jump** — before `synced`,
      before the setter, before `scrollToBlock` (F6b, sharpened by F10). Suppressing only the
      history write would still move the reader, because those are independent statements today and
      a tall paragraph can cross the reading line with its top well above the viewport. The visible
      consequence is that clicking a search result for the paragraph you are already reading does
      nothing; that is deliberate and wants a comment at the abort saying so, or somebody will
      "fix" it.
- [ ] The wrapper is `watchHistoryWrites` ([`router.ts`](../../src/web/router.ts)), which is the
      single choke point for both nuqs's writes and `navigate`'s. `navigate` currently hardcodes
      `null` state; it stops doing that.
- [ ] Tests, red first — `tests/jump-history.test.ts`: strip-and-preserve, the arm-and-consume
      handshake, a `cols`/`mode`/`sort` push after a jump carrying **no** stamp, a replace after a
      jump carrying **one**, jumping within a section after manual scrolling, jumping while the
      300ms position replace is pending, and both variants of `JumpOrigin` round-tripping through
      the stamp. Two of them assert more than a stamp's existence:
      - **from the top**: the predecessor URL has **no** `?at=`, and the final `scrollY` is `0`
      - **the F10 abort**: `scrollToBlock` was **not called**, not merely that no entry appeared
- [ ] Mutate the finished code at the end of the stage and check the suite notices — red-first only
      tests the diff ([silent-success.md](../reusable/silent-success.md)).

### Stage B — the chip

- [ ] `useJumpOrigin`: a `useSyncExternalStore` hook whose snapshot includes the validated stamp and
      which subscribes to **both** `popstate` and the `NAVIGATED` event (F6). `useAddress` is not
      enough — two entries can share a URL and differ only in state.
- [ ] `src/web/ReturnChip.tsx`: a small pill, bottom left, above the `Dock`, reading
      `↩ back to <section>`, following `.cmt-dialog`'s positioning at z-index 46.
- [ ] Drawn **exactly when** the current entry carries a stamp naming a block this article has —
      no section-equality hide rule (F2). Pressing Back, or any push that clears the stamp, removes
      it.
- [ ] Pressing it calls `history.back()` and **nothing else** — popstate → nuqs →
      `useReadingPosition` already does the scroll.
- [ ] A stamped block the article no longer has (re-extraction) hides the chip rather than pointing
      at nothing — the same graceful nothing `scrollToBlock` gives a stale `?at=`.
- [ ] An origin of `{ kind: "top" }` reads **"↩ back to the beginning"** rather than naming a
      section (F8).
- [ ] **A dismiss control** (F12): a small × that strips only the current entry's stamp with a
      `replaceState`. The chip is otherwise honest for as long as the stamp is on the entry, which
      can be the rest of a long session — and an *inferred* hide rule is what F2 already refused, so
      the escape has to be one the reader asks for.
- [ ] Tests: the gate, the label (both origin variants), that a `cols` push after a jump draws no
      chip, and that dismissing strips the stamp without adding a history entry.
- [ ] Browser check in a Sonnet subagent at phone width, per
      [browser-control.md](../project/browser-control.md).

### Stage B2 — opening a question is a jump; stepping between them is not

Both paths call `goToComment` today, and F9 is that they are two different intents wearing one
function. Splitting them is the whole stage.

- [ ] **Opening a question from the drawer is an arbitrary jump** and goes through the transaction
      when it moves the page. The call sites are the two `onOpenComment` closures in
      [`App.tsx`](../../src/web/App.tsx) (the owner's and the visitor's).
- [ ] **The dialog's Prev/Next do not push** — the four `onPrev`/`onNext` closures in the same file.
      They keep replacing `?note=` and scrolling, exactly as
      [comments.md § Reading order](../project/comments.md#reading-order) says: *"Like keynav.ts, it
      writes no position state of its own"*. Twenty questions must not cost twenty presses of Back.
- [ ] **The stamp survives those replaces**, which is what makes the split better than either half:
      after stepping through several questions the chip still points at the place the reader
      **entered** the traversal from, not at the previous question.
- [ ] When the target is already on screen, nothing moves and nothing is pushed — the existing
      deliberate behaviour, and the reason two comments in one paragraph do not jolt.
- [ ] Tests: drawer selection of an off-screen question adds **one** entry; **ten** off-screen
      Prev/Next steps add **none**, and the chip still names where the traversal began.

### Stage C — one tick in the spine

- [ ] A single faint mark at the origin block, drawn only while the chip is up, and none at all for a `{ kind: "top" }` origin (F8), through the rail's
      existing mark machinery ([`spine-marks.ts`](../../src/web/spine-marks.ts)).
- [ ] It must not take a search lane or move the search marks sideways.
- [ ] Test the arithmetic, not the pixels — that is what `spine-marks.ts` is a separate module for.

### Docs

- [ ] [url-state.md § Position replaces history](../project/url-state.md#position-replaces-history-deliberate-acts-push)
      gains the transaction and the chip: the same section, because it is the same rule. It must say
      that `?at=` is *rewritten* at jump time, which is new and surprising.
- [ ] [reading-view-overview.md](../project/reading-view-overview.md) gains a line for the chip.
- [ ] [comments.md](../project/comments.md) if Stage B2 changes what stepping between questions
      means for Back.

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
