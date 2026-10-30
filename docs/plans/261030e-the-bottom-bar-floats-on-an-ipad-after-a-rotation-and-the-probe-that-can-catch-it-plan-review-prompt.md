Review this plan before it is built. Read-only: do not edit files.

The plan: docs/plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it.md
Your own earlier consultation on the WebKit side: .scratch/sol-think-answer.md
The measurement script: .scratch/probe.ts
The code it changes: src/web/ViewportProbe.tsx, src/web/params.ts (currentProbe), src/web/admin-commands.ts, src/web/CommandBar.tsx (adminRows call site), src/web/reader/Reader.tsx (where ViewportProbe mounts).
Prior work: docs/plans/261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md.

Judge:
1. Is declining the blind re-anchor right, and is the iOS 26 floating-toolbar argument correct as stated? Is there a safe partial fix worth shipping now that the plan misses (for example one gated so it cannot fire on a healthy iPhone)?
2. Will the trace the plan collects actually distinguish the three states? Is any field missing or useless? Is the sentinel measurement sound (a fixed element inside .reader — or should it be portalled to body; any containing-block trap from transforms/filters/contain on ancestors)?
3. The switch design: module-level store + useSyncExternalStore vs alternatives; does starting the probe mid-session have any trap (Strict Mode, the read-once comment in params.ts, the probe's CAP keeping the oldest samples)?
4. Anything in the plan that is wrong, overstated, or a simpler option it should name.

Verdict first (GO / GO WITH CHANGES / RETHINK), then numbered findings with file:line, each with severity. Under 700 words.
