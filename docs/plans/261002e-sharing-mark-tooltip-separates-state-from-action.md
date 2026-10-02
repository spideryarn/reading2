# The sharing mark's card says the state, what sharing means, and where pressing goes, apart

Report `spya-d886ah`, from Greg (an admin, so trusted input), 2026-10-02, on
`/read/s41598-023-33209-9-spya-hxekgz`:

> The "Only you can read this. Share it with anyone" is a very confusing tooltip.
>
> One sentence is a statement of the current state. The other is a potential action. But there's no
> explanation of what this means or how this functionality works, or any UI differentiation between
> these two kinds of sentence.
>
> Do some web research on UI best practices for this kind of thing, consider whether we could have
> an action within the tooltip, and how to improve our UI text, and then update docs & prompts for
> UI text and tooltips, improve this particular tooltip, and look for other tooltips/UI text that
> should also be improved.
>
> — Greg, 2026-10-02

Plus three items the Overseer added to this session:

- **C7 from the Help-page review** ([261002b-help-page.md](261002b-help-page.md)): a visitor to a
  shared article sees the owner's notes in the gutter under a tooltip that says *"Your note on this
  paragraph"*. Fix it red-first, and check the other owner-versus-viewer wording.
- **Q10**: an action inside a card needs a card the pointer can enter. Greg said yes to trying it;
  the `hover-cards-clickable` session is adding the prop to `Tooltip`. **It is not on `dev` as of
  this plan**, so this builds the version that does not need it.
- **A stale header comment** in `src/web/shared-inventory.ts`: it lists the owner's comments among
  what stays private, and it calls the tweet thread an artefact with no mode. Both stopped being true
  (comments crossed on 2026-09-04, Tweets became a mode on 2026-09-29).

The research is
[261002b-tooltip-text-state-versus-action.md](../research/261002b-tooltip-text-state-versus-action.md).
In one line: products word a privacy state as a one-word label plus one sentence about who can see
it, and never append "go and share it" to that sentence; an action is a control, or at least a line
set apart that says what pressing does.

## Prior work checked

- `docs/plans/`: `260904b-sharing-mark-on-the-article-masthead.md` built the mark;
  `260906g` and `260930h` touched sharing copy. None addressed the state/action mix.
- `docs/user-feedback/`: no earlier report on this card.
- `gjd-remote ls`: this session (`fbd886ah-share-tooltip-and-ui-text`) is the only one on it;
  `hover-cards-clickable` is Q10's builder, not this.
- `git log origin/dev`: nothing since on `SharingMark` or the gutter's mark title.

## What changes

### 1. `ControlTip` gets a `press` line

A fourth, optional paragraph: **what pressing this control does, or where it goes**, last in the
card, styled apart (a rule above it, full ink, an arrow before it), so the action is visibly a
different kind of sentence from the state and the explanation. `head`, `what` and `how` stay
statements.

Not the `tap` slot: that is *"tap again to do it"*, about the gesture on a touch device, and its
docstring says it is only ever that shape.

### 2. The sharing mark's card

| | Private | Shared |
|---|---|---|
| head | Private | Shared |
| what | Only you can read this. (`SHARING_OFF`, unchanged) | Anyone can read this without signing in, and it's listed publicly. (`SHARING_ON`, unchanged) |
| how | **New:** what sharing would do, and that nothing goes before you have seen the list and confirmed | Unchanged: taking it down refuses the next request and no more |
| press | **New:** Press to go to the Metadata page, where Share… starts it. | **New:** Press to go to the Metadata page, where you can stop sharing. |

`SHARING_MARK_PUBLIC` and `SHARING_MARK_PRIVATE` (the state with an action glued on) go; the state
is the shared `SHARING_ON`/`SHARING_OFF` again, so the masthead, sharing card and shelf badge still
say one sentence between them.

The private `how` is the explanation Greg says is missing. Its claims are checked against
`ALWAYS_SHARED`/`NEVER_SHARED` and `SHARING_OPEN_TIP` in `src/messages.ts`: a public page, readable
without signing in, listed publicly, carrying most of what the AI made (Chat, Remember and
Referee stay behind, hence *most*) and the owner's comments, and a confirmation with the full list
before anything goes.

The accessible names (`SHARING_MARK_NAME_*`, *"Private — change who can read this"*) stay: a link's
name is its state and destination, which is what GPT Sol's 2026-09-04 finding asked for.

### 3. The Archive mark beside it

Same defect, found by the sweep: *"Off your shelf. Press to put it back."* and *"Press to archive
it: off your shelf, and reversible."* The state stays in `what`; the press moves to `press`.

### 4. The gutter's note mark, from the viewer's side (C7)

`BlockGutter`'s mark says *"Your note(s) on this paragraph"* to everyone. A visitor's notes are the
owner's. `TableView` and `BlockGutter` get a required `notesBy: "you" | "owner"` (required, so no
caller can inherit the owner's wording by default — that default is the bug), passed by `Reader`
from `owner`. The visitor's words follow the drawer's existing phrase, *"whoever added this
article"* (`Dock.tsx` § `NOT_A_MODE.visitor`): *"A note from whoever added this article"*.

Red first: a `block-gutter` test mounting the mark as a visitor and asserting the title and name do
not say *your*.

The sweep checked the rest of the margin and comments for the same defect: the marginalia column is
neutral, the comment dialog's editor and the command bar are owner-only, and the drawer heading was
fixed on 2026-08-28. Nothing else to change.

