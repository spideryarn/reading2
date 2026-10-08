# Text styles for the recurring lines in a mode band

**Status: done, 2026-10-08, on `dev`, not deployed. Session `fbar65p3-type-sizes-across-modes`, queue item `qi-t76rmqxr`,
report `spya-ar65p3`, question `q-dhnbhw` (answered `spya-k99f8e`).**

Up: [261006k](261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md)
§ Questions for Greg, which asked the question this builds.

## What it is for

Greg's answer to `q-dhnbhw`, 2026-10-08 (`spya-k99f8e`):

> Maybe this is part of the larger design system work that presumably there's only so many
> different kinds of fonts and sizes and displays and headings and whatever. It may be a few dozen,
> perhaps, but then new modes, new interface components would be mostly reusing one of those
> existing font types and sizes and whatever. That feels like it might lead to a cleaner design
> feel if things are, you know, using a more consistent design system. I don't think this is worth
> killing ourselves over, but perhaps we could make some steps towards it, taking lots of
> screenshots so that it doesn't, you know, disrupt things too much, because it looks okay right
> now. It just doesn't look as good as I think it could. Use your judgment. I think as much as
> anything, I'm trying to lay foundations so that development goes faster and is more likely to
> produce good results without too many rounds of iteration going forwards. And, you know, laying
> the foundations well for the current setup is a step towards that.

So, option A from the question, read through his three constraints: **a foundation new modes reuse**,
**no disruption to what looks fine**, **lots of screenshots**.

## What exists

No size tokens at all. The colour, shadow and control-height layers are named
([261007h](261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md));
type size is the one that is not. In the band stylesheets every rule picks its own rem, and the
same job lands on a different number in each mode (measured 2026-10-08 from the stylesheets):

