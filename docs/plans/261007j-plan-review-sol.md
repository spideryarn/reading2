No P0s. The guide itself is a good fit; most risk is in the surrounding UI and command machinery.

F1 — P1: `CHAT_TOOLS` contradicts “no web search”, and the dispatcher does not enforce per-kind subsets.

The plan gives Guide `CHAT_TOOLS` while saying it cannot reach the world ([plan:85](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md:85)). That set includes `read_web_page` and cross-library reads ([chat-tools.ts:327](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/chat-tools.ts:327), [chat-tools.ts:370](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/chat-tools.ts:370)). More importantly, `runTool` directly executes every shared tool; only `reader_notes` checks `toolsFor(kind)` ([chat-tools.ts:2053](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/chat-tools.ts:2053), [chat-tools.ts:2064](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/chat-tools.ts:2064)). A Guide-specific subset would therefore not be an authorization boundary.

Change the plan to define an explicit, stable `GUIDE_TOOLS` set, decide whether it excludes just provider search or also `read_web_page`/library access, and make `runTool` generically refuse any name absent from `toolsFor(ctx.kind)` before dispatch. Add a test proving an excluded model-supplied call performs no fetch or store read. Given the stated intent, I would exclude `read_web_page` but retain article tools; library access needs an explicit product decision.

F2 — P1: opening a single Guide thread inside Chat requires a second capability axis, not only `LearnKind`.

The plan notices that Guide is single-thread but not Learn ([plan:148](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md:148)), but the coupling is deeper:

- Chat can currently open only threads whose kind equals the band’s kind ([ConversationModes.tsx:503](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/modes/conversation/ConversationModes.tsx:503), [ConversationModes.tsx:519](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/modes/conversation/ConversationModes.tsx:519)).
- Every `SingleThreadKind` receives Learn selection, draft and composer behaviour ([ConversationModes.tsx:543](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/modes/conversation/ConversationModes.tsx:543), [ChatPanel.tsx:422](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/ChatPanel.tsx:422), [ChatPanel.tsx:483](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/ChatPanel.tsx:483), [ChatPanel.tsx:2684](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/ChatPanel.tsx:2684)).
- `sendTo` sends the component’s `kind` and includes `visible` whenever the Chat band has `onScreen` ([ConversationModes.tsx:1115](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/modes/conversation/ConversationModes.tsx:1115), [ConversationModes.tsx:1143](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/modes/conversation/ConversationModes.tsx:1143)). A Guide opened inside that component would therefore send `kind:"chat"` plus `visible`, yielding the existing 409 or 400 ([routes.ts:3106](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/routes.ts:3106), [routes.ts:3367](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/routes.ts:3367)).

Change Stage 2 to introduce explicit orthogonal concepts:

- `SingleThreadKind`: Learn kinds plus Guide, used by `targetOf`.
- `LearnKind`: Recall/Tutorial/Explore only.
- `openableInChat`: Chat and Guide.
- An authoritative outbound kind taken from the open thread or handoff target; add `visible` only for Chat.
- Guide uses per-thread Chat drafts, the one-line composer, no Live, and its own empty state.
- Extend handoffs with a required target so ordinary “Ask in chat” still creates Chat while Command Bar targets the singleton Guide.
- Pin Guide outside source filtering rather than merely relying on `listedInChat`, which currently lists every non-Candidates thread ([thread-source.ts:78](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/thread-source.ts:78)).

Add tests for existing/missing Guide, corrected optimistic IDs, drafts across mode changes, every Chat-list filter, ordinary handoff while Guide is open, Guide handoff while Chat is open, `kind:"guide"`, and absence of `visible`.

F3 — P1: a generic `mode` proposal is not always navigation-only and the full catalogue is too broad an allowlist.

