Verdict: **rethink**. Six of eight round-1 findings are closed, but P-1 remains open at P0 and P-2 remains partly open. The revised design still displays unchecked quotation-shaped text before its guard runs, while the provenance sentence makes claims the specified wire cannot establish.

## P-1…P-8 closure

| Finding | Status | Assessment |
|---|---|---|
| P-1 | **Not closed** | The prompt reduces risk, but the guard is still post-stream. “Taken back” does not undo text already read, and a disconnect can prevent replacement altogether. The guard also has substantial false negatives. |
| P-2 | **Not fully closed** | Exa pinning, the streaming probe, and counting only non-empty extracts are adopted. But “no full text of any page” remains unprovable, and the plan still does not name the exact per-result cap/configuration that the probe must establish. |
| P-3 | **Closed** | The weak identity line is removed, and the copy no longer claims any result is the work’s own page. A related new issue appears in Q-3. |
| P-4 | **Closed** | One hash now covers the article, work/link fields, capped passages, rendered profile, prompt version, and requested model, with hide-on-mismatch. |
| P-5 | **Closed** | The lower-level runner, separate request ownership, and three Explain request snapshots are the right seam. |
| P-6 | **Closed, conditionally** | The actual streaming probe is now the first gate; allowance numbers and arithmetic must be added before the rest of Stage 1 proceeds. |
| P-7 | **Closed for the original finding** | Nullable search count/provenance, context hash, both export paths, table inventory/read wiring, and public stripping are covered. Q-2 tightens what may count as a stored “source.” |
| P-8 | **Closed** | Investigate accepts only `finished`; unknown reasons and tool requests save nothing and emit no `done`. |

## Findings

### Q-1 — P0 — The post-stream quote guard still does not make streaming honest

The plan correctly repeats the original failure at [lines 53–54](</home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:53>), but then keeps the same timing at lines 57–62: check only after every delta has been displayed.

“Exposure is bounded” and “taken back” are not verification. Before the replacement arrives, the reader can read, copy, or act on the words. If the connection ends after the last delta but before the policy error, the visible text may never be replaced.

The scanner also misses:

- Markdown block quotes, italics, code blocks, HTML entities, and verbatim prose without quotation marks.
- Straight or curly single-quoted passages.
- Quotes shorter than six words, including titles, coined terms, and materially false short statements.
- Longer quotations split into several short quoted spans.
- A source quotation that also appears in the citing article—particularly likely when the article itself quotes the cited work.
- A passage found somewhere in the article but falsely attributed in the answer to an external source.

It can also reject legitimate text and give the wrong reason: a repeated profile phrase, reference title, or model-authored phrase in quotation marks is not necessarily a source quotation.

The six-word rule has been imported in the wrong direction. In 5G, fewer than six words is insufficient evidence that a quote was copied accurately; it does not follow that short quotations are safe to display unchecked.

**Concrete change:** Buffer the generated answer before displaying it and reject any quotation presentation—not merely long double-quoted spans—before either storage or rendering. Keep verified verbatim evidence exclusively in *Look it up*. If streaming is retained, do not claim it is quote-safe: the provenance must say the model was *instructed* to paraphrase, and the guard must be described as a best-effort backstop rather than a guarantee.

For a genuine guard failure, refusing the whole answer is correct. Selectively deleting the quotation can leave surrounding claims dependent on missing evidence. It is only “too blunt” because the proposed detector conflates article/profile/title quotations with source quotations.

### Q-2 — P1 — The provenance sentence is not true of the specified wire

At [lines 72–74](</home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:72>):

- **“We did not obtain the paper itself”** is defensible only if it means the full paper. An extract may itself come from the paper.
- **“or the full text of any page”** is not established. The provider labels the field as an extract but does not report whether a short page happened to fit in full.
- **“This was written from search extracts”** is incomplete. The request also supplies the whole article, work metadata, citing passages, and possibly the reader’s profile and purpose.
- **“It is the AI’s reading of those extracts”** similarly omits those inputs and cannot exclude model memory.
- **“paraphrased, not quoted”** is not established by the proposed guard.
- The parenthesised hosts are truthful only if they are derived from exactly the same non-empty-extract set counted by N. The proposed `sources: Citation[]` could otherwise include URL-only annotations the model did not receive as readable evidence.

The plan also permits an answer when `N = 0`, leaving the model to answer from the article or memory while the provenance announces zero extracts.

**Concrete change:** Require at least one non-empty extract before storing. Store and display as sources only annotations carrying non-empty evidence, and derive both N and the host list from that exact set. Use copy such as:

> We did not fetch or read the full paper. Web search returned extracts for N results (hosts); the provider does not say whether an extract contains all of a short page. The AI was asked to base claims about the work on those extracts, and used this article [and your profile and purpose] to relate them. It was instructed not to quote them.

If the output is buffered and quotation-safe, the last sentence can be strengthened accordingly.

### Q-3 — P1 — Removing the identity line also removes the boundary behind “what the work actually does”

The plan no longer overclaims that a result is the work, which closes P-3. But it still promises to say whether **the work** backs the claim and “what the work actually does” at [lines 44–48](</home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:44>). Nothing specified establishes that any extract belongs to, or reliably describes, that work. A similarly titled paper, review, correction, citing page, or DOI-bearing search URL can therefore become evidence about the wrong object.

Attribution such as “the abstract on arxiv.org says…” is model prose; the separate `Citation[]` does not bind that sentence to a returned source.

**Concrete change:** Make Investigate select at least one exact returned annotation as the work-bearing result and run 5G’s complete two-gate identity check internally before storing work-specific claims. Store the matched URL and match basis even if the UI continues to say only that the full paper was not obtained. If no result passes, do not state what the work does or whether it supports the claim; report that the search did not identify usable evidence.

### Q-4 — P2 — A failed “Investigate again” leaves an older stored answer behind

A second press overwrites only after successful completion. If the guard or finish check rejects the new run, “not stored” means the previous investigation remains in the database and can reappear on reload. The specified client instead replaces the streamed attempt with “it was not kept,” without saying that the previous answer remains.

**Concrete change:** Preserve and restore the previous stored answer in the client after a failed rerun, with copy such as: “The new investigation was not kept; the previous one is still shown.” If no previous current answer exists, show only the retry state.

The other new machinery—separate AI job, one exact context hash, nullable search accounting, and export coverage—is sound at plan level.