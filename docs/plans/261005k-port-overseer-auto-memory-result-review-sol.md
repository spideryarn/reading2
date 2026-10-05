**Not safe to prune yet.** I checked all 35 eligible files in full, their cited passages and moved edits, all 25 landed edits, and 13 retained rows. No files changed.

Seven eligible rows would lose lessons. Two further rows depend on workflow changes that should have remained proposals.

1. **RR-1 — P1 — A cut sentence still counts as ported.**  
   Memory: `no-production-db-access-from-this-laptop.md`. [Mapping row 145](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:145) marks the bucket’s `object/info` read and made-up-hash 400 control “moved (BE10).” The [plan log](/home/greg/code/spideryarn2/docs/plans/261005k-port-overseer-auto-memory-into-docs.md:114) says that sentence was cut as unverified, and [database.md](/home/greg/code/spideryarn2/docs/project/database.md:551) contains no replacement.  
   **Smallest fix:** mark **retain**; give L5 an unresolved disposition until verified and ported, or explicitly dropped with evidence.

2. **RR-2 — P1 — Formatter recovery loses its safety precondition.**  
   Memory: `biome-formatter-is-off-on-purpose.md`, lines 23–27. [Mapping row 113](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:113) preserves overwriting from HEAD and reapplying edits, but omits checking first that the content changes are exclusively yours. Its cited [linting.md passage](/home/greg/code/spideryarn2/docs/project/linting.md:220) also lacks that check. The omitted step protects peers’ uncommitted edits from being overwritten.  
   **Smallest fix:** mark **retain** and propose the missing check beside the recovery recipe.

3. **RR-3 — P1 — GitHub access loses the preflight and gains a Mac-only workflow.**  
   Memory: `no-github-cli-credential-on-this-box.md`, lines 21–23. [Mapping row 144](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:144) omits checking authentication before promising API work, completing independent work, and Greg’s option to authenticate this session. BE6 instead states [“Those are done from Greg’s Mac”](/home/greg/code/spideryarn2/docs/project/hetzner-remote-server-box.md:1203). The memory records a credential gap and explicitly allows login here; it does not establish that general workflow.  
   **Smallest fix:** mark **retain**, propose the omitted workflow, and restrict BE6 to the measured authentication state.

4. **RR-4 — P1 — The npm incident survives; safe probing does not.**  
   Memory: `npm-run-forwards-a-bare-argument.md`, lines 18–19. [Mapping row 148](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:148), [BE8](/home/greg/code/spideryarn2/docs/project/hetzner-remote-server-box.md:1209), and the script header preserve forwarding and the accidental restart. They omit the instruction to probe arguments with `--help`, a harmless invalid argument, or by reading the script—never an effective mode word.  
   **Smallest fix:** mark **retain** and add that safeguard as a proposal.

5. **RR-5 — P1 — Vercel access loses the check-before-depending lesson.**  
   Memory: `no-vercel-credential-on-this-machine.md`, lines 60–65. [Mapping row 146](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:146) and [BE11](/home/greg/code/spideryarn2/docs/project/vercel-hosting-deployment.md:93) preserve refusal versus lost authentication, but omit preflighting unattended runtime-log access before designing work around it. They also leave the allow-list remedy without its own disposition.  
   **Smallest fix:** mark **retain**, propose the preflight, and explicitly account for the remedy.

6. **RR-6 — P1 — A positive control does not cover an expired search window.**  
   Memory: `prove-an-empty-queue-with-a-control-query.md`, lines 22–23. [Mapping row 156](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:156) omits widening the period to find unresolved reports that aged out. Switching from Sentry to Postgres does not obsolete this: [feedback-unswept.ts](/home/greg/code/spideryarn2/scripts/feedback-unswept.ts:4) still defaults to 30 days. The cited `silent-success.md` passage covers positive controls, not time coverage.  
   **Smallest fix:** mark **retain** and propose the window check using the current `--since` interface.

7. **RR-7 — P1 — Overseer dispatch does not supersede independent claiming or handover.**  
   Memory: `announce-before-taking-a-queued-slice.md`. [Mapping row 110](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:110) substitutes Overseer dispatch instructions for a worker checking with peers and visibly claiming a publicly queued slice. It also drops “answer on timing, not ownership” as superseded. [overseer.md](/home/greg/code/spideryarn2/docs/project/overseer.md:583) does not cover agents starting independently, or handing an idle reserved slice to an awake peer.  
   **Smallest fix:** mark **retain** and propose those remaining instructions; retain the justified drops separately.

