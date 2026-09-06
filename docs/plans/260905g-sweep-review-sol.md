Verdict: REFUSE — one P1 documentation defect would prescribe a reader-visible broken repair.

### Findings

- **F1 — P1 — [postmortem:111](</home/greg/code/spideryarn2/docs/postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md:111>)**

  The proposed remedy, “a splice applied on publish,” happens too late. A mode job first copies and reads the legacy tree, then stamps its generated artefact with that tree’s `structureHash`. If publication subsequently splices the tree, the newly generated artefact is immediately stale against the published tree. This follows directly from the carry policy in [pg-revisions.ts:238](</home/greg/code/spideryarn2/src/store/pg-revisions.ts:238>), fingerprinting in [source-hash.ts:350](</home/greg/code/spideryarn2/src/source-hash.ts:350>), and final validation in [pg-revisions.ts:1624](</home/greg/code/spideryarn2/src/store/pg-revisions.ts:1624>).

  Repair must occur before any pipeline step reads the draft—preferably a one-time migration of affected stored revisions, or normalization when the draft is created. Before deployment, query production; if no affected rows exist, no compatibility repair is needed.

  The same paragraph also misstates the blast radius. Any on-demand mode job that carries the old tree—Arc, Glossary, Ideas, Quotes, Timeline, Quiz, Sketch, and others—can end in `PublishRefused`. Conversely, a hierarchy rerun, including the normal default re-extraction path, rebuilds through `collapseRestatedRungs` and heals the tree. Shelf/comment edits do not publish revisions.

- **F2 — P3 — [sse-heartbeat.test.ts:45](</home/greg/code/spideryarn2/tests/sse-heartbeat.test.ts:45>)**

  “Reached the wire” is inaccurate: the wrapper counts immediately before calling the original `res.write`. It proves that `heartbeat` attempted the frame; the later HTTP-body assertion is what proves receipt. Reword the comment, but the test itself remains valid.

- **F3 — P3 — [plan:87](</home/greg/code/spideryarn2/docs/plans/260905g-get-ready-to-deploy-sweep-fixing-the-publish-guard-and-heartbeat-flake.md:87>)**

  The plan says any beat is sufficient and that the count was loosened, but the implementation still requires three beats. What changed was the wall-clock deadline, not the count.

### Heartbeat assessment

The assertion is not tautological. It can still fail if:

- heartbeat never writes or stops before three frames;
- `res.write` throws or fails before bytes reach the client;
- frames are malformed or truncated;
- the trailing event is missing or reordered.

The microtask runs after the intercepted `original(chunk)` returns, so ending there is safe. Node does not internally invoke this overridden public `write` method with extra arguments; all calls in this test are strings, so the narrowed wrapper is harmless here.

I attempted the requested full Vitest run, but this sandbox rejects localhost `listen` with `EPERM`; the socket tests therefore cannot execute here. The two non-socket tests passed, and Biome reported the changed file clean. The current checkout has advanced from the named base to `a8fcda6b`, but the candidate test diff against `4cafdd38` is unchanged.

Fixing the malformed gitignored local file was appropriate. Calling the deployment sweep complete without auditing or migrating potentially affected production revisions was not.

**VERDICT: REFUSE.**