No P1 findings. The production dispatch is sound, but I found one P2 test gap and two P3 evidence/documentation problems.

### Findings

- **P2 — “Search with pending work” can silently stop being pending while the test remains green.**  
  The test installs a dummy `releaseSearch` at [the wiring test:595](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:595), which is replaced only if `/api/search/` actually reaches the deferred handler. Nothing asserts that replacement happened or that the request remains unresolved before leaving Search. Moreover, the test selects `match=words`, whose marks come from `findLiteral`, independently of the saved-run response. If the GET is removed or starts resolving immediately, every visible assertion still has the same answer and the eventual `releaseSearch?.()` merely calls the dummy. This is exactly the silent-success shape the test says it guards against. Assert that the deferred request was registered and remains unsettled before navigation; if the late reply itself is meant to be load-bearing, give it an active meaning-search with a distinctive hit.

- **P3 — the new `key={mode}` regression guard protects behavior React already guarantees, and its explanation is false.**  
  Chat returns `ConversationBand` directly at [Reader.tsx:1362](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/reader/Reader.tsx:1362), while Remember returns `RememberBand`; only inside that wrapper is another `ConversationBand` mounted at [ConversationModes.tsx:126](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/modes/conversation/ConversationModes.tsx:126). The top-level type changes, so React discards the Chat subtree before mounting Remember, with or without the key. A minimal probe against the installed React logged `init:chat, init:remember, cleanup:chat` without keys. Thus the green mutation was not a coverage hole. The contrary claims in [glossary-band-wiring.test.ts:317](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/glossary-band-wiring.test.ts:317), `Reader`’s comment, and the plan should be removed or corrected.

- **P3 — the A → B → A arm does not repeat the sequence the test and plan claim.**  
  The article-change case at [the wiring test:668](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:668) exercises only Ideas and Timeline. It never exercises Search, either Referee producer, Plain, Back, or the deferred reply across an article change. That is narrower than “the same again” in the test header and the completed-plan account. Either narrow those claims or extend the arm; currently article-scoped wiring mistakes in the other three slots evade this variant.

### Requested checks

- `selectPassages` is exhaustive and correct over all 14 modes. The actual `onFound` publishers are exactly Ideas, Quotes, Timeline, Search, and Referee’s Criteria/Claims pair. None of the nine empty arms publishes `Found[]`; Glossary uses the separate `TermSelection` path.
- The `band()` rewrite preserves the rendering gates. Glossary, Quotes, and Timeline retain their owner/visitor and artefact conditions. Ideas retains one `FeatureBoundary` around both branches with the same target, reset key, and Plain escape.
- Collapsing the siblings into one slot does not create cross-mode reuse: every non-null case has a distinct top-level type. The conversation key is not needed for that conclusion.
- The large wiring test is load-bearing for setter wiring—the Timeline mutation is meaningful—but its pending-request and article-change claims are overstated as above.
- The `NO_FOUND` identity claim is real. `hitMarks`, `hitStrength`, `hitHues`, and `hitBlocks` all memoize on `passages` identity; a fresh empty array would invalidate all four and hand new maps into `TableView`.
- `new-mode.md` and `url-state.md` are otherwise accurate. Article-access and position files are byte-untouched by the commit.

Validation: the four focused files pass, 29/29. Typechecking passed all three projects and confirmed all 1,418 files are covered.