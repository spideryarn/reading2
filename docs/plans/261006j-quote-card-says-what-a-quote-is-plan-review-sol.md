The purple prose fills are the best-supported reading of the report: the Dock button and band (i) already explain Quotes, while the fill’s card does not. The visitor, Find more, and Skim paths all reuse the same stored `Quote` objects. However, two proposed reader-facing claims are false for valid quotes.

### Findings

**F1 — P1 — established**

The proposed definition calls every quote “a line,” but the authoritative prompt explicitly defines a quote as “a passage, not a line”: it may contain several sentences or a whole paragraph ([quotes.ts](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/quotes.ts:1335)). The proposed visible score explanation repeats the same error ([plan](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md:48)).

Smallest fix:

> A passage the AI picked out as worth keeping, in the article’s own words.

If the score meanings remain, replace them exactly with:

> Importance — how much of the argument rests on this passage  
> Striking — how memorable and well put this passage is

The strength claim is technically true in its one-way form: a visibly stronger fill has a higher `max(importance, striking)`. The floor and two-tier mapping mean the converse is not true. If retained, clearer wording is:

> For scored quotes, stronger purple reflects the larger of its Importance and Striking scores. Unscored quotes use the lightest fill.

**F2 — P1 — established**

The proposed Help edit would preserve sentences that are false for legitimate quotes. `reason`, `importance`, and `striking` are independently optional ([types.ts](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/types.ts:1122)); `QuoteCard` therefore shows zero, one, or two scores and conditionally shows the reason ([ProseHoverCard.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/ProseHoverCard.tsx:1698)). The Help page currently promises “its two scores, why it was chosen,” “Each row carries two numbers,” and an open-Quotes button that is absent inside Quotes mode ([help-modes.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/help/help-modes.tsx:623)).

Smallest replacement:

> Rest the pointer on a highlighted quote for a moment. Its card says what a quote is, shows the scores the AI supplied — or says *Not scored* — and, when supplied, the AI’s reason for choosing the passage. It also has ‹ › to the quote before or after it in the text. Outside Quotes mode, it offers a button to open it there.

Replace the following score paragraph with:

> Depending on the chosen order, a row shows neither, one, or both of the AI’s two scores: how much of the argument rests on the passage, and how memorable and well put it is.

**F3 — P2 — established**

The plan does not evaluate the genuinely simplest adequate option: add only the definition sentence. It compares the chosen four-line expansion with “only the Help link,” but the existing card already provides scores, reason, provenance, and navigation ([plan](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md:98)).

Smallest fix: add “definition sentence only” to the alternatives and prefer it unless browser evidence demonstrates that the two score captions materially help. This directly answers the report without enlarging every quote card.

**F4 — P2 — established**

The proposed tests verify only the Help link’s `href`, not the plan’s explicit claim that following it closes the card. They also do not require the definition and link to appear in the unscored branch. A correct scored card with a non-closing link could pass ([plan](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md:118)).

Smallest fix:

- Assert definition and Help behavior on both scored and unscored fixtures.
- Add a half-scored fixture and assert only its supplied score appears.
- Move the pointer into the card, advance past the close delay, and prove it remains open.
- Click Help and assert the card closes, not merely that its `href` is correct.

The existing constant-derived score-text assertion is sound and should remain.

**F5 — P2 — reasoned**

The risky geometry is absent from acceptance testing. QuoteCard can be stacked after term and citation halves ([ProseHoverCard.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/ProseHoverCard.tsx:686)), while the card has a width cap but no general height cap or scrolling ([prose-hover-card.css](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/styles/prose-hover-card.css:21)). Four added lines may push the footer off-screen on a short or narrow viewport. The plan checks only 1440px ([plan](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md:129)).

Smallest fix: either use the definition-only version, or require a narrow, short browser case containing a stacked term/citation/quote card and verify the whole footer remains reachable. Avoid adding scrolling machinery unless that check proves it necessary.

**F6 — P2 — reasoned**

The table overstates “A purple fill in the prose” as universally having QuoteCard. The selector deliberately excludes `.xref`; when a quote overlaps a cross-reference, the cross-reference card wins ([ProseHoverCard.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/ProseHoverCard.tsx:468)). For a visitor, that cross-reference may have no card because its resolver is owner-only.

Smallest fix: qualify the row as:

> A purple prose fill under a pointer, except where a cross-reference card wins

Do not expand scope to merge the two cards unless the report specifically requires every overlapping fragment to explain Quotes.

**F7 — P3 — established**

The plan contradicts itself twice:

- It says the fills are the only visible Quotes surface besides the bar button, immediately after listing the visible spine strip.
- It says the reader learns “nothing about who decided,” immediately after noting that the card prints who chose it. `aiProvenance` explicitly says “Chosen by the AI” ([quote-band-rows.ts](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/quote-band-rows.ts:161)).

Replace the latter passage with:

> The reader learns that the purple passage is a quote, sees that the AI chose it and any scores it supplied, but is not told what Quotes are or what those scores mean.

The Help link itself is safe for shared-article visitors: `/help` is intentionally public when signed out. Pointer entry into the existing card is also already supported. Find more produces ordinary model quotes, Skim only references existing quote IDs, and reader highlights cannot reach QuoteCard.

The focused baseline suite passes: 11/11 tests. No files were changed.

VERDICT: do not build