# NOT READY

## Findings

1. **HIGH — the design premise is incomplete.** [plan:28](/home/greg/code/spideryarn2/.claude/worktrees/fb3g-resume-label-live-conversation/docs/plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md:28)

   `thread.messages.length > 0` was never a broken live-history test; it deliberately means “continue this thread.” However, the claim that no persisted signal can identify earlier live use is false:

   - `realtime_sessions` stores `thread_id` and `connected_at` permanently: [schema.ts:2493](/home/greg/code/spideryarn2/.claude/worktrees/fb3g-resume-label-live-conversation/src/db/schema.ts:2493).
   - `/connected`, usage reports, and close reports set or backfill that signal: [routes.ts:3564](/home/greg/code/spideryarn2/.claude/worktrees/fb3g-resume-label-live-conversation/src/routes.ts:3564).
   - Linked `ai_calls` rows additionally record `event_kind = 'transcription'`, providing evidence of spoken input: [schema.ts:2786](/home/greg/code/spideryarn2/.claude/worktrees/fb3g-resume-label-live-conversation/src/db/schema.ts:2786).

   These reports are best-effort, so they can produce false negatives, but not false positives. A conditional “Resume” design therefore needs new query/API/client plumbing, but not the claimed migration or spoken-row field. The product choice should be reconsidered with that corrected cost.

2. **MEDIUM, FIXED — tooltip overclaimed retained context.** [LiveButton.tsx:44](/home/greg/code/spideryarn2/.claude/worktrees/fb3g-resume-label-live-conversation/src/web/live/LiveButton.tsx:44)

   “It hears everything said here so far” was false: `liveSeedItems` uses `recentHistory`, which keeps at most 20 completed turns and excludes interrupted/incomplete pairs. I changed it to “with its recent completed turns” and added coverage.

No other findings. Chat and Remember have truthful names across idle, connecting, live, closing, and failed phases. `ControlTip.state` follows the documented current-fact-first convention. On touch, the synthesized hover still opens the uncontrolled tooltip; after activation, the idle state line disappears during connection. No stale product “Resume” assertions or descriptions remain outside intentional historical material.

## Gates

- `npm run typecheck`: exact command could not start `tsx` because the sandbox denied its IPC socket (`listen EPERM`). Running the same script as `node --import tsx scripts/typecheck.ts` passed all four projects and coverage of all 2,155 source files.
- `npx vitest run chat-live live-`: the exact multi-project command could not initialize the private Postgres lane because sandbox networking was denied. Its unit lane passed with `--project unit`: **9 files, 165 tests**.
- Final changed test rerun: **1 file, 26 tests passed**.
- Biome lint: exit 0; two existing complexity infos.

## Reviewer-applied diff

```diff
diff --git a/src/web/live/LiveButton.tsx b/src/web/live/LiveButton.tsx
@@
-   * rather than beginning one. **Not "has been live before"** — nothing stored
-   * says that — which is why the visible label is "Live" either way and never
-   * "Resume": beside a typed thread, "Resume" read as picking up a call the
-   * reader never made (SPIDERYARN-READING2-3G). The difference is said in the
-   * accessible name and the tooltip, where there is room for a sentence.
+   * rather than beginning one. **Not "has been live before"**: chat messages do
+   * not record their input mode, and this prop does not consult the separate
+   * realtime-session journal or its linked usage rows. The visible label is
+   * therefore "Live" either way and never "Resume": beside a typed thread,
+   * "Resume" read as picking up a call the reader never made
+   * (SPIDERYARN-READING2-3G). The difference is said in the accessible name and
+   * the tooltip, where there is room for a sentence.
@@
-            : continues ? "Continues this conversation out loud. It hears everything said here so far."
+            : continues ? "Continues this conversation out loud, with its recent completed turns."

diff --git a/docs/plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md b/docs/plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md
@@
-| A thread with messages | Live | Continue this conversation live | Continues this conversation out loud. It hears everything said here so far. |
+| A thread with messages | Live | Continue this conversation live | Continues this conversation out loud, with its recent completed turns. |

diff --git a/tests/chat-live-handoff.test.tsx b/tests/chat-live-handoff.test.tsx
@@
   it("says Hang up while the call is on, whatever the thread holds", () => {
@@
   });
+
+  it.each([
+    ["connecting", "Cancel", "Cancel"],
+    ["closing", "Finishing…", "Finishing…"],
+    ["failed", "Live", "Continue this conversation live"],
+  ] as const)("names the %s action truthfully", (phase, visible, accessible) => {
+    const { api } = fakeLive(phase);
+    paint(api);
+    expect(label()).toBe(visible);
+    expect(name()).toBe(accessible);
+  });
+
+  it("keeps Remember's larger visible label while naming the continuation", () => {
+    const { api } = fakeLive("idle");
+    paint(api, THREAD.id, [{ ...THREAD, kind: "remember" }]);
+    expect(label()).toBe("Live conversation");
+    expect(name()).toBe("Continue this conversation live");
+  });
@@
     expect(tooltip?.textContent).toContain("Talk about the article");
+    expect(tooltip?.textContent).toContain("recent completed turns");
+    expect(tooltip?.textContent).not.toContain("everything said here so far");
     expect(tooltip?.textContent).toContain("same conversation");
```