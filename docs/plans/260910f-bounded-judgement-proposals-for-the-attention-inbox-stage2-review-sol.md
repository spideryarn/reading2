## Findings

- **F15 — P2 — established:** the three downstream parsers accept `asks` text absent from the evidence excerpt.  
  Input: excerpt `Tell me which one.`, `asks: "This text is not in the excerpt."`; it parsed and rendered as the quoted sentence.  
  Smallest fix: repeat the normalized substring check after parsing each item in [store.ts](/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement/tools/overseer/store.ts:2838), [attention.ts](/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement/tools/fleet/attention.ts:525), and [types.ts](/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement/tools/fleet/web/src/types.ts:1754).

- **F16 — P2 — established:** accepted persisted data can render a model as Greg.  
  Input: `by:{kind:"model",model:"Greg",via:"overseer"}` renders “Proposal by Greg via the Overseer.”  
  Smallest fix: make the fixed UI wording carry the type: “Model proposal via the Overseer · model: Greg …”, including the unplaced tooltip, with a regression test in [AttentionPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement/tools/fleet/web/src/AttentionPanel.tsx:740).

- **F17 — P2 — established:** `asks` is unbounded and can restore the entire hidden 4,000-character tail above the disclosure. It also accepts one-character “sentences.”  
  Input: a 4,000-character tail returned verbatim as `asks`; [parseRoute](/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement/tools/overseer/attention-classify.ts:507) accepted it.  
  Smallest fix: impose a documented maximum in the classifier and all three wire parsers, with boundary and narrow-card tests.

- **F18 — P2 — reasoned:** cached proposals do not retain which model produced them. Changing `ATTENTION_CLASSIFIER_MODEL` without changing prompt version causes an old cached verdict to be attributed to the new model, without another call.  
  Smallest fix: store the producer-stamped classifier identity with the cached judgement and use it for attribution and proposal identity.

**Verdict: accept Stage 2 with four P2 follow-ups.** No established P0 or P1.

The requested questions check out otherwise: default-off behavior is preserved; recipient parsing is closed with no Greg fallback; `by` and `reach` cannot survive model-output canonicalization; current production reaches only `LIVE_SEAMS`; reach is recomputed per pass; no proposal triggers sending; and the 25,291-token version-2 prompt bound plus 1,000-token completion cap fits the reservation.

Besides `reason`, `asks`, `why`, and `topic`, the legitimate model-written text that survives is `unplacedWhy` and nested `answerability.why`. Arbitrary additional fields are stripped.

Focused tests passed 220/220. The supplied scoped result was 1,060/1,060 with clean typecheck. The full-suite log’s four failures were all caused by missing build artifacts, unrelated to this change.

Full report: [260910f-stage2-review-findings.md](/tmp/260910f-stage2-review-findings.md). I changed no repository files.