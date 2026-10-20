# Sources: a Reception you can read at a glance, and an Ask sub-mode

Feedback `spya-dk4tfq` (#645, SPIDERYARN-READING2-M8), addendum `spya-x4xpw4`; overseer queue item
`qi-a4538kz9`. Up: [reception.md](../project/reception.md), [sources.md](../project/sources.md).

> The Reception sub-mode UI is really confusing - I can't tell what's what.
>
> Perhaps start with things default-collapsed, so it's easier to see the grouping/hierarchy/relationships?
>
> Look at screenshots. Ask subagents to pretend to be naive users with different goals, and others to
> be product/UI experts, and try and improve it.
>
> — Greg, 2026-10-19 (spya-dk4tfq)

> Yeah, I'm looking at it further still, and it's bewildering.
>
> As well as trying to improve the UI, let's also add a new Chat sub-mode to the Sources mode (pick a
> name for it) for basically doing lots of searching to try and figure out what people think about the
> article, about the articles it has cited, and whether its claims have been supported, i.e. a general
> Chat mode for Sources.
>
> So maybe the sub-mode would open up a chat with a whole bunch of suggested questions (e.g. "How has
> the article been received?", "Are the article's main claims borne out?", etc - hopefully you can
> improve on/add to these questions, or even perhaps customise them dynamically based on the article) -
> and as always, the user could also choose to ignore the suggested questions, and just type into the
> input box.
>
> — Greg, 2026-10-19 (addendum spya-x4xpw4)

Two stages: Reception's layout first, then the new sub-mode. Each is committed on its own.

## What we looked at

