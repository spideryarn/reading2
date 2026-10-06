---
reports: spya-mvmpks
ending: shipped
parts: 3
---
# Remember mode becomes Learn mode, and Explore also covers critiques of the piece

`spya-mvmpks`, from Greg (admin; `feedback-reporter.ts` exit 0, by the sweep), filed 2026-10-05
07:48 UTC on `2605-20355v1-spya-ygtwkz`. SPIDERYARN-READING2-DG; Overseer queue item `qi-hsv465b2`.
This session has no Sentry sign-in and did not write the Sentry status; the next feedback sweep
does.

> Let's slightly expand the remit of explore submode in remember mode to help us think about
> potential critiques of the piece. And indeed, we may at some point want to change remember mode to
> learn mode. Yeah, let's do that. So remember mode is learn mode, and explore mode also is
> about—it's not just about sort of exploring ideas; it's also about exploring potential problems and
> criticisms and concerns and everything else like that. So it's really just about kind of deepening
> your thinking around the piece, whereas tutorial submode is more about understanding and
> internalizing what the piece says and making sure you've got a firm grasp of the author's intent.

**Ending: Shipped**, for this entry. It is on `dev` and not deployed. **The report is in three
parts, and the other two are queued and not built**, so the report as a whole is not finished:

- `qi-qg6ydbp7`: the two Features-page screenshots still show the old headings, and the browser
  pass was not done. Both need the worktree's app to sign in, which it cannot while the shared
  local database is behind `dev`'s newest migration.
- `qi-dabpymjd` (needs Greg): renaming the code's identifiers, the URL words and perhaps the
  stored thread kind from `remember`.

What we did. The plan, GPT Sol's three reviews and what landed are
[261005l](../plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md); the mode is
[remember-mode.md](../project/learn-mode.md).

- **Learn.** Every word a reader or a model sees says Learn: the bar, the tab title, the command
  bar, Help, Features, the prompts. Typing *remember*, or *remember quiz*, in the command bar still
  finds it. Links do not change: the address still says `?mode=remember`.
- **Explore.** A fifth move, a possible problem with the piece, with rules to keep it fair: the
  reader's own doubt first, the author's own answer looked for before objecting, an absence said of
  a passage and never of the whole piece, a missing source checked with the article's links before
  it is claimed, one problem at a time. A fourth starter in the empty state: *Where might this piece
  be wrong, or missing something?* Explore's chip is still behind the experimental switch.
- **Tutorial** is unchanged; it was already about the author's intent.
- **Measured**:
  [261005e](../investigations/261005e-explore-prompt-widened-to-critiques-of-the-piece.md). The
  gain is small, because Explore already answered a direct "what's wrong with this?" well. The
  first version of the new prompt made false "the piece gives no source" claims; the shipped one
  made none in the same runs.
