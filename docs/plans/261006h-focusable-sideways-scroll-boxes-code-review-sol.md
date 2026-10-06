The narrowed statement is accurate based on the code and targeted tests. I found no runtime defect within this stage.

- **F4 — P3, established, fixed:** [“What landed”](/var/tmp/spideryarn-worktrees/qi-t2ee3kyx-focusable-scroll-boxes/docs/plans/261006h-focusable-sideways-scroll-boxes.md:134) claimed nine new tests; the candidate adds twelve. A diff-based assertion failed with `9 !== 12`, then passed after the correction.

The ref spread works on both DOM boxes; the static report supplies no `box` props and still renders. The shelf and `/admin/users` retain their table markup, wrapper shape, and classes. The two reference-doc edits match the implementation.

Validation: all seven targeted suites passed, **172 tests**; typechecking passed through the equivalent Node invocation; lint was clean. Full `npm test` stopped before collection because Docker/database access was unavailable. Browser verification returned no result, so focus behavior during resize remains unverified here.

Only the plan’s count changed. Nothing committed.

ACCEPT