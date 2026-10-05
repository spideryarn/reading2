# Three robustness bugs: unknown wire values, a root with no children list, the chain timer

Up: [plans.md](../project/plans.md).

Three independent queue items, dispatched by the Overseer on 2026-10-05 under Greg's standing rule
(2026-10-04: *"if you see bugs, fix them without asking me"*). One stage and one commit per item, so
any one can land without the others. No paid model call is needed by any of them.

Done, for every stage: a failing test seen red first, `npm test` and `npm run typecheck` green, a
GPT Sol code review, and for anything a reader sees a browser check at desktop, iPad and phone widths.

## Stage A — `qi-nvwsgw8y`: an old app copy meeting a value it was built before

**The defect.** A copy of the app opened from a home-screen icon outlives several deploys. When the
server sends an enum value that copy has no table entry for, a bare `TABLE[value]` answers
`undefined`; when the value is an inherited name (`__proto__`, `constructor`, `toString`) it answers
an object or a function. The Metadata crash (`SPIDERYARN-READING2-BJ`, `-CB`) was this shape and was
fixed in `87f756f1e` with an own-key lookup and a neutral glyph (`src/web/Metadata.tsx` §
`stageIcon`). GPT Sol's F20 in
[the review of that work](261005d-notice-a-deploy-on-wake-code-review-sol.md) lists six more sites.

What each does today, as read (to be confirmed red, not assumed):

| Site | Lookup | Unknown value today |
|---|---|---|
| `SourceScanNotice.tsx` | `KIND_LABEL[kind]`, `ORDINARY_LABEL[ordinary]`, `BLIND_SPOT_LABEL[spot]` | empty label; the blind-spot list joins the word "undefined" into a sentence |
| `MirrorPanel.tsx` | `KIND_LABEL[remark.kind]` | empty badge |
| `CriteriaPanel.tsx` | `KIND_LABEL[row.config.kind]` | empty line |
| `marginalia/MarginaliaColumn.tsx` | `RELATION_WORD[relation]`, `PROVENANCE_TIP[provenance]` (four uses) | empty stamp or tip |
| `ProfilePage.tsx` | `PROVIDER_LABEL[m.provider] ?? m.provider`, `WIRE_LABEL[...] ?? ...` | already falls back to the raw value; only an inherited name defeats it |
| `live/gpt-live/useGptLive.ts` | `CLOSED_SENTENCE[reason] ?? CLOSED_OTHER` | already falls back; an inherited name hands `setError` a non-string |

An honest note on severity: React draws `undefined` as nothing, so most of these are a missing
label rather than a crash. What does throw is an object reaching React as a child (`__proto__`), and
what silently lies is `"undefined"` joined into prose. The queue item says "can crash"; the tests
will say which sites really do.

**The fix.** One small shared helper in `src/web/lib/` — an own-key lookup,
`ownLabel(table, key): T | undefined` — used by all six sites and by `stageIcon`, so there is one
way to read a table by a wire value. Each site names its own fallback:

- a kind / relation badge: the server's value in plain words (hyphens to spaces), so a new kind
  reads as itself rather than as a blank;
- a tooltip sentence or explanation (`PROVENANCE_TIP`, `ORDINARY_LABEL`): omitted, not invented;
- the blind-spot list: the raw value in plain words, never the word "undefined", and never dropped
  — a dropped blind spot would read as *we looked at everything*, which is the claim that list
  exists to prevent;
- `CLOSED_SENTENCE`: `CLOSED_OTHER`, as now.

Tests: one per site, each rendering (or calling) with a value outside the table and with
`__proto__`, seen red against today's code where today's code is wrong, plus a known-value control.

**Simpler option passed over:** `?? fallback` at each site with no helper. It leaves the inherited
names broken, which is the half that actually throws.

