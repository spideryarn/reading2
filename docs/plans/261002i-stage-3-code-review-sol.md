No P0s. The fourth-kind runtime design is sound, but I would not land Stage 3 until the revised prompt has fresh eval evidence and the Remember contract is made internally consistent.

### P1

- **Left — the available eval fails Tutorial’s core contract, and the prompt fix has not been re-evaluated.** In run 2, the unread reader gets two questions in Tutor 1, then a 150-word Tutor 2 containing three quotations and no block ID: [remember-tutorial.md:11](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/results/remember-tutorial.md:11), [remember-tutorial.md:19](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/results/remember-tutorial.md:19). That is the exact reader for whom citations are the guided-reading boundary. The doc’s “mild faults” summary omits the zero-citation turn and two hard length failures: [remember-mode.md:230](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/remember-mode.md:230).

  **Fixed in code:** `TUTORIAL_SYSTEM` now requires exactly one interrogative sentence/question mark, forbids evaluative openers, and checks every quotation or close paraphrase for a same-sentence genuine block ID: [converse.ts:920](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:920), [converse.ts:1024](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1024), [converse.ts:1050](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1050). The eval now detects the actual “Good —”/“That’s exactly…” openers without treating topical “perfect silicon replacement” as praise, and its scripted third answer now responds coherently: [remember-tutorial.ts:59](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/remember-tutorial.ts:59), [remember-tutorial.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/remember-tutorial.ts:86). A fresh eval run is still required.

- **Left — the accepted guided-reading decision is implemented, but `remember-mode.md` still states the opposite as the blanket Remember contract.** It says Remember “CANNOT” be used before reading and that the reader “has to have read the piece”: [remember-mode.md:49](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/remember-mode.md:49), [remember-mode.md:53](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/remember-mode.md:53). The Tutorial section later permits unread readers: [remember-mode.md:204](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/remember-mode.md:204). It also promises every taught piece is a quotation, while the prompt permits cited close paraphrase. I left this because it is an important rule doc requiring an approved before/after edit.

- **Fixed — the new export test originally stopped at export, despite the plan-review P1 requiring export→restore.** It now restores through the real seeder, asserts all four kinds survive, and exercises the Tutorial unique index: [store-export-thread-kind.test.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/store-export-thread-kind.test.ts:89).

### P2

- **Left — secondary source docs and comments still describe the old two-way switch.** This includes [url-state.md:91](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/url-state.md:91), [quiz.md:254](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/quiz.md:254), [icons.md:254](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/icons.md:254), [modes.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/modes.ts:97), [activation.ts:300](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/activation.ts:300), and [quiz.css:20](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/styles/quiz.css:20). Runtime URL and activation behaviour are correct; these are documentation drift outside the supplied stage files.

- **Fixed — tests had several silent gaps.** I added Tutorial’s spoken-route rejection, Start-over lifecycle, no-arm chip behaviour, explicit command-bar ranking, web-tool parity, and full shared prompt-section equality rather than comparing only the first 300 characters: [chat-spoken-route.test.ts:447](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/chat-spoken-route.test.ts:447), [remember-own-thread.test.tsx:473](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/remember-own-thread.test.tsx:473), [tutorial-kind.test.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/tutorial-kind.test.ts:45), [tutorial-kind.test.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/tutorial-kind.test.ts:81).

- **Fixed — `subModeParams` put a declaration directly in a switch clause.** It is now scoped and remains exhaustive: [sub-modes.ts:244](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/sub-modes.ts:244). Help/catalog wording and search terms were also brought into line with unread Tutorial use.

### Audit results

No unhandled runtime fallback was found. `SINGLE_THREAD_KINDS` drives both `targetOf` and `ConversationBand`; stale fresh IDs join the existing Tutorial thread; normalisers use `isThreadKind`; Chat overlays use positive Chat checks; Tutorial receives no Live controls and the server rejects spoken Tutorial turns; cost/model attribution to Chat is deliberate and tested.

The migration is a safe CHECK widening followed by a partial unique index, with no pre-existing Tutorial rows to fold. `npm run db:chain` passed, as did the journal/snapshot/digest tests. The extracted Recall spoken/citing sections preserve the prior `REMEMBER_SYSTEM` bytes exactly.

Checks:

- `node --import tsx scripts/typecheck.ts`: passed all projects.
- Focused non-Postgres Vitest: 106 passed.
- Migration Vitest: 67 passed.
- `plain-words-wiring`: 13 passed; its changelog case could not spawn Git in the sandbox (`EPERM`).
- Biome: no errors; one advisory for the new eval’s existing `main` complexity.
- Could not run `chat-spoken-route.test.ts`, `remember-route.test.ts`, or `store-export-thread-kind.test.ts`: sandbox cannot connect to Postgres on `127.0.0.1:54362`.
- Full `npm test` was not run.

**Verdict: not ready to land.** Runtime architecture looks correct, but rerun the Tutorial eval against the revised prompt, run the three Postgres-backed files, and reconcile `remember-mode.md` before landing.