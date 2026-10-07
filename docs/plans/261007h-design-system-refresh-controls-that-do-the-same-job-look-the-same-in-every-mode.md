# Design-system refresh: controls that do the same job look the same in every mode

**Status: planned, 2026-10-07. Session `fbrgq3f6-design-consistency`. Report `spya-rgq3f6`,
queue item `qi-9sv8cha4`.**

Up: [261007a-ui-sweep-umbrella.md](261007a-ui-sweep-umbrella.md) § For Greg, whose three
questions this builds.

## What it is for

Greg's report, 2026-10-06 (`spya-rgq3f6`, filed from `/changelog`):

> I don't know if we have much of a design system, but maybe this is a good moment to update it.
> See the slash admin slash design. We don't have to adhere to that. We could update that to be in
> line with our current best practices. But I think I'm just trying to sort of look for a tiny bit
> more consistency across modes and in various places, and to use this as a moment to reflect, you
> know, take screenshots, perhaps get input from other agents with different product manager or
> user designer or user personas, perhaps also GPT Soul, and then make a minimal update to
> agents.md and/or design docs to try and ensure that going forward we adhere a bit more to
> whatever revised design system you come up with. Hopefully we don't need major revisions. I'm
> just looking for polish.

And his answers to the UI sweep's three questions, relayed by the Overseer, 2026-10-07:

> yes A probably controls that do the same job should look the same in every mode, though use your
> judgment. and make a minimal update to docs about aiming for consistency. the agent should take
> screenshots for itself, but no need to show me screenshots. just proceed autonomously

> yes to all as you see fit

(The second, for both question 2 and question 3.)

**Polish, not a redesign.** Every family below moves an outlier onto a design the app already has;
none invents a new one.

## What "the design system" is here

There is no separate system and this plan does not make one. It is four things that already exist,
and the refresh is to make them agree and be seen:

1. **The tokens** — `styles/tokens.css` (brand, both themes) and `src/web/styles/tokens.css`
   (semantic names). Colour is settled and tested.