**Also in this stage: the temml import.** `src/web/maths.ts` § `loadTemml` fetches temml on demand.
After a deploy the old copy asks for a chunk that no longer exists, the import rejects,
`renderArticleMaths` catches it and the reader sees raw TeX with nothing said and nothing tried.
The recovery already exists for the two lazy routes: `src/web/stale-shell.ts` § `reloadIfStale`
asks whether a different build is live, reloads at most once per build per session, and declines
when the reader has unsent words. So: when the **default** loader rejects, call `reloadIfStale()`
(not awaited, its own failure swallowed) and return the article as today. A different build live ⇒
one reload and the maths draws; same build, offline, or a draft in hand ⇒ exactly today's
behaviour. An injected `load` (tests) does not trigger it unless the test asks.

What a reader sees: an article with formulae, opened in an old copy, reloads once instead of
showing raw TeX. That is the behaviour `/admin` and `/design` already have.

**Not doing:** retrying the import in place. A missing chunk stays missing; only a new shell knows
the new chunk's name.

## Stage B — `qi-gwnd4skg`: a stored tree whose root has no `children`

**The defect.** `src/web/tree.ts` § `buildChains` does `node.children.map(...)`. The type says
`children: NodeId[]`, but the tree is stored JSON and the type is a claim about it, not a check. A
root (or any node) with no `children` key throws and takes the reading view down. No producer
writes one today; long-documents stage D/E added a new producer, which is why this is worth an hour.

**The fix.** Guard where the stored tree is walked on the client: `buildChains`, and the two other
walkers in the same file that read `node.children` unguarded (`buildOutline` guards only the root;
`buildSummaryTree` guards nothing). A node with no list is a leaf. Then find what else the reading
view calls on the way to first paint with the same tree (`supplementIndex` is called from
`buildGeometry`) and make sure the fixed walk does not just move the crash one call down: the done
criterion is that the reading view's geometry, outline and summary tree all build from such a tree,
not that one line stopped throwing.

Tests, red first: `buildGeometry`, `buildOutline` and `buildSummaryTree` on a tree whose root has
no `children`, and on one where an inner node has none.

**Options passed over.** *Make the type forbid it* — it already does, and the type cannot see
JSON. *Normalise the tree once at the client's door* — covers every walker at once, and is the
better long-term shape if there turns out to be one door; the implementer reports how many doors
there are and whether other client walkers crash on the same input, and that is a follow-up to
report, not part of this stage. *Reject at the server* — `validate-tree.ts` is the place that
complains properly, and a reading view that draws a short tree is better than one that draws
nothing.

## Stage C — `qi-wbte273v`: the chain timer

**The defect.** ↑ / ↓ (`src/web/keynav.ts`) and the Diagram's Previous / Next
(`src/web/DiagramPanel.tsx`) step from *the row the last press aimed at* rather than from a
measurement, because a press mid-glide would measure a row half way. They believe that aim for
`CHAIN_MS` (600 ms: the 200 ms glide "plus a margin") and then measure again. The timer is a
`setTimeout` and the glide is `requestAnimationFrame`; under a long render the glide can still be
pending when the timer fires, the next press measures mid-air, and Next repeats the target it has
just used. GPT Sol reproduced it in a controlled test (261005c code review, C3). The class is the
one in [the postmortem](../postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md):
a clock standing in for a fact the code could read.

**Measure first.** A Sonnet subagent with Playwright, on a long article and a short one, at
desktop, iPad and phone widths, with and without CPU throttling: press Next (and ↓) twice at
several gaps around 600 ms and count how often the second press repeats the first target. The
numbers go in this doc. If it never happens in a browser the fix still lands (the fact is cheaper
than the clock), but the debrief says so.

**The fix: ask whether our jump has ended, rather than how long ago it began.** `scrollToBlock`
already tells its caller how a jump ends (`done(outcome)`: settled, cancelled or missing), and a
newer jump cancels the older one through the same call. So:

- `keynav.ts`: the chain is set on the press and cleared by that jump's own `done`, guarded by a
  per-press token so that the cancel a second press causes does not clear the second press's chain.
  The timer and `CHAIN_MS` go. The reader taking the page back (`wheel`, `pointerdown`) still drops
  it, as now.