8. **RR-8 — P1 — New instructions landed outside the proposal boundary.**  
   The clearest cases are:

   | Edit | Memory | Landed instruction |
   |---|---|---|
   | BE5 | `full-suite-needs-tmux-on-this-box` | [testing.md:117](/home/greg/code/spideryarn2/docs/project/testing.md:117): grep the log before interpreting the failure |
   | BE11 | `no-vercel-credential-on-this-machine` | [vercel-hosting-deployment.md:91](/home/greg/code/spideryarn2/docs/project/vercel-hosting-deployment.md:91): grep the overflow file rather than reading it |
   | CE1 | `eval-corpus-in-a-worktree-is-the-fixture-cut` | [testing.md:745](/home/greg/code/spideryarn2/docs/project/testing.md:745): expands the permitted eval workflow |
   | CE7 | `scratchpad-scripts-cannot-import-repo-deps` | [testing.md:931](/home/greg/code/spideryarn2/docs/project/testing.md:931): prescribes absolute imports or rooted `createRequire` |

   BE6’s Mac-only workflow is covered by RR-3. BE10 also presents one particular Node/import/transaction recipe as the production-read workflow.  
   **Smallest fix:** keep descriptions of mechanisms and measured outcomes; move new instructions into proposals. Reassess CE1/CE7 eligibility if removing those instructions leaves their lessons uncovered.

9. **RR-9 — P1 — CE6 turns historical tool behaviour into false current claims.**  
   Memory: `writing-escapes-produces-raw-bytes.md`; [testing.md:903](/home/greg/code/spideryarn2/docs/project/testing.md:903). The text says this box’s grep returns nothing and exit 1 for NUL-containing files, that default `rg` reads them correctly, and that a zero-width space behaves the same way.

   Read-only byte probes showed current GNU grep 3.11 and default `rg` return exit 0 with binary-match diagnostics for NUL-containing input. Both print matching UTF-8 lines containing U+200B. [The existing test header](/home/greg/code/spideryarn2/tests/no-raw-nul-bytes.test.ts:17) already distinguishes historical ugrep behaviour from GNU grep. `file` reporting `data` is also not proof of a NUL.  
   **Smallest fix:** qualify the observation by tool/version/date, distinguish U+200B from NUL, and describe `rg -a` accurately.

10. **RR-10 — P1 — DE2 adds false exclusivity.**  
    Memory: `check-git-log-before-building-a-feedback-fix.md`; [feedback-reports.md:394](/home/greg/code/spideryarn2/docs/project/feedback-reports.md:394). Commits do not reach a worktree *only* through `worktree:setup`. Ordinary merges work, and remote-tracking refs are shared. Setup itself [fetches before merging](/home/greg/code/spideryarn2/scripts/worktree-freshen.ts:111), so `git log origin/dev` can see those commits before this tree runs setup.  
    **Smallest fix:** describe what setup fetched and merged **in that incident**, and why its opening snapshot missed the fix.

11. **RR-11 — P2 — The quote checker does not establish human authorship.**  
    Memories: the AP1/AP2/AP5 permission files; docs: [check-quotes.py](/home/greg/code/spideryarn2/docs/plans/261005k-probes/check-quotes.py:23) and the mapping’s provenance section.

    String content returns before the automated-message filters. Compaction summaries are never rejected by `isCompactSummary`. “Shortest matching turn” does not establish an original human turn, and substring matches do not verify the complete quotation.

    I reran the committed checker excluding the porting session. It labelled AP1’s **compaction summary**, AP5’s **Overseer brief**, and AP5’s other **compaction summary** “typed.” Thus it does not reproduce the mapping’s stated method. Independently inspected primary turns support AP3, AP4, AP7, AP8, AP9, the mapping’s opening quotation, and AE2’s account of Greg’s approval. The four flagged quotations should remain unverified.  
    **Smallest fix:** apply filtering after normalising both content shapes, reject summaries/automated turns, and record an inspected source turn for each complete quote.

