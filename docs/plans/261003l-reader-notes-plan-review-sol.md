Reviewed against `48f4c195`. No files changed, tests run, or migrations applied. I found no cross-owner HTTP path to `runTool`.

The six statements in “What is already there” are substantially accurate:

| Statement | Assessment |
|---|---|
| Marks share `Comment` storage | Correct; fields such as body, quote and colour are optional. |
| Threads load with kinds and messages | Correct. |
| Stores enforce ownership | Correct, through the **article’s owner**, before reading child rows. See [pg-comments.ts:135](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/store/pg-comments.ts:135), [pg-chat.ts:333](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/store/pg-chat.ts:333), and [pg.ts:353](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/store/pg.ts:353). |
| Web search reaches every kind and round | Correct; server tools are withheld on the final round, but web search remains. [converse.ts:2248](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/converse.ts:2248). |
| Profile reaches the final user message | Correct, when profile use is enabled. |
| Tutorial supplies the integration template | Correct: 33 source/test files, plus docs, evals and migration metadata. Its migration was subsequently regenerated as `20261002232057_tutorial_thread_kind.sql`. |

Findings, ordered by severity:

1. **PR-1 — P1, established: the digest disappears on turn two, before history trimming matters.**  
   The plan injects the digest into the first request and explicitly does not store it ([plan:129–133](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md:129)). Storage writes only `question` into the user row ([chat.ts:280](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/chat.ts:280)); later requests reconstruct history from `m.text` alone ([converse.ts:1574](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/converse.ts:1574)). Consequently, Explore’s second answer sees only whatever the first answer happened to repeat.

   **Change:** send the bounded digest on every Explore turn, below the breakpoint. Resolve it using the authoritative returned `thread.id` and `thread.kind`. Add request-construction tests for the opening send, retry, edit of the opening question, second turn, and history trimming. If first-turn-only remains, define precisely how retry/edit identify that turn; checking whether the thread existed before the request is insufficient.

2. **PR-2 — P1, established: the conversation index has no output bound.**  
   Notes have row/character caps and transcripts have character caps, but the index promises “one row per conversation” without either ([plan:65–76](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md:65)). `chatStore.load` returns every thread and every message for the article ([pg-chat.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/store/pg-chat.ts:198)). Unlimited ordinary Chat threads can therefore defeat the promised bounded digest.

   **Change:** specify an index row cap, title clipping, character budget, ordering, and exact eligible total after excluding Candidates/current thread. Define whether the combined notes/index response also has one overall budget. Test many threads and long titles.

3. **PR-3 — P1, established: Live cannot supply the thread identity needed for exclusion.**  
   Adding `threadId` to `ToolContext` does not complete the Live path. Its endpoint accepts `{name,args}` and constructs context without a thread ([routes.ts:4276](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/routes.ts:4276)); browser wiring also sends no thread/session identity ([wiring.ts:236](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/web/live/wiring.ts:236)). Yet adding the tool to `CHAT_TOOLS` automatically exposes it to Live ([live.ts:407](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/live.ts:407)).

   **Change:** name the plumbing through both Live engines and validate the supplied thread/session against the owned article. Cover stored threads and Live’s initially local-only thread. Otherwise explicitly withhold this tool from Live in Stage 1.

4. **PR-4 — P1, reasoned: a role-only transcript can misrepresent failed or interrupted exchanges as completed discussion.**  
   The proposed transcript preserves speakers and clips text, but specifies no treatment of pending, error, stopped or interrupted messages ([plan:74](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md:74)). Those distinctions matter: failed Chat turns retain partial prose ([routes.ts:3462](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/routes.ts:3462)), and interrupted Live transcripts may contain words the reader never heard. Existing model history deliberately excludes interrupted pairs ([converse.ts:1708](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/converse.ts:1708)).

   **Change:** define eligible exchanges, incomplete-state labels, pair-preserving clipping and timestamp output. Enforce the same eligible-thread rule on direct `{thread:id}` reads as on the index, so supplying an excluded Candidates/current-thread ID cannot bypass that restriction.

