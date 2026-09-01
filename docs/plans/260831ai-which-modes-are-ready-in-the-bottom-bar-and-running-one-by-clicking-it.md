# Which modes are ready in the bottom bar, and running one by clicking it

Two changes to the bottom bar's mode segment, asked for together because they are two halves of one
thing — *the reader should be able to see which modes have something in them, and getting one that
is empty should not require finding a second button.*

> Can we lightly indicate in the bottom-bar which of the modes have already been run (i.e. are ready
> to display)? Or perhaps better still, indicate the ones that are not ready yet.
>
> And let's have a rule that if the user clicks a mode that hasn't been run yet, automatically run it
> (rather than requiring them to click a button to start it running).
>
> — Greg, 2026-08-31

## What this is actually about, which is smaller than "the modes"

Of the twelve modes, only **four** have a stored artefact that has to be paid for before there is
anything to show, plus **one view inside a fifth**:

| Mode | Backing step | State before anybody asks |
| --- | --- | --- |
| Plain, Hierarchy, Outline, Summary | the tree from `toc`, plus `arc` | ready — and [`useArc.ts`](../../src/web/useArc.ts) already asks for a missing arc on its own |
| Search, Chat, Review | nothing stored; every answer is a fresh call | not a question this feature asks |
| **Glossary, Ideas, Quotes, Timeline** | `glossary` / `ideas` / `quotes` / `timeline` | **empty** — all four are off `DEFAULT_INGEST_STEPS` ([`src/pipeline.ts`](../../src/pipeline.ts)) |
| **Diagram** | `sketch` for the sketch picture — **and see the correction below, because the other three are not free either** | complicated; the mode's row is still being decided |

So the dot appears on at most four buttons.

### The correction, kept rather than quietly fixed

An earlier draft of this table said Diagram had **three** pictures, of which only the sketch cost
anything, so "opening Diagram costs nothing". Both halves were wrong, and a cross-family review found
it ([the review](260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it-review-sol.md),
finding 1):

- `DIAGRAMS` in [`src/web/diagram.ts`](../../src/web/diagram.ts) is **four** — `force`, `drift`,
  `trail`, `sketch` — and its own comment says all four cost a model call.
- `force` POSTs through `useSimilar`; `drift` and `trail` POST through `useProjection`. Both embed,
  so both spend. Only the sketch is a *job*; the other three are plain requests.

[`visitor.ts` § `COSTS`](../../src/web/visitor.ts) already said this in as many words, and the draft
was written after reading it. Worth recording because it is the shape of mistake this feature cannot
afford: an artefact-shaped question was asked of a mode whose costs are not artefact-shaped.

**What it means for the plan:** the arrow-key removal in stage 0 matters more than it looked (arrowing
across the chips could buy Similar, Projection *and* Sketch, not just Sketch), and **Diagram's dot and
its auto-run are now an open question rather than a decided one** — see § What is still Greg's to
decide.

## References

- [reading-view-overview.md](../project/reading-view-overview.md) — the three regions, and the rule
  that a mode and a band are separate questions.
