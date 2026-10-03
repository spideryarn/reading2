# Bounding an intermediate representation while emitting a larger serialized response

Stage 1 review of [261003l](../plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md)
found that `reader_notes` could exceed its promised character budgets. The defect is established
by four failing assertions before the fix; deployment or reader impact was not established.
Oversized tool results matter because they are sent again on later model rounds, and Explore is
intended to send this digest on every turn.

## The cause and the evidence

Introducing commit **`05a1dc3f8`**, “261003l stage 1: reader_notes, a Chat tool that reads the
reader's own notes”, added the pure formatters and promised announced caps and exact totals.
Blame attributes both the raw `row.length` budget check and the later rendering to that commit.

The class is **bounding an intermediate representation while emitting a larger serialized
response**. `wholeRows` in [reader-notes.ts](../../src/reader-notes.ts) measured rows before
[untrusted()](../../src/untrusted-fence.ts) expanded each stored `<<<` or `>>>` from three to five
characters. Digest and transcript rendering then added headings, notices and fence markers
outside the overall budgets. Individually bounded fields did not bound the final answer.

A second review caught an assumption in the first remedy: the old triple replacement was not
idempotent. Escaping `<<<<<` left a fresh `<<<`; fencing an already measured row could expand it
again. A new red test emitted a 6,043-character notes body against 6,000. The final helper breaks
complete delimiter runs, and a regression checks both delimiter directions at lengths 3–11 and
repeated application. This establishes a sizing defect, not a demonstrated complete closing-fence
forgery.

The red-first Vitest assertions in
[reader-notes-tool.test.ts](../../tests/reader-notes-tool.test.ts) measured:

| Returned representation | Actual characters | Budget |
|---|---:|---:|
| Ordinary digest, complete content | 8,863 | 8,000 |
| Notes body containing repeated delimiters | 9,126 | 6,000 |
| Ordinary transcript, complete content | 8,030 | 8,000 |
| Transcript containing repeated delimiters, complete content | 12,660 | 8,000 |

## Why the original checks agreed

The test named “keeps the whole answer inside one overall budget” measured only fenced bodies,
then allowed headings and fences a separate overhead. Delimiter tests checked that stored text
could not close a fence; they did not combine delimiter-heavy fields with budget assertions.
Thus the tests preserved the implementation's mistaken measurement boundary. Ordinary prose
could exceed the overall promise, and escaped prose could exceed even the body budgets.

The same measure-then-fence shape exists in `article_links` and `article_citations` in
[chat-tools.ts](../../src/chat-tools.ts). Their older contracts need a separate review; this
stage's fix does not establish complete-response budgets for those tools.

## The fix and the countermeasures

The review fix in the workspace shares an idempotent `escapeUntrusted` helper with the fence,
so row selection counts the escaped representation. Final rendering checks complete content:
it removes whole index rows before note rows, or the oldest whole transcript exchanges, until
the answer fits. Notices and shown counts are rendered again after removal. This is also the
long-term remedy: the contract applies to the representation delivered to the consumer.

Ranked by ease against value:

1. **Assert the final returned representation's budget** with ordinary and delimiter-heavy
   inputs. Added in this review and seen red on the original code. This catches expansion and
   wrapper overhead together.
2. **Share the escaping operation used for sizing and emission.** Included in the fix; a
separate estimate would create another representation that could drift from the output.
3. **Reserve a guessed fixed allowance or increase the caps** — rejected. Either can conceal
   this example while leaving later rendering changes outside the check.
4. **Build a generic budget framework for all tools** — deferred to a wider change. The narrow
   formatters can enforce their returned-content contracts directly without that machinery.

Up: [Postmortems](../project/postmortems.md)