The retained sample exposed these additional omissions. They are **P2 today because their files remain retained**, but their current proposals do not account for everything:

| ID | Memory and proposed home | Missing lesson and smallest fix |
|---|---|---|
| **RR-12 — P2** | `a-named-worktree-may-hold-a-dead-sessions-work`; [CP5](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:840), `worktrees.md` | Look for an existing topic worktree **before** assuming a fresh start. Inspecting a named tree after entering is insufficient. Add a lesson and extend CP5. |
| **RR-13 — P2** | `a-comment-is-not-a-traced-equality`; [row 99](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:99), `name-is-evidence.md`/DP6 | A cache fingerprint can omit fields essential to safe identity comparisons. The general predicate warning does not preserve this corollary. Propose it explicitly. |
| **RR-14 — P2** | `two-joins-that-disagree-are-a-measurement`; [row 172](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:172), `silent-success.md`/DP2 | Report disagreements per row, and deliver unfavourable readings when the decision is being made. Neither survives completely. Extend DP2. |
| **RR-15 — P2** | `a-codex-self-review-looks-like-an-independent-one`; [DP7](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:1170), `codex-cli-as-subagent.md` | Brief the independent reviewer to treat the first artefact as a claim and test named statements. Add that safeguard. |
| **RR-16 — P2** | `full-suite-needs-tmux-on-this-box`; [row 130](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:130), `testing.md` | The timeout incident survives, but its prohibition on deadlines for long commands has no proposal or explicit rejection. Give it a disposition. |
| **RR-17 — P2** | `tmux-outlives-closed-tabs`; [row 171](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:171), `hetzner-remote-server-box.md` | The claimed laptop location of `sessions.mjs`’s source was consciously omitted as unverified in the report, but disappears from the mapping. Record it as unresolved or explicitly dropped. |

12. **RR-18 — P2 — The Remote Control stale check proves too little.**  
    Memory: `remote-control-is-already-on-for-box-sessions.md`; [row 162](/home/greg/code/spideryarn2/docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md:162). I reproduced eight session files, one containing a null `bridgeSessionId`. That establishes today’s sample, not that the field is obsolete. The launch-versus-live distinction survives in the [older dashboard plan](/home/greg/code/spideryarn2/docs/plans/260907e-agent-fleet-dashboard.md:2646).  
    **Smallest fix:** narrow the dropped claim to the obsolete count and cite that surviving diagnostic passage.

13. **RR-19 — P2 — BE7/BE8 have a weak ownership home.**  
    Memories: `write-tool-refuses-paths-outside-the-repo` and `npm-run-forwards-a-bare-argument`; [box trap list](/home/greg/code/spideryarn2/docs/project/hetzner-remote-server-box.md:1204). These describe harness and npm behaviour rather than box configuration, making discovery less likely for readers following the tooling docs.  
    **Smallest fix:** choose the owning tooling passage and leave a signpost here; propose any move into protected reusable docs.

14. **RR-20 — P3 — The plan tidies a purported verbatim quotation.**  
    Source: the original job instruction, rather than a memory file; [plan quotation](/home/greg/code/spideryarn2/docs/plans/261005k-port-overseer-auto-memory-into-docs.md:13). Greg’s transcript says “Clawed code”; the plan substitutes “Claude code.” The meaning is clear, but the text is no longer exact.  
    **Smallest fix:** restore the transcript wording or visibly mark the editorial correction.

I found **no P0 secret exposure, actual data deletion, or invented Greg quotation in the 25 landed doc edits**. Added content contains no credential value, connection string, private address, or provider project/team ID. Commit metadata contains the ordinary author/coauthor email addresses. The changed Markdown’s unfenced inline links resolved against the candidate tree.

`write-capable-reviewer-can-invent-greg-quotes` is an exact duplicate of its retained counterpart; deleting that duplicate alone loses no unique lesson.

The requested mapping check returned **85 rows, 85 files, 35 eligible, 50 retain; `ok`, exit 0**. Without writing a file, I removed a row: it failed correctly. I then changed every retained verdict to eligible: **85 eligible; `ok`, exit 0**. It verifies inventory and hashes, while ignoring lesson coverage and pending proposals.

**Verdict: reject pruning on this mapping; repair RR-1 through RR-10 and account for the retained-row omissions before treating the port as complete.**