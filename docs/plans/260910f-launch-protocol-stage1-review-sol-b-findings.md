# Stage 1 review findings (Sol B)

## F16 — P1 — established

Reconciliation trusts the absolute `artefactDir` replayed from the launch journal. The only legality check is “absolute and ends with `/o/<id>/a<n>`” (`launch-protocol.ts:432-434`, used at `:511`), so a line may point at another launch-store root. Reconciliation passes that path straight to the evidence reader (`:1352-1355`) and accepts a correlation-bound `exit.json` there as completion (`:1358-1362`). The same deterministic origin has the same occurrence/correlation id in a scratch, moved, or other daemon store, so those can genuinely be the wrong job's files. That can release the live store's slot without evidence that its own job ended.

(a) `/tmp/launch-protocol-path-repro.test.ts` replays a valid planned → reserved → launching history whose path is `/tmp/a-different-launch-store/launches/o/<same-id>/a1`, then supplies that other directory's matching exit record. The run established all three failures: replay status was `whole`, the artefact port received the foreign path, and reconciliation emitted `completed`.

(b) Smallest fix: do not use the journal string as a read capability. At reconciliation, derive the attempt directory from the currently opened `LaunchJournal.attemptDir(occurrenceId, attempt)` (and treat a recorded path that differs as `history-lost`, if the absolute path remains in the schema). Add a test with two roots containing the same deterministic occurrence id.

## F17 — P1 — established

An admission-history reset can permanently resurrect a reservation that the launch journal already records as released. If the admission journal's release line is the damaged line, its conservative salvage carries the earlier reservation into the fresh owner journal. But `decide` only consults/releases the owner when the launch fold says the reservation is `held` (`launch-protocol.ts:1429-1433`); a terminal record whose reservation fact is already `released` falls through to no decision (`:1469-1473`). At capacity one, the resurrected key can block every later job, and `dispose` cannot clear it because it correctly refuses completed occurrences (`:1614-1615`).

(a) `/tmp/launch-released-owner-repro.test.ts` replays a whole launch journal ending `completed` → `released`, supplies the lookup result a repaired admission owner has when it carried the reserved line but lost the release line, and expects a licensed release. It failed: `reconcile` returned `[]`.

(b) Smallest fix: reconcile terminal/disposed records against owner truth even when their launch reservation fact says `released`. If lookup finds the same key held, release it again under the already-recorded licence; either make a repeated matching `released` event legal for audit, or add an owner-only idempotent release decision because the launch-side release evidence is already durable. Add the admission-hole-at-release integration case.

## F18 — P2 — established

Replay accepts the same `waiting-admission` reason twice, although D3 requires that record once per distinct reason and F11 says illegal/duplicate histories become `history-lost`. `admissible` includes `waiting-admission` (`launch-protocol.ts:421-423`), and the transition simply writes another waiting state without comparing the reason (`:496-498`). The live drive avoids the duplicate (`:1223-1227`), so this is a replay/invariant gap rather than wrong live scheduling today.

(a) `/tmp/launch-duplicate-wait-repro.test.ts` replays planned → waiting(`full`) → waiting(`full`) and expects `history-lost`; it failed with status `whole`.

(b) Smallest fix: reject `waiting-admission` when the previous state is already waiting with the same `why`; add this sequence to the F11 table. Continue accepting a changed reason.

## F19 — P1 — established

F4's conclusive `identity.kind === "other-boot"` can be vetoed by an earlier, separate failed boot-id read. `identityOf` already returns both the recorded and current boot ids, but `evidenceDecision` only records reboot completion if the earlier `ports.boot()` result was readable (`launch-protocol.ts:1384-1388`). In the real composition those are two separate reads: the first can fail transiently and the identity check's later read can succeed. The code then returns `hold` at `:1417-1418`, contrary to “other-boot → completed” and “unavailable evidence never overrides stronger conclusive evidence.”

(a) `/tmp/launch-other-boot-precedence-repro.test.ts` supplies a present start record, `boot()` unavailable, and `identity()` = `other-boot { recorded: "boot-one", current: "boot-two" }`. It expected `completed (rebooted)` and failed because reconciliation returned `hold`.

(b) Smallest fix: in the `other-boot` arm, use `identity.recorded` and `identity.current` directly to emit the reboot completion; do not gate that conclusive result on the earlier read. Add this mixed-read ordering to the F4 table.
