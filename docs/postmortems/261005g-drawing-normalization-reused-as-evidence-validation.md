# Drawing normalization reused as evidence validation

Caught during review of [plan 261005h](../plans/261005h-five-small-ui-fixes-from-the-queue-search-copy-remember-chips-shelf-pills-shift-marginalia-yearless-date-shelf-facts-dot.md), item D. A Timeline note could select an earlier occurrence that did not contain its temporal phrase. No production impact was established.

## The class: drawing normalization reused as evidence validation

`quoteHolds` in [notes.ts](../../src/web/marginalia/notes.ts) used the default `findQuote` pass to establish phrase containment. That pass deletes whitespace when its first pass fails: useful for drawing a stored quote against rendered text, unsafe as evidence that a phrase is present. [quote-match.ts](../../src/quote-match.ts) explicitly distinguishes those jobs; server `locatePhrase` in [timeline.ts](../../src/timeline.ts) uses `"spaced"`.

Two exact, surviving quotes expose the distinction without re-extraction:

| Dating phrase | Earlier quote, wrongly selected | Later quote that actually holds it |
|---|---|---|
| `In June` (`noYearFrame`) | `Acme discussed its launch in Injune.` | `In June, Acme launched.` |
| `Later on` (`words`) | `Acme discussed the late Ron and its launch.` | `Later on, Acme launched.` |

The first inner lookup returns `{start:29,end:35}` for `Injune` under the default pass and `null` under `"spaced"`. The parser returns `noYearFrame` for the later `In June` passage with no year frame, so this is reachable from a valid stored event. The quote offsets themselves are correct: `findQuote` maps normalized characters back to the original input.

`git log -S` and blame identify **`3ec64f141`** as introducing the helper and the yearless-note bug. Its intended containment fix also carried forward the existing `words` case's permissive matching. Existing tests distinguished inside from outside a quote, but used ordinary word boundaries and never challenged the matcher's equivalence.

## Fix and countermeasures, ranked

1. **Red-first boundary-collision regressions** in [marginalia-notes.test.ts](../../tests/marginalia-notes.test.ts): both two-block fixtures above must select only the later quote. These are cheap tests of the evidence/drawing distinction, rather than tests that merely repeat the implementation.
2. **Use the existing evidence matcher at the assertion boundary:** inner phrase lookup becomes `findQuote(slice, phrase, undefined, "spaced")`. This is the intended long-term fix here. Outer quote lookup keeps its existing drawing tolerance; the two lookups serve different purposes.
3. **A global matcher rewrite is rejected for this work.** It would change other features' drawing behavior and stored-artifact handling. The shared helper already offers the required distinction; enforcing it at this containment assertion is sufficient and narrower.

The regressions were run before the fix: **2 failed, 1 passed, 49 skipped**;
both failures received the earlier block instead of the later one. After the
inner lookup changed to `"spaced"`: **3 passed, 49 skipped**. The third case
checks that whitespace runs, curly quotes and a Unicode lowercase expansion
before the quote still produce correct slice offsets.

Up: [postmortems.md](../project/postmortems.md).
