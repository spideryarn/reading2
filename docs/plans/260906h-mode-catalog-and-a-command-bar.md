# A mode catalog, and a command bar that opens a mode

Status: **planned**, not yet built. Written 2026-09-07.

This is the build plan for the design set out in
[260905e-mode-catalog-and-command-bar.md](260905e-mode-catalog-and-command-bar.md), which stays the
authority for the *why* and for the long-range shape. This file says what we are actually building
first, what we are deliberately not building yet, and what we passed over.

Its parent review is
[260905e-main-app-architecture-review.md § A3](260905e-main-app-architecture-review.md), whose
instruction this plan executes:

> The companion plan deliberately reopens how their discovery metadata is collected: migrate true
> duplicates into a mode catalog, retain exhaustive per-layer adapters for distinct policies.

## What Greg asked for

> I'd also like to have a command bar where I can type (or even talk) and it would open the
> appropriate mode (a bit like Spotlight/Alfred on the Mac), e.g. in a nice-to-have future world I'd
> be able to just click and say out loud "take me to the bit where the article introduces article
> consciousness" or "generate me Quotes and an Illustrated diagram" or "explain how access
> consciousnes is different from phenomenal consciousness" or whatever, and it would perform the
> appropriate actions. Dunno if a mode registry would help with this!
>
> — Greg, 2026-09-05

On how much weight to give what:

