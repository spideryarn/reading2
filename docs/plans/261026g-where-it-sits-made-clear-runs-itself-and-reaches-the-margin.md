# Where it sits: made clear, runs itself, and reaches the margin

Written 2026-10-26. Acts on three reports Greg filed as admin the same morning, all on Sources ›
*Where it sits* for `index-spya-wq3rud`, the mode built by
[261025h](261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md):

> The new where it sits submode of sources looks very powerful. The layout a bit confusing. Perhaps
> we could start with things being default collapsed so that I can easily tell what belongs to
> what. So, for instance, challenged would be default collapsed with a little indicator of how many
> are found or something. […] Also, there were tools at the bottom that if I clicked, they kicked
> off chats somehow. I don't know. Should those be more prominent? Should they be buttons? […] Could
> we fold them in and run them automatically? How can we make this less confusing, less manual for
> the user? […] Start with the goals of the user in mind. And remember to assume that the user is
> using it for the first time.
>
> — Greg, 2026-10-26 (spya-c5gvp0)

> when I open that submode, I want it to automatically start running rather than requiring me to
> open the submode and then click. […] I expected there to be a way to ask in chat about that
> summary. […] I want to make sure that any of this stuff has lots of hyperlinks and block links
> and whatever to the text and to the outside world. The sources should be really densely linking.
>
> — Greg, 2026-10-26 (spya-mfuz6g)

> Please make sure that the stuff that you found here is going to show up in the marginalia mode.
> […] I want to see that as entries in the marginalia mode somehow, if we run where it sits.
>
> — Greg, 2026-10-26 (spya-pkpqch)

## Stage 1 — the findings in the margin for every owner (spya-pkpqch)

The margin already had a *literature* kind (plan
[261024o](261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md) §
Marginalia), but only with the experimental switch on: the dossier left the switch on 2026-10-25
and its margin notes were left behind as "a separate call" ([marginalia.md](../project/marginalia.md)).
Greg's report is that call. The gate in `OwnerMarginFeed` goes; the read stays a read
(`useSituateRead`, no job), a stale dossier is still not drawn, and a visitor still gets none.
Cost: one more GET when the owner's margin opens, a 404 when no search has run.

The simpler option, and the one taken: lift the gate. Nothing else about the notes changes.