The plan calls every `mode:<key>` a move ([plan:89](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md:89)), but opening a mode deliberately has the Dock’s generation behaviour and cost ([CommandBar.tsx:44](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/CommandBar.tsx:44)). The catalogue itself marks Summary and Diagram as generating ([catalogue:55](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/command-pick-catalogue.generated.json:55), [catalogue:80](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/command-pick-catalogue.generated.json:80)). The current proposal risk is fixed per proposal id, so one `mode` id cannot honestly label some arguments as generating and others as navigation ([command-proposal.ts:49](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/command-proposal.ts:49), [command-proposal.ts:276](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/command-proposal.ts:276)).

The generated catalogue also contains context-specific and experimental rows, whereas the existing Command Bar receives the Dock’s live `visibleModes` set specifically to avoid copying those rules ([CommandBar.tsx:69](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/CommandBar.tsx:69)).

Change the plan so drawing and pressing both resolve the target against the current owner-reading-view command set, not merely any catalogue `mode`/`submode` row. Derive `generates` from `modeGenerates`/`subModeGenerates` ([activation.ts:377](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/activation.ts:377), [activation.ts:698](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/activation.ts:698)). Test experimental-off, unavailable targets, generating modes and changed availability between render and press.

F4 — P1: first-open Guide selection needs one coordinator; the proposed URL change will race the existing first-open default.

`PurposePrompt` clears its mark only after a definitive purpose read, retaining it on failure ([PurposePrompt.tsx:21](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/PurposePrompt.tsx:21), [PurposePrompt.tsx:83](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/PurposePrompt.tsx:83)). Independently, `useLastView` claims first-open synchronously and later replaces the URL with Summary after settings load ([last-view.ts:618](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/last-view.ts:618), [last-view.ts:740](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/last-view.ts:740), [last-view.ts:771](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/last-view.ts:771)). Stage 3 does not say which wins, or how `<guide>` is known before thread loading ([plan:164](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md:164)).

Change the plan to add one owner-only first-open coordinator that owns the mark/purpose decision and blocks the ordinary Summary default only while that marked decision is pending:

- Stored purpose: clear mark and retain normal Summary default.
- Definitively absent + band fits: clear mark, select the existing Guide or one optimistic Guide, and suppress the modal.
- Definitively absent + narrow: keep the existing modal path.
- Failed purpose read: retain the mark and do not treat failure as absence.
- Reconcile an optimistic Guide with the stored singleton without losing its draft.

Add race-order and StrictMode tests, including settings/purpose arriving in either order, an existing Guide, failed reads, phone widths, and no duplicate thread or send.

F5 — P1: `purpose:<free text>` can hold the accepted line, but “Guide only” is not implementable through the current global chip API as described.

Today `CHAT_PROPOSABLE` is global and `chipFor` receives no thread kind ([chat-commands.ts:32](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/chat-commands.ts:32), [chat-commands.ts:66](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/chat-commands.ts:66)); the command context likewise contains only an executor ([CommandChip.tsx:31](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/CommandChip.tsx:31)). Therefore an injected ordinary Chat answer could render a `purpose` button unless kind becomes an authoritative input at both draw and press.

Free text is acceptable under the existing rule only if the complete exact payload is visible, bounded and reparsed on press; the hostile article can induce the proposal, but cannot execute it. That is the boundary documented by the existing hostile-article eval ([chat-tools.md:844](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/chat-tools.md:844), [chat-tools.md:884](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/chat-tools.md:884)). However, the plan should not call the payload “the reader’s own data”: it is model-authored text later represented to prompts as “Why they are reading this piece” ([profile.ts:83](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/profile.ts:83)).

Change the plan to pass stored thread kind into chip validation and recheck it on press; show the whole proposed purpose without ellipsis and identify it as AI-suggested. A safer 80/20 is to prefill/open the existing purpose editor, or save the reader’s latest message rather than arbitrary model-authored text. Add adversarial tests proving normal Chat never renders or executes `purpose`, even with a valid token.

F6 — P2: the Command Bar fallback’s state machine is ambiguous and currently contradicts “the fast pick stays first”.

