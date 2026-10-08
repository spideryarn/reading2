The CSS fix looks sound: no mode overrides the padding, normal mode layouts shrink correctly, and safe-area/install-hint offsets cancel out. The herald’s `max()` avoids double-counting the padding.

Fixed two test issues:

- [Chip test](/var/tmp/spideryarn-worktrees/chat-phone-guide-chip/tests/the-way-back-chip-clears-a-covering-band-in-chrome.test.ts:60): explicit `undefined` broke typechecking. Also strengthened coverage with long content, the close button, safe-area and install-hint states.
- [Herald test](/var/tmp/spideryarn-worktrees/chat-phone-guide-chip/tests/mode-herald-in-chrome.test.tsx:109): its simulated measurement omitted the new padding, producing incorrect herald placement. It now measures the actual room.

Updated stale comments and the plan. The original overlap test has meaningful controls; it would not pass merely because the chip moved outside the band.

Wider limitations remain: ModeSurface does not lift the composer above iOS’s keyboard, and extremely short bands can overflow fixed/minimum-height content.

Validation: typecheck passed through the same script using `node --import tsx`; 52 focused assertions passed; test-file lint passed. Browser checks were blocked by Chrome’s sandbox launch failure. Full tests were blocked by database access, and one focused stylesheet check by `spawnSync git EPERM`. Browser verification still needs rerunning outside this sandbox.