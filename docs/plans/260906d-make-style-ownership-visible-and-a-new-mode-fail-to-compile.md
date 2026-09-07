# Make style ownership visible, and make a new mode fail to compile

**Status: finished and on `dev`, 2026-09-06** (`cac94777`). Both halves built, reviewed twice by
GPT Sol on the plan and twice on the code, all seventeen findings accepted and fixed, nothing
overruled. The worktree is removed. Shipping CSS came out **byte-identical** through the split
(md5 `733c807548da26925bd8b120d7c026ac`, content-hash filename unchanged), and four merges of
`origin/dev` landed on top of it, each verified by an oracle computed a different way from the
edits.

What is deliberately **not** done, and why, is in [§ Left undone](#left-undone) at the foot.

Item **A10** of [260905e-main-app-architecture-review.md](260905e-main-app-architecture-review.md)
§ A10 and its stage checklist § *Make style ownership visible*. That stage is the authority; this
file is how it gets built.

Two halves that share one theme — **the thing you have to edit should be findable, and the thing
you forgot to edit should be red**:

1. `src/web/styles.css` is 15,489 lines. Split it into an ordered composition of smaller semantic
   sheets, **preserving cascade order exactly**, so that the file an editor opens tells them where
   a rule belongs.
2. The mode extension contract has four decisions a new mode must make — presentation, visitor
   policy, label, activation. Label and visitor policy already fail to compile when missed.
   **Activation lacks a total decision. Presentation already has a visitor-side compile tripwire
   (`BAND_SAYS`), but no owner-controller coverage.** Close those two gaps.

## What this is not

- **Not a redesign.** No selector is rewritten, no class is renamed, no rule is grouped with its
  prefix-mates, no visual adjustment rides along. The semantic CSS model is right for table
  geometry and reading typography and is not up for replacement. The problem is *finding* which
  rules own a feature, not the existence of both semantic CSS and Tailwind.
- **Not a change to the layering.** One documented import order under `tailwind.css`'s `app` layer;
  the `tw` prefix, the `@source` guard, the token bridge and the deliberate absence of Preflight
  all stay exactly as they are. No feature stylesheet is imported unlayered from its component.
- **Not a mode-dispatch refactor.** The exhaustive `switch` at the composition point is **A3**, and
  A3 belongs to the agent who owns `App.tsx`, `Reader` and the mode controllers. Nothing here edits
  the band branch.

## The collisions this plan is shaped around

Four other jobs are live in this repo at the same time.

| Job | Owns | How this plan stays out of the way |
|---|---|---|
| **A1+A3** | `App.tsx`, `Reader`, mode controllers, passage lifecycle | The presentation check mounts `<App/>` from the outside, exactly as `public-network-trace.test.tsx` and `a-broken-mode-…test.tsx` already do. It never names `Reader` or a controller's internals, so A3's switch extraction cannot break it. |
| **A5** | `ChatPanel.tsx`, Search panel, `useVisualViewport.ts`, and the **mode-band and composer rules** | Those rules move as a *verbatim contiguous slice* into a named file and are not otherwise touched. A5's edits then land in `styles/mode-band.css` instead of `styles.css`; a merge conflict there is a small one. |
| **A8** | `useColumnContext.ts`, `rows.ts`, `fonts.ts`, `scroll.ts`, geometry internals of `position.ts` | No TypeScript in that set is touched. |
| **structure-mode** | four unmerged commits in `App.tsx`, `Dock.tsx`, `position.ts`, `styles.css` | `styles.css` is the shared one. Mitigated by landing the extraction in **small, sectioned commits** and merging `origin/dev` at the start of every stage and before every push. See *Merge discipline* below. |

**Merge discipline.** `git merge origin/dev` at the start of each stage and again before pushing.
A conflict in `styles.css` after the split is a conflict between "someone edited a section in the
old file" and "that section moved" — resolve by applying their hunk to the *new* file at the
identical position, never by reverting the move. Read the history behind both sides first
([git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md)).

## Why the cascade is the thing that breaks

Extracting contiguous ranges in order and importing them in order is provably order-preserving —
but only if every cut is *actually* contiguous and *actually* in order. The failure mode is
silent: a rule that used to be overridden by a later one is now the winner, nothing errors, and
the difference is a few pixels on one surface nobody screenshotted.

### Measured, before writing any of it

Two things were established with a throwaway compile of a four-level import chain through
Tailwind's own `compile()` (2026-09-06, `tailwindcss` at the version this lockfile names):

1. **`layer(app)` is inherited all the way down.** A rule in a file imported by a file imported by
   `styles.css` lands in `@layer app`, exactly as `tokens.css` → `colourscales.css` already
   demonstrates two levels up. So the extraction needs no `layer()` on the new imports, and adding
   one would be the mistake.
2. **`@import` is inlined *positionally*, not hoisted.** A file whose own rules sit between two
   `@import`s emits in written order: import-A's rules, then its own, then import-B's. This is what
   makes the extraction provably order-preserving — the import order *is* the cascade order.

   It also **diverges from the CSS specification**, where an `@import` following a style rule is
   invalid and dropped. Our build always goes through Tailwind, so what ships is the positional
   behaviour; but a rule left in `styles.css` between imports would mean the file no longer says
   its own load order at the top, and the same file in a plain-CSS pipeline would silently lose
   every sheet below that rule. Hence the "no rule in `styles.css`" test in stage 2 — it guards a
   legibility rule today and a correctness one the day the bundler changes.

### The pairs that actually break

A selector-span analysis of the file (2026-09-06) found **30 selectors appearing in two or more
sections**, and they are not evenly spread. The overriders are concentrated in two late blocks —
`@media (max-width: 731px)` from ~12136 and the coarse-pointer/small-device block from ~12706 —
which between them override `.reader`, `.masthead`, `.controls`, `.dock`, `.dock-modes`,
`.dock-btn`, `.spine`, `.mode-band`, `td.gist .sticky`, `thead th`, `.cmt-dialog`,
`.chat-dialog`, `.annotate-dialog`, `.install-hint` and `:root` itself.

**That scan finds one concentrated set of high-risk dependencies. It does not find them all**, and
an earlier draft of this plan said it did (Sol F9). Selector *identity* misses the case where two
**different** selectors of **equal specificity** match the same element, and then source order —
not specificity — decides. It is live here, verified 2026-09-06:

- `.gloss-quiet` (slice 12) sets `padding: 1rem 0.9rem`; `.tl-thin` (slice 33) resets padding on
  the same `<p className="gloss-quiet tl-thin">` in `TimelinePanel.tsx`;
- the same again with `.dbt-empty` (slice 34) in `DebatePanel.tsx`.

Both work only because glossary comes before timeline and debate. **Their later position is
load-bearing**, and the plan's earlier claim that "specificity settles that, not order" was simply
wrong. The proof that every such dependency survives is the ordered manifest and the compiled-output
comparison — never selector identity. So:

- **One output file owns exactly one contiguous top-level interval of the old file.** Semantic
  ownership does not licence gathering sections that recur later. A repeated family stays beside
  its original neighbours and gets a second, order-qualified file if it needs one. So there is no
  gathered `overlays.css`: the floating chat panel, the annotation dialog, the diagram dialogs,
  the lightbox and the feedback modal each stay in their own slice, in their own place. *(Sol F1 —
  the plan's first draft described exactly that illegal gathering.)*
- **Every cut is a contiguous range, subject only to declared reference rebasing.** A CSS relative
  URL resolves against the sheet containing it, so moving bytes one directory deeper can change
  their meaning even when the concatenation is identical (Sol F3). **Measured 2026-09-06: zero
  `url()` in `styles.css`, and its one `@import` is line 27, which stays in `styles.css`** — so
  this has no instance today. The rule stands anyway: inventory every `url()` and `@import`
  before cutting, and if one ever moves, rewrite it so the resolved absolute target is unchanged
  and record the rewrite in the manifest. The concatenation check rejects every other byte
  difference.
- **Two immutable baselines are captured before the first cut**, both labelled with the source SHA:
  1. the core `tailwindcss` `compile()` output, for diagnosis;
  2. **the CSS emitted by `npm run build:client`** — which is what actually ships, because the app
     builds through `@tailwindcss/vite`, using Vite's resolver, Vite's import inlining and URL
     rebasing, and production optimisation. A direct `compile()` diff can be empty while the real
     pipeline differs (Sol F4). Only the Vite artefact is called "the CSS the browser receives".

  A comparison is refused if either baseline is missing or was produced from the post-cut SHA —
  otherwise "before/after" quietly becomes two *after*s.
- **And then a browser looks anyway**, against the built preview, because no CSS diff can see a
  file that stopped being imported at all.

## Stages

### Stage 1 — the tests stop naming one file, proved by a real cut

Thirteen test files do `readFileSync("src/web/styles.css")` and grep it. Every one of them breaks
the moment a rule moves, and — worse — several would go *green over nothing* if their regex simply
stopped matching. `tests/css-tokens.test.ts` § the outline row's number track has a vacuity guard;
most do not.

The stage, in order, so the helper is proved red-first rather than asserted:

1. **Cut one section first.** Move `§ spine` (and its search-marks sub-section) out of
   `styles.css` into `src/web/styles/spine.css`, imported from `styles.css` at the identical
   position. Run the suite. `tests/spine-width.test.ts` must go **red**. That is the proof the
   filename coupling is real and that the helper below has something to fix.
2. **Add `tests/helpers/stylesheets.ts`.** It resolves the `@import` graph from
   `src/web/tailwind.css` — relative imports only, package imports skipped — and returns the
   sheets in load order, plus a concatenation of them. One place knows the file layout.
3. **Migrate all thirteen tests to it**, plus `tests/css-tokens.test.ts`'s hard-coded `SHEETS`
   array. Suite green.

   **`tests/no-raw-nul-bytes.test.ts` is explicitly *not* migrated** (Sol F8, and he is right —
   I had it down as a hard-coded path list and it is not one). It derives every authored file from
   `git ls-files`, and `src/web/styles.css` appears in it only as one of twelve *coverage
   witnesses* — a file per group whose disappearance proves the globs shrank. Pointing that at a
   stylesheet helper would narrow a deliberately repo-wide test. It keeps its witness, which is
   still a real file (the import-only entry), and gains one extracted child beside it.
4. **`css-tokens.test.ts` keeps its sheet order, and that is deliberate.** Its `SHEETS` list is
   `tailwind, styles, tokens, colourscales`, and it builds a `valueOf` map where **the last
   definition wins**. The walker returns cascade order instead — `colourscales, tokens, styles,
   tailwind` — and **three tokens are defined in two sheets**: `--highlight` (tokens.css and
   styles.css) and `--font-sans` / `--font-mono` (tokens.css and tailwind.css's `@theme inline`).
   So the two orders resolve those three differently.

   Cascade order is the *correct* answer to "what does this token resolve to", and the hand-written
   list has been giving the other one. **That is a real latent defect and it is not this job's to
   fix**: changing it moves what a colour-contrast test measures, which wants its own change with
   its own evidence. So the migration splices `readerSheets()` into the slot `styles.css` occupied
   and leaves the surrounding order alone — a provable no-op. Written down here so the next person
   finds it rather than rediscovers it.

5. **Give the vacuity guard to the ones that lack it.** A test that greps for a selector and
   asserts something about the match must first assert *the selector was found*. Several already
   do (`text-alone-centring`, `prose-centred-in-its-cell`, `gutter-target-size`, `valence`); the
   rest get the same line. This is the [silent-success](../reusable/silent-success.md) shape and
   the whole reason a move is dangerous.

**Done looks like:** one section extracted, the suite green, and **no semantic-CSS test reading
only `styles.css` while expecting all the rules to be physically in it.** Not "no test names the
path" — `no-raw-nul-bytes` legitimately does.

### Stage 2 — the extraction

`styles.css` becomes a header comment and an ordered list of `@import`s, and nothing else. Each
imported file is a verbatim contiguous slice of the original, in its original position.

**The cut is mechanical and its arithmetic is checked before anything is written.** A throwaway
script holds a table of `[file, startLine, endLine]`, refuses unless the ranges tile lines
29–15489 with no gap and no overlap, cuts them verbatim, and then asserts that concatenating the
pieces reproduces the original **byte for byte**. Verified 2026-09-06: 37 slices, 40–981 lines
each, exact rebuild.

**And it refuses a cut that lands inside a rule, an at-rule or a comment — which the
concatenation check cannot see.** That is the trap worth naming: bytes split through the middle of
an `@media` block still rebuild the original perfectly, because concatenation only asks whether
the bytes are all there and in order. What it does not ask is whether each *file* is parseable on
its own, and two unparseable halves are two files the browser drops. So the script scans the whole
source tracking brace depth, comment state and strings, and every cut point must be at depth 0 and
outside a comment. Verified 2026-09-06: all 37 are, and the file's braces balance.

**The section boundaries were established, not eyeballed.** `styles.css` uses *two* banner styles —
the common `/* ----…` and a rarer `/* ====…` used for four long essay-sections. A dash-only scan
finds 67 banners and silently misses the four `====` ones at 12105, 12637, 14591 and 15048 — and
12105 opens "A NARROW WINDOW", a mega-section that **contains** what look like standalone sections,
while 12637 opens "a coarse pointer" nested inside where a dash-only range would have ended. Using
the wrong boundary set would have cut the file in the middle of the very blocks whose order matters
most. **71 top-level sections**, every boundary spot-checked against the file.

The families, following the brief's own list — **reader geometry and typography, shared mode
surfaces, dock and overlays, feature sections, site and shelf chrome**. The 37 files, in import
order, are the section ranges grouped without reordering:

All under `src/web/styles/`, and the order below **is** the import order and the cascade order.
The line ranges are the old file's; they tile 29–15489 with no gap and no overlap.

| # | File | Old lines | | # | File | Old lines |
|---|---|---|---|---|---|---|
| 1 | `tokens.css` | 29–276 | | 20 | `touch.css` | 8383–8422 |
| 2 | `shell.css` | 277–704 | | 21 | `profile.css` | 8423–8967 |
| 3 | `table.css` | 705–1018 | | 22 | `diagram.css` | 8968–9374 |
| 4 | `prose.css` | 1019–1609 | | 23 | `dialogs.css` | 9375–9885 |
| 5 | `spine.css` | 1610–1822 | | 24 | `gutter.css` | 9886–10614 |
| 6 | `tooltip.css` | 1823–2016 | | 25 | `ideas.css` | 10615–11005 |
| 7 | `annotations.css` | 2017–2970 | | 26 | `diagram-sketch.css` | 11006–11387 |
| 8 | `column-context.css` | 2971–3218 | | 27 | `diagram-illustrated.css` | 11388–11725 |
| 9 | `dock.css` | 3219–3828 | | 28 | `diagram-drift.css` | 11726–12104 |
| 10 | `design-page.css` | 3829–4045 | | 29 | `narrow-window.css` | 12105–13027 |
| 11 | `mode-band.css` | 4046–4910 | | 30 | `lightbox.css` | 13028–13196 |
| 12 | `glossary.css` | 4911–5320 | | 31 | `outline-mode.css` | 13197–13522 |
| 13 | `prose-hover-card.css` | 5321–5643 | | 32 | `quotes.css` | 13523–13825 |
| 14 | `footnotes.css` | 5644–6007 | | 33 | `timeline.css` | 13826–14016 |
| 15 | `dock-fit.css` | 6008–6183 | | 34 | `debate.css` | 14017–14376 |
| 16 | `search.css` | 6184–6855 | | 35 | `quiz.css` | 14377–14590 |
| 17 | `referee.css` | 6856–7836 | | 36 | `feedback.css` | 14591–15047 |
| 18 | `summary.css` | 7837–8182 | | 37 | `site.css` | 15048–15489 |
| 19 | `chat-actions.css` | 8183–8382 | | | | |

Four of those names are worth a sentence, because the file order is not the tidy order:

- **`mode-band.css` (11)** is the band's umbrella *and* Chat, which lives directly in it. **A5's
  ground.** It is not split further here; A5 can do that with the component in front of them.
- **`glossary.css` (12)** carries base classes that Ideas, Timeline, Debate and Quiz reuse by
  putting a second class beside `.gloss` — so 25, 33, 34 and 35 all depend on it, **and some of
  their companion classes override it by source order alone** (`.tl-thin`, `.dbt-empty`; see
  above). Its earlier position is load-bearing, not incidental. Each of those files gets a header
  line saying where its base rules are and that it must stay after them — precisely the thing a
  split can hide.
- **`chat-actions.css` (19)** is chat rules that arrived later and sit a long way from
  `mode-band.css`. They stay where they are. Moving them next to the rest of chat is the tempting
  edit this stage exists to refuse.
- **`narrow-window.css` (29)** is the mega-section "A NARROW WINDOW" *and* its children *and* the
  nested "a coarse pointer" block. It is where nearly every cross-section override lives, and it
  must stay after everything it overrides.

Three rules that are not negotiable:

- **Extraction does not consolidate declarations.** The global geometry definitions already in the
  opening token/shell interval stay there; the responsive redefinitions of `:root` (~12137, ~12707)
  and **all 31 `z-index:` declarations** stay in their original slices. The single home for the
  cross-feature stacking *contract* is
  [design-css-overview.md § The stacking order](../project/design-css-overview.md), which points at
  the physical declarations — a doc, not a file of CSS. Turning those numbers into shared tokens,
  or physically gathering them, is a separate cascade-changing refactor and is out of scope.
  *(Sol F2: "one home" as first drafted was impossible — the declarations are spread through
  spine, tooltip, dock, mode band, dialogs, search, profile, timeline, feedback and site.)*
- **`styles.css` is an import-only ownership manifest.** The test parses it and requires **every
  non-comment top-level node to be an `@import`** — not merely "contains no style rule", which
  would pass an `@media` block or an `@supports` wrapper sitting between two imports.

  **The rationale is ownership and visible ordering, not portability**, and an earlier draft got
  that wrong (Sol F10). It claimed a rule here would break a spec-conformant CSS pipeline — but
  `tailwind.css` already places `@custom-variant` before its own `@import "./styles.css"`, so the
  tree is not portable to one regardless. What this guard actually buys is that the file keeps
  saying its whole load order at the top, under the pipeline we support. Changing bundlers is a
  separate import-prelude review.
- **Nothing is renamed and no selector is touched.** If the extraction makes an ugly boundary
  obvious, it is written down here, not fixed.

Landed in **several small commits**, one per family, to keep the structure-mode job's merges
tractable.

**Done looks like:** the concatenation check passes byte-for-byte; **both** baselines compare
equivalent — the `compile()` one and the `npm run build:client` one; `npm run build` succeeds; and
`npm test`, `npm run typecheck` and `npm run check` are green.

### Stage 3 — prove the cascade did not move, in a real browser

A Sonnet subagent that has read [browser-control.md](../project/browser-control.md) then
[browser-testing.md](../project/browser-testing.md) first. On this box that means **Playwright
against system Chrome**, and it kills its own dev-server pid rather than `pkill -f vite`.

Captured **before and after** on the same article, same viewport, same build kind:

| Surface | Why it is in the list |
|---|---|
| Plain | no band, no gist columns — the geometry baseline |
| Hierarchy | the gist columns, the fisheye |
| Outline | a band whose rules a test already pins (`.outln-row`) |
| Two unlike bands (Glossary and Diagram) | one list-shaped, one picture-shaped |
| A modeless annotation | the comment box, which is *not* a modal |
| A true modal | the figure lightbox — a native `<dialog>` in the top layer |
| Visitor chrome | signed-out `/read/public/…`, a different component tree |
| The shelf | `site-*` and the card grid, the far end of the file |

Compared: `getBoundingClientRect()` for a named element list per surface, plus
`getComputedStyle` for the properties the sections actually set, plus screenshots. A pixel
difference is a finding; a *dimension* difference is a bug.

**Done looks like:** every dimension identical, every screenshot pair visually identical, and the
raw before/after tables written into this plan.

### Stage 4 — the extension contract

Four decisions a new mode makes. Where each one stands today:

| Decision | Table | Total? |
|---|---|---|
| Label | `MODE_LABEL` (`src/title-text.ts`) | **yes** |
| Visitor policy | `POLICY` (`src/web/visitor.ts`) | **yes** |
| Activation | `MODE_TARGET` (`src/web/activation.ts`) | **no — `Partial<Record<Mode, …>>`** |
| Presentation | `BAND_SAYS` (`tests/public-network-trace.test.tsx`) — **visitor only** | yes, but it never renders an owner's controller |

**Presentation is not "nothing", and saying so was wrong** (Sol F7). `BAND_SAYS` is total and
already on `new-mode.md`'s compiler-checked list, so a fifteenth mode is red there today. What is
missing is that nothing renders the **owner's** real controller and checks what it drew. The
deliverable is coverage of the real owner surface, not a new compile tripwire — and the plan must
not claim otherwise.

1. **Every activation decision is total *and executable*.** A tagged union alone is not enough:
   `{ kind: "delegated"; owner: string }` is a *string*, nothing consumes it, and a fifteenth mode
   could write `{ kind: "delegated", owner: "ResearchBand" }` and typecheck with no arming path
   anywhere (Sol F5, round two — the round-one fix was documentation wearing a type's clothes).
   Diagram works today only because `Dock.tsx` carries an explicit `if (m.mode === "diagram")`
   branch, and the type created no equivalent obligation for anyone else.

   So the delegated variant carries **an arming function**, not a description:

   ```ts
   Record<Mode,
     | { kind: "fixed"; target: AutoRunTarget }
     | { kind: "delegated"; arm: (slug: string, ctx: PressContext) => void; why: string }
     | { kind: "none"; reason: string }>
   ```

   and `armActivationForMode(slug, mode, ctx)` executes all three exhaustively, with `ctx`
   carrying the current diagram kind. **`Dock.tsx` then calls that one function for every mode and
   loses its Diagram-only branch** — a six-line edit, on ground the structure-mode job also holds,
   so it is deliberately the smallest one that removes the special case, and the commit message
   says whose ground it is.

   Genuinely free modes, and modes that wait for the reader's own words, are `none` **with the
   reason written out**. Every absence in the existing `MODE_TARGET` docblock already has such a
   reason in prose; this turns that prose into the type.

2. **One test file and one harness, but two independently configured phases** — and the second
   half of that sentence is a correction. My first instinct was one sweep over one fixture state,
   on the grounds that two sweeps would be two harnesses agreeing with each other. Sol showed that
   forcing both contracts through one fixture state is not a simplification but a contradiction
   (F6, round two): **to prove a Dock press posts, the artefact has to be missing** — and a
   controller with a missing artefact draws its *empty or running* state, not its populated body.
   So `says` would have been matching chrome, and deleting the real Ideas, Quotes, Timeline or
   Debate renderer could have left the sweep green.

   One file, one `<App/>`/`NuqsAdapter`/`StrictMode` harness — the one
   `a-broken-mode-leaves-the-article-readable.test.tsx` already establishes — and two phases:

   - **the activation phase** supplies *missing* artefacts and checks `SPENDS`;
   - **the presentation phase** supplies *populated, deliberately asymmetric* fixtures and checks
     `DRAWS`.

   `SPENDS` is its own independently written `Record<Mode, …>` of literal expected targets or a
   deliberate none, **never derived from the production activation table**, and Diagram exercises
   both of its dynamic targets.

   **The band table is not nullable**, because a nullable one permits exactly the omission it
   exists to catch (Sol F6): `{ band: ".mode-band.research", says: null }` passes over an empty
   shell, and `{ band: null, says: null }` passes over a controller that was never written. So:

   ```ts
   const NO_BAND_MODES = ["plain", "hierarchy"] as const;
   const DRAWS: Record<Exclude<Mode, (typeof NO_BAND_MODES)[number]>,
                       { where: string; says: string }> = { … };
   ```

   Every row requires both fields, non-empty. A genuinely bandless fifteenth mode has to be added
   to `NO_BAND_MODES` on purpose, which is a decision someone makes rather than a row they omit.
   `plain` asserts readable article prose **and** no band; `hierarchy` asserts a real gist-column
   value **and** no band.

   **Read only what a reader can read**, and **`says` must be a fixture-only body literal** — not
   a heading, a status line, a button label or any shared chrome, and scoped to the exact band.
   A string that could be drawn by the empty state is a string that proves nothing. Matched
   against accessible content, excluding `[hidden]`, `[aria-hidden="true"]` and the
   screen-reader/measurement copies — `BAND_SAYS`' own docblock records the precedent, where
   Outline's visible list could be deleted while five `aria-hidden` measuring copies kept the
   expected text on the page.

   **The values are literals**, not computed from `MODES_UI`, `POLICY`, `DRAWS`' own keys or
   anything in `App.tsx`. That is the whole point of the row in the brief.

3. **`new-mode.md` updated**: activation moves out of *the residue nothing checks* into the
   compiler-checked table; the presentation row gains the owner sweep beside `BAND_SAYS`. The
   residue list shrinking is the deliverable.

4. **Mutation checks, three of them**, because one proves less than it looks:
   - delete a **fixed** mode's activation row's effect → the sweep must go red;
   - break the **delegated** arm (Diagram) → red;
   - delete a **populated generated controller's visible body** — Ideas, Quotes, Timeline or
     Debate — while leaving its shell, heading, loading/empty chrome and hidden measuring copies
     intact → red. That is the F6 scenario, and a sweep that survives it is one that would have
     accepted an empty band. It must be run against a *populated* fixture; run against a missing
     one it calibrates nothing.

**Done looks like:** a fifteenth word in `MODES` is a typecheck error at activation *and* at
`DRAWS`, the sweep exercises the real owner controller for all fourteen, and the three mutations
each go red.

### Stage 5 — `/design`, and the docs

- **Representative real surfaces on `/design`** in the states the brief names — loading, missing,
  stale, error, running, success, with a long label and at larger text — reusing `JobProgress` and
  `.band-head` rather than mocking their look. Feature-specific filtering, scoring, chronology and
  provenance stay distinct; this is the *shared* surface only.
- **[design-css-overview.md](../project/design-css-overview.md) § The five files, in load order**
  becomes the style map: the import order, one line per file saying what it owns. That section's
  wording is a rule, so the edit goes through
  [edit-important-docs.md](../reusable/edit-important-docs.md) — one approved change at a time,
  before and after shown. Signposting (adding the new files' lines) needs no approval.
- **Stale inventories removed.** That doc says "~12,800 lines" in two places and the review says
  15,007; both are already wrong. Replace with the command and its run date, per
  [CLAUDE.md § Cite, don't restate](../../CLAUDE.md).
- `touch.md`, `tooltips.md`, `reading-view-overview.md` get their `styles.css §` pointers updated
  to name the file that now owns the rule.

### Stage 4, part 2 — the owner sweep, 2026-09-06 (`ffa12f4e`)

`tests/every-mode-draws-its-surface.test.tsx`, 28 tests. One harness, two phases, as Sol's F6
required: phase A with every artefact 404 checks `SPENDS`; phase B with **twelve populated,
deliberately asymmetric fixtures** checks `DRAWS`. Each `says` is a string invented for that mode
alone, never a heading, count or button label.

Three mutations, all red, all restored — and the third is the one the nullable table would have
missed:

```
quotes: the band drew no body:
  expected '1 quoteYour profileChoose them again'
  to contain 'before anybody could say what it would measure'
```

The shell, the `band-head` count (*"1 quote"*), the empty/stale chrome and the hidden copies were
all still on the page. Only the body was gone, and the assertion caught it.

Adding a fifteenth word to `MODES` is now red at `SPENDS` and `DRAWS` as well as `MODE_LABEL`,
`OWNER_MODE_NOTE`, `MODES_UI`, `POLICY`, `MODE_TARGET` and `BAND_SAYS`.

Three fixture facts worth keeping: Illustrated can only be armed on an article that already has a
Sketch (`useIllustrated.ts`); `quotes`' `says` is the quoted line rather than the model's `reason`,
because the panel draws the line; and `hierarchy` needs `?cols=1`, since an absent `cols` means
*whatever fits* and nothing fits in jsdom.

### The merge, 2026-09-06 (`1da61575`)

The collision this plan was shaped around. `origin/dev` added 139 lines to `styles.css` in three
places while this branch made it a manifest. Resolved by moving **their** hunks into the sheets
that now own those regions — the origin line to `shell.css`, the PDF figure note to `prose.css`,
`.tip-soon-head` to `dock.css` — anchored on the run of context lines each follows rather than on
line numbers, since line numbers are what the split changed.

**Verified by position, not by size.** A hunk dropped into the wrong file still builds, is still
the right length, and still passes every test. So: concatenating the 37 sheets in import order with
the headers stripped reproduces `origin/dev`'s `styles.css` from line 29 on — all **15,629 lines**,
exactly.

### The second merge, 2026-09-06 — and the oracle that had to be replaced

78 commits of `origin/dev`, and **37 hunks, 622 insertions and 220 deletions**. Unlike the first
merge this one is not additive: `origin/dev` scopes the bare `td {` and `thead th {` that were
reaching the shelf (`601a550a`), and retires the dock-fit rules the new bar replaces.

**The first merge's check could no longer be used, and this is the more interesting half.** "The
sheets reconstruct `origin/dev`'s `styles.css` exactly" stopped being true the moment this branch
added CSS of its own — the `/design` bands of Stage 5. Kept as it was, it would have been a guard
that can never go green, which is the same failure as one that can never go red: either way it has
stopped distinguishing anything. It was replaced by a three-way merge of the three *concatenated
bodies*, computed with `git merge-file`, and the sheets must concatenate to that byte for byte.
`git merge-file` is not the code path that edits the sheets (`git apply`, hunk by hunk), so the two
can disagree.

The arithmetic is the reason to believe it, and it was checked before the merge was applied:

| | lines | |
|---|---|---|
| base | 15,601 | |
| ours | 15,666 | base **+65** — this branch's `/design` bands |
| theirs | 16,003 | base **+402** — exactly 622 − 220 |
| expected | 16,068 | base **+65 + 402** |

The three-way merge was clean, 0 conflicts. **One hunk was accepted by two sheets**: it changes a
button's width to a gap-and-padding, and `.prof-mic` in `profile.css` has a byte-identical
declaration block. Placed in `mode-band.css` by mapping the hunk's base line number to the region
that owns it — base line 4934 is inside `.chat-live-btn`, and `profile.css` contains no
`.chat-live*` rule at all. The oracle then went green, which is independent confirmation: the wrong
choice would have moved those three lines in the concatenation.

#### Two of origin/dev's own guards had been broken by the split, and only one of them said so

This is the class in [the postmortem](../postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md),
found for the tenth time — and the first found by somebody else's test rather than by review.

- **`tests/table-selectors-are-scoped.test.ts` read `src/web/styles.css` directly and asserted an
  *empty* list of offending selectors.** After the split that path holds no selectors at all, so the
  guard passed while checking nothing — and it is the guard for the very deletions in this merge.
  Repaired to read the sheet set, and to assert it found **more than 500** selector branches before
  asserting the absence. Calibrated without mutating anything: the pre-merge body has **2** bare
  selectors and the post-merge body has **0**, so the repaired guard separates the two states, while
  the version reading `styles.css` reports green for both.
- **`tests/dock-corner-controls.test.tsx` had the same cause and failed loudly**, because its author
  had written a positive control — the masthead's `--safe-top` padding has to be found before the
  absences are asserted. Same split, same day, opposite outcome, decided entirely by whether a
  positive control was written. That is the postmortem's recommendation observed working in the
  wild rather than argued for.

Three types tightened under the new mode test while it was not looking, which is the contract doing
its job in the direction it was built for: `Article` gained a required `navLabelStatus`,
`DirectDebateRow` a required `identifies`, and `DebateLosses` a `sourceIsCopy`. All four errors
landed at `npm run typecheck` rather than at runtime. `NO_LOSSES` and `COUNTS` are now annotated
`DebateLosses` and `DebateCounts` rather than inferred, so the next added field is one error at the
declaration instead of one at every use.

### The third merge, an hour later — and the argument for doing it often

21 more commits and another 202 insertions / 39 deletions, in the hour between committing the second
merge and pushing it. That is the whole case for Greg's instruction to pull on every wake-up, and
the numbers make it concrete: **37 hunks after five hours, 5 hunks after one.** The work is roughly
linear in elapsed time, and the *risk* is not — a five-hunk merge is one where each placement can be
checked by eye, and a thirty-seven-hunk one is where a mistake hides.

Same method, and by now it is machinery rather than a judgement call: resolve `styles.css` back to
its 65 lines, build the oracle, place each hunk by trying it against all 37 sheets, require exactly
one to accept. All five unambiguous this time — `tokens.css`, `dock.css` ×2, `debate.css` ×2 — and
the merge-2 manual override was deliberately cleared rather than carried forward, since a stale
override is a hand-placed hunk that stops being examined. Arithmetic again: base 16,003 + ours 65 +
theirs 163 = **16,231**, and the sheets concatenate to exactly that.

### Stage 5 — the docs, 2026-09-06

83 references to `styles.css` found across `docs/`; **53 repointed** at the sheet that now owns the
rule, 30 deliberately left at the entry point under a stated rule (a *section or selector* → the
owning file; the *entry point, the import, the layering, the load order* → `styles.css`, which is
still exactly right).

Four stale facts corrected, three of them made stale by this change and one merely exposed by it:

- **`tailwind.css` said "the four narrower blocks in styles.css"** — `grep -rc "prefers-reduced-motion"`
  finds **18 across 13 files**. Wrong by more than four times, for long enough that nobody can say
  when it drifted.
- **`design-css-overview.md`'s z-index inventory command** pointed at `styles.css` and so returned
  **nothing at all** after the split — a documented command that answers zero without erroring.
  Repointed, re-run, re-dated: 31 declarations.
- **`web-client.md` and `browser-testing.md` both said `styles.css` is 1,212 lines.** A proportion
  pinned to two absolute numbers ("about 1,060 of 1,212") goes stale twice as fast as one.
- **`design-css-overview.md`'s own line count**, which the sweep set to 15,812 and the merge then
  made 15,951 within the same day — a good illustration of why these carry a command and a date.

`new-mode.md`'s compiler-checked table gained `MODE_TARGET`, `SPENDS` and `DRAWS`, and its residue
list lost the activation entry. **The residue list shrinking was the deliverable**, and it shrank.

#### `/design` — the shared band, in its real states (`61fdf6a5`)

Eight bands, using the **real** `JobProgress`, the real `.mode-band` / `.band-head` markup and the
real `.gloss-*` bodies — nothing that imitates a component, because a design page drawing its own
approximation goes on looking right after the component changes.

**Four of the brief's six state names are real; two are not**, and the page says so. `loading`,
`none` (= *missing*), `ready` (= *success*) and `error` are `ArtefactStatus` in `useAutoRun.ts`.
*Stale* is not a status — it is a boolean beside a `ready` one — and *running* is a `Job` on
screen, which is `JobProgress`'s business. Two more were added that the code has and the brief did
not name: **built-and-empty** (`builtButEmpty`, used by three panels) and the long-label case.

**And it immediately did its job — two real defects, both pre-existing, neither mine:**

1. **A long run-button label overflows the band by 71px.** shadcn's `Button` is
   `whitespace-nowrap` and `shrink-0`, so `.gloss-run`'s `flex-wrap` cannot rescue it. `.band-head h2`
   beside it truncates correctly, which is why nobody had seen this: the half that fails is the half
   nobody made long.
2. **At a 20px root the controls grow and the band does not.** The chip goes 28 → 34px and
   `size="sm"` 32 → 40px while the band stays 288px, because the band's width is in `px`
   (`MODE_MIN`) and the controls are in `rem`.

Both are recorded rather than fixed: they are product-visible geometry, outside A10's ground, and
[design-css-overview.md § Controls](../project/design-css-overview.md) is where a fix would need to
argue itself.

One deviation, flagged by the implementer and worth acting on later: `--mode-w: 288px` mirrors
`MODE_MIN` in CSS rather than importing it, because importing `layout.ts` into `DesignPage` would
require a line in `SHARED_WITH_READER` (`tests/eager-client-graph.test.ts`) — which that agent was
barred from touching. `App.tsx` already loads `layout.ts` eagerly, so adding it is free.

## Reviews

GPT Sol on this plan before any code, and at the end of every stage. Two rounds each, then settle
it here with *"Sol still objects to X; overruled because Y"*.

### Round 1, on the plan — [260906d-plan-review-sol.md](260906d-plan-review-sol.md)

Verdict: **refuse as written**, on F1, F2 and F4. All eight findings accepted; two of them needed
correcting on the facts rather than on the judgement.

| ID | P | Finding | Disposition |
|---|---|---|---|
| F1 | P1 | The ownership map's `overlays.css` would have gathered non-contiguous sections (floating chat 9375, annotation 9408, diagram dialogs 11172/11603, lightbox 13028, feedback 14591) — the exact prefix-gathering A10 forbids | **Fixed.** One file = one contiguous interval, stated as a rule. The real 37-file cut had already been built that way; the plan's prose had not caught up |
| F2 | P1 | "All z-index declarations stay in one file" is impossible — there are 31, spread through ten sections | **Fixed**, verified: `grep -cE '^\s*z-index:'` = 31. The contract's single home is the *doc*; the declarations stay put |
| F3 | P1 | Relative URLs resolve against the containing sheet, so moving bytes a directory deeper can change their meaning | **Accepted, no instance.** Measured: **zero** `url()` in `styles.css`, and its one `@import` (line 27) stays in `styles.css`. The discipline is written in anyway |
| F4 | P1 | `tailwindcss.compile()` is not the production pipeline — the app builds through `@tailwindcss/vite`, which resolves, inlines and **rebases URLs** differently, and the plan omitted `npm run build` | **Fixed.** Two immutable pre-cut baselines, SHA-labelled; only the Vite artefact is called what the browser receives |
| F5 | P1 | `target \| null` lets an artefact-backed mode typecheck while half-wired, and misrepresents Diagram, which arms via `armActivationForDiagram` | **Fixed.** Tagged union: `fixed` / `delegated` / `none` with a reason |
| F6 | P1 | `{ band: string \| null; says: string \| null }` permits both an empty band and a missing controller; and a raw `textContent` read passes over `aria-hidden` measuring copies | **Fixed.** `NO_BAND_MODES` + a non-nullable table over the remainder; accessible-content reads only; a mutation that deletes the visible body must go red |
| F7 | P2 | Presentation is not "nothing" — `BAND_SAYS` is already total and already on `new-mode.md`'s list. The gap is *owner-side* coverage | **Fixed.** The claim was overstated and is withdrawn |
| F8 | P2 | `no-raw-nul-bytes.test.ts` is git-derived, not a hard-coded list; `styles.css` in it is a coverage *witness*, and the stated completion condition would have deleted it | **Fixed**, verified in the source. It is excluded from the migration and keeps its witness |

Sol's two "resolved" notes match my own spikes: `layer(app)` survives four levels of nested
`@import`, and `npm run typecheck` does cover `tests/`.

### Round 2, on the revised plan — [260906d-plan-review-round2-sol.md](260906d-plan-review-round2-sol.md)

Verdict: **refuse as written**, on F5 still open. **The extraction itself was independently
verified** — Sol re-derived that all 37 slices tile the source, that each parses on its own, that
the concatenation is byte-identical, and that a virtual 37-file Tailwind compilation is *exactly
identical* to the current output. He also declined my two offered retreats: no reason to drop to
~15 files, and no reason to rename `glossary.css`.

| ID | P | Finding | Disposition |
|---|---|---|---|
| F5 | P1 | **Still open.** `{ kind: "delegated"; owner: string }` is documentation wearing a type's clothes — nothing consumes `owner`, so a fifteenth mode typechecks with no arming path. Diagram works only via an explicit `if (m.mode === "diagram")` in `Dock.tsx`. And the shown test contract had no activation expectation at all | **Fixed.** The delegated variant now carries an `arm` **function**; `armActivationForMode(slug, mode, ctx)` executes all three variants exhaustively; `Dock.tsx` loses its Diagram branch; `SPENDS` is an independently written table |
| F6 | P1 | **Still open.** One fixture state cannot serve both contracts: proving a press posts needs a *missing* artefact, but then the controller draws its empty state, so `says` matches chrome and deleting a real renderer leaves the sweep green | **Fixed.** One file and one harness, **two independently configured phases**; `says` must be a fixture-only body literal; the mutation check runs against a *populated* controller |
| F9 | P2 | "Exactly the pairs" and "specificity settles that, not order" are both wrong: distinct equal-specificity selectors compete on one element | **Fixed**, verified: `.gloss-quiet` sets `padding: 1rem 0.9rem` (slice 12); `.tl-thin` (33) and `.dbt-empty` (34) reset it on the same `<p>`. Source order decides, and glossary's earlier position is load-bearing |
| F10 | P2 | The import-only guard is right but its portability rationale is not — `tailwind.css` already puts `@custom-variant` before its own `@import` | **Fixed.** Rationale restated as ownership and visible ordering; the guard strengthened to *every non-comment top-level node is an `@import`*, which "no style rules" would not catch |
| F7 | P3 | The withdrawn "presentation has nothing at all" claim survived in the introduction | **Fixed** |

**Discovery is now closed** (two rounds). F5's and F6's final fixes were not in the round-two
snapshot, so they get a narrowly scoped check *of those fixes* when stage 4's code goes for review —
not a reopening of the plan.

### Round 1, on the code — [260906d-code-review-sol.md](260906d-code-review-sol.md)

Verdict: **refuse**, on four established P1s. Sol found no evidence the split changed the compiled
cascade — *"but its guards are weaker than claimed"*, which is the sentence that matters, and it
was right. **He reproduced every one of the nine by mutating and running**, which is exactly what a
plan-stage review could not have done.

The P2s, all in guards I wrote or touched, all fixed and each verified **mutation-first** —
reproduce, watch it pass, fix, watch it fail (`05ca1d21`, `e5b3772f`):

| ID | Finding | Mutation: before → after |
|---|---|---|
| F15 | **The manifest guard sorted both sides**, so it never checked import order — the one thing it exists to protect. Moving `glossary.css` below `timeline.css` left all four tests green, reversing the `.gloss-quiet` / `.tl-thin` overrides | PASS → **FAIL**. Now compared against a hand-written ordered `MANIFEST`: the list is the expectation, the file the implementation |
| F16 | `startsWith("@import")` accepted an external URL, a path outside `src/web/styles/`, the typo `@important;`, and **`@import "./styles/table.css" print;`** — which makes every table rule print-only | PASS → **FAIL**, and the `print` qualifier alone also fails. Exact shapes now, as an allowlist |
| F17 | The resolver emitted each sheet at the *first* mention with one global `seen` set, so it was neither positional nor duplicate-preserving. Appending `@import "./spine.css"` to `table.css` left 194 tests green while the real build emitted Spine **twice** | PASS → **FAIL** in 7 of 8 suites, plus a new duplicate branch |
| F18 | The aimed-column guard let arbitrary selector suffixes through; `.never` on all eight `[data-aim]` selectors — none of which can match any DOM — stayed green | PASS → **FAIL** |
| F19 | The hue guard checked only `Math.max`. Deleting rules 1–7 and keeping 8 left all 50 annotate tests green | PASS → **FAIL**: `expected [ 8 ] to deeply equal [ 1..8 ]` |

**Two places Sol was wrong, both found by running rather than reading** — the reason CLAUDE.md says
to check each finding yourself:

- **F17's premise.** Sol said the tree has no nested relative imports, which made "ban them all"
  look safe. `styles/tokens.css` imports `./colourscales.css`, and `readerSheets()` walks it. The
  ban landed narrowed to *no relative `@import` under `src/web/styles/`*, plus no file visited
  twice anywhere, with an error message that names which case you are in.
- **A docblock I wrote.** It claimed no relative import in this tree carries a `layer()` suffix.
  `tailwind.css`'s `@import "./styles.css" layer(app)` does, and it is the entire layering
  mechanism this job rests on.

F18's fix also needed `aimed-column.test.ts` moved to the jsdom environment, which broke its
`new URL(…, import.meta.url)` reads — jsdom hands back an `http` `import.meta.url` — so those
became cwd-relative, matching the sibling style tests.

#### `npm run check:staged-revert` cannot read a merge, and says so as four false positives

Worth knowing before somebody trusts it or "fixes" what it reports. Run mid-merge, it flagged
`scripts/deploy.ts` as *"staged content is exactly what this path held before 1481e19"* and three
files as *"staged for DELETION though HEAD still has it"*, plus a wall of
`fatal: path … exists on disk, but not in <sha>^`.

Every one of them was **origin/dev's own deliberate work arriving** — `219c4bc1` "Retire the
SPIDERYARN_STORE tombstone, and the sensor that watched for it" removes `src/store/live.ts` and two
tests and takes `deploy.ts` back to its pre-Stage-F content. Verified before believing it:
`git cat-file -e origin/dev:src/store/live.ts` fails, and `git log origin/dev -- src/store/live.ts`
names the commit.

The guard's premise is the *"commit your own files by name"* flow, where the index should differ
from `HEAD` only by your own edits. During a merge the index legitimately holds someone else's
whole branch, so "this content is older than `HEAD`" stops meaning "somebody's work is being
quietly undone" and starts meaning "the branch you are merging decided to go back". Its verdict is
sound and its interpretation does not survive the context.

Not fixed here, and not written into
[version-control.md](../project/version-control.md) either — that file's wording is a rule, so it
goes through [edit-important-docs.md](../reusable/edit-important-docs.md) rather than being
amended in passing. The suggestion for Greg is one line in the script: if `MERGE_HEAD` exists, say
which findings are incoming rather than staged.

### Round 2, on the code — [260906d-code-review-round2-sol.md](260906d-code-review-round2-sol.md)

The fixes from round one, which no reviewer had seen, plus the second `origin/dev` merge. Eight
findings, **all eight accepted**; six fixed, one recorded, one a correction to the postmortem.

Sol reconstructed the base, ours and theirs bodies himself and re-ran the three-way merge before
judging it, and got matching SHA-256 hashes. A review that checks the evidence rather than the
prose about it is the one worth paying for.

| ID | Finding | Disposition |
|---|---|---|
| F20 | `DiagramPanel.tsx` still said Force is the default picture and that opening bare `?mode=diagram` posts to `/api/similar`. The default has been Sketch since `params.ts` § `DEFAULT_DIAGRAM` | **Fixed.** Flavour 2 again, in the same file that caused F11 — false prose waiting for a test to be written from it |
| F21 | `DRAWS` was keyed `Exclude<Mode, (typeof NO_BAND_MODES)[number]>`, so one list both *excused* a mode from having a row and *skipped* it at run time. A fifteenth mode added to it was checked by nothing at all | **Fixed**, and this was the serious one — the mistake the file exists to prevent, committed one level up. `DRAWS` is now total over `Mode` with a `band` / `none` union, and a `none` row must carry its own positive control. Calibrated: deleting the `plain` row is now `TS2741` |
| F22 | `paidPosts()` deduplicated through a `Set`, so a press that bought the same request twice was indistinguishable from one that bought it once | **Fixed**, and it needed an experiment rather than an edit. Measured: with cardinality kept, exactly one endpoint doubled (Force's `/api/similar`, from a mount effect); with `<StrictMode>` off, all 28 pass with exact counts. So it was the replay and **not** a real double-spend. Phase A now opens non-strict and counts; phase B keeps StrictMode, which is where it earns its place |
| F23 | The import walker recognised `@import "…"` but not `@import url("…")`, so a sheet could import another sheet and both the leaf ban and the duplicate-visit check would miss it | **Fixed.** Calibrated with Sol's own mutation |
| F24 | Nothing stopped a component doing `import "./styles/table.css"`. `client-imports.test.ts` allows any specifier resolving inside `src/web`, and every CSS-side rule only walks `@import` edges — so the *other way in* was unguarded, and a sheet arriving that way is **unlayered**, which beats every layered rule regardless of specificity | **Fixed** with a new guard: the only stylesheet a TypeScript file may import is `src/web/tailwind.css` (twelve files do; no other spelling is legal). Calibrated — and `client-imports.test.ts` stayed green throughout the mutation, exactly as Sol said |
| F25 | The `> 500` positive control proves bulk, not that the sheet under test entered the scan | **Fixed** with a named witness from `table.css`. **And the calibration found a hole in the fix**: my first witness, the scoped `thead` selector, is repeated in `narrow-window.css`, so it survived `table.css` being dropped from the manifest entirely. A unique selector replaced it. The count still reported 1,974 branches while the sheet was absent — Sol's point exactly |
| F26 | The merge oracle proves global byte order, not ownership: moving a rule across an adjacent sheet boundary preserves the concatenation | **Recorded, not fixed.** Correctly identified as a limitation rather than circularity, and it is the right limitation to accept: the oracle exists to prove *the cascade did not move*, which it does exactly. Ownership is what the sheet headers and the nine misfiled sections are for, and neither is a thing a byte comparison can check |
| F27 | The postmortem's class — "a check whose expectation is downstream of the thing it checks" — names one subtype as the whole. Flavours 3 and 4 involve no derived expectation | **Accepted and rewritten.** The class is now an **uncalibrated verifier**, with four stages at which the failing state can be erased: acquisition, normalisation, predicate, expectation. F22 and F25 from this very round are normalisation and acquisition faults, which the old frame could not name — and normalisation joins as a fifth flavour, since a harness artefact answered by discarding information is how it arrives |

Nothing overruled. Sol's judgement that the split's size was "an amplifier, not the root cause" is
accepted too, and it is the argument for merging often rather than for splitting less.

## What actually happened

### Stages 1 and 2 — the extraction, 2026-09-06

**`styles.css`: 15,489 lines → 65.** Its original header comment, its original
`@import "../../styles/tokens.css";`, and 37 `@import "./styles/<name>.css";` lines in the
original order.

Each of the 37 is **a contiguous slice, verbatim, plus a header comment** — and the qualifier
matters. At the moment of the cut every slice was byte-exact, and that is what the concatenation
check proved. Each then gained an ownership header: **286 lines added, zero deleted**, verified by
stripping the headers and diffing the concatenation against `git show HEAD:src/web/styles.css`.
So no rule was altered, moved or dropped — but "byte-exact" stopped being the right word for the
files as they now stand, and saying it anyway would be the kind of claim that survives because
nobody re-checks it.

**The cascade is proved unchanged five ways**, and the last one is the one that counts:

| Check | Result |
|---|---|
| Slices tile lines 29–15489, no gap or overlap | ✓ 37 slices, 40–981 lines each |
| Every cut at brace depth 0 and outside a comment | ✓ all 37; the source's braces balance |
| Concatenating the slices rebuilds the original | ✓ byte-exact |
| `tailwindcss` `compile()` output, before vs after | ✓ identical |
| **`npm run build` shipping CSS, before vs after** | ✓ **identical, md5 `733c807548da26925bd8b120d7c026ac`** |

Vite content-hashes the CSS asset, so the filename staying `main-DxLuWTrd.css` across the split is
independent corroboration: a single changed byte would have renamed it.

**The brace-depth check earned its place.** Byte-concatenation cannot see a cut through the middle
of an `@media` block — the bytes are all still there and still in order, so it rebuilds perfectly —
but each half would be an unparseable fragment in its own file and the browser would drop both.
It is now inside the splitter, so the operation refuses rather than depending on someone
remembering to check.

**The red arrived as predicted.** Immediately after the cut, every one of the thirteen
stylesheet-grepping tests failed. That is the evidence the filename coupling was real rather than
theoretical, and it is what `tests/helpers/stylesheets.ts` was written to fix — the helper resolves
the `@import` graph instead of naming a file, and was verified to be a **provable no-op before the
split** (`readerSheets()` returned exactly `["src/web/styles.css"]`).

**New guard: [`tests/styles-entry-is-imports-only.test.ts`](../../tests/styles-entry-is-imports-only.test.ts).**
Calibrated in both directions rather than merely written:

- appending `@media (max-width: 400px) { … }` to `styles.css` → **red**. This is the case a
  "contains no style rule" check would have passed, and is why Sol's F10 wording (parse the
  top-level *nodes*) is the right guard;
- adding an unimported `src/web/styles/zz-orphan.css` → **red**, from the other direction: a sheet
  nobody imports is dead CSS that nothing else would notice.

Both mutations reverted; `git diff -- src/web/styles/` clean afterwards.

**Baseline suite established as genuinely green.** The pre-change run showed 3 failed / 734 passed,
and all three were environmental rather than real: `cold-start-lazy-imports` and `pdf-bundle-trace`
both want an API bundle to inspect and this worktree had never run `npm run build`; `admin-store`
was Postgres contention and passes alone. So any red after this point is mine.

### A vacuity guard that was satisfied by the rename it existed to catch

Worth its own heading, because it is the whole reason the plan insisted the guards be *calibrated*
rather than merely written.

Adding a guard to `referee-criteria-explained` produced `expect(css).toContain(".crit-how")`.
Renaming the rule to `.crit-how-x` — the exact mutation the guard exists to detect — **left it
green**, because `".crit-how-x"` contains `".crit-how"`. A substring test cannot distinguish a
class from a longer class that starts with it.

Rewritten as `/\.crit-how[\s,{]/` and re-calibrated with `.crit-hoq`, it goes red. `css-tokens.test.ts`
already knew this — its own docblock records two earlier attempts to check a class by grepping the
bundle, one of which *"matched `text-ink` inside `text-ink-faint`"* — which is the same bug, found
twice, three weeks apart, by two different people.

The general shape, for the next person: **a guard written and never run against its own mutation is
not a guard.** Five were calibrated here; four went red first time and this one did not.

### What the split costs: three lint findings the linter can no longer see

Measured with the repo's own `biome.jsonc`, 2026-09-06:

| | errors | warnings |
|---|---|---|
| the single pre-split file | 9 | 42 |
| the 37 split files | 9 | 39 |

**The three that went are not three that were fixed.** `noDescendingSpecificity` compares selectors
*within a file*, and three of those pairs now sit either side of a file boundary. So the split
buys a small, real **loss** of lint coverage — recorded here rather than reported as 42→39
improvement, which is what the numbers say if nobody asks why.

It is not worth reversing for: the pairs Biome can no longer see are the same ones the header
comments now name explicitly (`glossary.css` before `timeline.css` and `debate.css`;
`narrow-window.css` after everything), so what was a silent lint warning has become a written rule
in the file that depends on it. But if a cross-file CSS linter ever becomes available, this is the
reason to want it.

*(The first attempt at this measurement was wrong and is worth recording as a trap: linting the
pre-split file from a scratchpad directory runs it **without** `biome.jsonc`, which reported 1
error and 10 warnings — and comparing that against the in-repo run would have said the split
introduced eight new errors. A linter's baseline is a property of its config, not of the file.)*

### What the split made visible: nine sections that are not where their name says

Giving each file a header meant reading each one against its banner, and **nine of them do not
contain what they claim**. None is a bug and **none was moved** — the whole stage forbids it, and
each is now stated in the owning file's header instead. They are the strongest argument that the
split was worth doing: every one of these was invisible inside a 15,489-line file, and each is a
candidate for a later, deliberate, cascade-aware move.

| File | What is actually in it |
|---|---|
| `footnotes.css` | the last third, from `.gloss-where`, is **Glossary's** tail — where the piece uses a term, the panel foot and its buttons, the *Look up a term* box |
| `diagram-drift.css` | the last ~40 lines are the **dictation microphone** (`.prof-mic-*`, `.spin`), which belong with `profile.css` |
| `ideas.css` | the second half (`.diag-force*`, the link kinds) is the **force-directed graph**, a Diagram sub-mode |
| `glossary.css` | also carries `.srch-gate-*`, **Search's** confidence bar (deliberate; the in-file comment says why) |
| `quotes.css` | also carries `.score-bar*`, **shared with Glossary** via `ScoreBars.tsx` |
| `quiz.css` | also carries the Recall \| Quiz switch (`.remember-submode*`), which is **Remember's** head |
| `dock.css` | also carries `.logo-home` — the opposite, top-left corner |
| `feedback.css` | ends with the comment-only `metadata` section: zero live rules, kept as a diagnosis note |
| `prose.css` § `outline` vs `outline-mode.css` | **two different features sharing one word** — the table with its text column off, versus the `.outln-*` band panel |

**Browser baseline captured before the cut**, in dev mode, on the unsplit tree — all 10 surfaces at
1280×900 and 390×844 with `getBoundingClientRect` and `getComputedStyle` for a named element list
each. Two "not found" entries were checked rather than assumed: `.gist .sticky` is genuinely absent
under Hierarchy's default auto-fit (`TableView.tsx` renders `.sticky` only for a gist cell *not*
under a fisheye panel), and a visitor's public article opens in Plain, which has no band.

### Stage 3 — the browser, 2026-09-06

All 10 surfaces recaptured in dev mode against the same two article slugs, and compared to the
pre-split baseline:

- **computed styles: 0 differences**, across every measured property, selector and viewport;
- **root variables** (`--dock-h`, `--spine-w`, `--logo-w`, `--feedback-w`): identical everywhere;
- **rects: identical** on all 10 surfaces at both widths, with one apparent exception;
- **screenshots**: a real pixel diff (no ImageMagick on the box; Python PIL instead), 0.00–0.24%
  differing pixels, and `10-landing` desktop byte-exact at **0**.

**The one exception is not one.** `.annotate-dialog` on mobile moved `y` 547.78 → 525.05 and grew
`height` 244.22 → 266.95. But **547.78 + 244.22 = 792.00 and 525.05 + 266.95 = 792.00**: the
bottom edge is pinned to the same pixel in both runs and only the content height changed. The
dialog is positioned off a live text-selection rect produced by a scripted drag, so the selection
differed slightly between runs. A cascade change would have moved the anchored edge; this did not,
and the computed styles for that element were identical.

**And the hypothesis this stage existed to test was disproved, which is the useful part.** The
reason to look at dev mode at all was that it serves CSS through a different pipeline than the
build, so a 37-file `@import` chain might behave differently there even with a perfect production
bundle. It does not: **dev serves exactly one app stylesheet request**, because
`@tailwindcss/vite` resolves the whole chain server-side in dev just as it does in a build. There
are no chained requests to fail. 0 CSS 404s, 0 console errors, 0 page errors.

So the split carries no dev-mode cost, and the reason is worth keeping: *the number of files is
invisible to the browser in both modes.*

### Stage 4, part 1 — activation is total and executable, 2026-09-06 (`a5fbf4f1`)

`MODE_TARGET` is now `Record<Mode, ModeActivation>` over the tagged union: `fixed` carries a
target, `delegated` carries **an arming function** and a `why`, `none` carries a reason in a
sentence. `armActivationForMode(slug, mode, ctx)` executes all three and ends on a `never`, and
**`Dock.tsx` lost its Diagram-only `if`** — one call now, for all fourteen (20 lines, two hunks, on
ground the structure-mode job also holds).

**Referee and Remember are `none`, not `delegated`** — and that is a correction to this plan, which
had assumed `delegated`. Each opens on a sub-mode that waits on somebody's own words (Criteria,
Recall; both confirmed as the defaults in `referee-views.ts` and `params.ts`), so a `delegated` row
would carry a function that arms nothing — exactly the shape the union exists to refuse. Their
chips arm one level down, as the original docblock always said.

Both mutation checks went red and were restored: `timeline → {kind:"none"}` failed *"runs the
timeline"*; stubbing Diagram's `arm` failed both sketch tests.

**Found, pre-existing, and deliberately not fixed: Referee has Diagram's bug in miniature.**
`?referee=` is persistent query state like `?diagram=`, so pressing Referee in the bar while
`?referee=claims` survives lands the reader on the paid Claims panel with **nothing armed** — they
must press the in-band button themselves. It runs in the *safe* direction (a missing arm, not a
spend nobody asked for), which is why it is a papercut rather than the P1 the Diagram version was.
Recorded here rather than fixed, because it is not this job's ground and the fix wants its own
evidence.

Two smaller notes: `armActivationForDiagram` now has no importer outside its own file and is kept
exported because three docs and two hooks cite it by name; and `Dock.tsx`'s prop docblock, which
said the diagram kind is read there *"rather than a `MODE_TARGET` row"*, was made stale by this
change and is corrected — Diagram now **is** a row, a delegated one that consumes exactly that
value.

## Left undone

Everything A10's stage asked for is done. These are things the work **found** and deliberately did
not do, each with what it costs to leave it. None of them blocks anything.

**Found and left, because moving them is a cascade change and this job was an extraction:**

- **Nine sections are not where their name says** — [§ What the split made visible](#what-the-split-made-visible-nine-sections-that-are-not-where-their-name-says)
  lists them. `footnotes.css` ends with Glossary's tail, `ideas.css`'s second half is the force
  graph, `dock.css` carries `.logo-home`, and `prose.css § outline` and `outline-mode.css` are two
  different features sharing a word. Cost of leaving: the sheet name misleads an editor for exactly
  those nine. Fixing one is a one-file move plus a browser check, and each is independent — good
  work for somebody with a spare hour, and **not** a batch.
- **Three `noDescendingSpecificity` findings the linter can no longer see**, because the pairs now
  straddle a file boundary. This is a real loss of coverage, not three bugs fixed — recorded in
  [§ What the split costs](#what-the-split-costs-three-lint-findings-the-linter-can-no-longer-see).

**Defects found while looking at something else, none of them A10's ground:**

- `css-tokens.test.ts` has a sheet-order defect of the same family as the ones fixed here.
- Two `§` anchors cited in docs that have **never** existed in the file they name.
- Referee's miniature Diagram, and two `/design` geometry defects — product-visible, so
  [design-css-overview.md](../project/design-css-overview.md) is where a fix argues itself.
- `src/web/layout.ts` could join `SHARED_WITH_READER` in `tests/eager-client-graph.test.ts`, which
  would let `DesignPage` import `MODE_MIN` instead of mirroring it as `--mode-w: 288px`. `App.tsx`
  already loads `layout.ts` eagerly, so it is free.

**Two rule changes that need Greg, because their wording is a rule:**

- The postmortem's recommendation 1 — *paste the guard's red message into the commit before landing
  it* — is not written into [silent-success.md](../reusable/silent-success.md). That is
  `docs/reusable/`, which [edit-important-docs.md](../reusable/edit-important-docs.md) routes one
  approved change at a time.
- `npm run check:staged-revert` cannot read a merge, and reports every incoming deletion as a
  staged revert — [§ the guard that cannot read a merge](#npm-run-checkstaged-revert-cannot-read-a-merge-and-says-so-as-four-false-positives).
  One line in the script fixes it: if `MERGE_HEAD` exists, say which findings are incoming. Left
  alone because the wording lives in [version-control.md](../project/version-control.md). **This is
  the one with a sharp edge** — the next agent either trusts a false alarm, or "fixes" it by
  undoing somebody else's deletions.

**Accepted limitation, not a defect:** the merge oracle proves cascade order, not ownership (F26).
A rule moved across an adjacent sheet boundary preserves the concatenation. That is the right thing
to accept: ownership is what the sheet headers are for, and no byte comparison can check it.

---

Up: [260905e-main-app-architecture-review.md](260905e-main-app-architecture-review.md)