- `DiagramPanel.tsx`: the same rule. Its jump goes out through the `onFollow` prop, which does not
  hand back an ending today. The implementer traces `onFollow` to where it reaches `scrollToBlock`
  and picks the smaller of: (a) passing a `done` through; (b) reading `glideTarget()` at press
  time, if and only if the glide is started synchronously inside `onFollow` (otherwise there is a
  gap before the glide begins, which is this bug again). The existing outside-gesture drop stays.

After a jump settles the page is where it will be, and `measureRow()` is a synchronous layout read
that already honours a centred arrival's anchor, so measuring afresh is right. The Diagram's 2026-08-31
comment says `glideTarget()` was tried and left "a gap where nothing is in flight and the
measurement is still mid-air"; as read today that gap should not exist for a layout read, but that
is a reading, so the implementer proves or refutes it with a test before deleting the comment.

**One edge to decide, named here so it is not inherited.** A target the page cannot reach (the last
rows of the article, where the scroll is clamped) never arrives at the reading line. Today a second
press inside 600 ms still steps on from the aim; with the timer gone it would measure and repeat.
Nothing moves either way for ↓, but ↑ straight after differs. Proposed: keep the aim after a
*settled* jump until the page next moves to a pixel that is not ours — the same fact the arrival
anchor uses — only if a test shows the edge is real; otherwise clear on `done` and say so.

Tests, red first: Sol's C3 shape for both callers (the glide's frames held back past 600 ms, a
second press, two distinct targets expected), and the existing chain tests kept. The test that
asserts "measures the world again once the chain has expired" by waiting `CHAIN_MS` is rewritten to
wait for the jump's end instead: it was the clock, written down as the requirement.

**Simpler option passed over:** a bigger `CHAIN_MS`. It goes green on any test with a large enough
number and loses on a longer book, which is what the postmortem says about its sibling.

## What GPT Sol's plan review changed (2026-10-05)

[The review](261005h-three-robustness-bugs-plan-review-sol.md) said build all three, each with
changes. Every finding was accepted; where the text above disagrees with this section, this wins.

**Stage A.**

- **P-1 (P0), P-2 (P1): the maths recovery is awaited, not fired in the background.** Returning the
  article while the build check runs lets the reader start typing a comment or a criterion, neither
  of which `safeToReload()` knows about, and then reloads over it. So `renderArticleMaths` awaits
  `reloadIfStale()` *before* handing the article back, the way `LazyPage.tsx` § `orReloadIfStale`
  holds its rejection: nothing of the article is on screen yet, so nothing can be typed into it. A
  load whose `signal` is already aborted skips recovery entirely, and one aborted while the check
  is pending is covered by `reloadIfStale`'s own address check, to be proved by a test (leave
  before the rejection; leave while the check is pending; a draft present).
- **P-3 (P1):** `PROVENANCE_WORD[note.provenance]` (`MarginaliaColumn.tsx`, the stamp) joins the
  inventory. The implementer greps each of the six files for any further table read by a wire
  value rather than trusting this list.
- **P-4 (P3):** the blind-spot list joins an *empty* segment, not the word "undefined". The fix is
  the same; the test asserts every blind spot sent is represented.

**Stage B.**

- **P-5 (P1): guarding `tree.ts` only moves the crash.** Sol reproduced three more:
  `marginalia/notes.ts` § `marginaliaNotes` (`root.children is not iterable`), `crumbs.ts` §
  `isCrumbSection`, and `whereForBlock` (Skim). With that many walkers, **the fix is at the door**:
  one function that gives every node of a stored tree a `children` list (the same object back when
  none was missing), called where the client receives the tree, so no walker can meet the state.
  `buildChains` keeps a guard of its own, since it is the reported crash and is also reachable from
  tests and scripts that hand it a tree directly. If the implementer finds more than two doors,
  fall back to guarding each walker and say so. Tests: root and inner node without a list, through
  the door, into geometry, outline, summary tree, marginalia notes, crumbs and `whereForBlock`.

