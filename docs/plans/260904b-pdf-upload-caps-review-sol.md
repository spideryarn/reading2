Verdict: the feature and ownership move are right, but I would request three changes before landing.

## Findings

1. **[P2] Preserve `pdf-read.ts`’s existing export while moving ownership.**  
   Moving the canonical value to [uploads.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/uploads.ts:67) is the cleanest design. A new shared limits module, build-time substitution, or runtime configuration would all add machinery without improving ownership.

   However, removing the existing `MAX_PAGES` export creates avoidable integration risk for the branch heavily editing `pdf-read.ts`. Keep a compatibility re-export:

   ```ts
   import { MAX_PAGES } from "./uploads.js";
   export { MAX_PAGES };
   ```

   The browser still imports `uploads.ts` directly, there remains one source of truth, and concurrent code importing from `pdf-read.ts` keeps compiling. New consumers should use `uploads.ts`.

2. **[P2] The component test proves rendering, not visibility.**  
   [The test’s `textContent` helper](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx:59) stays green with `hidden`, `aria-hidden`, `display:none`, `tw:hidden`, `sr-only`, or off-screen positioning. It is nevertheless a real test: it catches omission, wrong wiring, and numeric drift.

   Strengthen it cheaply by locating the actual hint element and checking:

   - its text contains `PDF` and both derived limits;
   - neither it nor an ancestor has `hidden`/`aria-hidden`;
   - no inline `display:none`/`visibility:hidden`;
   - no known hiding utility such as `tw:hidden` or `sr-only`.

   Better still, give the hint an `id` and the PDF button `aria-describedby` pointing to it. That makes the limits discoverable to screen-reader users and gives the test a semantic selector. jsdom cannot prove arbitrary stylesheet or geometric visibility; a browser test would be required for that, and I do not think one is warranted for this line.

3. **[P2] Give the three picker refusals codes.**  
   I would reverse the deliberate exception in [uploads.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/uploads.ts:96). A code identifies an authored branch; it is not inherently about a provider or request. The microphone failures already establish that client-only failures benefit from codes.

   This report is exactly the evidence: “couldn’t upload PDF” could mean MIME/name rejection, empty file, size rejection, page rejection, quota, transfer failure, or extraction failure. The support value exists before any request is sent.

   Use distinct picker codes—do not reuse `[up-pdf]` or `[up-big]`, because those identify different server-side sentences and stronger byte-level checks. For example: `[pick-pdf]`, `[pick-empty]`, and `[pick-big]`. Add the same shape invariant used by the dictation tests. These need not enter `CODE_KINDS` unless some interface will classify them.

## Direct answers

- **Render condition:** `{!chosen && !transfer}` correctly makes the hint and file row mutually exclusive. But it means “no transfer record,” not “no transfer running.” Terminal `failed`, `cancelled`, `queued`, and `article` transfers remain present until forgotten, so the hint stays hidden. It can also be hidden under a new local refusal if a terminal transfer remains. I would retain the predicate for the one-slot layout, but correct the comments/specification. Changing it to `!chosen && !busy` would draw the hint alongside a terminal file row and cost the height the design is avoiding.

- **`formatBytes`:** safe for all actual callers. Integer progress values now become `6 MB` rather than `6.0 MB`, which is consistent with the intended presentation. `mb >= 100` is equivalent to the old opposite branch for finite numeric inputs. For `NaN`, the branch differs but both implementations still produce `NaN MB`; no caller supplies it. Keeping `mb < 100` would make the equivalence more mechanically obvious, but there is no functional defect.

- **Copy:** the hint is good. The size refusal is acceptable, though “This file is 60 MB; the limit is 50 MB.” is slightly clearer. Two phrases should change:

  - The picker only inspects MIME/name hints, so `That isn't a PDF` is too certain. Prefer `That doesn’t look like a PDF.`
  - `reads at most 250 of them` can momentarily suggest that the first 250 pages will be processed. Prefer `This PDF has 300 pages; this app accepts PDFs of at most 250 pages.` Likewise, the static record could say `That PDF has more than the 250 pages this app accepts in one document.`

Validation: the 17 focused tests passed, the message/bundle invariants passed, lint found only an existing complexity advisory, and a client production build succeeded. Full typechecking is currently red solely in unrelated concurrent `illustrated`/`DiagramPanel`/job-test work.