### 5. The glossary card's Hide button

*"Hide this term from your glossary and the underlines — only for you. Unhide it from the
glossary's Hidden list."* A `title`, so no `press` line; the fix is to keep it a statement: *"Hides
this term from your glossary and its underlines, for you only. The glossary's Hidden list brings it
back."*

### 6. The stale comment in `shared-inventory.ts`

Made to match `ALWAYS_SHARED`/`NEVER_SHARED`: comments and notes on the shared side, the arc as the
one artefact that crosses with no mode, the tweet thread through the sweep.

### 7. Docs

- `tooltips.md` gets a line under `ControlTip` describing `press`. The **rule** (state and action never
  share a paragraph) is a change to what a rule doc says, so it is proposed to Greg with before and
  after in the final message, not applied
  ([edit-important-docs.md](../reusable/edit-important-docs.md)).
- `research.md` signposts the research doc; `docs/user-feedback/` gets the note.
- "Prompts for UI text": there is no prompt that writes UI text — it is written by agents following
  `tooltips.md` and `copy.md`. So the rule proposal is the prompt change.

## Deferred, by name

- **A *Share…* button inside the card** — waits for `hover-cards-clickable`'s opt-in prop on
  `Tooltip`. Then the `press` line on the private card becomes the button.
- **Landing on *Access & sharing* rather than the top of the Metadata page.** The page has no
  hash-to-section handling yet; the `Share…` button at its top does the scroll. The `press` line says
  where it lands, honestly.
- **The sharing card and the shelf badge on a shared, archived article** still say `SHARING_ON`
  (*"…and it's listed publicly"*), which is false there. Only the masthead knows both facts today;
  `AccessSharing` would need the archive state lifted to it. Found by GPT Sol's plan review.
- **Touch.** Unchanged: a tap on the mark follows the link, so the card is unreachable by finger
  (Masthead.tsx § `SharingMark` says so already).

## The simpler option passed over

Rewording the one string (`"Only you can read this. Press to share it."`) and nothing else. It
leaves the action in the same paragraph as the state, which is the second half of Greg's complaint,
and still explains nothing.

## Reviews

### Plan: GPT Sol, read-only, 2026-10-02

[261002e-sharing-mark-tooltip-plan-review-sol.md](261002e-sharing-mark-tooltip-plan-review-sol.md)
(exit 0, answer file fresh). Five findings, no P0; all five taken.

1. **P1 — archiving a shared article delists it**, and the cards said otherwise. Checked:
   `src/store/public-library.ts` filters `archivedAt is null` while `publicSlug` does not, so the
   link works and the listing goes. Now: the sharing mark says `SHARING_MARK_ON_ARCHIVED` for a
   shared, archived article; `SHARING_MARK_HOW_PUBLIC` says stopping sharing also takes it off the
   public list; the Archive mark's `how` says what archiving does to the listing on a shared
   article. Two tests in `masthead-sharing-mark.test.tsx`.
2. **P2 — Search is not withheld**: visitors get finished saved searches. Removed from the list;
   the card already says only *most*.
3. **P2 — the gutter test stopped below the seam.** Added a case to
   `tests/public-network-trace.test.tsx` that goes through the public payload and `Reader`; seen red
   with `Reader` passing `"you"` to a visitor, green with the fix.
4. **P2 — `go` contradicts tooltips.md's "a head and two paragraphs"** unless that paragraph is
   revised too. The revision is in the before/after proposal to Greg (final message); the factual
   `press` section in tooltips.md says it sits outside the two paragraphs.
5. **P3 — `go` is too narrow a name** for Archive, which goes nowhere. Renamed `press`.

Found while building: **the Archive mark's card had no `className="tip-soon"`**, so none of the
card rules in dock.css applied to it (body-size text, no styled head). Fixed; the new test of its
card is what found it.

### Code: GPT Sol, workspace-write, 2026-10-02

[261002e-sharing-mark-tooltip-code-review-sol.md](261002e-sharing-mark-tooltip-code-review-sol.md)
(exit 0, answer file fresh). Five findings, all fixed by Sol inside the change, read and kept:

1. **P1** — a shared article whose archive state is unknown was told it is listed publicly. Now
   `SHARING_MARK_ON_ARCHIVE_UNKNOWN`. Only reachable after a failed re-read: the one owner path
   (`ArticlePage` → `Reader` → `Masthead`) always passes the controller.
2. **P1** — `ArchiveMark` treated unknown visibility as private, saying *"Nothing else changes"*.
   Now its own branch.
3. **P2** — the card tests compared rendered text with imported constants, so a false constant
   passed. Semantic assertions added, plus all four archive/shared combinations and a press that
   flips both marks.
4. **P3** — **four test fixtures render `TableView` through casts that hid the new required
   `notesBy`**, so "required" did not hold there; they would have exercised the visitor's words
   silently. Fixed in `annotation-cost`, `annotation-reuse`, `prose-not-rebuilt` and
   `short-selection-in-a-mark`. Worth knowing for the next required prop on `TableView`: the
   typecheck does not find every caller.
5. **P3** — stale comments and leftover `go` wording.

Browser pass (Sonnet, Playwright, dark theme, 1400px): all four cards as intended — private,
archive, shared, and a visitor's gutter mark titled *"A note on this paragraph from whoever added
this article"*. Shots: `261002e-shot-1-private.png` to `-4-visitor-gutter.png`. The rule above the
press line is faint in the dark theme, the same as the existing `tap` line's.