**Stage C.** P-6, P-7 and P-8 together replace "clear the chain when our jump's `done` fires":

- P-6: a second tap on a step button fires `touchstart`, which cancels the glide and delivers
  `done("cancelled")` *before* the click, so clearing on `done` breaks rapid taps on the device the
  buttons exist for.
- P-7: `glideTarget()` is null during an instant (reduced-motion) jump's corrective frame, so it is
  not a completion signal; option (b) is dropped and the Diagram forwards `done`. Every branch must
  call it, including `beginJump`'s already-there return.
- P-8: the clamped-end edge is real in both directions.

**The rule that satisfies all three: the aim stands while our jump is unfinished, and after it ends
for as long as the page is still at the pixel it ended on.**

```
press            → chain = { row, endedAtY: null }      (this object is the token)
our jump's done  → that object's endedAtY = window.scrollY   (settled, cancelled or missing alike)
next press       → chain valid  iff  endedAtY === null  ||  window.scrollY === endedAtY
                   valid → step from chain.row;  otherwise → measureRow()
```

A second tap's `touchstart` cancels the glide at some pixel and the click arrives at that same
pixel: valid. A jump clamped at the end of the article settles and the page stays put: valid, so ↓
goes on and ↑ steps back from the aim. A reader's wheel, a scrollbar drag, another feature's jump:
the pixel changes, and the next press measures. Nothing expires, and an older jump's late `done`
writes to its own object, not the newer press's. It is the arrival anchor's rule
(`scroll.ts` § `ourScrollY`) applied to the chain.

The existing drop listeners (keynav's `wheel` / `pointerdown`; the Diagram's outside-gesture list)
stay. The pixel rule makes most of them redundant, and removing them is a separate change nobody
has asked for.

Tests added to the list: the real scroll engine in the Diagram touch test (today's `onFollow` only
records ids); reduced motion; an already-there jump; both clamped-end sequences.

## Stage C's measurement: it did not happen in a real browser (2026-10-05)

A Sonnet subagent, Playwright on system Chrome, commit `8f93796bb`, trusted CDP input so the gap
between presses is wall-clock. Two presses, a gap, then where the reader ended up.

**0 repeats in 436 two-press trials.** ↓ and the Diagram's Next (Force picture), a 3,053-block
article (`s3-doctorow-250p-spya-jg872v`, from the top and from row 1500) and a 93-block one
(`submarine-spya-qw0f3d`), at 1440, 820 and 390 wide, 6× CPU throttle (and 12× for ↓), gaps from
50 to 1,500 ms. Not run: 4×, throttle off beyond a sanity check, 820 for the Diagram, the Sketch
picture (it needs a paid generation).

What it saw instead:

- ↓ on the long article at 6×: the glide's last movement comes 400 to 590 ms after the press, a
  few as late as 694 ms. So the glide does end right around the 600 ms timer; no second press was
  caught in the gap.
- **The Diagram's Next holds the main thread for about 15 seconds on the 3,053-block article at 6×**
  (1.5 to 2 s on the short one), so a second click is never delivered inside the window at all.
  That is a performance defect of its own and is reported to the Overseer, not fixed here.

So the controlled reproduction stands and the browser frequency is, as far as this could measure,
zero. The fix still lands because the rule it replaces is the class that cost six days in
production one file away, and because the pixel rule is no more machinery than the timer. It is
the lowest-value of the three, and the debrief says so.

## Progress

All three built by Opus subagents on 2026-10-05, one commit each, red first. GPT Sol's code review
and the browser check are still to come as of this commit.