2. **The shared pieces** — `ModeSurface`, `JobProgress` (shadcn `Button` outline/sm),
   `OrderGroup`, `ThresholdSlider`, `ReadError`, `useSlow`, `.close-x`. The drift is in the modes
   that predate a piece and were never moved onto it (the umbrella's § One level up).
3. **The docs** — [design-css-overview.md](../project/design-css-overview.md) and
   [controls.md](../project/controls.md).
4. **`/design`** — the live page. Today it draws tokens, faces, buttons, job progress, mode
   surfaces, toggles, focus, icons, rhythm, prose marks and the wordmark. It draws **none** of the
   recurring controls that drifted: part-switchers, text boxes, order chips, tap targets, shadows,
   the signed-out bar.

## The families, in order

Each family: merge `origin/dev` first; one Opus builder; red-first where behaviour changes, a
before/after screenshot and measurement where only pixels do; GPT Sol code review (write-capable,
fixes inside the family); my read of the diff; gates; one commit; push to `dev`.

The code map behind every row is in § Evidence. Line numbers drift; locate by content.

### F1 — The loading line (Q1)

Today: Chat's list, Search's saved searches and the dock's comments wait 600ms, then show a 13px
`LoaderCircle` and a sentence in a `role="status"` row (`ChatListLoading` in `ChatPanel.tsx`).
Thirteen bands print a bare grey sentence at once with no role (`.gloss-quiet`, `.quotes-quiet`,
`.summ-quiet`: Glossary, Ideas, Timeline, Skim, FAQ, Citations, Tweets, Quiz ×2, Debate, Criteria,
Claims, Quotes, Simple). Diagram's Sketch and Illustrated, and Search's first answer, show a
spinner or sentence at once.

Change: lift `ChatListLoading` into one shared `BandWaiting` (useSlow + `role="status"` +
`LoaderCircle.cmt-spinner` + the caller's sentence, keeping the caller's padding class), and move
the thirteen bands, Diagram's two and Search's first answer onto it. Search keeps its `--hit`
coloured spinner (search's own hue, on purpose). Visible change: a small spinner joins each line,
and a fast load shows nothing for 600ms instead of a flash of grey text.

**Only waits move.** A "not made yet" sentence ("Nobody has read the chronology out of this one
yet") is the page, not a wait, and must still appear at once; the builder sorts each `.x-quiet`
call site into one kind or the other (the designer persona). The 600ms is the house rule
([loading-spinner.md](../project/loading-spinner.md)), not a new one; the reader persona worried a
blank half-second looks broken, which is the trade that rule already made.

### F2 — The part-switcher (Q1)

Model: Summary's joined bar (`.summ-views` / `.summ-view-btn`, a radiogroup), which Greg chose on
2026-10-03 and Debate already shares. Move **Structure**, **Referee** and **Learn** onto it (their
own rules go; Referee keeps its `display: contents` wrapper by a modifier; Learn keeps its
four-chip tightening). **Diagram** and **Search** take its shape; their "on" state is decided in
§ Judgement calls. Structure gains the 44px coarse-pointer floor Summary has, which closes one of
Q2's small targets.

Also, from the personas:
- **Position.** Learn's bar sits right-aligned in its header; every other mode's sits at the left.
  It moves left.
- **Narrow windows.** A joined bar cannot wrap gracefully, and at 390 Diagram's fifth chip and
  Referee's "Notices" already fall onto a line of their own. At narrow widths the bar scrolls
  sideways inside itself, as `OrderGroup` does on touch, rather than wrapping; the builder checks
  Diagram, Referee and Learn at 390.
- **Referee's second row** under its text box (Find passages / For–against / Check the literature)
  is in the old pill style. The builder reads what it is: a choice of part takes the bar; an
  action takes F3's button.
- **Skim is exempt**, in writing: its ‹ › is the mode's main control and was made 44px at Greg's
  request (2026-09-28), so it is a pager, not a part-switcher.

The shared rules move from `summary.css` to `mode-band.css` under the same names (as K5 kept
`.gloss-*`), so a renamed class does not ripple through twenty tests.

### F3 — Text boxes and run buttons (Q1)

- **Run buttons:** Referee's `crit-run`, `clm-run`, `mir-run`, `cnd-start-btn`, `cnd-send` and
  Search's `find` (`srch-go`) become shadcn `Button` outline/sm, the 32px, 8px one `JobProgress`
  already draws in nine modes. Old classes stay as test hooks. `crit-run` keeps `aria-disabled`.
- **Text boxes in the bands:** the nine take the majority values: border `--rule-strong`, corner
  `var(--radius)`, ground `--page`, one padding (`chat-input`'s). Outliers today: `cnd-box`,
  `crit-text`, `quiz-answer`, `ill-steer-input` (border/corner), `skim-purpose-input` (5px,
  raised ground, border-colour focus). The 16px iOS floor in `narrow-window.css` is untouched.
  The off-band boxes (shelf, Help, sign-in, all `rounded-md`) already agree with each other and
  stay.

### F4 — Order chips, failure colour, the signed-out bar (Q1)

- **Order chips:** `.gloss-sort-btn` (6.4px corners) and Search's `.srch-sort-btn` (10px) take one
  corner and one "on" ink. Search's row keeps its own wrapping (`display: contents`), as K4 decided.
- **Failure sentences:** four colours today (orange `--highlight-ink`, red `--destructive`, plain
  ink, grey). All take `--danger`, the error-text token K1 added and the palette test holds at
  4.5:1 on every surface. `--color-danger` joins the Tailwind bridge so `tw:text-danger` exists
  (and `css-tokens`' text guard still passes). Fills (destructive buttons) stay `--destructive`.
- **The signed-out bar:** Help, Changelog, Privacy, Contact and Open source draw a small home icon
  where Home, Features and Pricing draw the full `SiteNav`. Signed out, they draw `SiteNav` too,
  as Sign-in already does; their 24px titles stay (they are documents, not heroes).

### F5 — Phone and keyboard (Q2)

- **Hit areas:** one shared class generalising `.close-x::after` (an invisible target of at least
  40px wherever there is a finger, drawn the same size) on Quotes' "why", the passage links
  (`.block-ref`), /profile's and Metadata's section headings (`PageSection`), "Forgot your
  password?". Where two would overlap (Quotes' "why" buttons, 20px apart) the row grows instead.
  `.close-x` itself is not touched (`close-cross.test.ts`).
- **Skip to modes:** a visually-hidden-until-focused link, the first Tab stop in the reading view,
  that moves focus to the checked mode radio in the dock.
- **Marketing fade-ins reveal once and stay:** today a CSS scroll timeline, reversible by nature.
  An `IntersectionObserver` sets `data-shown` once; CSS hides only what has not been shown, and only
  when the script is running, so without it everything is visible.

### F6 — Wording, faint grey, light shadows (Q3)

- **Wording:** "one model pass" → "one model call"; "this piece" → "this one" in reader-visible
  not-made-yet lines. The run verbs stay.
- **Faint grey on raised surfaces, dark:** `--ink-faint` is 4.44:1 on `--surface-raised`. Lighten
  dark `--muted-foreground` one step (0.63 → 0.64: 4.62 raised, 5.88 page), with the palette test
  gaining the raised pair first, seen red. The passage-id chips in Learn stay faint.
- **Light-theme shadows:** two tokens, `--shadow-pop` and `--shadow-dialog` (and the large-surface
  one), with lighter light-theme values in the spirit of the marketing pages' `--site-lift`; the
  literals in about fourteen rules and two Tailwind strings use them.
- Debate, Chat and Learn keep printing their own names.

### F7 — `/design` and the docs

- **`/design` gains a "Controls across modes" section**: **one canonical example per family**,
  drawn from the real component or class, not a copy of each mode's variant (the designer persona:
  the page is already ~12,800px tall, and a copy per mode is a second thing to keep current). For
  each: its states (off, on, hover, focus, disabled), its size for a finger, a "used by" line
  naming the modes, and its one-line rule. Families: part-switcher, run button, text box, order
  chips, the loading line beside the not-made-yet line and the failure sentence (so the three are
  told apart at a glance), the hit area, the two shadow tokens. A short checklist at its head for
  whoever adds a mode. It answers the umbrella's § One level up: a seventh design arriving is
  something you see by opening one address.
- **Docs:** a few plain lines in [controls.md](../project/controls.md) recording the aim, with
  Greg's words, and naming the canonical piece for each family; one line pointing to it from
  [design-css-overview.md](../project/design-css-overview.md). Greg approved this update.
- **AGENTS.md:** a one-line proposal, shown to Greg by edit-important-docs.md, not applied.

## Judgement calls

- **Diagram's and Search's "on" colour: neutral, like Summary's.** The rule worth writing down
  (designer persona): **orange marks the mode; a part within it is marked neutrally.** In
  `diagram-sketch-1440-light` the Sketch chip and the dock's Diagram tab are the same orange, so
  two levels of choice read as one. Search's blue stays on its hits and spinner, where it means
  "a search result"; on the matcher it only marks which kind of search is chosen. The reader
  persona found Search's "on" the hardest to see of all. The product-manager persona would have
  kept Search's blue as the mode's identity; overruled for the reason above, and the raised fill
  is checked visible in both themes before landing.
- **Diagram's failure sentence takes `--danger`, not grey.** Its comment argues a picture that was
  not made is no cause for alarm; but grey is how every band prints "not made yet", so a grey
  failure is indistinguishable from never having asked (designer persona). The wording stays calm;
  the colour says it failed. The product-manager persona preferred grey; overruled on that ground.

### F8 — If time: two the personas found

- **The voice row.** Chat shows a bare mic, "Live" and a Realtime menu; Learn shows the mic with
  "Talk", "Live conversation" and the menu, and at 390 Learn's Send drops to a line of its own.
- **Diagram's pager** (⌃ 1/24 ⌄, two half cells, mismatched borders) takes Quotes' and Skim's
  ‹ n › shape.

Each gets its own queue entry if not built.

## Not in this job

- **Font sizes across modes** (`qi-f8h393sb`) — not answered by Greg. The debrief says whether one
  change would cover both.
- **Native `title` tooltips** (`qi-3rpkfhd8`) and **text buttons to icons** (`qi-zkt2mtf9`):
  their own queue entries.

## Evidence

The code map (a subagent, read-only) and the baseline screenshots are in the session scratchpad;
their conclusions are summarised in each family above. Personas: § Persona reviews.

## Persona reviews

Three subagents, each shown the baseline screenshots (~115, every mode and sub-mode at 1440 in
both themes, seven at 390, /design, the shelf, the signed-out pages; article
`fd-src-nagel-bat-spya-f5aw85`) and this plan's first draft. Their findings are folded in above;
what each said in short:

- **Designer (Opus).** Agreed with every model. Added: only waits move in F1; Skim is a seventh
  switcher (exempted); joined bars at 390; Learn's position; Referee's second row; neutral "on" for
  parts with orange for the mode; Diagram's failure in `--danger`; `/design` as one canonical
  example per family rather than every mode side by side. Would have cut the fade-in rewrite, the
  skip link and the "this piece" wording, and queued them; **kept**, because Greg approved all
  three by name and each is small.
- **Product manager (Sonnet).** Ranked wording, the signed-out bar and failure colour as the most
  value for the effort and F2 as the riskiest: keep position, order and labels and change only the
  skin. Would have kept Search's blue and Diagram's grey (both overruled, § Judgement calls).
  Said Help is reachable from nowhere signed out; **false** (Sol R14: `SiteFooter` links Help on
every marketing page, and `SiteNav` has no Help link), so the full bar is for consistency, not
discovery. Suggested one
  template for every not-made-yet line ("Read once and kept" against "Written once and kept");
  **not taken**, because Greg asked to leave the verbs, which read as chosen per mode.
- **Reader (Sonnet).** Five looks for one switcher; Search's "on" barely visible; Search's
  "find" looks disabled; Referee's actions look like option chips; grey text cannot be told apart
  as waiting or empty; small targets on the phone. Would notice F2, F3, F5's hit areas and F1's
  spinner, and would not notice the rest. Worried a blank 600ms looks broken (§ F1).

## What GPT Sol's plan review changed

[The review](261007h-design-refresh-plan-review-sol.md), read-only: **ready with these fixes**,
twenty findings (R1–R20), no P0 or P1. All accepted; how each lands, as a rule for the builder:

- **F1.** R1: also Candidates' "opening…", Diagram's projection wait and Illustrated's per-image
  "Fetching the picture…"; Search's partial-results spinner and its "thorough" indicator are
  **exceptions** (they sit beside usable results in a fixed geometry). R2: `BandWaiting` mounts its
  `role="status"` container at once with the caller's geometry, fills it after 600ms, and its
  spinner is `aria-hidden`. R3: timer changes only where a test reads loading text, and each such
  test also checks the line is absent before the threshold.
- **F2.** R4: Referee's chips become a boxed group (no longer `display: contents`) with Notices
  beside it, wrapping below it when narrow. R5: **every old class stays as a hook**, and the
  keyboard contract stays (every choice tabbable, arrows belong to the article,
  `arrows-belong-to-the-article.test.tsx`); Learn keeps `aria-pressed` — appearance only, no role
  change. R6: Referee's Find passages / For–against / Check the literature row is a radiogroup
  choosing a criterion's kind, so it **takes the bar** (not a run button); Skim's `.skim-depths` is
  a real part-switcher and takes the bar's neutral "on" (its pager stays exempt). R7: the sideways
  scroll at narrow widths keeps the chosen part in view the way `OrderGroup` does (its reveal logic
  extracted into a shared hook rather than copied), buttons do not shrink, the corner icons keep
  their room; checked at the 288px band as well as 390.
- **F3.** R8: the field census includes Criteria's two `.crit-poles` inputs; Chat's rename and
  edit boxes and `ProfileBox` are **excluded** (inline editors, and an off-band component shared
  with /profile and Metadata). R9: `aria-disabled` on Criteria's run keeps its unavailable look and
  no enabled hover, without `pointer-events: none`; button types, guards, the 16px field floor,
  autosizing, resize and `voices.css` survive. R10: Glossary's find/add-term and Dig deeper run
  controls join; Unhide, navigation and Ask in chat stay `.gloss-btn`.
- **F4.** Split into **F4a** (order chips, failure colour) and **F4b** (signed-out bar). R11:
  failure colour goes on failure-state selectors only; shared wait/empty/failure classes in Diagram
  and Illustrated are split first. R12: the builder enumerates every site before changing one
  (JobProgress and Tweets included); `danger` is a text token and stays out of `NON_TEXT_TOKENS`;
  `css-tokens` and `tailwind-utilities-resolve` both run. R13: the signed-out bar reuses
  `SignedInShell`, sits outside the narrow document column in a `.site` scope, accounts for the
  top padding, handles `/privacy` linking to itself, and leaves `SITE_NAV_ROUTES` alone (signed-in
  corner Feedback unchanged).
- **F5.** Split into **F5a** hit areas, **F5b** skip link, **F5c** fade-ins. R15: adjacent passage
  links (`BlockRange`, `Cited`) and wrapped lines must not have overlapping targets: grow the
  layout or bound the target, exclude spans with no id, and check who owns a tap at the edge. R16:
  the fade-in hides only while the observer is running and the reader allows motion; print,
  reduced motion, no `IntersectionObserver` and a failed start all show everything; it cleans up
  and restarts across client-side navigation.
- **F6.** R17: the grey is lightened **globally** (dark `--muted-foreground` 0.63 → 0.64), which is
  broader than "on raised surfaces" and is recorded as such; the simpler change, and it covers the
  next raised surface too. It does not fix text drawn at reduced opacity, and is not claimed to.
  R18: three elevation tokens, `--shadow-pop` (tooltips, menus, popovers: four `tw:` strings in
  `TagEditor`, `ShelfTags`, `DataTable`, `menu.ts`, plus the CSS rules; `CommandBar`'s
  `tw:shadow-lg` too), `--shadow-dialog`, `--shadow-sheet` (profile, feedback, lightbox); swatch
  rings, inset marks and table dividers are not elevation and are left.
- **F7.** R19: one canonical example per family cannot by itself show a new caller drifting, so
  the claim is narrowed, and F7 adds a small check that the moved callers stay moved (the builder
  picks the cheapest honest one). The existing loading example on /design is updated, so the page
  does not teach both. F7 goes last.
- **F8.** R20: Learn's "Talk" label is deliberate; Diagram's pager steps vertically, keeps
  unavailable buttons tabbable by `aria-disabled` and has a focusable readout. Borrow dimensions,
  not meaning.

## Order and waves

Two builders at a time at most (the box is busy), never two on one file:

| Wave | Builder A | Builder B |
|---|---|---|
| 1 | F1 loading line (panels) | F4b signed-out bar + F5c fade-ins (site pages, `site.css`) |
| 2 | F2 part-switcher | F5b skip link + F6 grey and shadows (`Reader`, `Dock`, tokens, popover CSS) |
| 3 | F3 run buttons and text boxes | F5a hit areas |
| 4 | F4a order chips and failure colour + F6 wording | — |
| 5 | F8, if time | — |
| 6 | F7 `/design` and docs | — |

## Review status

- Plan: [GPT Sol](261007h-design-refresh-plan-review-sol.md), read-only, **ready with these
  fixes**; all twenty applied above. No second round: the fixes narrow or specify, and each
  family's code gets its own review.

## What landed

Builders shared this worktree two at a time on disjoint files; the orchestrator committed each
family by pathspec.

- **F4b + F5c — signed-out bar, fade-ins** (`143fdb199`, Sol's fixes `32be0fb09`;
  [review](261007h-f4b-f5c-code-review-sol.md), ready with these fixes). The five document pages
  go through one `DocumentPage` shell: signed out, `SiteNav` (outside `<main>`, in a
  `display: contents` `.site` scope, `/privacy` dropping its own link); signed in, unchanged. The
  fade-ins are `reveal-once.ts`: a section below the window waits, rises once on entering, and is
  never watched again; print, reduced motion, no observer or a failed start show everything.
  Measured: scrolling `/features` back up, every section stayed at opacity 1. **Sol found two
  P1s:** the new bar sat inside a phone's notch (fixed: the inset is padded, subtracted from the
  floor and added to anchor offsets; a browser check with a 47px inset put the wordmark at 63px);
  and the `-8%` bottom root margin resolves against the viewport's *width*, so a wide short window
  could leave a section hidden for good (fixed: the whole viewport). Postmortems
  [261007h](../postmortems/261007h-a-shell-substitution-kept-the-links-and-lost-their-geometry.md),
  [261007i](../postmortems/261007i-an-observer-double-discarded-the-options-that-controlled-visibility.md).
  **What the plan had wrong:** a single root flag hiding every section would have hidden a late
  section forever; each waiting section is marked instead.
- **F5b + F6 — skip link, grey, shadows** (`6f357c3e5`, Sol's fixes `aa75c4947`;
  [review](261007h-f5b-f6-code-review-sol.md), ready with these fixes). "Skip to modes" is the
  first Tab stop and lands on the checked mode (or the first, when the open mode lives under
  More). Dark `--muted-foreground` 0.63 → 0.64: 4.44:1 → 4.62:1 on a raised surface, the palette
  test's new pair seen red. `--shadow-pop`, `--shadow-dialog`, `--shadow-sheet` in
  `src/web/styles/tokens.css`: dark byte-identical to the old literals, light ~0.35–0.4 of the
  alpha; the command bar moved from `tw:shadow-lg` to `--shadow-dialog`, a visible change in dark.
  **Sol found one P1:** pressing the link during the dock's one-second entrance did nothing
  (fixed; a browser check with animations slowed confirmed focus lands and the dock shows).
  Postmortem [261007j](../postmortems/261007j-navigation-tests-replaced-the-destinations-lifecycle.md).
  **Left (D5):** six more elevation shadows (docked chat, the Ask chip, the gutter, the dock
  drawer, the mode herald, chat's latest pill) have their own silhouettes and keep their literals.
- **F1 — the loading line** (`cd1db5533`, fixes `5fb8b4783`;
  [review](261007h-f1-code-review-sol.md), **not ready** on E1, fixed by the orchestrator).
  `BandWaiting` is the one wait: an empty `role="status"` box at once, then after 600ms an
  `aria-hidden` 13px spinner and the sentence. About twenty waits moved onto it. Not-made-yet
  sentences stay immediate; so do lines that answer a press (Referee's "Reading the paper…",
  Search's first answer), which pass `delayMs={0}` — the house exception for a turn already sent.
  **Sol's P1s:** Search's first answer was gated though it answers a press (E2); Illustrated
  mixed a known empty state with a wait (E3); an image plate inherited the previous fetch's timer
  (E4); and **E1**, the empty box was only its padding tall, so the band grew by a line when the
  words arrived. Sol wrote a Chrome test (eleven callers, 280 and 360px) but could not run Chrome
  in its sandbox, so left E1 unfixed; red here at 32 vs 56px. Fixed by laying out the same
  spinner and sentence unseen before the threshold, the words as CSS `content` so the live region
  has nothing to announce early; green for every caller. Postmortem
  [261007k](../postmortems/261007k-a-shared-wait-still-belongs-to-one-request.md). **Left (E7,
  pre-existing):** Learn's Start over shows "Fetching your Learn conversation…" while the old one
  is being deleted.