5. **PR-5 — P2, established omission with reasoned consequence: “No Live, as Tutorial” needs an explicit implementation step.**  
   The current UI suppresses Live specifically when `kind === "tutorial"` ([ConversationModes.tsx:736](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/web/modes/conversation/ConversationModes.tsx:736)). Adding Explore elsewhere leaves this branch offering Live, despite `SpokenKind` accepting only Chat/Recall ([chat.ts:423](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/chat.ts:423)).

   **Change:** explicitly update that capability check and test that Explore has no Live control. Expand Stage 2’s inventory to name `THREAD_KINDS`, `NEW_THREAD_TITLE`, `ConversationVisibilityByKind`, the keyed Explore band, `REMEMBER_SUB_MODES`, and `subModeParams`. Several are compiler-checked; the runtime vocabulary and UI behaviour still deserve direct tests.

6. **PR-6 — P2, reasoned: the eval needs a runnable tool fixture and a narrower claim.**  
   The Tutorial template disables server tools and uses the synthetic slug `eval-tutorial` ([remember-tutorial.ts:195](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/evals/learn-tutorial.ts:195)). Reusing that setup cannot evaluate note retrieval. The proposed comparison also changes **both prompt and automatic digest delivery**, so it can compare B with A+B, but cannot isolate a prompt effect.

   **Change:** specify isolated owner/article/notes/thread fixtures or a controlled tool-runner seam, enable server tools, and exercise the production digest construction. Record actual tool calls and `done.searches`; a judge cannot establish whether searching happened from prose alone. Give the judge the fixture notes/profile, conceal arm names, and define numerical thresholds for “far more often” and “brief.” Five-turn runs also need separate deterministic retry/edit/history tests. Call the result a **product comparison**, or add equal-context arms to support a prompt-only claim.

7. **PR-7 — P2, established: the owner-isolation test is described using an impossible normal fixture.**  
   The plan asks for “a second owner’s notes on the same slug” ([plan:97](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md:97)), but article slugs are globally unique ([schema.ts:168](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/db/schema.ts:168)).

   **Change:** test two valid owned articles, then call the actual wrapper/HTTP path as owner A using owner B’s slug and thread IDs. Assert rejection/no returned private text. Include the Live endpoint, which is independently callable.

Ownership holds across the paths you named. Public dispatch goes through its separate namespace; authenticated routes set the verified user as the ambient owner ([routes.ts:7520](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/routes.ts:7520), [routes.ts:10840](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/routes.ts:10840)). Typed Chat and Live both load the owned article before running tools. Admin status does not change that owner identity. `runTool` itself is not an authorization boundary; its reachable HTTP callers and store reads supply that boundary.

Other integration conclusions:

- **Command bar:** add Explore’s sub-mode words and URL mapping. “No command chips” refers to model-proposed action buttons, not omission from command-bar navigation.
- **Activation/last-view:** existing logic already treats every Remember view except Quiz as inert; last-view remembers the `remember` parameter generically. Add Explore coverage; no new automatic spending mechanism is needed.
- **Export/import:** kind handling already uses `isThreadKind`, and the bundle preserves stored kinds. Extend the real restore test.
- **Cost/admin/fleet:** Explore inherits the `chat` job and existing article attribution. Admin counts all thread kinds ([pg-admin.ts:515](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/store/pg-admin.ts:515)). I found no fleet article-thread counter needing an Explore branch.
- **Timestamps:** threads have creation/update timestamps; messages have creation and optional edit timestamps, rather than `updated_at`. Correct the plan’s wording.
- **Candidates:** it deliberately sees the byline to exclude authors ([converse.ts:1186](/home/greg/code/spideryarn2/.claude/worktrees/explore-submode-and-reader-marks-tool/src/converse.ts:1186)). The anonymisation suspicion therefore does not establish a violation. Withholding personal-note access remains a sensible scope choice. Recall/Tutorial need behavioural checks before deciding whether to withhold it.

The migration design is sound. Fencing also follows the existing convention, but the acknowledged outbound leakage risk remains: URL limits reduce capacity; they do not prevent sending a short private note, including through a URL path.

**Verdict: build with the changes named, particularly PR-1 through PR-4.**