- **Stage B, `56ef1be7c`.** One door, as hoped: `article/access.ts` § `resolveAccess`, so
  `tree.ts` § `withChildLists` is called there and `buildChains` keeps its own guard. 29 of 38
  function-level tests and 4 of 5 tests that mount the real `App` were red before. Known limit: the
  walkers outside `tree.ts` are safe because of the door, not on their own, and
  `src/section-path.ts` reads `.children` unguarded on the server too, which is outside this stage.
- **Stage A, `d96aa2e5a`.** `src/web/lib/own-label.ts` § `ownLabel`, `plainWords`. 41 tests red
  before. What was really wrong at each site: `__proto__` crashed SourceScanNotice, MirrorPanel,
  CriteriaPanel and ProfilePage, and in Marginalia made the slot's boundary drop every note beside
  the block; `toString` as a GPT-Live close reason made the error read "[object Undefined]"; an
  ordinary unknown value only drew a blank. The maths recovery is `renderArticleMaths`'s `recover`
  option, awaited. Two things decided in passing: an unknown everyday explanation is omitted but the
  finding keeps its place in the list; and after a reload is requested the article is returned at
  once, so raw TeX can show for an instant before the page is replaced.
  Other tables that may be read by a wire value were noticed and not traced (`RERUN_LABEL`,
  `KIND_WORD` in FeedbackEarlier, three in DebatePanel, `SCORE_LABEL`, `QUOTE_SCORE_LABEL`,
  `SECTION_LABEL`, `FROM_LABEL`, `DIMENSION_LABEL`, `DEPTH_LABEL`, `STATE_WORD`): reported to the
  Overseer as a follow-up.
- **Stage C, this commit.** `keynav.ts` § `Chain` (`startChain`, `endChain`, `chainedRow`), shared
  by both callers; `CHAIN_MS` and both timers are gone. The Diagram's ending is forwarded
  `stepTo` → `onFollow` (`FollowJump`) → `Reader.tsx` § `followTo` → `jumpTo` → `beginJump`, five
  files, every new parameter optional. Red before: C3 for both callers, reduced motion, an
  already-there jump, both clamped-end sequences, and a page moved with no gesture. Five mutations
  of the finished rule each turned tests red, including the "clear on done" design this plan first
  proposed. Known limit: the type stops `jumpTo` being passed as `onFollow` unwrapped, but only
  tests hold "every branch calls `ended`".

## Code review fixes (2026-10-05)

The independent review found three in-scope gaps, reproduced with tests before fixing:

- Stage A: a reload request released the article before document replacement. Maths now shares
  LazyPage's bounded grace hold. A pending check could also reload an abandoned load whose address
  stayed the same; its abort signal now vetoes recovery before the session reload is claimed.
  [Recovery postmortem](../postmortems/261005g-an-address-and-a-reload-request-are-not-a-loads-lifetime.md).
- Stage C: settled aims survived reflow at unchanged `scrollY`, and Diagram kept a numeric aim
  after its block order changed. A later press now checks the settled target's layout, and Diagram
  drops aims when its block mapping or picture changes. This extends the accepted pixel rule;
  unfinished jumps, rapid touch and clamped ends retain their aims.
  [Navigation postmortem](../postmortems/261005g-a-navigation-aim-outlives-the-layout-that-made-its-row-true.md).
- Stage B needed no code change. Mutating its ingress fix and independent geometry guard made the
  relevant tests fail; the original code was restored.

The earlier Stage A Progress decision to return immediately after a requested reload is superseded
by this review fix. Browser checks and the complete database-backed suite remain to be run in an
environment with network access. Nothing was committed during the review.

**Wider server finding, reported only:** `src/public/dto.ts` § `publicTree` spreads
`node.children` before the public response reaches the client. Calling the real `publicArticle`
with a missing root or inner list threw `TypeError: node.children is not iterable`; its complete-tree
control returned two nodes. The public route converts that exception to HTTP 500. Thus the client
visitor tests prove safety for a delivered malformed payload, not an end-to-end visitor read from
malformed storage. This and the already-noted `src/section-path.ts` server Skim walker remain outside
the client stage's fix.