> FYI I'm willing to revisit previous decisions (because they might have been judgments made by
> less capable previous models, or perhaps our requirements have evolved), e.g. we might consider
> the idea of a universal mode registry if that has long-term benefits. If you can, distinguish
> between product decisions made by me (treat these with more weight) vs decisions made by previous
> agents (we're more willing to change them).
>
> — Greg, 2026-09-05

And on how far ahead to build:

> The goal is what's best long-term for the user and the codebase, and to explore ideas. For example,
> I can imagine a world in which users can build their own new modes (generate UI), or a marketplace
> of modes - though all that is far in the future, and for now I just want to make what we have work
> well.
>
> — Greg, 2026-09-05

That last sentence is the one this plan obeys. The voice half of the first quote is a **later stage
than text, not a parallel one**, and is not in this plan at all.

## The four product calls, answered up front

Asked and answered 2026-09-06, before any code. These are Greg's, so they carry his weight and an
executor does not get to reinterpret them.

1. **v1 is modes only.** You type a mode name or alias, press Enter, and it opens **exactly as
   pressing that mode's Dock button does** — same activation, same generate-on-open, same cost. No
   model call, no passage jump, no Generate rows, no "ask this article".
2. **Cmd/Ctrl-K, and a search-icon button in the Dock** so it is reachable on a phone. The Dock keeps
   every mode button it already has; the command bar is an additional door, never a replacement.
3. **No match says `No command matches.` and nothing else.** No article-search fallback, no
   ask-this-article fallback. *(This overrode the recommendation put to him, which was to offer the
   article search as a fallback row. An honest empty state was preferred to a helpful guess.)*
4. **Experimental modes: the bar draws exactly what the Dock would draw.** Switch off ⇒ not listed.
   One rule, one place — [experimental-features.md](../project/experimental-features.md).

## What changed under us on 2026-09-06, and why it makes this smaller

This plan was drafted against a reading of the tree from before the 2026-09-06 landings. Two of them
matter enough to design around, and both make the work *smaller*:

- **`MODE_TARGET` is now total over `Mode`** — a tagged union of `fixed` / `delegated` / `none`, in
  [`src/web/activation.ts`](../../src/web/activation.ts). It used to be a `Partial<Record<…>>`.
- **The Dock now makes one call for all fourteen buttons.** Diagram had an `if` of its own; it does
  not any more. A mode press is now, in full:

  ```ts
  armActivationForMode(slug, m.mode, { diagram });
  onMode(m.mode);
  ```

That second point is the whole of requirement 1. "Opens it exactly as pressing its Dock button does"
is now **two calls that already exist**, rather than a policy the command bar would have had to
restate and keep in step. Had this landed a day later, v1 would have needed its own copy of the
Diagram branch, and a copy is what goes stale.

## The catalog: what moves, and what emphatically does not

`src/mode-catalog.ts` — a pure module importing only `./modes.js`, readable by browser and server,
holding a **total `Record<Mode, ModeCatalogEntry>`**. Three fields:

| Field | Where it lives today | Why it moves |
|---|---|---|
| `description` | `MODES_UI[].blurb`, [`Dock.tsx`](../../src/web/Dock.tsx) | Product copy about what a mode *is*, not about how the Dock draws it. A second reader is arriving and the only home is a 2,354-line React component |
| `experimental` | `MODES_UI[].experimental` | Same: a fact about the mode's maturity, not about the bar |
| `aliases` | **nowhere** | New. `toc` for Hierarchy, `define`/`terms` for Glossary. The command bar is its first consumer and it needs a home that is not a component |

The blast radius of that move is small and was measured rather than assumed: `.blurb` and
`.experimental` are read at exactly **three call sites, all inside `Dock.tsx`** (lines 817, 1298,
1694). Five test files import `visibleModes` from `Dock.js`; none of them touches either field
directly. So `visibleModes` **stays exported from `Dock.tsx`** and those five files are untouched.

**Four things stay where they are**, and saying why is most of the value of this section:

- **`label` stays in `MODE_LABEL`** ([`src/title-text.ts`](../../src/title-text.ts)). Already a
  total, single-home record that the tab title, the Dock and the shared-inventory dialog all read,
  and `title-text.ts` is already browser-and-server safe — its own docblock names that constraint,
  and `tests/client-imports.test.ts` asserts it. Moving it buys nothing and touches many files. The
  brief called `label` in three places duplication; since 2026-09-02 it has been in one.
- **`icon` stays in `MODES_UI`.** It is a `lucide-react` component. Putting it in a module the server
  imports drags React across the seam the catalog exists to keep clean.
- **`keepLabel` stays in `MODES_UI`.** A fit-ladder fact about the bar, and nothing else will ever
  read it.
- **`POLICY` and `MODE_TARGET` stay exactly where they are.** These are the "exhaustive per-layer
  adapters for distinct policies" A3 asked us to retain. A renderer and a spend decision keyed by the
  same mode are different facts, not one fact written twice — and `MODE_TARGET` was made total over a
  tagged union yesterday. Folding it into a catalog now would undo that in the same week.

**`MODES_UI` keeps its order and its array-ness.** The order is Greg's, hand-maintained, and
`ModesMissingFromDock` keeps it exhaustive. The row shrinks to `{ mode, icon, keepLabel? }`.

### `Mode` is still owned by `modes.ts`, and the catalog does not derive it

The brief offered a fork: "Derive `Mode` from its literal keys or keep the existing closed union with
a total `satisfies Record<Mode, ...>` … Choose one as the final vocabulary owner, not both."

**We keep `modes.ts` as the owner.** `modes.ts` imports nothing at all, deliberately, so both
runtimes can read the vocabulary. The catalog will hold fourteen paragraphs of product copy; deriving
`Mode` from it would give every consumer of the word `Mode` — the server included — a transitive
dependency on that copy, and would invert the dependency that makes `modes.ts` safe. The catalog is
`Record<Mode, …>` and the compiler checks it, which is the same totality guarantee with the arrow
pointing the right way.

This also keeps [`new-mode.md`](../project/new-mode.md)'s standing rule true: **nothing counts the
modes, anywhere.**

## The command bar

`src/web/CommandBar.tsx`.

**It mounts from `Dock.tsx`, not from `App.tsx`.** The Dock already holds every input the bar needs —
`slug`, `mode`, `onMode`, `experimental.on`, and `diagramInSearch(search)` for the Diagram press
context — so mounting it there costs **no edit to `App.tsx` at all**, which is A1+A3's territory and
is being rewritten this week. It renders only where the Dock has an `onMode`, which is the reading
view; the Dock on Metadata, Tweets and the public pages has no band to change and gets no bar. The
overlay is a native `<dialog>` opened with `showModal()`, so its DOM position is irrelevant — it
paints in the top layer either way.

- **Pattern**: native `<dialog>` + `showModal()`, following
  [`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) and
  [`Lightbox.tsx`](../../src/web/Lightbox.tsx). That gives focus trap, focus restore, inert
  background and Escape without writing any of them. There is no shadcn `Dialog` or `cmdk` in this
  repo and this is not the change that should add one. **`showModal()` is not enough on a phone** —
  reuse the visual-viewport treatment `FeedbackDialog.tsx` already carries, or the bar sits under
  the iOS keyboard.
- **Rows arrive as a prop, not an import.** The Dock already computes `visible`; it passes
  `visible.map((r) => r.mode)` into `CommandBar`. `visibleModes` therefore **stays in `Dock.tsx`,
  unexported-to-anyone-new**, the five test files that import it are untouched, and — the reason
  this matters — `CommandBar` does not import from `Dock.tsx` while `Dock.tsx` imports `CommandBar`,
  which would be a circular dependency. Requirement 4 is still satisfied by construction: the list
  the bar draws *is* the list the Dock drew.
- **One execution path, not two matching ones.** `Dock` defines a single
  `activateMode(next: Mode)` holding `armActivationForMode(slug, next, { diagram })` and
  `onMode(next)`, and hands it to **both** `DockModes` and `CommandBar`. Two call sites that must
  stay paired and ordered is how they drift; one callback cannot. Each surface keeps its own
  presentation behaviour after the call — the Dock's conditional pointer blur (Dock.tsx 1740-1743),
  the bar's close, clear and focus return.
- **Matching** is a **pure exported function** — normalise (lowercase, trim, collapse whitespace),
  then substring against `MODE_LABEL[mode]`, the aliases and the description; rank label-prefix,
  then alias-prefix, then label-substring, then the rest; ties break in **Dock order**, so the
  ranking is total and testable. The alias-collision test in Stage 1 uses **this same normaliser**,
  or case and whitespace variants pass uniqueness while colliding in the matcher.
- **Keyboard**, specified because "the highlighted row" is otherwise untestable: the input
  autofocuses; the **first result is selected**; Up/Down move and clamp; the selection **resets to
  the first row on every filter change**; a mouse or touch on a row selects and activates it; Enter
  activates the selected row and does nothing when there are none. The list is a `listbox` with
  `aria-activedescendant`.
- **No match** renders `No command matches.` and nothing else.
- **Escape** closes and clears the draft; **Cmd/Ctrl-K** opens. Verified free: a grep of `src/web/`
  and `tests/` for `metaKey`/`ctrlKey` with `"k"` returns nothing. The global handler **ignores key
  repeat**, calls `preventDefault()` when it claims the press, and does not fire while an `input`,
  `textarea`, `select` or `contenteditable` has focus.
- **Escape precedence, and not opening over another modal.** The Dock drawer is non-modal and has a
  **capture-phase** window Escape handler of its own (Dock.tsx ~1088) that would eat the bar's
  Escape. Rule: Cmd/Ctrl-K **closes the drawer first, then opens the bar**, and does not open at all
  while another native modal is showing.

### Deliberately deferred, and named so nobody thinks it was forgotten

Everything below is in the brief and is **not** being built now. Each is a thing we chose not to do,
not an oversight:

- **The typed `AppAction` vocabulary** — `ActionArguments`, the exhaustive dispatcher,
  `passage.locate`, `passage.jump`, `artefacts.ensure`, `chat.ask`. v1 has exactly one verb and it is
  "open a mode", which the Dock already implements in two lines. A dispatcher over one action is a
  dispatcher over nothing. It arrives with the second verb, and the second verb is what will show us
  the shape.
- **`mode.open` vs `mode.activate` as separate actions.** v1 only ever does the activate path,
  because Greg's answer 1 says a press from the bar costs what a press on the Dock costs. The
  distinction is real and stays documented in the brief; nothing in v1 needs to express it.
- **Generation rows** ("generate me Quotes and an Illustrated diagram"). Needs `artefacts.ensure`,
  paired outputs, quota rejection, and the cost-disclosure contract Diagram already holds — price
  before press. That contract is the reason this is not a quick win.
- **Passage intent** ("take me to the bit where…"). Needs a model call and the "one inline plan
  before spending" rule.
- **Voice.** Later stage than text, explicitly.
- **`presentation family` (`plain` / `columns` / `band`) in the catalog.** Nothing in v1 reads it,
  and since 2026-09-06 `DRAWS` in
  [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx)
  is an independently written total statement of what each mode draws. A third statement of the same
  fact is the duplication the catalog exists to remove.
- **Keeping an unfinished draft across a close and reopen.** The brief proposes it; v1 clears on
  close. One `useState`, no identity question, and no half-typed command surviving a reader change.
- **Server idempotency.** Untouched, because v1 issues no POST. The gap named in the brief —
  `useJobs.run`/`parseJobRequest` take no client idempotency key, and `jobs_active_work` deduplicates
  only queued and running work — is still open, and still blocks automatic retries for any later
  stage that does spend money.

### The simpler option passed over

**Import `visibleModes` from `Dock.tsx` and build no catalog at all.** It works today: the bar would
read `MODE_LABEL` for the name and `m.blurb` for the description, and Stage 1 would disappear.

Passed over for two reasons. First, **aliases have nowhere to live** — `toc`, `terms`, `define` are
new facts, and the only home on offer would be a fifth field on a Dock layout row, which is exactly
how `MODES_UI` became the place everything about a mode ends up. Second, it makes a new file depend
on a 2,354-line React component that **four other agents are editing this week**; the catalog is
about sixty lines of data with one import.

A second, smaller thing passed over: **keyboard only, no Dock button.** Greg asked for the button
(answer 2), because Cmd-K does not exist on a phone. His call, taken as given.

## Stages

Two. Each ends green and committable, and if the job were abandoned after Stage 1 what landed would
still be an improvement — the discovery facts out of a contested component and into a pure module.

### Stage 1 — the catalog

- [ ] Add `src/mode-catalog.ts`: `ModeCatalogEntry` and a total `MODE_CATALOG: Record<Mode, …>`
  carrying `description`, `aliases`, `experimental`. Imports `./modes.js` and nothing else.
- [ ] Move the fourteen blurbs and the fourteen `experimental` booleans out of `MODES_UI` **verbatim**.
  No copy is rewritten in this stage — a wording change hidden inside a move is a wording change
  nobody reviewed.
- [ ] `MODES_UI` rows become `{ mode, icon, keepLabel? }`. `visibleModes` stays in `Dock.tsx`, still
  exported, and reads `MODE_CATALOG[m.mode].experimental`; the three call sites at Dock.tsx 817, 1298
  and 1694 are the whole edit.
- [ ] Test: aliases are unique across modes, and no alias equals another mode's label — an ambiguous
  bar is worse than a bare one.
- [ ] Test: `tests/dock-experimental-modes.test.tsx`'s `BEHIND_THE_SWITCH` still passes and is
  **still not derived** from the catalog. It is the independent statement; that is its whole job, and
  its docblock says so.
- [ ] Test: `tests/client-imports.test.ts` still holds — the catalog must not pull `src/web/` into
  the server's import graph. **`mode-catalog.js` needs adding to that file's shared-module
  allowlist**; a new shared module is not admitted by default.
- [ ] Docs: `new-mode.md` gains the catalog row in its totals table; `web-client.md` gains the file.
- [ ] Mutation check: flip one `experimental` in the catalog and confirm the suite goes red.

Done looks like: the Dock renders identically, `npm test` and `npm run typecheck` green, and nothing
outside `src/web/` imports React because of this change.

### Stage 2 — the command bar

- [ ] Extract `activateMode(next)` in `Dock.tsx` and route `DockModes`' existing `onClick` through
  it. This lands **first**, on its own, so the refactor is reviewable separately from the feature.
- [ ] `src/web/CommandBar.tsx` — native `<dialog>`, input, ranked rows, empty state, and the
  visual-viewport treatment copied from `FeedbackDialog.tsx` rather than reinvented.
- [ ] Mounted from `Dock.tsx`, guarded on `onMode`, taking `activateMode` and the visible mode list
  as props. **No edit to `App.tsx`.**
- [ ] Pure `rankModes()` matcher in its own module, exported, with the shared normaliser.
- [ ] The `generates` marker: a small read-only accessor exported from `activation.ts` answering
  "would opening this mode start work?" — `true` for `fixed` and `delegated`, `false` for `none` —
  and a muted trailing word on those rows. No cost figure, no readiness check. See F1 below.
- [ ] Test: the marker is total — every mode is either marked or not, decided by `MODE_TARGET`, with
  no default. Mode fifteen cannot arrive unmarked by accident.
- [ ] Cmd/Ctrl-K opens it: ignores repeat, `preventDefault()` when claimed, inert while a text field
  has focus, closes the Dock drawer first, refuses to open over another native modal.
- [ ] The Dock gains **one** search-icon button. Smallest possible edit in contested ground, and the
  commit message will say whose ground it is.
- [ ] Test: the bar lists exactly what the Dock lists, switch on and switch off.
- [ ] Test — **cost parity, through the real harness.** `pendingActivation` is *not* sufficient
  evidence: `tests/every-mode-draws-its-surface.test.tsx` explains why a token is not a post, and
  Diagram's Force, Drift and Trail paths spend through **mount-time POSTs that leave no token at
  all**. So parameterise that file's existing phase-A trigger to fire from the command bar as well
  as the Dock, and assert on all four of: selected mode and URL, queued job steps, direct paid
  requests, and no unsafe pending token left after settlement. Cover `none`, `fixed` and every
  delegated Diagram context.
- [ ] Test: `rankModes()` directly — ordering, ties in Dock order, normalisation.
- [ ] Test: nonsense input renders `No command matches.` and no rows.
- [ ] Test: keyboard contract — first row selected, Up/Down clamp, reset on filter change.
- [ ] Browser check in a subagent, phone viewport as well as desktop.
- [ ] Docs: `keyboard.md` gains Cmd/Ctrl-K; `reading-view-overview.md` gains the bar.
- [ ] Mutation check: break the ranking tie-breaker and confirm the suite notices.

Done looks like: a reader presses Cmd-K, types `toc`, presses Enter, and is in Hierarchy — having
spent exactly what the Dock button would have spent.

## Territory

Four other agents are live in this tree. This job stays out of: `App.tsx`, `Reader`, the mode
controllers and the passage lifecycle (A1+A3); `useColumnContext.ts`, `rows.ts`, `fonts.ts`,
`scroll.ts` and the geometry internals of `position.ts` (A8); `styles.css`, `tailwind.css` and
`/design` (A10); `ChatPanel.tsx`, the Search panel and `useVisualViewport.ts` (A5).

`Dock.tsx` is contested and this job edits it twice — the Stage 1 field move and the Stage 2 button
and mount. Both are attributed in their commit messages. `App.tsx` is not edited at all.

## Review record

- [x] **GPT Sol on this plan, round 1** — 2026-09-07, six findings, in
  [260906h-mode-catalog-and-a-command-bar-review-sol.md](260906h-mode-catalog-and-a-command-bar-review-sol.md).
  Its verdict: *"The catalog split is sound, and deferring `AppAction` is sound. I would not build
  Stage 2 unchanged, however."*
- [ ] GPT Sol at the end of Stage 1.
- [ ] GPT Sol at the end of Stage 2.

Two rounds each, then settled here in writing.

### Round 1 dispositions

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | P0 | Paid mode activation has no pre-spend disclosure | **Partly upheld, partly overruled** — see below. Premise checked and found not to hold as stated; Fable arbitrated; a `generates` marker lands, a cost line does not |
| F2 | P2 | "The same two lines" is duplicated execution, not one execution path | **Accepted.** One `activateMode(next)` in `Dock`, handed to both surfaces |
| F3 | P2 | `CommandBar` importing `visibleModes` from `Dock.tsx` is a circular dependency | **Accepted, and it was a real catch** — `Dock` imports `CommandBar`, so the reverse import closes a cycle. The visible list is now a prop |
| F4 | P2 | `pendingActivation` does not prove cost parity | **Accepted.** Diagram's Force/Drift/Trail spend through mount-time POSTs leaving no token, so a token comparison proves nothing. The test moves into the real harness |
| F5 | P2 | Matching and keyboard selection underspecified | **Accepted.** Both now written out, and the matcher is a pure exported function sharing its normaliser with the alias test |
| F6 | P2 | The modal collides with the Dock drawer's capture-phase Escape handler | **Accepted.** Precedence rule written in, plus the visual-viewport point |

It also cleared, explicitly: the catalog split, `modes.ts` keeping the vocabulary, mounting from
`Dock`, deferring `AppAction`, and — verified independently, by hand — the three-call-site blast
radius. It found no new token-cross-spend sequence.

### F1, and why the premise does not hold

Sol's P0 says the bar's rows disclose no cost before an Enter that can spend ~$0.20 on Diagram, and
that the design brief requires disclosure before a spend-authorising press.

**The Dock button does not disclose it either**, and that is deliberate and recent. `Dock.tsx`
670-695 says so in its own words: pressing Diagram is *"the most expensive button in the bar that is
in front of every reader: ~$0.20 and about two minutes"*, it *"used to buy nothing — the mode landed
on an invitation with the price on it and waited for a second press — and Greg asked for the second
press to go"*
([260906b](260906b-opening-a-mode-starts-it-generating.md)), and *"the empty state still says the
price for anyone who arrives without pressing."*

So a bar showing the same description and spending the same money is at **parity** with the Dock,
which is exactly what Greg's answer 1 asks for. Adding a cost line to bar rows that the Dock buttons
do not have would make the bar *more* disclosed than the Dock — a product change nobody asked for,
and one that reverses a decision Greg made two days ago.

What survives the correction is narrower and real: **the bar is a materially faster path to the same
spend.** Typing `d` and hitting Enter lacks the moment of recognition that finding and pressing a
labelled icon gives. That is a product question rather than a technical one, so it went to Fable to
arbitrate rather than being overruled on my own judgment.

**Fable's ruling, 2026-09-07: partially uphold — surface one bit, not a cost line.**

> Parity is a complete answer to the question Greg actually answered — *what does Enter do and what
> does it cost* … It is not a complete answer to the disclosure question, because the two paths
> don't disclose the same way. The Dock's disclosure isn't only its tooltip; it's the icon, the
> fixed position, and the deliberate reach to a labelled thing. The bar replaces that with a typed
> prefix and a reflex Enter.
>
> But Sol has the size wrong. The row already shows the blurb *inline*, which is more visible than
> the Dock's hover tooltip … So the bar is already at-or-above the Dock on what a reader can see
> before pressing. What it lacks is one bit: *does this row start work*.

So: **each row whose `MODE_TARGET` kind is `fixed` or `delegated` carries a muted trailing word,
`generates`, after its description. `none` carries nothing.** Enter is unchanged and there is no
gate. This adds no hand-maintained fact — `MODE_TARGET` is already total over `Mode`, so mode
fifteen gets its marker decided by the row it must already write — and it needs only a small
read-only accessor exported from `activation.ts`, not the table itself.

A word rather than a glyph, on Fable's reasoning: a glyph needs a tooltip to mean anything and
"a tooltip is not read by anybody in a hurry" (this repo's own words, 260906b); a coin would make it
about money, which readers do not pay per call since they hold slots; a spark would read as "AI
magic", which is the flattening voice [vision.md](../project/vision.md) rejects. `generates` is a
plain verb naming what happens.

**Known imprecision, recorded rather than fixed:** if the artefact already exists, opening the mode
spends nothing and the marker over-warns. The Dock *under*-warns in exactly the same case. Both are
acceptable for v1; making it exact needs the readiness adapter this plan is deliberately not
building.

**Sol's F1 is therefore partly overruled: no cost figure and no readiness state, because that
reverses a decision Greg made on 2026-09-06 and puts dollars in front of readers who are not billed
per call.** The disclosure gap it correctly identified is closed by the `generates` marker instead.
Greg can strike the marker if he would rather have strict Dock parity.