The rest of the plan (the layout, the automatic run, the summary's chat, the links) follows once
the screenshots, persona reviews and spikes are in.

## What a first-time reader met (the evidence)

A Sonnet browser agent shot *Where it sits* on three local articles with a dossier and two without,
desktop and phone (`/tmp/…/scratchpad/shots/before/`, described here because the scratchpad is not
kept). On the 2023 consciousness review the band is one column about 545 px wide: the overview
(eight lines of the model's face), then 13 findings under five small grey caps headings
(*CHALLENGED · 2*, *CITATION? · 1*, *SINCE · 7*, *NOT CITED? · 2*, *SUPPORTED · 1*) in the same
type as *AFTER IT* and *BEFORE IT*, about 3,900 px of scroll, then the free lists, then *Tools:*
as a wrapped line of orange text, *Ask your own question* alone on the second line. On a phone,
nine screens. Two findings under *Since* quote the same passage one after the other.

Four persona subagents read the shots and Greg's three reports — a first-time policy analyst, a
cognitive-science postdoc, a product manager (Opus) and a UI/UX designer. **They agreed on nearly
everything**, independently:

1. **No map.** Nobody could see the shape of the result (how many of each, which matter) without
   scrolling it all; the group headings don't read as groups. All four proposed **a count strip
   and folded groups, not sub-tabs**: tabs hide the counts, which are the summary, and a third row
   of tabs does not fit 390 px. Open the group that matters most (*Challenged*) by default.
2. **The tools are a mystery.** Orange words that look like the source links, at the very bottom;
   one swaps the band, another starts a chat, nothing says which or what it costs. Three of four
   noticed they overlap the dossier: *Pages about it* is the dossier's *Reception*, *Close to it,
   not cited* its *Not cited?*, *Check a claim* its *Challenged* one claim at a time, *Ask your
   own question* is chat. The postdoc found the one item they most wanted (a page disputing the
   paper) behind *Pages about it*, invisible from the dossier.
3. **The overview is a dead end**: no chat, no links. The block ids (`skqjuz`) read as debris, the
   quote does not look like the way to the passage, and the order of the groups follows no rule a
   reader can see (*Supported* last, *Since* in the middle).

## What this plan does

```
 ┌ Where it sits │ Bibliography 66 │ Links 0 ┐
 │ ┌───────────────────────────────────────────────┐
 │ │ A review from 2023: what has happened since    │
 │ │ The report was followed by a peer-reviewed…    │  overview, model's face
 │ │                         [💬 Ask about this]    │
 │ │ Challenged 2 · Since 7 · Citation? 1 ·          │  count strip: each a press
 │ │ Not cited? 2 · Supported 1                      │  that opens and shows its group
 │ └───────────────────────────────────────────────┘
 │ ▾ Challenged 2   Later work disputes or failed to reproduce it
 │   ┌ “The main alternative to this approach…” ↗ skqjuz  [💬]
 │   │ Pennartz (2026) argues …
 │   │ How can we validate … · cell.com ↗   › What it says
 │ ▸ Since 7        “We use these indicator…” and 6 more
 │ ▸ Citation? 1    “Conwell and Ullman (2022)…”
 │ ▸ Not cited? 2 …  ▸ Supported 1 …
 │ What was searched: 16 searches …   [Search again] 25 Oct
 │
 │ Go further
 │  [Pages about it 1]   web pages that discuss this piece — a few cents, on press
 │  [Check a claim]      the piece's claims, each checkable in chat
 │  [Close to it, not cited]  related papers it does not cite — free, on press
 │  [💬 Ask your own question]  a chat about where it sits
 │
 │ AFTER IT …   BEFORE IT …
```

### Stage 2 — the dossier you can take in at a glance (c5gvp0, mfuz6g's chat)

Client only: `SituateDossier.tsx`, `situate-dossier.ts`, `reception.css`.

- **The overview in a box**, with the head line, and **Ask about this in chat** under it (mfuz6g).
  Chat cannot read the dossier (no chat tool reads `situate`), so the question carries the
  overview, as a finding's carries its note: a lens, `About this search of the literature's
  overview: “…” What does it rest on, and how far should I trust it?`, cut to `MAX_LENS_CHARS`.
  Its mark is found by those words, as Investigate's questions are (`threadForOrigin`). The simpler
  option over a new id-shaped origin: no route, no CHECK, no migration; the cost is that a re-run
  that rewords the overview loses the mark, which Investigate's questions already live with.
- **A count strip** under the overview: one press per group, each opening its group and bringing it
  into view.
- **Groups fold**, each heading a real button with its count, its meaning in plain words (today's
  tooltip, `SITUATE_FINDING_TIP`, now on the line) and, shut, the first passage it is about.
  **The first group in the reader's order is open; the rest are shut.** Which are open is
  component state, not the address, as *After it*'s view is. A finding focus (the margin's *Open
  in Sources*, a chat's way back) opens its group before it lands.
- **The reader's order**: Challenged, Since, Citation?, Not cited?, Reception, Supported — what
  most changes how far to trust the piece first. A display order in `situate-dossier.ts`; the
  stored kinds and the margin's `strongestFirst` are untouched. Labels unchanged (they are the
  margin's stamps too); the meaning line does the explaining.
- **Findings as cards** with a left edge, and **the quote is itself the jump** to its passage
  (BlockRef's id stays, as in every mode: controls.md § Controls that do the same job look the
  same). Consecutive findings in one group on the same passage share one quote.
- The free lists' subtitle that renders large and indented (`.where-what`) fixed.

### Stage 3 — the tools say what they do (c5gvp0)

`WhereItSitsPanel.tsx`. The four tools move from the foot to **under the dossier**, as **Go
further**: four buttons in the house's control style, each with one line saying what it does and
what it costs, the chat one with the chat icon. Still plain moves to the same addresses, arming
nothing. Folding *Pages about it* and *Not cited* into the dossier's groups, and running them
automatically, is the step after (below), not this one.

### Stage 4 — opening Where it sits starts the search (mfuz6g)

A press that lands on *Where it sits* — the Sources button when *Where it sits* is the view, its
chip, its command-bar row — **arms `situate` as well as `bibliography`**, through the activation
token every mode that starts itself uses (activation.ts): the token is what tells a press from an
arrival, so a pasted link, a reload, Back and Forward still start nothing. One automatic attempt
per article per tab session (`auto-run-targets.ts`), never a re-run of a stored or stale dossier,
and the rate allowance (`SITUATE_RATE_POLICY`) still applies; when it refuses, the button and its
message are what the reader sees. The privacy page, its `LAST_UPDATED`, `/help`, sources.md and
the disclosure say *when you open Where it sits* rather than *when you press*.

**The cost rule, read against this.** Greg on q-vg2b69 (2026-10-25): *"$0.30, okay, but then that
should be upon user request"*; on mfuz6g (2026-10-26): *"when I open that submode, I want it to
automatically start running"*. These conflict only if opening is not a request. **This plan takes
the press that opens the sub-mode as the request**, and only the press: the activation token is
already the house's line between a reader asking and a page arriving. Said so in the note.

### Stage 5 — denser links (mfuz6g)

Client-side, free: *Before it*'s works link out (DOI or URL) as well as into Bibliography; an *After
it* paper that is also a finding's source says so and goes to the finding; a finding's source that
is a work the piece cites opens its Bibliography row. **The overview's own sentences linked to the
passages and findings they rest on** needs the read prompt to return them (`situate/3`, sentences
with ids, Summary's shape) and is held until 261025h's Stage 3 adoption (the Haiku shortlist) has
landed in `src/situate.ts`, so the two prompt changes are measured one at a time.

## Sequencing with 261025h

That session (`fbvg2b69-sources-reshape`) has Stage 4 committed and not pushed, and is in its
Stage 5 (personas, then fixes) in the same files. Stage 1 here is disjoint and lands now. Stages
2–4 are spiked in this worktree on a local merge of its branch, shot and shown to the personas
again, and **pushed only after its work is on `origin/dev`**, merged then. Stage 5's prompt half
waits for its Stage 3 adoption.

## Left out, and why

- **Sub-tabs** — all four personas against: they hide the counts.
- **Folding Pages about it and Not cited into the dossier and running them on open** — the strongest
  persona suggestion after the layout, and the next step. Not here: Not cited sends the piece's
  opening to OpenAlex, which is a privacy press (sources.md), Pages about it is a second paid call
  on every open, and the dossier already runs a reception query of its own (261025h, decision 6).
  The clear *Go further* row first; whether to fold is a call worth making with the new layout in
  front of Greg.
- **A chat tool that reads the dossier** — chats about it carry their words instead.
- **The persona left-field ideas** (a trust line, a spine map of ticks, guess-before-reveal) —
  261025h's experiments already have guess-first; the others are listed in the note.
