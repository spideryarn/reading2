# Deploys tab: default-collapsed, a table of contents, easier to read

Greg, 2026-09-09:

> improve the Deploys UI, e.g. default-collapsed, with a table of contents. Take browser screenshots
> and make it easier to read.

The Deploys tab landed the night before ([260909b](260909b-deploys-tab-most-recent-production-deploys.md))
and it is correct and unreadable. This is the reading pass over it: every deploy collapses to one
line, a table of contents at the top can jump to any of them, and the honest-absence states the
first pass fought for all survive.

Owner of the work: session `deploys-ui`, worktree `deploys-ui`, queue item `qi-dwyjxwrz`.

## What was actually wrong, measured before designing

A Sonnet subagent drove Playwright against the live dashboard on `:8787` at 1280×900 and 390×844
before anything was changed. Screenshots (scratchpad, 2026-09-09):
`before-desktop-1280.png`, `before-desktop-1280-top.png`, `before-phone-390.png`,
`before-phone-390-top.png`.

| | desktop 1280 | phone 390 |
|---|---|---|
| whole page, 10 deploys | **6066 px** | **8824 px** |
| the freshness header | 279 px (4–5%) | — |
| a normal deploy card | **950–1000 px** | taller |
| a quiet deploy card | ~101 px | — |

**The header is not the problem, and that is the finding worth having before designing.** The brief
said "the staleness header kept but made scannable", and I had a redesign of it half-drafted; the
measurement says it is 4% of the page and already reads as four short lines. Redesigning it would
have been effort spent on the part that works, and every sentence in it was fought for line by line
in 260909b's review. **So it is left alone.** The one change it gets is that it is no longer the
thing standing between you and the list, because the list is now short.

The three real faults, from the same pass:

1. **One deploy is more than one viewport.** To learn that a *second* deploy exists you scroll past
   the entire write-up of the first — eight entries, three sub-headings, and a row of commit chips
   under every paragraph. And you cannot tell in advance which releases are the cheap ones: the
   quiet ones are 101 px and look identical from above.
2. **There is no way to jump to a particular deploy.** No index, no anchor, no release-number
   control. Wanting release 70 means reading 74, 73, 72 and 71 on the way.
3. **It reads as a wall of near-identical boxes.** Every card repeats heading → sub-heading →
   paragraph → a row of grey commit chips, ten times.

## What we are building

### Each deploy collapses to one line, expands in place

A native `<details>`/`<summary>`, closed by default. The summary is the whole row:

```
Release 74   05:32 UTC   25h ago   8cd2206   137 commits   Delete an article for good  +7 more
```

- the release number, which is also what the table of contents jumps to, so the target and the
  destination read the same;
- **the clock time, labelled with its zone**, and the date on the day heading above it rather than
  repeated on every row. That zone was the reader's own device's for the first draft; it is UTC, and
  why is the reversal recorded below;
- the short sha as **plain mono text, not a link** — a link inside a `<summary>` both follows and
  toggles, and it is a fiddly tap target on a phone. The linked sha is in the body, where it was;
- the commit count, or *commit count not recorded* — null is not zero, unchanged from 260909b;
- **a one-line gist**, which is the part that has to stay honest (below).

Opening it shows exactly what the card showed before: the three-zone line, the linked sha and
previous sha, the grouped changelog entries, and every partial-read sentence.

### The gist is where this design could lie

The collapsed line is a summary of a thing whose whole first review was about not summarising it
wrongly, so the three cases stay apart, as they do in the body:

| the deploy | the gist reads |
|---|---|
| `changelogReadable === false` | *what changed could not be read* — in `unknown-ink`, never as a quiet deploy |
| readable, no entries | *Nothing a reader would notice* — faint. The common case, and not a fault |
| readable, entries | the first entry's title, preferring a headline one, then `+N more` |
| readable, some entries unparsed | as above, **plus `+N unreadable`** in `unknown-ink` |

That last row is the one a collapsed view invents the opportunity for: a summary reading
"Hover cards on links +2 more" when three further entries failed to parse is understating a gap the
expanded body does declare. It costs one clause.

### The table of contents