**Screenshots.** No local article has a rich Reception: the rows are in `claims.rows`, the older
shape. So a Sonnet browser agent mocked `/api/reception/**` with 12 synthetic rows, 3 themes and 3
key sources, all shaped exactly like the stored ones, on a local article with real Cited-by data.
The shots were 1440×900 and 390×844 (the session's scratchpad, not committed).

**Five readers looked at the shots.** Three naive readers, each with a different goal:

- a student: *is it taken seriously, and what is the main criticism?*
- a journalist: *the strongest critics I could quote, and who they are*
- a researcher: *the lines of debate, who cites it, and what came after*

Two experts:

- an information-architecture designer
- a visual designer and UX writer

They agreed on more than they differed:

1. **The groups are not containers.** "Threads across these sources" looks like a table of contents,
   but it is a row of filter buttons. Nothing gathers the rows under their themes, and the key
   sources sit wherever *as found* put them. All five said it in some form, and the researcher made
   it their one change: *"Today the card promises grouping and the list ignores it."*
2. **Every row is fully open and the same shape.** A row has six to eight lines: the key line, the
   title, the meta, a chip, the AI triple, a three-line quote and *more*. Twelve of them read as one
   strip; only the title differs, and it sits mid-row.
3. **The labels repeat or contradict.**
   - The chip says LINKS / NAMES THIS PIECE on every row, and is read as a stance ("I read 'links this
     piece' as 'supports it'").
   - *bears directly · disputes · Critical* is three words for one judgement.
   - The AI tag comes in three styles.
   - The second group has a heading and the first has none.
   - Pressing a thread changes the chip's count and quietly drops *stance* from the order bar.
4. **Cited by is five screens down**, under two caveat paragraphs. For "is it taken seriously" it is
   the readers' most trusted signal.

All three readers thought the quotations were one template sentence. That was the synthetic data,
not the product, so it is not a finding.

## Stage 1 — Reception, default-collapsed

### The outline

At about 540px, in the default state:

```
 ┌ Bibliography │ Not cited │ Links │ Reception 12 │ Claims │ Ask ┐        (i)
 │ as found · date · stance                       ← sorts the rows inside every section
 │ ┌ AI  What the AI noticed in these sources ────────────┐   ← one AI-labelled frame
 │ │ ▸ ☆ Key sources                                  3   │
 │ │ ▸ Seeming versus being                           3   │
 │ │     Three sources pick up the essay's point that…    │   ← the gist, in the model's face
 │ │ ▸ Where the line is drawn                        2   │
 │ │     Two sources say the essay draws the line…        │
 │ └──────────────────────────────────────────────────────┘
 │ ▾ Every page                                         12
 │     ✗ Anil Seth and the beast machine: a critique ↗
 │       consciousnessblog.example.org · 2024 · AI: disputes it
 │     = Do we need biology for feeling? ↗
 │       philosophyreview.example.com · 2026 · AI: qualifies it
 │     … (the 5 that link or quote it, two lines each)
 │     MENTIONS ITS TITLE ONLY — MAY BE ANOTHER PIECE · 7
 │     ⚑ Interview: Seth on why AI will not wake up ↗
 │       podcast.example.fm · 2025 · AI: corroborates it
 │     …
 │ ▸ Cited by                                            5
```

*Revised after GPT Sol's plan review (F1, F2): the first draft opened Key sources and closed Every
page, which hid the title-only rows behind a press, the exact thing postmortem 261003h forbids.*

A section with one row open:

```
 │ ▾ Seeming versus being                AI · 3
 │     Three sources pick up the essay's point that…
 │     ▾ ✓ The danger is seeming, not being ↗
 │         opinion.example.com · 2026 · AI: extends it
 │         ☆ AI's key source: Takes the seeming-versus-being point further than the essay does.
 │         │ "…the quotation, located in the page's own extract…"
 │         AI  bears directly · extends · supportive
 │         ┊ AI interpretation … (the fence, as now)
 │         By H. Columnist · links to this article · opinion.example.com/…
 │         Read it on opinion.example.com ↗
 │     ▸ ⚑ Interview: Seth on why AI will not wake up ↗
 │         podcast.example.fm · 2025 · title only, may be another piece · AI: corroborates it
```

### The decisions

- **Sections replace the thread filter in Reception.** Each is a native `<details>` in Claims'
  `rcp-group` idiom, with its count in its summary:
  - **inside one frame headed *AI · What the AI noticed in these sources***: **Key sources**, when
    the synthesis picked any, then **each AI theme** in the model's order, with its gist under its
    summary. The theme names stay inside an AI-labelled container, as the Threads card's are today,
    so the panel header's rule that "a heading is a claim we stand behind" still holds: the only
    headings in our voice are *Every page*, the title-only heading and *Cited by* (GPT Sol's F2);
  - **Every page**, every Reception row, with the title-only rows under their own heading as today;
  - **Cited by**, for the owner.

  The themes are Reception's own: `threadsWithin` scoped to `direct.rows`, so a theme made only of
  an older search's claim rows is neither drawn nor counted here (F4).

  **A row appears in every section that names it.** A theme's gist says "Three sources…", so
  opening it must show three. Giving each row one home ("Also in…") would make the gist and the
  section disagree. Every page holds them all, so nothing depends on a theme.
- **What is open by default: Every page, and only it.** The AI's sections and Cited by start
  closed, so the outline is the first thing on screen and every stored row is still drawn before any
  press (postmortem 261003h; GPT Sol's F1 on this plan). The open state is the panel's own and is
  not stored. `?receptionthread=<id>` (an old link, or a way back) opens that section and scrolls
  the list's own scroller to it, on arrival and on a later change of the parameter; a stale id does
  nothing. Claims keeps its thread filter unchanged; this stage touches only Reception's.
- **Reception's chip count** becomes the number of stored rows, no longer through a thread. It is
  what Every page holds, and sources-counts.ts stays the one derivation for the chip, each
  section's count and the (i). The (i)'s *N on screen* becomes *N sources found; Every page lists
  all of them* (F3).
- **A row is two lines until opened.**
  - The first line is a stance mark and the title (the link out, as now).
  - The second line is the site, the year, *title only, may be another piece* on a title-only row,
    and one AI-tagged word for `relation` (*AI: disputes it*, *qualifies it*, *extends it*,
    *corroborates it*, *unclear*).

  A disclosure button opens the rest. The quotation stays one press away, as the header's rule
  requires ("the reader's one-action check"). It is the first thing the open row shows after the key
  line, so the evidence comes before the AI's reading.

  The stance mark is the `LEAN_APPEARANCE` icon already drawn. The full triple (*bears* ·
  `relation` · lean) moves to the open row, unchanged in content.
- **The LINKS / NAMES THIS PIECE chip leaves the closed row.** Only the exception is marked: ⚑ *title
  only, may be another piece*, on a title-only row wherever it is drawn. The open row says *links to
  this article* or *mentions its title only* in plain words, and keeps the identification evidence
  the chip's tooltip held. Inside Every page the title-only rows keep their heading, reworded to
  *Mentions its title only — may be another piece*; in a theme or Key sources they sort after the
  rows that link the piece, under the chosen order. Nothing filters them out.
- **The key-source line** moves into the open row as *☆ AI's key source:* and the why-sentence. The
  role word goes, because the visual expert and the journalist both found it opaque. The star stays
  on the closed row.
- **The order bar** sits once at the top and sorts the rows inside every section. With no filter,
  *stance* no longer disappears.
- **Cited by** becomes a collapsed section with its count in the summary, once its read answers. Its
  caveats go inside the section, one line plus the (i), so that what each says is kept. A visitor
  still gets the Scholar link, as a quiet last line.
- **No stance tally.** The student asked for "4 critical, 4 supportive" at the top. The file header
  records why there is none: a for/against tally puts the model's readings into a headline in our
  voice (GPT Sol's F9 on 260906b). It stays out.
- **Unchanged**:
  - the stale banner, the empty and running states, the handoff to Claims, the (i);
  - the angle box, until Stage 2 moves it;
  - Claims' layout. Its claim-check rows and an older search's claim rows also use `Row`. They get
    the two-line row too, with *bears* as the AI word, because that is what Claims orders by.

### What it gives up

- A thread can no longer narrow the list to its rows; opening its section does that instead.
- A row shown in two sections is drawn twice.
- The quotation is one press away rather than on screen.

### The tests

The existing panel tests (`reception-and-claims-panel.test.tsx`, `reception-threads.test.ts`,
`reception-navigation.test.tsx`, the sources-counts tests) are changed where they pinned the filter.
New ones:

- the sections and their counts;
- Every page open by default, and every stored row (title-only included) in the DOM before any press;
- a row in two themes drawn in both;
- title-only rows present and flagged in every section;
- `?receptionthread=` opens its section and scrolls to it, on arrival and on a later change, for `key` and a theme id, and a stale id does nothing;
- a theme made only of older claim rows is not drawn in Reception;
- a visitor's layout.

A browser pass at 1440 and at 390 against the same mocked data, with before and after shots.

## Stage 2 — the Ask sub-mode

### The name: **Ask**

- **Chat** is a mode, and a sub-mode's label may not repeat another row's
  (tests/mode-catalog.test.ts).
- **Explore** is Learn's.
- **Discuss** suggests other people.
- **Investigate** and **Inquire** are long.

*Ask* matches the app's *Ask in chat*, and it is a verb, as Greg's examples are questions. The
runner-up is *Inquiry*. Aliases: *investigate*, *research*, *what do others say*, *sources chat*.

### What the reader sees

```
 ┌ … │ Reception │ Claims │ Ask ┐
 │ [ Ask about this piece and what others say…        ] [💬]
 │ SUGGESTED
 │  💬 How has this piece been received, and by whom?
 │  💬 Are its main claims borne out by later work?
 │  💬 Who disagrees with it most strongly, and on what grounds?
 │  💬 Have the studies it leans on been replicated, challenged or retracted?
 │  💬 What has been published since that changes the picture?
 │ ABOUT ITS CLAIMS                         ← only when Claims' list has been made
 │  💬 Is "a starter needs cool water" borne out?        (or its mark, if checked)
 │ ABOUT THE WORKS IT CITES                 ← its three most-leaned-on works
 │  💬 How has "Smith et al. 2019" held up?             (or its mark)
 │ YOUR QUESTIONS                           ← the old *Your angles*, newest first
 │  💬 "replication attempts" — gist…                     2
```

**A press sends.** Every row and the box hand the question to Chat, as the angle box does today
(`handToChat`). The answer streams there, and Chat's *Back to … in Sources › Ask* line returns. A
question in *Your questions* opens its chat beside Sources, as a claim's mark does.

**Why not a chat inside the band.** Opus checked this. The floating dialog can only start a chat
anchored on a block (`ChatTarget`'s `draft` arm requires an `anchor`, src/web/ChatDialog.tsx), and
mounting a second `ConversationBand` inside Sources would be a second way of doing the same thing.
Starting an un-anchored chat in the floating dialog, so the reader stays in Sources, is the deferred
next step. It goes ahead if Greg wants it.

### Where each question's words come from, and its origin

| Row | Stored origin | Question sent |
|---|---|---|
| The box (typed) | `{ mode: "reception", lens: <the words> }` | the reader's words fenced, then the search line |
| A suggested question | the same shape, `lens` = the question | the question, then the search line |
| A claim | `ClaimOrigin`, through `checkClaim` | `askToCheckClaim`, unchanged, so Claims shows the same mark |
| A cited work | the `bibliography` item origin, through `askWork` | Bibliography's question, unchanged, so the work's row shows the same mark |

**No new origin word, no migration.** The `reception` lens shape already exists and the database
admits it. What changes is where its way back lands: `openOrigin`, `originBack` and
`threadSource`'s tooltip now name *Sources › Ask*. The angle chats already made land there too,
which is right, because that is where *Your questions* now lists them. The stored word stays
`reception`; no reader sees it.

**The box asks a question, not an angle.** `askReceptionThroughLens`'s fixed tail ("What do others
say about the article from this angle?") reads wrongly after "How has it been received?". A new
builder beside it sends the question as asked, with *Search the web widely, and say plainly if you
find little.* after it. The fence stays, because a suggested claim or title is the article's words.

**Tailored questions, with no model call.**
- The claims come from Claims' stored list, when the owner has made it, up to four, in article
  order. The Ask chip never buys the list.
- The works come from Bibliography, the three it leans on most (`relevance`).

Both are already loaded by the band. A model writing the questions would mean a new step and a new
cost before any press. It would also put model words into a message the reader sends, and a
suggested question worded from the reader's profile waits for Send by the privacy page's promise.
Deferred until the templates prove too generic.

**The angle box and *Your angles* leave Reception** and become Ask's box and *Your questions*. That
is one less control on top of the panel Greg found bewildering.

### Spend

Each press is one ordinary chat turn with web search, the same as *Check this claim in chat* today.
It adds several new one-press places that send a paid chat turn, but no new spend mechanism and no new guard: every press goes through Chat's own route and its limits (GPT Sol's F9). Tests: arriving on Ask sends nothing, one press is one chat POST, and a visitor has no senders mounted. The chip arms nothing (`activationForSources`
returns `null` for Ask, as for Links). A link, Back or a restore buys nothing, because nothing on the
panel spends until a press.

### Visitors

Ask is owner-only: a visitor has no chat. It is left out of the visitor's chip row, and
`?sources=ask` draws Bibliography for a visitor (`visitorSourcesView`), as Not cited does. That
follows an existing pattern rather than editing a defence.

### What it touches

[mode.md](../project/mode.md)'s sub-mode checklist and [chat-from-a-mode.md](../project/chat-from-a-mode.md)'s
table:

- `SourcesView` and `SOURCES_SUB_MODES` (the label, description and aliases). `ReceptionAndClaimsView`
  is defined today as Sources' views minus three, so adding `ask` would quietly widen it: it becomes
  the positive union `"reception" | "claims"`, and both SourcesMode controllers route each view with
  an exhaustive `switch` (F5);
- params.ts `sourcesParam` and `visitorSourcesView`;
- `activationForSources`;
- the chip row in SourcesMode.tsx, and a new `AskPanel` that takes the chip row as `head`;
- sources-counts (no count for Ask: there is nothing to count before a press, and *Your questions*
  is not a list the chip should number);
- Reader's senders, passed down: the lens sender, `checkClaim`, `askWork`, and the bundles for the
  marks;
- `openOrigin`, `originBack` and `threadSource` for the lens, and `titleFromOrigin` (src/chat-title.ts),
  whose *Angle: …* becomes *Question: …*, because a suggested question is not the reader's angle (F6);
- the help page `src/web/help/pages/modes/sources.md`;
- the command bar's aliases;
- the docs: sources.md gets a § Ask, the old § Look at the debate from an angle in reception.md moves
  there, and chat-from-a-mode.md's table row changes.

### The tests

- the chip and the address, and a visitor never seeing Ask;
- the suggested questions present, and a claim and a work row appearing only when their lists exist;
- a press sends with the right origin and question (lens, claim, work);
- an existing claim or work chat shows its mark instead of a button;
- the way back from an angle chat lands on Ask;
- the old Reception has no angle box;
- `chat-handoff.test.ts` for the new builder and its fence;
- `every-mode-draws-its-surface.test.tsx`'s `SOURCES_VIEWS_DRAW` and the chip-count assertion, and
  `url-state.test.ts`'s address and visitor inventories, with Ask's own panel content, so a valid Ask
  address that drew Reception would fail (F7).

## Deferred, named

- **Ask's conversation opening beside Sources** in the floating dialog, so the reader never leaves
  the mode. It needs a third `ChatTarget` arm for an un-anchored chat with an origin.
- **Model-written suggested questions**, if the templates prove generic.
- **Renaming the stored origin word** `reception` to `ask`, which needs one migration. Nothing a
  reader sees depends on it.
- **A real-data browser pass** on a production article's Reception (Tinbergen 1963), once deployed,
  because the local rows were synthetic.

## The simpler option passed over

- **Fold every section into one long list with headings, and no disclosures.** It would be cheaper,
  but it is what Greg found bewildering: headings alone did not make the groups visible.
- **For Ask, a launcher with only fixed questions and no tailored rows.** It would be simpler still,
  but Greg asked for questions about "the articles it has cited" and "whether its claims have been
  supported", and the two stored lists answer that at no cost.

## GPT Sol's plan review

[261020n-…-plan-review-sol.md](261020n-sources-reception-layout-and-a-sources-chat-sub-mode-plan-review-sol.md).
The verdict was *revise before build*. All nine findings are taken:

| Finding | What changed |
|---|---|
| F1 (blocker) | Every page is open by default, and the title-only heading stays |
| F2 | The AI's sections sit inside one AI-labelled frame |
| F3 | The (i)'s count sentence |
| F4 | Themes scoped to Reception's rows |
| F5 | A positive union and exhaustive routing |
| F6 | `titleFromOrigin` |
| F7 | The draw inventories |
| F8 | Tests for the scroll and for a later change of the parameter |
| F9 | The spend wording, and three tests |

## Progress

- [x] Plan reviewed by GPT Sol (revise before build; all nine taken, above)
- [ ] Stage 1 built, tested, browser-checked, code-reviewed by GPT Sol, committed
- [ ] Stage 2 built, tested, browser-checked, code-reviewed by GPT Sol, committed
- [ ] Docs, user-feedback note, queue item done, pushed to dev
