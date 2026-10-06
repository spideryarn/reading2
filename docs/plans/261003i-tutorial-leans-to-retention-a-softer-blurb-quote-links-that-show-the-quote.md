# Tutorial leans to retention, a softer blurb, and quote links that show the quote

Up: [plans.md](../project/plans.md) · the mode: [remember-mode.md](../project/learn-mode.md) ·
where it is going: [remembering-vision.md](../project/learning-vision.md)

**Three of Greg's reports on Remember's Tutorial sub-mode, 2026-10-03**, all from one sitting on one
article (`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, Levin's *Self-Improvising
Memory*). Relayed by the Overseer; session `fb-tutorial-2610`.

| Report | What it asks |
|---|---|
| `spya-hw8mhz` | The blurb should not ask the reader to *say* they haven't read it; say it is fine if they haven't, or haven't finished |
| `spya-hzpf9b` | A quote came with a block link, but clicking it "didn't seem to take me with the quote"; make sure a quote always has a block link "so that the user can see the quote in situ" |
| `spya-mtsf0y` | A "tiny nudge" towards **retention** — understanding what the author is saying and internalising it — and less exploring the reader's own thoughts. And a proposed new **Exploration** sub-mode for "what do I think?", which knows the reader's comments, highlights and chat threads |

Greg's words are in the feedback notes and are quoted below where they decide something.

## What his own conversation shows

His Tutorial thread (`spya-uf5bx4`) was read from production, read-only. Three assistant turns:

- **Every quotation had a block id straight after it, and every id was the right block.** Eight
  quoted phrases, four ids; six phrases are verbatim in the cited block and the other two differ
  only by a footnote marker the article prints inside the phrase ("Self² as a process", "maintained⁶
  by agents"). So the prompt was already doing what `spya-hzpf9b` asks for.
- **The cited blocks are long**: 248, 218 and 202 words. A click scrolls to the block and washes the
  whole paragraph (`flashBlock`), and the reader is left to find one sentence in 250 words. That is
  the report: the link took him to the block, not to the quote. **The fix is on screen, not in the
  prompt.**
- **The tasks went to the reader's own view at once.** Turn 1 opened with a verdict ("That covers the
  core moves well") and asked *"how do you think that … differs from …"*; turn 2 asked *"where would
  you push back"*; turn 3 ran a web search and asked where *he* thought Levin would draw a line.
  None asked him to say back, explain or connect what the author wrote. The prompt's ladder says to
  climb when the reader answers well, and a rich first account sent it straight to the top rung,
  *Doubt*. That is `spya-mtsf0y`.

## Stage 1 — the blurb, and the prompt's weight (`spya-hw8mhz`, `spya-mtsf0y`)

**The blurb.** Three places ask the reader to say they have not read it: `TutorialInvitation` and
the composer placeholder in `src/web/ChatPanel.tsx`, and the canned assistant line `readItFor` in
`src/converse.ts`. All three change to an offer, not a request:

- invitation: *"What do you remember about this article? It's fine if you haven't read it yet, or
  haven't finished — we can start from wherever you are."*
- placeholder: *"What do you remember about it? It's fine if you haven't read it yet."*
- canned line: *"I've read it. What do you remember about it? It's fine if you haven't read it yet,
  or haven't finished."*

`HOW TO START` in the prompt gains the matching case: a first message that says little or nothing
about the piece is treated as not having read it, without asking them to confirm.

> you already know that they haven't read it because you see the reading time
>
> — Greg, `spya-hw8mhz`

**Not built: telling the tutor how much the reader has read.** The model is not shown reading time
today; only where the reader is now. Passing it would need the route to load the reader's
`reading_time` rows and a new line in the final user message. The softened words do the job the
report asks for without it, so it is deferred and queued (see § Deferred).

**The prompt.** `TUTORIAL_SYSTEM` changes in four places, and nowhere else:

1. *The goal*, first paragraph: what the turns are for is **understanding what the author is saying
   and keeping it**. Greg: *"a bit more of a focus on retention. To say understanding the author's,
   what the author is trying to say, and internalizing it."*
2. *The tasks*: the staples are say-it-back, why-the-author-needs-it, example, connect, and the
   reach-back. **A task that asks for the reader's own view (push back, what do you think) is the
   exception**: at most about one turn in four, never two running, never the first two tasks, and
   the turn after it comes back to the piece. "When they answer well, move up" now means a harder
   question *about the article* — what a step of the argument needs, how two parts fit, what the
   author would say to a case — not an invitation to opine.
3. *The expert*: harder questions about the argument, still about what the author says.
4. *When the reader goes exploring on their own* — a long speculation, a request to search the web
   for critiques: answer briefly, say Chat is the place to take it further, and come back to the
   piece with the next task.

It still pushes the reader to think. Greg: *"that's not to say that tutorial mode shouldn't push me
to think at all. It's great that it does, but just a bit less."*

**Measuring it** ([prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change)).
`evals/remember-tutorial.ts` gains:

- a fourth scripted reader, `richRecall`, shaped like Greg's session: a long, good, opinionated
  spoken account; then "I wasn't sure what he meant by that"; then a speculation of their own with a
  request to look for critiques; then two ordinary answers. Generic enough to run on any article.
- two screens, printed per turn and counted: **does every quoted phrase appear in the block cited
  straight after it** (the check `spya-hzpf9b` deserves, which nothing made before), and **is the
  turn's one question about the reader's own view** (a crude pattern: "push back", "do you think",
  "your view", "would you", "do you agree"). Screens, not verdicts; a person reads the turns.
- an `--out` name, so an arm is never overwritten.

Arms: the old prompt **twice** (the control, which says how much two samples of one prompt differ),
then the new prompt, on two articles: the Noema fixture and the Entropy article Greg was reading
(copied read-only from production into the scratchpad, never into the repo; it is an open-access
paper). Four readers × five turns × two articles × three arms = 120 Sonnet turns against a cached
article, a few dollars. The write-up goes in `docs/investigations/`.

**Pass:** on the new arm, own-view questions fall well outside the control's spread and no reader's
first two tasks are own-view; length, citations and quote-in-block are no worse; and reading the
turns agrees.

## Stage 2 — a link after a quotation shows the quoted words (`spya-hzpf9b`)

When a citation chip in an answer comes straight after a quotation — `"…" [spya-…]`, which the
citing rules make the standard shape — clicking it **washes the quoted words** in the block, not
the whole paragraph, and centres on them. Where the words cannot be found in the block, it does
exactly what it does today.

The parts already exist: `onJump(id, passage?)` → `bandJump` → `jumpTo` → `beginJump` →
`flashBlock(target, {passage})` narrows the wash to marks carrying a passage key (Skim uses it),
and `findQuote` in `src/quote-match.ts` turns a quotation into a span of a block's text, forgiving
case, spacing and curly quotes.

The missing piece is the mark. Two ways to get it:

- **A. A transient `Found`** for the clicked quotation, published into the prose's passage slots so
  `annotateHtml` draws a `mark.hit` (invisible at rest) before the jump settles, then flashed by the
  existing passage flash. Reuses everything; costs a new producer in `passages.ts` and a mark that
  must be drawn in every mode the band is open in.
- **B. A range flash**: find the span in the block's DOM text at click time and paint it for the
  flash's duration with the CSS Custom Highlight API. No marks, no re-render, no passage slot; one
  new function beside `flashBlock`. Costs a second way to flash, and falls back to the whole-block
  wash on a browser without the API.

**A is the default** because it adds no second mechanism. The implementer may take B if A needs a
timing hack (the mark not yet drawn when the scroll settles) — and says so here.

Applies to every answer that renders through `Cited` — Chat, Recall, Tutorial — since the shape and
the complaint are the same in all three.

Details that are decided:

- The quotation is the last double-quoted run in the text straight before the chip, straight or
  curly marks. A quotation with an ellipsis is matched on its longest piece. A chip with several ids
  tries the quotation in each.
- No match → today's whole-block wash. Never a wrong highlight: an ambiguous match (the phrase
  occurs twice in the block) takes the first, which is still inside the right paragraph.
- A footnote marker inside the article's phrase ("Self² as") defeats the match today. If
  `renderedText` keeps the marker, the match is retried with digits and superscripts between
  letters dropped from the block's side; if that is more than a few lines, it falls back to the
  whole block and is named in § Deferred.

Tests, red first: the extraction (a unit test on the segmenter), the click passing the passage, and
the flash landing on the phrase and not the cell. Then a browser check by a Sonnet subagent at
desktop, iPad and phone widths.

## Stage 3 — Exploration: proposed, not built

> why don't we create a new exploration submode alongside tutorial submode that is more for, like,
> what do I think? Now, it may be that I can just get that from the chat, but ideally the exploration
> submode would have access to my comments, my highlights, my chat threads, and so it would know what
> discussions I've had so far and try and push me to think further about the things that are
> interesting to me.
>
> — Greg, `spya-mtsf0y`

**Not built in this run, because it does not stay simple**, and one question in it is Greg's.

What a v1 as a fourth Remember chip would take, measured against Tutorial's own commit (33 files,
+905 lines): a new `ThreadKind` and the migration that widens the `kind` CHECK and adds a
one-per-article index; the chip, the URL value, the empty state, the help page, the export; a new
system prompt and its eval; **and the new part** — the reader's comments, highlights and other chat
threads rendered into the final user message. That last part is the feature, and nothing does it
today: chat's eight tools reach the article and the library, not the reader's own notes. It also
puts the reader's stored chat transcripts, which can hold a stranger's web page, into a prompt, so
it wants fencing like every other untrusted block ([security-map.md](../project/security-map.md)).

Three ways to build it, for Greg to choose between:

```
  A. A fourth chip in Remember        B. A tool in Chat              C. Both, B first
     Recall · Tutorial · Quiz ·          Chat gains `my_notes`:         B now; A later if a
     Explore                             your comments, highlights      separate voice still
                                         and other threads on           seems wanted
     own thread, own prompt:             this article
     "push me on what I think"
```

- **A — a fourth chip, "Explore".** What he described. Its own single thread and a prompt whose
  whole job is his thinking: it opens by naming what he has marked and argued about, and pushes on
  it. Costs the full list above (about Tutorial's size plus the notes plumbing), and puts a mode
  that is not about remembering under Remember.
- **B — a `my_notes` tool for Chat.** Chat can already be asked "what do I think about this?"; what
  it lacks is knowing what he has marked. One read-only tool gives it his comments, highlights and
  the titles and gist of his other threads on this article. No new kind, no migration, no chip.
  Costs: it is still Chat's voice, which answers more than it pushes, so the Socratic push would
  come from a line in Chat's prompt or from him asking for it.
- **C — B first, then A if it is still wanted.** B is the plumbing A needs anyway, so nothing is
  thrown away.

**Recommendation: C.** B is small, useful on its own, and is the hard half of A. Whether a separate
chip is worth it is easier to judge once Chat knows his notes. What would tip it to A now: if the
point is the *stance* (a model that keeps pushing rather than answering), which a tool cannot give.

Queued for the Overseer as its own entry, so the report's deferred half is not lost.

## Deferred, each with its reason

- **Reading time shown to the tutor** (Stage 1). Queued with Exploration's entry.
- **Exploration** (Stage 3). Its own queue entry, waiting on Greg's choice above.

## Reviews

GPT Sol on this plan before building (read-only), and on the code (write-capable).

### The plan review, and what changed because of it

[261003i-tutorial-retention-plan-review-sol.md](261003i-tutorial-retention-plan-review-sol.md):
nine findings, no P0, *build with the changes above*. All nine were checked against the code and
accepted, in whole or in part. **Where this section and the stages above disagree, this section is
what was built.**

| | Finding | What was done |
|---|---|---|
| PR-1 (P1) | "Never own-view in the first two tasks" contradicted the opening question for a reader who has not read it; and "says little about the piece ⇒ has not read it" would misread a terse goal | The opening prediction is named as not one of the rationed tasks. The from-zero case is now "has nothing of the piece in it **and asks for nothing**", and a short first message that names a goal is a goal. A `terseGoal` reader tests it |
| PR-2 (P1) | "Citations no worse" tolerates a quotation with no link, which Stage 2 cannot help | The eval's gate is now **no article quotation without an id straight after it**; the per-turn reminder says "straight after the closing quotation mark" |
| PR-3 (P2) | The three existing readers name Seth's arguments, so on a second article they test misplaced premises; and a rich account must be *right* about the piece | Readers are per article (`--readers=noema|entropy`). Noema: the three, plus an accurate `richRecall`. Entropy: a close paraphrase of Greg's own turns, and `terseGoal` |
| PR-4 (P2) | The own-view regex rewards rewording; the quote screen used the forgiving matcher and one ellipsis piece; no prompt hash, no blind judge | The regex is a flag only. The measure is a blind labelling of every task. Quotes are verified with the `"spaced"` pass, every ellipsis piece in order. Each run prints a hash of the prompt |
| PR-5 (P2) | Option A is not supported: a `Found` is always painted (wash and underline) and feeds the paragraph bars and the rail | **A is dropped** |
| PR-6 (P1) | Stripping digits to step over footnote markers would turn `CO2` into `CO` | Footnote references are skipped **by node**, when the block's text is walked; no digit pattern |
| PR-7 (P2) | A quotation with emphasis inside is split across Markdown nodes | Accepted as a limit: such a quote falls back to the whole-block wash, and a test pins the fallback. Adjacency is strict, so an earlier quotation is never attached to a later citation |
| PR-8 (P2) | Option B promised centring on the phrase but only described painting | The promise is withdrawn: the scroll still centres the block, and only the paint narrows. The range flash lives **inside** `flashBlock`, so it shares cancellation, the held flash on a phone, and reduced motion |
| PR-9 (P2) | Stage 3's `my_notes` assumed a per-thread gist that does not exist | The proposal now says: capped comments and highlights, plus an index of the article's other threads (title, turn count), with a bounded read of one thread on request |

So **Stage 2 as built is option B, narrowed**: a click on a chip that sits straight after a
quotation paints the quoted words with the CSS Custom Highlight API, inside `flashBlock`; anything
that cannot be matched, and any browser without the API, gets today's whole-paragraph wash.

### What landed

- **Stage 1**: the three surfaces and the help page say it is fine not to have read it; the prompt
  is weighted to the author. Measured: own-view tasks 19 of 60 turns before, 6 of 60 after, by a
  blind judge ([261003c](../investigations/261003c-tutorial-prompt-leans-to-retention.md)). Still
  imperfect: the pointer to Chat appears in half the runs, one run asked for the reader's view two
  turns running, and a short phrase re-quoted later in an answer can lack its id.
- **Stage 2**: built as above. One change from evidence: about one article quotation in ten has its
  id later in the same sentence, so a chip takes every quotation in its sentence, not only the one
  straight before it. Seen in a real browser at desktop, iPad and phone widths, light and dark; on
  a phone the band steps aside and the paint follows. The paragraph-wash fallback was not seen in a
  browser (the answer had no paraphrase chip); tests hold it.
- **Stage 3**: not built; queued as `qi-pbskakrj`, waiting on Greg. Reading time for the tutor is
  queued as `qi-a7p9xc4p`.

### The code review

[261003i-tutorial-retention-code-review-sol.md](261003i-tutorial-retention-code-review-sol.md), on
`b34ad2d3c`: six findings, no P0 or P1, *land with the fixes above*. Sol fixed four itself: two gaps
in the eval's quotation screen (CR-1, CR-2, with
[a postmortem](../postmortems/261003c-a-quotation-screen-changes-which-words-it-promises-to-verify.md)),
and two tests that could not fail — nothing checked that a drawn passage wins over quotes, and the
jump test asserted a fallback that dropping the quotes also produces (CR-3, CR-4, with
[a postmortem](../postmortems/261003b-the-fallback-outcome-stands-in-for-evidence-of-the-preferred-path.md)).
CR-5, the blind judge's files not being in the tree, was right and is fixed: they are in
`evals/results/`. CR-6 corrected claims in the investigation that the evidence did not carry. One
round; nothing overruled.

**Stage 3, option B, restated after PR-9:** one read-only Chat tool that returns the reader's own
comments and highlights on this article (capped, with the cap announced), and an index of their
other threads on it — title and turn count — with a second, bounded call to read one. Scoped to the
signed-in owner and this article, speaker roles kept, stored text fenced as data.
