# Fable to Opus in the Overseer's routing, and dropped cases to Greg

Greg retired Fable on 2026-09-28, and on 2026-10-07:

> yes, switch to using Opus 5.5 over Fable, with GPT Sol (latest) for technical/cross-model-family
> review/input
>
> — Greg, 2026-10-07

The Overseer's attention classifier still offered `"fable"` as a holder, and routed *"wording, a
default, or whether a case can be dropped"* to it. The last of those had already been settled as
Greg's ([overseer-direction.md § The gates](../project/overseer-direction.md#the-gates)); the
prompt was never brought into line.

## What changed

- **The holder is `opus`.** `ProposalRecipient` in `tools/fleet/wire.ts`, and every list of
  holders (classifier, memory, overseer store, fleet server, browser, labelled set).
- **The prompt routes** wording, defaults and arbitration between two workable options to Opus
  *"when nothing irreversible is at stake"*, and *"whether a case can be dropped"* to Greg.
  Sol's line is unchanged.
- **The prompt version is now 3.** `PROPOSAL_PROMPT_VERSION`'s own rule is to bump whenever a
  verdict's meaning changes, and a version-2 verdict may have sent a dropped case to Fable. A
  version-2 verdict is now stale and re-read first, as designed (plan 260910f D3).
- **Decision advisers gain `opus`.** New decisions can say Opus advised them.

## Stored values: two different answers, on purpose

- **Attention proposals map `fable` → `opus` when read** (`storedRecipient` in
  attention-classify.ts, and one restated copy in each of the overseer store, the fleet server and
  the browser parser, which restate rather than import by design). A proposal is a *route*: a
  stored `fable` means "ask the model for judgment", and that model is now Opus. Nothing on disk
  is rewritten. As of 2026-10-07 there was nothing to map anyway: proposals are off in production
  (`OVERSEER_PROPOSALS` unset) and `~/.overseer/attention.json` held two version-1 verdicts with
  no holder.
- **Decision advisers keep `fable` readable, as `fable`.** An adviser is *history*: those
  decisions really were advised by Fable, and `~/.overseer/decisions.jsonl` has some. Mapping them
  to Opus would falsify the record. The panel still labels them "Fable".
- A model answering `fable` **now** is refused like any unknown holder (D8): it is answering a
  prompt it was not given.

## Left alone, deliberately

- **The `ask-fable` action id.** It already asks Opus (label, text and `model: "opus"`); the id
  was kept on 2026-09-28 because it is on the wire between the dashboard and the server. Renaming
  it would need an alias for old tabs, for no change in behaviour.
- **`Fable` in `tools/fleet/vocabulary.ts`** — dictation hints; the name still appears in
  quotes and history, so it is still a word people say.
- **Attributions** ("Fable's ruling, 2026-09-08") in code comments and docs, and Greg's quotes
  naming Fable. Those are history.
- **Pane fixtures** that show Claude Code's own model menu.

## The eval

`scripts/attention-eval.ts`, paid, against the 25-item labelled set (the wording fixture is now
labelled `opus` and renamed to match). The before arm ran prompt version 2 on `0363fb62d`, in a
separate checkout; each run cost about $0.006.

| arm | routing correct |
| --- | --- |
| before (v2) run 1 | 4 of 7 |
| before (v2) run 2 | 3 of 6 (+1 unplaced) |
| first v3 wording, runs 1–3 | 5/8, 2/7, 4/8 |
| final v3 wording, runs 1–3 | 4/8, 3/7, 5/7 |

The totals are inside the noise between two runs of one prompt. The per-item table was more
useful. The **first** v3 wording (*"a judgment rather than a fact — wording, a default, or
choosing between two options that both work"*) sent the shut-it-down fixture (labelled Greg:
killing processes) to Opus in all three runs, where v2 had said Greg or unplaced. Adding *"when
nothing irreversible is at stake"* brought it back to Greg in two of three (one `self`). The
wording fixture went to Opus whenever it was judged.

**A defect in both arms, not fixed here:** the sort-order and wording fixtures are usually
*unjudged* because the model quotes 370–430 characters and the card's bound is 300
(`MAX_ASKS_CHARS`). That is why the Sol and Opus fixtures rarely score. It is the same before and
after, and fixing it is a separate prompt change.

**Fixed 2026-10-08, in the prompt.** The bound stays: 300 is the card's height on a phone, and two
dashboard parsers restate it. The `asks` line never said 300. It now asks for the *shortest* exact
passage, states `MAX_ASKS_CHARS` from the constant the parse checks, says the options before the
question are not the quote, and gives an example. No version bump, because a verdict means what it
did and a refused one was never cached. `tests/overseer-attention-classify.test.ts` holds the
prompt to the constant.

| v3 prompt, 3 runs each (~$0.006 a run) | sort-order (sol) | wording (opus) | routing correct |
| --- | --- | --- | --- |
| before: quote unbounded | judged 1 of 3 (426 chars twice) | judged 1 of 3 (413 twice) | 5/10, 2/6, 3/7 |
| after: shortest, at most 300 | judged and correct 3 of 3 | judged and correct 3 of 3 | 5/9, 4/9, 5/9 |

After the fix the two fixtures quote *"Tell me which and I'll do it."* and *"Your call on the wording;
I'll swap it in either way."*. **A separate, older cause of unjudged items is still there:**
`ended-prose-no-question-two-messages` sometimes reasons past `MAX_COMPLETION_TOKENS` (1,000) and
comes back empty or cut off. Sixteen direct calls each, at temperature 0: 3 with the old wording,
4 with the new. So the change did not cause it. It is a budget trade-off (the day budget reserves
against that cap), so it is left for the Overseer to decide.

## Review

GPT Sol reviewed the code (fix-in-place). One real finding, fixed: bumping the version had
stopped the memory parser refusing a version-2 question with no proposal, because the check
compared against the *current* version. The class and the fix are in
[261007t](../postmortems/261007t-changing-the-active-version-silently-narrows-validation-of-readable-history.md).
Sol also agreed with keeping `ask-fable`, and left new decisions able to record `fable`, since
refusing it on write would also refuse a report written before the change and replayed after.