- [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — the bar. `MODES_UI` is the ordered list, `DockModes`
  renders the radiogroup, `MARKED` is the dimming that already exists and means something else.
- [`src/web/visitor.ts`](../../src/web/visitor.ts) § `markedModes` — the existing `marked` map, why
  a marked button stays pressable, and the NN/G rule that a tooltip may never be the only carrier.
- [`src/web/useArc.ts`](../../src/web/useArc.ts) — **the precedent for the whole second half.** It
  already starts a job on its own when an owner opens an article with no arc, with a per-slug ref
  guard against `<StrictMode>`'s double effect, and it is mounted in `OwnedReader` and never in
  `Reader` because starting a job is a POST.
- [`src/web/useStepJob.ts`](../../src/web/useStepJob.ts) — one pipeline step run from a reading-view
  surface: the job, the two ways it fails, and `FORCE_ONLY_WHEN_NAMED`.
- [`src/web/useGlossary.ts`](../../src/web/useGlossary.ts) (`find` / `more` / `reset`),
  [`useIdeas.ts`](../../src/web/useIdeas.ts), [`useQuotes.ts`](../../src/web/useQuotes.ts),
  [`useTimeline.ts`](../../src/web/useTimeline.ts), [`useSketch.ts`](../../src/web/useSketch.ts) —
  the five hooks, each with a `status` of `loading | none | ready | error` and one verb.
- [`src/web/public-artefacts.ts`](../../src/web/public-artefacts.ts) — **the design this copies.**
  The visitor path already answers *which artefacts does this piece have* off the article payload,
  and the plan it came from deleted a second request to do it
  ([260827ai](260827ai-public-read-only-access.md) § The second request disappears).
- [`src/web/useJobs.ts`](../../src/web/useJobs.ts) — the poller, its visibility gate, and its
  first-poll-is-a-baseline rule.
- [`src/types.ts`](../../src/types.ts) § `Article` — the owner's payload, and the two places that
  build one (`src/api.ts` and `src/store/pg.ts`).
- [design-css-overview.md](../project/design-css-overview.md) and
  [`styles.css`](../../src/web/styles.css) § the modes segment — where the dot's rule goes, and the
  `overflow: hidden` on `.dock-modes` it must stay inside.
- [silent-success.md](../reusable/silent-success.md) — the failure mode this feature is one bad
  decision away from: a dot that says ready over an artefact that is not there.

## Principles and key decisions

All four were put to Greg on 2026-08-31 and answered.

- **A small hollow dot marks the not-run ones**, and a filled, pulsing one marks a mode whose job is
  running. Ready modes carry nothing. Chosen over dimming, because the existing dimming
  (`MARKED`, opacity-55) already means *you are a visitor and will meet a boundary here* — a
  visitor would see one treatment carrying two facts — and because dim reads as *disabled* at
  exactly the moment we want the button pressed. Chosen over marking the ready ones because on a
  freshly-added article that is the same marks the other way up, and the bar would start bare and
  fill in, which says less.
- **Clicking a mode with nothing in it starts its job**, for all five, **sketch included.** Greg was
  offered the version that exempted sketch (121–194s, ~$0.20, the slowest single call in the app)
  and the version that put a cost confirmation in front of it, and took neither: *"All five, sketch
  included."* Picking the **Sketch view** inside Diagram is the trigger; opening Diagram itself
  costs nothing and opens on a picture drawn from the tree.
- **A stale artefact counts as ready.** No dot, no auto-run, and the panels' existing staleness
  banner and *find them again* button stay exactly as they are. Re-running silently would spend a
  model call on an article the reader may be perfectly happy with, and the artefact on screen is
  still a fair account of the piece.
- **The dot is advisory; the panel decides what to spend.** The bar's readiness map may be wrong —
  it is a cached fact about somebody else's article — so it must never be what authorises a paid
  call. The auto-run fires from inside each panel's own hook, on its own `status === "none"` after
  its own GET, exactly as `useArc` does. A wrong dot therefore costs a dot, and nothing else.
- **Never for a visitor.** `tests/visitor-gaps.test.ts` asserts a signed-out browser issues no POST
  whatever, and starting a job is a POST. Every auto-run sits in a hook mounted only under
  `OwnedReader`.

### The simpler options passed over

- **A new `GET /api/artefacts/:slug`.** The obvious way to learn what exists, and it needs a new
  route, a new method on `ArticleReader`, and two store implementations. Rejected because the
  visitor path already solved this question by putting the answer in the payload the page is
  fetching anyway, and putting a second request back would undo
  [260827ai](260827ai-public-read-only-access.md) § The second request disappears on the owner side.
- **Reusing `GET /api/metadata/:slug`.** It already returns `done` per step for every stage, in both
  stores. Rejected on cost: it stats every output file on the filesystem and reads the whole block
  table plus four fingerprints on Postgres, to answer five booleans, on every article open.
- **Auto-running from the Dock's `onMode` handler.** One place instead of five. Rejected for the
  reason in the fourth principle above — it would make the cosmetic map the thing that authorises
  a paid call — and because the Dock would then need to know which step backs which mode, which is
  the coupling the panels already own.

## The thing that made this dangerous, and what we did instead of guarding it

**The arrow keys selected as they traversed.** `DockModes.onKey` called `onMode(target.mode)` on
every ArrowLeft/Right/Up/Down, and `End` jumped to the last mode — a roving-tabindex radiogroup
where focus *is* selection. A keyboard reader holding → walked through Glossary, Ideas, Quotes and
Timeline in about a second, mounting each panel as they passed. With auto-run that is **four paid
model calls from one keypress.**

Two more controls have the same shape and the same `stopPropagation`, and one of them also spends:

| Control | Where | Selecting costs |
| --- | --- | --- |
| the mode segment | `DockModes.onKey`, [`Dock.tsx`](../../src/web/Dock.tsx) | up to four model calls, after this change |
| the three diagram pictures | the inline `onKeyDown` on `.diag-kinds`, [`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx) | **the sketch: 121–194s, ~$0.20** |
| the two search matchers | `onModeKey`, [`SearchPanel.tsx`](../../src/web/SearchPanel.tsx) | nothing |

The first fix written here was a ~600ms settle delay inside each panel's hook. **That is gone**, and
what replaced it is better because it removes the hazard rather than racing it. Greg, 2026-08-31,
reading the problem:

> I don't really like the way the keyboard changes modes or sub-modes, so if it helps, we can remove
> that functionality. I'd rather up/down *always* moves the text, and we can use left/right for
> mode-specific behaviours?

So **all three lose their arrow handling**, and every button in them becomes its own tab stop. Tab
reaches each; Enter, Space or a click selects. `role="radio"` and `aria-checked` stay — the *exactly
one of these* claim is true and the segment's hairline frame is the sighted half of it.

Three things fall out, and the third is why this is in this plan rather than in one of its own:

1. **[keyboard.md](../project/keyboard.md) becomes true without exception.** It says ↑ / ↓ step the
   article and ← / → choose the stride. That was true *except* inside three controls, which is the
   kind of exception nobody remembers and which Greg met as a bug.
2. **← / → keep meaning the granularity stride**, everywhere, including while the bar has focus.
   Confirmed with Greg directly — *"the left/right is the hierarchy granularity-column-switcher,
   right? Yes, we want to keep that"* — so the dock simply stops intercepting it and nothing about
   the zoom's keyboard changes.
3. **Selection is always an explicit gesture, so nothing needs guarding.** No timer, no debounce, no
   settle delay. The only other way to walk several modes is browser Back/Forward — `?mode=` is
   `history: "push"` — and that can only re-walk modes the reader has already been to, which are
   therefore already run or already running. It cannot start anything new.

`useArc`'s per-slug ref guard is still kept, for the other half of the problem it was written for:
`<StrictMode>` runs every effect twice in development, and without it every mount POSTs twice.

**The costs, stated rather than discovered.** The bar goes from one tab stop to twelve, the diagram
chips from one to three, the matchers from one to two — so tabbing past the bar takes more presses.
And it is a deliberate departure from the ARIA authoring practice, which prescribes roving tabindex
plus arrow keys for a radiogroup; each of the three sites gets a comment saying why, because the
reason is local and unobvious: on this page the arrows belong to the article, and one of these
radiogroups spends money when it changes.

**`nextModeIndex` loses its last caller and goes.** It is exported from `Dock.tsx` and shared with
`SearchPanel` precisely so there would not be two copies of the wrapping arithmetic; with all three
handlers gone there is nothing left to share. Deleting it means a sweep, because a function that was
held up as an example gets named in places that do not call it —
[rename-or-move.md](../reusable/rename-or-move.md). Known mentions: `tests/chat.test.ts` (its whole
suite), `src/web/SearchPanel.tsx`, `src/web/scroll.ts` and `tests/bar-visibility.test.ts` (both cite
it as precedent in a comment), `docs/project/search.md`, and two plans that are history and stay as
they are.

## What the cross-family review changed

The plan went to GPT Sol before anything but stage 0 was built
([prompt](260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it-review-prompt.md),
[answer](260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it-review-sol.md)).
Verdict: *"not ready to build"*, five blockers. **Every one was checked against the code and every one
is real**, which is unusual and is why they are all folded in rather than triaged. Two of them are
Greg's to decide, and those are in the section after this one.

### 1. Mounting a panel is not the same as clicking a mode

The plan claimed that once the arrow keys were gone, "selection is always an explicit gesture". That
is false, and the falseness is exactly where the money is. `useAutoRun` would fire from
`status === "none"` **after mount**, and a panel can mount without anybody having clicked anything:

- a pasted or bookmarked `?mode=ideas` — `modeParam` restores it on load;
- Back/Forward through pushed mode entries, where a fast second navigation can unmount the first
  panel before its GET resolves, so "you have already been there, so it is already running" does not
  hold;
- the metadata and tweets pages' Dock links, built by `withMode`;
- a direct `?mode=diagram&diagram=sketch`;
- history entries made before this feature existed.

Greg's rule was *"if the user **clicks** a mode that hasn't been run yet"*. So the fix is to make the
click real data rather than infer it: **a one-shot activation token**, set by the Dock (and the
diagram chips) on click / Enter / Space, handed down, and consumed by the panel only after its own GET
says `none`. A pasted link shows the empty state and its button, and spends nothing.

That also keeps the fourth principle intact — the Dock still never learns which step backs which
mode. It says *the reader just pressed this*, which it is the only thing that knows.

### 2. `useJobs` treats its first poll as a baseline, and that strands both the panel and the dot

Confirmed in [`useJobs.ts`](../../src/web/useJobs.ts): a job already `done` on the first poll is
recorded in `announced` without calling `onFinished`. So:

1. the payload says `ideas: false`; the panel's GET 404s;
2. the job finishes — another tab, or our own unforced run skipping because the artefact appeared —
   before this hook's first poll;
3. nothing is announced, the panel stays `none` and the dot stays hollow until a reload.

`useStepJob.start` makes it likelier rather than safer: it remembers the id the POST returned but does
not put that job into `queue.jobs`, so a fast job is never seen running at all — no spinner, no
reload, no success. The reader is shown *not generated* over an artefact that exists, and can go on
starting harmless no-op jobs. **This is the silent-success shape the repo keeps meeting**, and it is
the finding I would not have found: it is invisible unless you read the poller's seeding rule against
the panel's state machine.

Two fixes, and both are needed: `useStepJob` must reconcile the id `start` returned — including a job
already `done` on the first poll — and reload exactly once; and the bar needs a real readiness
revalidation rather than inferring existence from whatever historical job it happens to see.

### 3. `PublicArticle` is structurally an `Article`, so `Article` cannot grow a required field

`ArticleAccess` in [`App.tsx`](../../src/web/App.tsx) carries an `Article` on **both** arms and says
why: *"`PublicArticle` is structurally an `Article` with fields absent rather than a parallel
shape"*, so one reading view draws both. `sanitizeArticle(article: Article)` is the doorway. Adding a
required `built` to `Article` — while correctly refusing to add it to `PublicArticle` — breaks that
assignment.

And it is the wrong seam anyway: `loadArticle` is not only the browser route. Comments, chat, live
conversation and the chat tools all call it, and none of them wants five extra artefact reads.

So: an **owner-only wire type** on the browser route — `interface OwnedReadingArticle extends Article
{ built: BuiltModeArtefacts }` — with a route-specific projection, and `built` lifted aside before
sanitising and put back after. Postgres adds presence expressions to that projection only; the
filesystem does its extra checks only there.

### 4. Presence must mean *usable*, not *non-null*

`stat` is not enough — a `writeFile` killed halfway leaves a file that exists and will not parse.
Neither is `IS NOT NULL`: `loadSketch` correctly rejects `{"scenes":[]}`, and a scalar or malformed
object is non-null and unreadable. Both would draw a ready dot over an artefact the panel cannot open.
Use the shape rules already centralised in `SHAPE`
([`src/store/artifacts.ts`](../../src/store/artifacts.ts)); Postgres can mirror them with
`jsonb_typeof` and length checks without moving any JSONB.

The plan had left this as a judgement call between `stat` and `has`. It is not one, and *"a wrong dot
costs a dot"* was too glib: a wrong dot here costs the reader an explanation of why a mode they were
told was ready is empty.

**And `built.sketch` comes off the payload entirely.** Nothing reads it — the dots are for four Dock
modes, and `useSketch` does its own GET when the view mounts — and it is the largest artefact to
check.

### 5. One active job per article, so the second click 409s

[`src/jobs.ts`](../../src/jobs.ts) allows one active job per article: identical work is deduped, but
*different* work gets a 409 in the reader's own words. So with Glossary running, clicking empty Ideas
posts, gets refused, and the per-slug guard means it is never retried — the reader has to press the
button by hand once Glossary finishes. Click four empty modes quickly and at most one runs.

That is not "clicking a mode runs it", so it needs a real answer: hold the activation and start it
when the slot frees, or say *waiting for the glossary to finish* — which is true, and is a state the
panels do not currently have.

### 6. The direct CLIs are outside the queue

`npm run glossary` and its four siblings call the generators and write artefacts directly, with no job
record. So a panel that sees the artefact absent can start a paid call beside a CLI run already doing
it, and the two race. The plan should stop implying `useJobs` covers this — the comment in
`useStepJob` that says a CLI run "shows up here as progress" is wrong today — or the CLIs need the
same per-article exclusion.

### 7. Smaller, and all folded in

- **The panels need a `starting` state.** Until `/api/jobs` sees the job, `JobProgress` draws its
  ordinary run button — so relabelling it *Try again* offers a retry before anything has failed.
- The new empty-state strings belong in [`src/messages.ts`](../../src/messages.ts), per
  [copy.md](../project/copy.md), with the bracketed codes and the retry classification kept.
- The no-POST assertion belongs in `tests/public-network-trace.test.tsx`, not `visitor-gaps.test.ts`,
  with cases for Quotes, Timeline and `?mode=diagram&diagram=sketch`, signed-out and signed-in.
- Stage 0 named three radiogroups; there were **five**. Both extras — the diagram's option rows and
  the sketch's scene chips — were found and fixed while building it, and the test is an app-wide
  sweep rather than a list, so a sixth cannot arrive quietly.
- The stale `.dock-modes` comment in `styles.css` claiming one tab stop is fixed.

## The three decisions the review forced, and Greg's answers

All three put to him on 2026-08-31, after the review.

### Only a real press spends. A link never does.

*"if the user **clicks** a mode"* is taken literally. A **one-shot activation token** is set by the
Dock on click / Enter / Space, handed down, and consumed by the panel only after its own GET says
`none`. A pasted or bookmarked `?mode=ideas`, a Back/Forward step, and a link in from the metadata or
tweets page all show the empty state with its button, and spend nothing.

This is what closes finding 1, and it keeps the fourth principle intact: the Dock still never learns
which step backs which mode. It says *the reader just pressed this*, which is the only thing it is in
a position to know.

### Diagram: the sketch only, and the other three are left exactly as they are

Greg, on being told the picture chips are not free:

> I don't understand why the other Diagram sub-modes are different. Perhaps a subagent should make
> them work consistently? Or if there's a good reason they're different, just work on Sketch for now.

**There is a good reason, and it is a real difference in kind rather than an accident:**

- **The sketch is a pipeline step.** One model call over the whole article, writing a stored artefact
  — 121–194 seconds, about $0.20, kept afterwards. It has a *has this ever been built* state, which
  is the only state a readiness dot can express.
- **Force, drift and trail are embeddings arithmetic.** `POST /api/similar/:slug` and
  `POST /api/projection/:slug` — [`useSimilar.ts`](../../src/web/useSimilar.ts) describes its own
  call as *"cheap, bounded and cached"*: the blocks are embedded the first time and served out of
  memory afterwards. They write no artefact, so there is nothing to be built or unbuilt, so there is
  no dot to draw.

And the behaviour Greg is asking for is **already what those three do**: select the picture and it
fetches. They arrived at auto-run independently, and this plan brings the sketch into line with its
three neighbours rather than the other way round. From the reader's chair all four then behave
identically — pick a picture, it appears — and the difference underneath is only which of them is
worth marking.

So: **no dot on the Diagram button at all**, and the sketch auto-runs on its own activation.

**But there is one genuine inconsistency underneath, and it is a live bug rather than a design
choice.** [`useProjection.ts`](../../src/web/useProjection.ts) records it, from a ⟨Sol⟩ review on
2026-08-30: `similar.ts` calls `embedAll` itself instead of going through
[`article-vectors.ts`](../../src/article-vectors.ts), which was built precisely so the two would
share, **so a cold Force → Drift embeds the whole article twice**. That is the "make them work
consistently" job and it is worth doing — it is pre-existing debt, it is already written up in
`article-vectors.ts`, and it is nothing to do with readiness dots. **Not folded in here**, so that
this plan does not quietly become two.

### Auto-runs use the reader's profile, and say so as a fact

Today's empty states let the reader untick *use my profile* before pressing the paid button. An
automatic run has nobody to ask, so it takes the default — profile on — and the panel then states it
in words: *"Using your reading profile."* **Not a disabled tickbox**, which reads as a choice the
reader missed rather than a decision already taken. Changing it afterwards means regenerating, which
is a second call, and the *find them again* control is where that lives.

The alternative — a brief pause showing the tickbox before starting — was rejected because it puts
back exactly the settle-delay timer that removing the arrow keys let us delete.

## Stages and actions

### Stage 0 — take the arrow keys off the radiogroups — **DONE**

**First, because it is what makes every later stage safe**, and because it stands on its own: it is
worth doing whether or not the rest of this plan ships. See § the thing that made this dangerous.

**There were five, not three.** The plan named the bottom bar, the diagram's kind chips and the
search matchers; grepping for `role="radiogroup"` found two more — the diagram's **option rows**
(`.diag-opt-set`) and the sketch's **scene chips** (`.sk-scenes`). The review independently caught
the first of those. Four of the five had been copied from the bar, comment and all, which is why the
test is an app-wide sweep rather than a list of three files.

- [x] Test first, red before green: `tests/arrows-belong-to-the-article.test.tsx`. It renders the bar
      and asserts an arrow changes nothing **and reaches `window`** — the second half being the one a
      careless deletion loses, since a handler that stopped selecting while still calling
      `stopPropagation` would leave ↑ / ↓ dead in the bar, which is the actual complaint.
- [x] `DockModes`: `onKey` and its `refs` array gone, `tabIndex={0}` on every button,
      `role="radio"` / `aria-checked` / `aria-label` kept. The `e.detail > 0` blur on click stays —
      it is Greg's ← / → complaint from 2026-08-26, about *pointer* clicks leaving the keyboard to
      the article, and it still earns its place now that a focused button takes Enter and Space.
- [x] `DiagramPanel`: both groups — `.diag-kinds` and `.diag-opt-set` — lose their `onKeyDown` and
      the `document.querySelector` focus-follow with it.
- [x] `SketchView`: `.sk-scenes` likewise.
- [x] `SearchPanel`: `onModeKey` and the `radios` ref gone.
- [x] `nextModeIndex` deleted, its suite in `tests/chat.test.ts` replaced by a note saying where the
      behaviour went, and every mention swept: `src/web/scroll.ts` and `tests/bar-visibility.test.ts`
      both cited it as precedent in a comment, and `docs/project/search.md` described the sharing.
- [x] A comment at each site saying why the ARIA authoring practice is being departed from, because
      the reason is local and unobvious.
- [x] [keyboard.md](../project/keyboard.md) — the rule loses its exceptions, and the audit note under
      *a widget that already handled the key keeps it* is corrected: the dock is no longer one of the
      two places that `preventDefault` an arrow, so that rule now has exactly one beneficiary (the
      diagram picture's `role="tree"`, which keeps its keys because it is content navigation, not a
      mode switch). [search.md](../project/search.md) rewritten, and the stale one-tab-stop comment
      in `styles.css` fixed.
- [x] `tests/sketch-view-drawing.test.tsx` — its keyboard test asserted the roving tabindex, and its
      docstring recorded ⟨Sol⟩'s 2026-08-30 finding that the scene row had a roving tabstop and no
      arrows. **That finding is still honoured and the remedy is reversed**: rather than completing
      the pattern, the roving tabstop goes and every scene becomes tabbable. Written up in the test,
      because a review's recommendation being overturned is exactly what AGENTS.md says to record.
- [x] `npm run typecheck` clean for `src/web`; the 11 test files around the change all green.
- [ ] Still owed: a network assertion that an arrow press posts to none of `/api/similar`,
      `/api/projection`, `/api/jobs` (the review's stage-0 ask). The sweep test asserts the
      *mechanism* is absent, which is stronger against reintroduction and much cheaper, but it is not
      the same claim. Belongs with the `public-network-trace` work in the later stage.
- [ ] Still owed: focus order at three window widths, in stage 5's browser pass. Twelve tab stops in
      a bar that scrolls horizontally on a phone is the thing most likely to read badly.

### Stage 1 — the readiness fact reaches the client

- [ ] Add the five booleans to the owner's article payload. `Article` in
      [`src/types.ts`](../../src/types.ts) gains one field — a named type, e.g.
      `built: BuiltArtefacts`, with a required key per step so an omission in either builder is a
      compile error rather than a silent `false` (the same `assets: Assets | undefined` reasoning
      that field's docstring already carries).
- [ ] **Postgres: this is an existing mechanism, not a new one.** `REVISION_READ_POLICY` in
      [`src/store/pg.ts`](../../src/store/pg.ts) already has a `"presence"` column mode, and the
      `library` reader already takes `tree`, `arc`, `tweets` and `glossary` that way — as SQL
      `IS NOT NULL`, so none of the JSONB crosses the wire. This is five `presence` grants on the
      `article` reader, matching entries in `PRESENCE_OF`, and the literal expressions in
      `REVISION_PROJECTIONS.article`. `tests/store-revision-columns.test.ts` is the policy test that
      already guards this and will fail if the three are left out of step.
      - Read the note on `sketch` in that policy before writing it: a scene is up to 46KB, and
        reading it to answer a boolean is exactly the cost
        [260828c](260828c-library-read-latency.md) was written about. Presence, never value.
- [ ] Filesystem: five presence checks in [`src/api.ts`](../../src/api.ts) § `loadArticle`, against
      the `dir` it has already resolved. **Decide deliberately between `stat` and the artifact
      store's `has`** — `has` parses rather than stats, because a `writeFile` killed halfway leaves
      a file that exists and will not parse
      ([`src/store/artifacts.ts`](../../src/store/artifacts.ts) § `has`). Parsing five artefacts on
      every article load is real cost for an advisory dot; existence is cheap and can lie in a way
      that costs a dot and nothing else. Name the choice in a comment either way.
- [ ] Test first, and watch it go red: a store-parity test that an article with a glossary and no
      ideas reports `{glossary: true, ideas: false, …}` identically from both stores. The parity
      suite is where a divergence of this shape gets caught (`src/api.ts` § the cross-store note).
- [ ] Check the public DTO path does **not** grow one. `PublicArtefactSet`
      ([`src/public-types.ts`](../../src/public-types.ts), `src/public/dto.ts`) already answers this
      question for a visitor, and a second answer beside it is the drift this repo keeps writing up.
- [ ] `npm test`, `npm run typecheck`.

### Stage 2 — the dot

- [ ] `useModeReadiness(slug, built)` — a small hook in `src/web/`, seeded from the payload, that
      mounts `useJobs(announce)` and flips a step to `ready` when a job for this slug writing that
      step reaches `done`, and reports `running` for a queued or running one. Returns
      `ReadonlyMap<Mode, "none" | "running">` — ready modes are absent from the map, so the Dock's
      test is `has`, matching `marked` beside it.
      - **Cost, said out loud:** this is a second `useJobs` poller in the reading view alongside the
        one `useArc` already mounts. That is the pattern every surface here uses, and the fix if it
        ever matters is lifting one poller into the reader, not a private one per hook — the same
        note `useStepJob` already carries.
- [ ] Render it in `DockModes`: a `.dock-ready-dot` inside the button, `position: absolute` against
      a `position: relative` button, sized ~5px, hollow `1px solid var(--ink-faint)` for *none* and
      filled `var(--highlight)` with a slow pulse for *running*. It must sit inside `.dock-modes`'s
      `overflow: hidden` and inside the narrow-width `padding-inline: 0.45rem`, so check both
      breakpoints (§ the modes segment, and § a narrow window).
      - `prefers-reduced-motion` kills the pulse — the filled/hollow difference still carries it.
- [ ] **The dot is never the only carrier**, which is the rule `Dock.tsx` already states about
      `marked` and the reason it is stated: extend `aria-label` (`"Glossary, not generated yet"` /
      `"Glossary, generating"`) and add one line to the tooltip saying what pressing it will do and
      roughly how long it takes. A hover tooltip is unreachable by touch and by keyboard.
- [ ] Tests: the dot appears for a mode whose flag is false, disappears when a job for that step
      finishes, and never appears for a visitor.
- [ ] **Stop and show Greg** — this is the half that has to look right, and it is cheap to change.

### Stage 3 — auto-run, on the four modes

- [ ] A shared `useAutoRun({ status, job, start })` helper carrying the per-slug ref guard and the
      "only when `status === 'none'`" test — one place, because the four copies this repo already
      grew of the job half are what `useStepJob`'s header is about. **No settle delay**: stage 0
      removed the thing it was guarding against, and a timer nobody needs is a mechanism that will
      outlive its reason.
- [ ] Wire it into `useGlossary` (`find`, unforced — `more` appends and is not what an empty band
      means), `useIdeas`, `useQuotes`, `useTimeline`. Unforced in every case, for `useArc`'s reason:
      the step's own freshness check is the thing being trusted, and forcing would pay again on any
      race where another tab wrote one first.
- [ ] Test first: mounting a panel whose artefact is absent POSTs exactly one job; mounting it twice
      (which is what `<StrictMode>` does) POSTs one; mounting with a stale artefact POSTs nothing;
      mounting with a job already running POSTs nothing; a visitor POSTs nothing.
- [ ] Update the four panels' empty states — they currently read as *press this to begin*, and
      after this the job is already running, so the copy is the job's progress and the button is a
      *try again* for a run that failed. [copy.md](../project/copy.md).
- [ ] `npm test`, `npm run typecheck`.

### Stage 4 — auto-run, on the sketch

- [ ] `useSketch` needs an unforced start: `draw` is hardcoded to `force: true` (correctly — it is
      offered beside a picture that is current). Add the unforced path for the automatic one.
- [ ] Wire `useAutoRun` into `useSketch`, firing when the reader selects the Sketch view inside
      Diagram, which is when `SketchView` mounts.
- [ ] Rewrite `SketchView`'s empty state. Its current copy says *"it is never drawn until you ask"*,
      which stops being true here — and the sentence it exists to deliver, *this takes about two
      minutes and costs a model call*, matters **more** now, not less, because the reader did not
      press anything. It moves above the progress bar rather than beside a button.
- [ ] Test: selecting the sketch view with no sketch starts one job, once. And the assertion stage 0
      put in — an arrow press on the diagram chips changes nothing and starts nothing — must still
      pass, which is the point of having written it before this stage rather than after.
- [ ] `npm test`, `npm run typecheck`.

### Stage 5 — finish

- [ ] Docs, in the same piece of work: a line in
      [reading-view-overview.md](../project/reading-view-overview.md), the rule itself in
      [web-client.md](../project/web-client.md) or a short section wherever the bar is owned, the
      sketch's changed bargain in [diagram.md](../project/diagram.md), and the
      *what runs when* line in [ingest-queue.md](../project/ingest-queue.md), which currently says
      every paid step is asked for by hand.
- [ ] `npm run lint` on the touched files, `npm run check`.
- [ ] Browser pass in a Sonnet subagent ([browser-testing.md](../project/browser-testing.md)):
      the dot at three window widths, the keyboard traversal starting no jobs, and one real
      auto-run end to end. Ask it back for the conclusion, not the page dumps.
- [ ] Cross-family review of the built code — weighted higher than this plan's review, per
      [AGENTS.md](../../AGENTS.md).

## Risks

- **The keyboard traversal.** Named above with its fix; it is the one that spends real money if it
  is got wrong, and the test for it goes in before the code.
- **A dot that lies.** The payload is a snapshot; a job run from the CLI while the page is open is
  picked up by the poller, but a `db:import` or another machine is not. Advisory by design, and
  the panel's own GET is what decides — but the copy must not promise more than that.
- **Two facts in one treatment.** A visitor sees `MARKED` dimming; an owner sees dots. They can
  never appear together (a visitor cannot start a job, so a visitor gets no dots at all), and the
  test should pin that rather than leave it to be true by accident.
- **`Article` grows a field.** Two builders, a parity test, and the public DTO next door which must
  *not* grow one — `PublicArtefactSet` already answers this question for a visitor and a second
  answer beside it is the drift this repo keeps writing up.

---

Up: [AGENTS.md](../../AGENTS.md)