| Job | Today |
|---|---|
| a row's main line | Skim's section `.skim-place` 0.88 · Timeline `.tl-label` 0.88 · Referee `.crit-criterion` `.clm-claim` `.cnd-name` 0.91 · Debate `.dbt-title` 0.92 · FAQ `.faq-question` 0.93 · Quotes `.quotes-text` 0.93 · Glossary `.gloss-name` 0.95 · Ideas `.ideas-name` 0.95 · Citations `.cite-title` (unset, inherits the band's 0.96) |
| verbatim source words under a row | Timeline `.tl-quote` 0.83 · Skim `.skim-words` 0.84 · Citations `.cite-quote blockquote` 0.85 · FAQ `.faq-quote` (0.86, via `.gloss-part-text`) · Debate `.dbt-quote`, Referee `.clm-quote` `.mir-quote` 0.88 · Ideas `.ideas-quote` 0.89 · Referee `.crit-quote` 0.9 |
| a sentence explaining the row (the model's, mostly) | Referee `.crit-why` `.clm-why` `.cnd-why` 0.83 · Debate `.dbt-applies` 0.85 · Ideas `.ideas-reason` 0.86 · Glossary `.gloss-part-text` 0.86 · Citations `.cite-why` 0.88 · Glossary `.gloss-gloss` 0.89 |
| a small line: provenance, date, source | `.cite-meta` 0.77 · `.quotes-prov` `.dbt-meta` 0.78 · `.tl-when` `.gloss-sources a` `.crit-meta` 0.81 |
| a count | `.cnd-count` 0.81 · `.srch-count` 0.83 · `.gloss-count` 0.85 |
| a group's small uppercase heading | `.skim-cluster-h` `.dbt-group-head` 0.72 · `.tl-group > h3` `.ideas-group > h3` 0.77 |

The builder confirms each selector's job against its component before moving it; the table is a
starting list from the stylesheets, not a verdict.

## The change

**Six size tokens, named by job, in `src/web/styles/tokens.css`**, the semantic layer (imported
before every band sheet):

| Token | Job | Value | Why that value |
|---|---|---|---|
| `--type-item` | a row's main line, the thing you scan down | 0.92rem (14.7px) | the middle of today's cluster; most rows move by under half a pixel |
| `--type-quote` | verbatim source words under a row — the article's, or a cited page's | 0.88rem (14.1px) | the commonest value already |
| `--type-body` | a sentence under the row that explains it | 0.85rem (13.6px) | the middle of 0.83–0.89 |
| `--type-meta` | a small line: where, when, from whom | 0.78rem (12.5px) | the middle of 0.77–0.81 |
| `--type-count` | a number standing for how many | 0.83rem (13.3px) | the middle of 0.81–0.85 |
| `--type-label` | a group's small uppercase heading | 0.77rem (12.3px) | the sticky headings in Timeline and Ideas were lifted to it for readability; the two at 0.72 come up to meet them |

`--type-`, not `--text-`: `--text-pad-l` already means something else in `shell.css`, and
`--text-*` reads as Tailwind's size namespace even where it does not collide.

**A role is decided by the line's job in its row, not by whose words they are.** In Quotes the quote
*is* the row, so it is `--type-item`; under a Debate title, a quote is `--type-quote`.

Then **move the rules in the table onto the tokens**, one mode at a time, size only — no
line-height, weight, colour or face changes. Where a selector is shared with a line doing a
different job (`.mir-quote, .mir-criterion`; `.gloss-part-text` on FAQ's quote; `.gloss-count`,
which Quiz reuses for status sentences; `.dbt-group-head` on `.dbt-group-claim`), split the rule or
target the narrower selector, so that each line gets its own role and nothing rides along.

Visible effect: most rows move by less than half a pixel. The real moves are Skim's section line
and Timeline's label 14.1 → 14.7, Skim's and Timeline's quotes 13.4 → 14.1, Citations' title
15.4 → 14.7, and the two 0.72 group heads up to 12.3. Those are the ones the screenshots are for.

**What does not move, on purpose:**

- **Quiz's question** stays at 1.03rem, a named exception with a comment: it is one prompt the
  reader answers, set above its 0.94rem premise and answer box, not a row in a list (GPT Sol F3).
- **Timeline's and Ideas' group blurbs** (`.tl-blurb`, `.ideas-blurb`, both 0.79) — small
  explanatory copy, already equal; neither meta nor body.
- **Marginalia, Structure and the outline.** Marginalia is drawn small in the margin beside the
  prose, and Structure and the outline size their rows by distance from where you are
  (`--structure-tier-*`), which is already a named scale. Neither is a band row.
- **Diagram, Sketch and Illustrated** — their type is part of a fixed visual composition.
- **Chat** — its turns are prose, not rows.
- **Everything outside the band**: the shelf, /profile, the Tailwind pages, the masthead, dialogs.
  That is option B's ground, not A's.
- **One-off sizes in the band** — a button, a status line, a number in a chip. They keep their odd
  value. The aim is that the six jobs are settled, not that every number is.

**Search is in.** It has the same jobs (a quotation, a model's explanation, a count); the builder
maps them.

If a screenshot shows a move looking worse, that rule becomes a named exception with a comment
saying why. An exception with a reason is an outcome, not a failure.

**`/design` gains a "Text roles" section** after Faces: a compact matrix of each role against the
voices it actually appears in (Geist, the model's mono, the author's serif, the reader's Arial),
its value, and one line on when to use it. That is the page a person building the next mode opens,
and the side-by-side the 261006k review said was missing.

**Docs:** [typography.md](../project/typography.md) gains § Text roles in a band — the six jobs,
the rule ("a new band's line that does one of these jobs uses its token; anything else may pick its
own"), and what was left out and why. [mode.md](../project/mode.md)'s checklist gains one line
pointing at it. That is how a new mode finds them, which is the foundation Greg asked for.

### The test

`tests/type-roles.test.ts`:

1. **The tokens exist**, with their values, in `src/web/styles/tokens.css`.
2. **Each moved line uses its token**: a registry of `{file, selector, role}` — the table as
   built — and for each, the stylesheet parsed (not grepped: comments, `@media` blocks and `font:`
   shorthands are real here) and every declaration of `font-size` on that exact selector is
   `var(--type-<role>)`, with no later rule for the same selector setting a different size. Red
   first: written before the move, it fails on every row.
3. **Each named exception is listed** with its reason, so Quiz's question can't be "fixed" onto
   `--type-item` by the next tidy-up without someone deleting the reason first.

**No ratchet on literal sizes.** The plan had one (the count of bare numeric sizes in the band
sheets may not rise). GPT Sol's F6 showed a count proves little — remove one, add another, nothing
moves — and the strong version, an exact inventory of every remaining literal, would make every
edit to any band size a test edit. That friction is more than Greg asked for (*"not worth killing
ourselves over"*). The pointer from mode.md and `/design` is what a new mode will meet; the registry
protects what was moved.

### Screenshots

Before and after, the same article, every touched mode, at four sizes: 1440, 1024, a phone at 390,
and a phone held sideways at 844 × 390. A Sonnet subagent with Playwright on the box
([browser-control.md](../project/browser-control.md)) writes one script and runs it twice, so the
pairs are like for like, and records each target's computed `font-size` alongside. I compare them
myself; any that looks worse becomes an exception as above. Greg asked for screenshots so as not to
disrupt — they are for the agent's judgement, not a gallery for him (261007h, *"no need to show me
screenshots"*).

## The simpler option passed over

**Tokens and docs only, no moves** — define the six, document them, and let new modes use them.
Zero visible change, half an hour. Passed over because the tokens would describe a system nothing
used: the next agent would copy a neighbouring mode's literal rem, as every mode so far has, and
the point of A — the modes looking like one product — would not happen.

**Bigger, also passed over:** a scale for the whole app (option B). Greg: *"not worth killing
ourselves over."*

## Stages

1. **Before-shots** (subagent) — the current dev build, every mode above, four sizes.
2. **Build** (Opus subagent) — test red, tokens, moves, `/design` section, docs; gates green.
   GPT Sol code review, write-capable. Commit.
3. **After-shots and judgement** — same script, compared; exceptions applied where a move looks
   worse; re-gate; commit; push to `dev`.
4. **Bookkeeping** — q-dhnbhw quoted and acted, the note in `docs/user-feedback/`, endings, queue.

## Progress

- [x] GPT Sol plan review: approve with changes, eight findings, all taken
  ([answer](261008i-plan-review-sol.md)). F1 a sixth role, count; F2 the quote role is any verbatim
  source, and Quotes' and FAQ's quotes are in; F3 Quiz's question an exception, Citations' title
  in; F4 split shared selectors; F5 Search in, Diagram out by name; F6 the ratchet dropped for a
  registry; F7 label at 0.77; F8 blurbs left alone, a role-by-voice matrix, a landscape shot
- [x] Before-shots: 14 band views (Skim, Timeline, FAQ, Glossary, Quiz, Quotes, Ideas, Citations,
  Debate, Search, Referee's four parts) on three local articles, at 1440, 1024, 390 and 844 × 390,
  one script run twice, with computed sizes recorded. Debate had no reception rows locally and
  Mirror and Candidates no results, so those lines are checked by the test, not by a picture
- [x] Build (Opus): 49 test rows seen red before any CSS moved, then green; full `npm test` green
  (1868 files). Departures from the table, each judged right: Search's passage is `--type-item`
  (Quotes' case); `.dbt-group-count` and `.skim-cue` added; the `.gloss-count` role set on the
  counts by descendant selector, since Quiz borrows the class for status sentences
- [x] After-shots compared pair by pair. Every move is under a pixel except Glossary's definition
  (14.2 → 13.6px, still comfortable in the mono) and the two small heads up to 12.3px; no row
  rewraps badly at any width, including the phone. No move looked worse, so no new exceptions.
  `/design`'s matrix checked at 1440 and 390 (it scrolls sideways inside its panel on a phone).
  Seen side by side there, the model's mono and the reader's Arial read larger than the serif at
  one size; that is the face question 261006k left open, not a size one, and is not acted on
- [x] GPT Sol code review: approve with changes, six findings, all fixed by the reviewer and kept
  ([findings](261008i-code-review-findings.md), [answer](261008i-code-review-sol.md)): F1 FAQ's
  quote wins by specificity, not sheet order; F2 Debate's claim heading and F3 Mirror's block-id
  line made explicit exceptions; F4 the test now also loads the whole cascade onto DOM witnesses,
  so a different, more specific selector cannot override a role unseen (negative controls red);
  F5 two `/design` cells corrected; F6 the docs name all the exceptions
- [x] Pushed to dev
- [x] Bookkeeping: q-dhnbhw answered and acted, the report's note updated, endings regenerated

## Screenshots kept

Before on the left, after on the right, at 1440:
[Skim](261008i-shot-skim-before-after.png) (section line and quote up by about 0.6px) ·
[Glossary](261008i-shot-glossary-before-after.png) (the biggest move, the definition down 0.6px) ·
and [/design's Text roles](261008i-shot-design-text-roles.png).