At the top of the list, above the deploys: one row per **day**, and under each day a chip per
deploy carrying its release number.

```
Times and days below are UTC, the zone the record itself is in.
Open a deploy to see it in UTC, London and Athens.

Tue 8 Sep 2026    74  73
Mon 7 Sep 2026    72
Sun 6 Sep 2026    71  70  69  68  67  66  65
```

Pressing a chip opens that deploy and scrolls it into view.

**Why days rather than a flat list of ten lines, which is what the brief literally described.** With
every deploy collapsed to one line, a flat table of contents is the list again, one row for one row,
directly above it — it would double the page to say nothing new. Days are a real index: they are how
a person asks the question ("what shipped on Monday?"), they stay compact when *Show more* takes the
window to 70, and every individual deploy is still one press away, which is what the brief's purpose
clause ("so a person can jump to one") actually asks for. The literal reading is the option passed
over, and this is the reason.

The same grouping puts a day heading in the list itself, so the structure the contents describes is
visible when you scroll rather than only at the top.

### The hazard this design walks straight into

**A table of contents built from `<a href="#...">` would break the tab.** The dashboard keeps its
mode in the URL fragment (`mode.ts`), and `parseHash` falls back to `sessions` for any name it does
not recognise — so pressing an anchor for `#deploy-74` would not scroll to a deploy, it would throw
the reader onto the Sessions tab. The contents is therefore **buttons calling `scrollIntoView`**, not
anchors, and there is a test that fails if a link ever grows an `href` starting `#`.

`scrollIntoView` does not exist in jsdom, so it is called under a guard — and the test installs one
per row and asserts *which* row was scrolled. It did not, for a while: this paragraph claimed the
scroll was checked when deleting the call left everything green, which GPT Sol caught.

### Which disclosure

The brief asked whether to reuse the pattern `SessionDetail.tsx` uses for its previous messages, or
extract a shared component. **Neither: the same pattern, no shared code.** `SessionDetail`'s is a
bare `<details>` with a faint one-word `<summary>` ("Rename", "Where it is") and inline Tailwind — it
is a vocabulary, not a component, and there is nothing there to import. This panel's summary is a
full multi-column row, so a component general enough for both would take a `ReactNode` summary and a
`className` and be worth less than the two `<details>` elements it replaced. `SessionDetail.tsx` is
not this session's file and is not touched. A small local `DeployRow` keeps the two `<details>` in
this panel consistent with each other.

**Uncontrolled**, deliberately: the page re-renders once a second off `useNow`, and passing
`open={false}` every tick would slam every row shut under the reader's finger. Open-ness is DOM
state, keyed by `deploymentId`, and the contents reaches it through a ref.

## Stages

- [x] **Stage A — look first.** Screenshots and measurements above.
- [x] **Stage B — collapse.** `DeployRow`, the gist, the row summary, the labelled clock time.
      Tests red-then-green.
- [x] **Stage C — the table of contents.** Day grouping, day headings, chips, jump-and-open, the
      no-`href` guard.
- [x] **Stage D — verify and review.** Browser again at both widths, after-screenshots here, gates,
      GPT Sol.

### Stage B status

Done. `DeployRow` is the disclosure and `Gist` is the closed row's one clause; `deployGist`,
`deployLocalWhen`, `localZone`, `deployDays`, `dayLabel` and `OPEN_ZONE_LABELS` are new in
`deploys-client.ts` with unit tests in `tests/fleet-deploys-client.test.ts`.

### Stage C status

Done. `Contents` and the day headings, both driven by `deployDays`. The list moved into its own
`DeployList` component — partly because the panel above it is a chain of *which nothing is this*
arms and the list is the one arm with a shape, and partly because inlining it took `DeploysPanel`
from biome's pre-existing 31 to 36 on `noExcessiveCognitiveComplexity`. It is back at 31, which was
verified against `git show HEAD:` of the same file rather than assumed.

### Stage D status

Done. Numbers and the three browser-only findings below.

## What it cost and what it bought

Measured the same way as the before pass, ten deploys, everything collapsed:

| | before | after |
|---|---|---|
| page height, 1280 | 6066 px | **1190 px** |
| page height, 390 | 8824 px | **1682 px** |
| one deploy, closed | 950–1000 px | **29.8 px** at 1280, 50.6 px (two lines) at 390 |
| elements in the tab order, 390 | ~151 | **34** |

Nine deploys fit in one desktop viewport. Before, you could not see two.

Screenshots (scratchpad, 2026-09-09): `deploys-final/final-desktop-1280.png`,
`final-phone-390.png`, `final-desktop-1280-jumped.png`, and the intermediate
`deploys-after/after-desktop-1280-expanded.png`.

The last two rows of the table are the ones worth keeping. **A row is 30 px because it is one line**,
and the thing that made it one line is not the disclosure — it is that the date lives on the day
heading instead of on every row. **And the tab order is the number that says what a phone reader was
actually facing**: 151 controls to walk past, almost all of them commit links inside changelog prose
nobody had asked to see.

Jumping to a release well down the list leaves its summary 17.7 px clear of the masthead, and a
keyboard reader who presses Enter on a jump button finds their next Tab inside that release's body
rather than back in the index.

### The tab-order number needed measuring twice, and the first answer was wrong

The first pass reported 171 elements by two selectors — a raw one and a "reachable" one — and
**both returned 171**, which does not mean everything is reachable; it means the second selector did
not discriminate. `content-visibility` on a closed `<details>` clears neither `offsetParent` nor
`getClientRects()`, so both filters were counting the commit links inside every collapsed row. 171 is
also exactly 151 + 10 summaries + 10 jump buttons, which is what a raw count does when it cannot see
a disclosure.

The number that settles it is a real Tab cycle: 250 keypresses, distinct elements recorded until it
wraps. **34**, agreed by two independent counts — 10 summaries, 10 jump buttons, 13 other controls
(three tooltip triggers and the nine-button dock), and one commit link, the `main is at …` in the
header, which is outside any disclosure and genuinely visible. Zero links inside collapsed rows.

### Three things the browser found that no unit test could have

1. **The jump landed behind the sticky masthead.** `scroll-mt` was on the `Card`; `scrollIntoView`
   is called on the `<details>` inside it, and `scroll-margin` is read off the target, never off an
   ancestor. The jump worked, the right row opened, and you arrived in the middle of the body with
   the release line hidden under the 62 px header. Moved onto the scrolled element; re-measured at
   111.9 px clear. There is now a test asserting the scrolled element is the one carrying the
   offset — jsdom does no layout, so the pairing is what is assertable, and the pairing is what was
   wrong.
2. **At 390 the native triangle sat on a line of its own above the row.** An `inline-flex` span
   beside a `list-item` marker is an atomic box: too wide for what the marker leaves, it drops
   whole instead of wrapping. Fixed with the vocabulary `src/web/ChangelogPage.tsx` already uses for
   the reader-facing twin of this tab — `list-none`, our own `ChevronRight` turning on
   `group-open:`, and a `::-webkit-details-marker` rule, which is not optional because this page is
   read on an iPhone and Safari's marker is a shadow pseudo element. Four lines in
   `tools/fleet/web/src/tailwind.css`, and checked to survive the build rather than assumed.
3. **The `quiet` pill and the gist were saying the same thing side by side** on every quiet deploy —
   twice the ink for one claim, on the rows that deserve the least of it. The pill now draws only
   when it would say something the gist does not, which is the contradictory record line.

### What the tests could not see, and why that mattered

**Every pre-existing test on this tab stayed green through the whole rewrite.** They assert on
`container.textContent`, and a closed `<details>` keeps every child in the DOM — so a suite of
thirteen tests about this panel could not tell an open card from a closed row. That is
[silent-success.md](../reusable/silent-success.md) exactly, and it is why the new tests assert on the
`open` attribute and on which element a string sits inside, and why each was proved able to fail:

| mutation | test that noticed |
|---|---|
| rows default `open` | draws every deploy CLOSED |
| `deployGist` drops its `changelogReadable` branch | does not call a deploy quiet when its changelog could not be READ (panel and unit) |
| `deployDays` groups in UTC | files a late-evening UTC deploy under the day the READER had |
| `jump` does not set `open` | opens the deploy the contents points at |
| a contents chip becomes `<a href="#deploy-N">` | navigates with buttons, never with a fragment link |
| the row drops `+N unreadable` | says on the closed row how many entries it could not read |
| the row drops the zone label from the time | says what the deploy shipped WITHOUT opening it |

The two tests that were red before they were green are `dayLabel`'s: `en-GB` spells 8 September
`Tue, 8 Sept 2026`, which is how the formatter came to be assembled from `formatToParts` — zones.ts's
rule, arrived at the same way.

## The timezone decision was wrong, and GPT Sol caught it

The plan above proposed drawing the closed row's clock in **the device's own zone**, on the argument
that `zones.ts` forbids only an *unlabelled* local time and every rendering here would carry its
zone's name. That is a misreading, and Sol's P1 said so:

> The new comments reinterpret the objection as being only to an unlabelled clock. That is not what
> `zones.ts` says: it rejects detection because different devices disagree, and requires all three
> clocks to remain visible.

Which is right. `zones.ts` says *"There is no setting, no detection of where he is, and no 'local
time'"*, and the cost is not hypothetical: a detected zone makes the page disagree with itself across
devices. The box would file a 23:19 UTC deploy under the 8th and Greg's phone in Athens under the 9th,
for the same release. **A day heading is not a thing to be device-dependent about.**

**The fix taken is not the one Sol proposed.** Sol's smallest correct fix was to group by UTC and put
the whole three-clock line back in the summary. Instead `ROW_ZONE` is a constant, `UTC`:

- no detection at all, so `localZone()` is deleted and with it the staleness Sol also spotted — a
  device's zone can change under a tab left open for hours, so the memoised answer was not immutable;
- UTC is the zone the record's own timestamps are in, so a reader comparing this page against the
  file or a log line has the identical string in front of them;
- every day heading carries `· UTC`, not only the contents at the top, because a heading eight
  releases down the page is read on its own;
- the panel tests stopped depending on the host's zone and became literals. The zone-dependent
  behaviour is still exercised, in `deployDays`'s own unit test with `Europe/Athens` and the `(+1d)`
  case — `zones.ts`'s reason for keeping `zones` a parameter, applied again.

**What is left for Greg**, and it is a real question rather than a formality: a closed row shows
**one** of the three clocks, and `zones.ts` says all three are always shown. The brief for this pass
directed it — *"do not lose the three-zone times, only tuck them behind the expand"* — so it is an
instruction followed rather than a judgement made, and opening a deploy still gives the canonical
line. But `zones.ts` is Greg's own written decision and the brief's phrasing is the Overseer's, so
he should get to say which wins.

### The rest of round 1

| finding | what happened |
|---|---|
| P2 — the wholly-unreadable gist dropped its `+N unreadable` | Real. The arm returned before reaching the count, so the row that had lost the most said the least, while the helper's comment claimed the count rode on every arm. Fixed and tested. |
| P2 — a jump moved the viewport but not focus | Real, and invisible from a screenshot: a keyboard reader stayed on the index button and their next Tab went to the *next* index entry. Now focuses the target `<summary>` with `preventScroll`. |
| P2 — `scroll-mt-20` is a fixed 80 px under a notch | Real. `.masthead` adds `--safe-top`, and a 390 px desktop emulation has no notch to fail on. Now `calc(5rem + var(--safe-top, 0px))` in the stylesheet. |
| P3 — `behavior: "smooth"` defeats reduced motion | Real: a JavaScript request for animation is not overridden by `scroll-behavior: auto`. `behavior` dropped so the stylesheet governs. |
| P3 — two comments overclaimed | Both true. The plan said the scroll was asserted; it was not, so rather than weaken the claim the test now installs a `scrollIntoView` per row and asserts which one was called. And `dayLabel`'s safety comes from `timeZone: "UTC"`, not from noon. |

### And one of my own mutations found a weak test

Every new assertion is mutation-checked. Two came back green, and only one was the mutation's fault:

**the day-grouping test could not tell UTC from Athens.** The three fixture timestamps produce the
labels `Tue 8 Sep` and `Mon 7 Sep` in *both* zones — only the membership differs, because 23:55 UTC
on the 7th is 02:55 on the 8th in Athens. A test that names the headings passes either way. It now
asserts **which releases sit under which heading**, through a `data-day` hook on the group, because
the contents heading and every changelog section are `<h3>`s too — the first attempt read a release
number out of the wrong element and got `7405`, `textContent` having run `Release 74` into
`05:32 UTC`.

That is the whole argument for mutation-checking in one example: the test was green, the code was
right, and the test was still worthless.

### Round 2: no P0, no P2, and one question that is not mine to answer

Sol confirmed every runtime finding closed, and the strengthened grouping test sufficient
(*"`data-day` is a reasonable, stable test hook and not a smell"*). Three things came back.

**The `zones.ts` conflict is still open, and Sol wrote the sentence to put to Greg.** Verbatim, so it
is not softened on the way:

> The Deploys brief says to tuck the three-zone line behind expansion, but `zones.ts` says UTC,
> London and Athens are always shown. Should collapsed deploy rows be an explicit exception that show
> only UTC until opened, or must all three remain visible on every closed row?
>
> — GPT Sol, 2026-09-09

Either answer is a small change: amend `zones.ts` to name the Deploys exception, or render
`deployWhen(version.version)` in the summary and let the row wrap. **Until Greg rules, the tab ships
as briefed** and this paragraph is the record that it was noticed rather than missed.

**And it is not only this tab.** Session `dashboard-design-system` hit the same rule the same night
from the other end: its Usage rewrite turned nine of that tab's ten wall-clock instants into
durations and kept all three zones only on the reset. Two sessions arriving at the same exception
from opposite directions is a rule meeting its edge, not two people finding it inconvenient — so it
goes to Greg once, for both tabs, rather than twice.

The proposal to put to him, which is ours rather than his, is the distinction that session drew:
**the instant you act at, against the instant you judge freshness by.** A limit reset is the first,
and ambiguity there costs a decision — which is exactly the case `zones.ts` was written for and
argues at length. A deploy that happened yesterday is the second, and this row has already answered
*when* with `25h ago` before anybody reads the clock. If that split holds, "all three, always" is
right where it came from and over-broad everywhere else, which is a smaller change than either tab
backing out. A third option arrived in the same merge and is worth naming: `instant.ts`'s `instantTip`
puts all three zones one hover away from any printed instant — attractive, except that the
dashboard's tips are `mouseOnly`, so it does nothing on the phone where this actually matters.

**The contents was navigation with no landmark and no groups.** Tabbing it gave "Jump to release 74",
"Jump to release 73" and so on, with each date sitting alongside as an unassociated `<span>` — so a
sighted reader got an index organised by day and a screen-reader reader got a flat run of numbers.
Now a `<nav aria-labelledby>` with a `role="group" aria-labelledby` per day, named by the element a
sighted reader is already looking at rather than by a duplicated string. Tested, and all three
mutations of it go red.

**And Sol found a per-tick cost I had built in without noticing.** `ref={(el) => register(id, el)}`
is a new function on every render, and React answers a changed ref by calling the old one with `null`
and the new one with the element — so a page that re-renders once a second was detaching and
re-registering every row twice a second to arrive back where it started. At 200 rows that is 800 map
operations a second for nothing. A `useCallback` fixes it; `register` is already stable.

Sol declined to rank the wider 200-row question without measurement, which is right, and said what
to measure: React commit duration and render counts at 10 versus 200 rows, closed and then several
open, plus main-thread CPU and long tasks over a minute. Left as a named next step rather than
guessed at.

### A test that was allowed to be a constant, and briefly was not

While the rows were drawn in the device's zone, no panel assertion could name a time or a day without
being an assertion about **where the suite was running** — this box is `Europe/London`, a CI runner
is usually UTC. The expectations were therefore derived at runtime by a different route from the one
under test. Taking the detection out took that with it: the rows are UTC by contract, so the
expectations are literals again. A test that is allowed to be a constant should be one.