With no static match, Enter currently invokes the fast picker; only a high-confidence navigation can run immediately, and no answer becomes `COULD_NOT_TELL` ([CommandBar.tsx:2172](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/CommandBar.tsx:2172), [CommandBar.tsx:2213](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/CommandBar.tsx:2213), [CommandBar.tsx:2301](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/CommandBar.tsx:2301)). Showing “Ask the guide” immediately on static no-match would make it the active row and bypass that picker.

Change Stage 3 to specify: first press runs the existing picker; only when it returns no usable row does the bar replace `COULD_NOT_TELL` with an “Ask the guide…” row; a fresh second press sends the sentence. Test double-Enter/in-flight locking, changed drafts, picker success, picker refusal, Guide handoff targeting and exactly one paid Guide send.

F7 — P2: shelf size is not reading experience, and the proposed query/cache/privacy treatment is underspecified.

`onTheShelf()` only means “published article-shaped row”; it does not scope by owner or archive state ([pg.ts:453](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/store/pg.ts:453), [pg.ts:460](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/store/pg.ts:460)). Those predicates are added separately by the real shelf query ([pg.ts:2361](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/store/pg.ts:2361)). The schema already has `opens` and `lastOpenedAt`, which are closer to Greg’s “articles already read” than imports on a shelf ([schema.ts:241](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/db/schema.ts:241)). Counts also require runtime numeric mapping, not merely a TypeScript annotation ([pg-admin.ts:464](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/store/pg-admin.ts:464)).

Change the plan either to omit experience personalization in v1—the cheapest cut—or define a coarse, owner-scoped bucket from previously opened articles, excluding the current article. Put that changing value in the final user message beside the profile, never into `GUIDE_SYSTEM` or the cached article prefix; the existing code explicitly keeps reader-varying data below the cache breakpoint ([converse.ts:1910](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/converse.ts:1910), [converse.ts:1977](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/converse.ts:1977)).

The privacy update is not conditional: this is a new derived account datum sent to a provider, and the page deliberately inventories what each model receives ([PrivacyPage.tsx:470](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/web/PrivacyPage.tsx:470)). Replace “if the shelf count counts” with a required privacy-page and privacy-doc update.

F8 — P2: the bookkeeping stage needs explicit negative decisions and a stronger eval.

No new route or gateway job is necessary: Guide can use the existing `/api/chat` route, and `jobFor` already maps every non-Candidates kind to the `chat` ledger/model route ([converse.ts:138](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/converse.ts:138), [ai-call.ts:423](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/src/ai-call.ts:423)). That means:

- No authenticated route-contract row, unless implementation introduces a new endpoint.
- No new `AI_JOB_ROUTE` or model inventory row.
- Guide costs will be reported as `chat`; state that this is intentional for v1 and add a `jobFor("guide") === "chat"` test.

Add to Stage 4:

- `security-map.md`: the plan touches files named there, although it should not alter the listed `slugPart`/`requireUser` or URL/slug defenses ([security-map.md:93](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/security-map.md:93), [security-map.md:103](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/security-map.md:103), [security-map.md:113](/var/tmp/spideryarn-worktrees/fbtddvg2-guide-agent/docs/project/security-map.md:113)). Document the new per-kind tool gate and proposal allowlists as defenses.
- Prompt-cache placement tests for experience data and stable catalogue/tool bytes.
- Owner-isolation/archive/count-mapping tests if the experience query remains.
- The UI/handoff/race matrix from F2, F4 and F6.
- An investigation write-up for the paid eval, including hostile articles asking for all three new tokens, normal Chat attempting `purpose`, hidden/experimental mode ids, long/encoded purposes, and scoring by the real draw-and-press validator. The current happy-path handful in Stage 3 is not enough for a boundary that existing evals have already shown prompts do not enforce.

The right 80/20 is the new kind, pinned Guide, static greeting, profile-aware conversation, and safe mode/search proposals. The parts likely to cost much more than the plan implies are embedding a singleton non-Chat kind inside Chat’s state machine and replacing first-open routing asynchronously. The free-text purpose write and exact experience count are the easiest pieces to simplify without losing the guide’s central value.

**Verdict: build with changes.**