Verdict: do not ship this exact version. The ordinary one-line draft is fixed, but finding 1 is only half-addressed, and the new `status:"shell"` guard is based on the wrong semantic.

## Findings

1. **Blocker — a multiline draft can still be classified as empty.**  
   [pane.ts:1115](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/pane.ts:1115), [test:97](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tests/fleet-pane-surface.test.ts:97)

   The comment says continuation occupancy is checked before the border test, but the code does the opposite:

   ```ts
   if (line.rule !== "none") return empty-or-occupied;
   if (boxLineIsOccupied(...)) occupied += 1;
   ```

   A real counterexample is:

   ```text
   ─────────────────────────────
   ❯ 
   ────────
     caption
   ─────────────────────────────
   ```

   This can be entered as a leading multiline break followed by a pasted diagram/table. Claude supports `Ctrl+J` and `Shift+Enter` multiline input. [Claude Code interactive-mode documentation](https://code.claude.com/docs/en/interactive-mode)

   Failure sequence: prompt row is empty → first continuation is decoration-only and therefore `rule !== "none"` → it is mistaken for the lower border → `paneSurface` returns `empty-input` without inspecting `caption` → dashboard appends and submits.

   I executed that construction against the implementation; it returns:

   ```json
   {"kind":"empty-input","promptLine":1}
   ```

   The new test passes for the wrong reason: its prompt already says `❯ here is a table`, so the result is occupied even if the scan stops at the decoration line and never reads the caption.

   The fix needs to distinguish the measured lower border structurally—width/alignment and likely position—not treat every decoration-only line as it. Merely reversing the two statements would count the genuine lower border as draft text.

2. **High — `status:"shell"` does not mean “a foreground program owns the tty.”**  
   [steer.ts:998](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/steer.ts:998), [shell tests:629](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tests/fleet-steer.test.ts:629)

   I inspected the installed Claude Code 2.1.263 binary. Its producer computes the written status as:

   ```js
   baseStatus === "idle" && hasUnfinishedLocalBash ? "shell" : baseStatus
   ```

   `hasUnfinishedLocalBash` is true for any non-terminal `local_bash` task. That includes the important false-positive state: Claude is idle at its input box while a background Bash task continues. Officially, background Bash is asynchronous and Claude can accept and answer new prompts while it runs. [Claude Code background Bash documentation](https://code.claude.com/docs/en/interactive-mode#background-bash-commands)

   Failure sequence: agent backgrounds a dev server/test → Claude returns to an empty prompt → private state says `shell` → direct Send falsely says another program would read the keys → queued messages are released repeatedly and may eventually age out. A long-running background task can disable steering indefinitely.

   Therefore:

   - Fail-open on missing, malformed, unknown or unreadable private state is reasonable if this remains a non-authoritative hint.
   - But then it provides no safety guarantee in the opposite direction: a changed or absent status can conceal a real foreground reader and the send proceeds.
   - “It only adds refusals, so it cannot break anything” is false. It cannot cause an unsafe send, but it can break availability and starve the queue.
   - Under the code’s own claimed meaning, the guard is also missing from `answerQuestion`: a stale dialog could remain visible while the supposed foreground child reads the option keystroke.

   **I think this guard should not have been built in its current form.** Remove it, or rename/reframe it honestly as “an unfinished local Bash task exists”—which is not a useful refusal policy here. A future genuine foreground-ownership signal would need to guard both send entry points.

3. **High, pre-existing — prior finding 4 remains exactly unfixed.**  
   [routes-steer.ts:1037](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/routes-steer.ts:1037), [steer-client.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/steer-client.ts:114), [SessionDetail.tsx:163](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/SessionDetail.tsx:163)

   The server carries `delivery`, but the browser still discards it. Text succeeds → Enter fails → server says `send-partial`, `delivery:"partial"` → client reduces that to code/why/status → UI states “Nothing was sent” and offers the generic refresh advice.

   The plan explicitly says this was handed elsewhere, so it did not merely appear fixed—but it remains a live false statement in the shipped path.

4. **Medium — the drain test proves release, but not “left at the head.”**  
   [fleet-drain.test.ts:579](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tests/fleet-drain.test.ts:579), [queue.ts:810](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/queue.ts:810)

   The implementation really does splice the released item back before every deliverable item. But the test queues only one item. A mutation that moved the refused item to the tail would remain green.

   Queue two messages, refuse the first, then assert both stored order and that the next drain attempts the first text—not the second.

5. **Low — the new wire/UI join is correct today, but entirely unprotected in browser tests.**  
   [routes-steer.ts:194](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/routes-steer.ts:194), [steer-client.ts:205](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/steer-client.ts:205), [SessionDetail.tsx:186](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/SessionDetail.tsx:186)

   The string is exactly `input-not-empty` at every current hop. With a valid server response, it cannot fall into “Refresh and look again”; the code comparison occurs before the generic 409 branch.

   But the browser models refusal codes as arbitrary `string`, and no web test mentions `input-not-empty`. A one-character mismatch in `Outcome` would compile and make the generic recovery reappear while every present test passed. Add a browser test asserting:

   - the server’s `input-not-empty` outcome renders the special explanation;
   - no Refresh button exists;
   - the handoff contains the exact row name.

6. **Low — `Handoff` receives the right prop, but assumes every tmux name is a safe unquoted shell word.**  
   [SessionParts.tsx:365](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/SessionParts.tsx:365)

   All three call sites pass `row.name`, including the new outcome path, and the required prop makes omission a compile error. That join is correct.

   However, `FleetRow.name` is merely `string`, sourced from tmux. A manually created or renamed session called `two words` produces the unusable command `gjd-remote resume two words`; shell metacharacters are worse. Normal fleet creation and rename paths enforce slugs, so this is low severity, but the component’s stated guarantee is wider than its type. Quote the argument safely or withhold the command for non-slug names.

## The remaining questions

- **Wide characters, combining marks and normal narrow-terminal wrapping are safe.** I tested `界`, an isolated combining acute, and U+200B zero-width space; all remain occupied. A wrapped character on a continuation row is detected. More than four visual rows becomes `unrecognised`, which is a safe refusal.
- **`trim()` hides more than ordinary spaces.** U+3000 ideographic space, U+2003 em space and U+FEFF all classify as empty. That is the same fundamental “whitespace-only buffer” limitation, but broader than the current test admits.
- **ANSI-only content is removed and reads empty**, but production uses `capture-pane -p`, which already strips terminal styling, and actual escape bytes are editor actions rather than credible draft prose. I do not count this as another practical defect.
- **`cleanLines` normally preserves indices:** it maps every newline-delimited row without filtering. Its OSC remover can theoretically consume embedded newlines, but that is not a credible production `capture-pane -p` shape.
- **The line-0 material guard is proportionate.** A genuine dialog whose outer border lands at row 0 loses phone buttons and requires terminal handoff, but the alternative is confidently approving incomplete material. Keep it. I would only soften the refusal text from “anything above has scrolled off” to “there may be material above.”
- **The union claim is now honest.** `sendMessage` exhaustively switches and permits only `empty-input`; `answerQuestion` permits only `dialog` and fails closed for every other/future arm. I do not see a cheap, meaningful unforgeable capability improvement—the transport/injection seam would have to be redesigned, not branded cosmetically.
- **The `inputSurface` move lost no prior check.** Recognised-dialog rejection, last-prompt selection, upper border, lower-border window and live capture ordering all survive.

## Audit of the original seven findings

| Earlier finding | Result |
|---|---|
| 1. Decoration erased by `cleanLines` | **Partly fixed.** Prompt-line raw works; decoration continuation remains unsafe. |
| 2. Foreground guard | **Built, but semantic premise disproved. Remove it.** |
| 3. Corpus/name | **Addressed.** `occupied-input` is right and mappings are explicit. The plan still says 24 fixtures; the test now enumerates 25. |
| 4. Browser drops delivery | **Not addressed; still real.** |
| 5. Line-0 material guard | **Addressed correctly**, with the availability cost tested. |
| 6. Capability overclaim | **Addressed in the plan.** No production bypass found. |
| 7. Drain behavior | **Partly addressed.** Release/retry is proved; head ordering is not. |

Verification: 485 targeted tests passed; the one failure was the unrelated hard-coded timestamp case you identified. The direct typecheck runner passed all projects and confirmed all 1,670 TypeScript sources are covered. No files were changed.