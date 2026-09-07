Verdict: **refuse the plan as written**. F1, F2, and F4 are established P1 contract violations. The overall direction is good, but the extraction map and verification recipe are not yet strong enough to support its “provably unchanged” claim.

### F1 — P1 — established: the proposed ownership map requires non-contiguous moves

(a) [`styles/overlays.css`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md:145>) claims ownership of “lightbox, floating panels, dialogs”, but those occur at widely separated positions in `styles.css`: floating chat at 9375, annotation at 9408, diagram dialogs at 11172/11603, lightbox at 13028, and feedback at 14591. One file cannot contain those while remaining a single contiguous range.

The A5 collision note has the same problem: shared mode-band rules begin around 4046, while composers occur later with substantial feature-specific rules between them. Following the ownership descriptions literally violates A10’s prohibition on gathering prefix- or feature-related rules.

(b) Replace the extraction-map preamble and the `overlays.css` row with:

> **One output file owns exactly one contiguous top-level interval of the old file.** Semantic ownership does not permit gathering sections that recur later. A repeated family stays beside its original neighbours and receives another order-qualified file if necessary. In particular, floating panels, diagram dialogs, the lightbox and feedback remain in their respective contiguous slices; there is no gathered `overlays.css`.
>
> Before the first cut, commit an ordered manifest giving every slice’s old start and end byte offsets and destination. Every old byte must belong to exactly one slice and the manifest order is the import order.

### F2 — P1 — established: the stacking-rule instruction is impossible without moving rules

(a) The plan says all z-index declarations “stay in `tokens-and-shell.css`”, then says anything found elsewhere stays in the byte stream. There are currently **31** `z-index:` declarations distributed through the entire stylesheet, including spine, tooltip, dock, mode band, dialogs, search, profile, timeline, feedback and site sections. Moving them into the first file would require splitting declarations from selectors or relocating whole rules; leaving them in place contradicts the promised single home.

That directly conflicts with both “verbatim contiguous slices” and A10’s “cascade must not move” contract.

(b) Replace the first non-negotiable rule with:

> **Extraction does not consolidate declarations.** The global geometry definitions already in the opening token/shell interval remain there; responsive redefinitions and every existing `z-index` declaration remain in their original contiguous slice. The single home for the cross-feature stacking contract is `design-css-overview.md` § *The stacking order*, which points to the physical declarations. Turning the numbers into shared tokens or physically consolidating them is a separate cascade-changing refactor and is out of scope.

### F3 — P1 — reasoned: byte-preserving moves do not preserve stylesheet-relative URLs

(a) CSS relative URLs resolve against the stylesheet containing them, not the original entry point. Moving bytes one directory deeper can therefore change their meaning even when concatenation and order are identical. [CSS Values § Relative URLs](https://www.w3.org/TR/css-values-4/#relative-urls) defines that behavior.

The present concrete case is [`@import "../../styles/tokens.css"`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/styles.css:27>). If moved verbatim into `src/web/styles/tokens-and-shell.css`, it resolves toward `src/styles/tokens.css`, not the existing top-level file. Losing those tokens would visibly damage nearly every surface.

It can safely remain in the import-only `styles.css`, but the plan does not say so.

(b) Replace “Every cut is a byte-for-byte contiguous range” with:

> **Every cut is a contiguous range, subject only to declared URL rebasing.** Inventory every `@import`, `url()` and other stylesheet-relative reference before cutting. Keep the existing `@import "../../styles/tokens.css"` in `styles.css` at the same ordinal position. If any relative reference moves, rewrite it so its resolved absolute target is unchanged, record that rewrite in the slice manifest, and make the concatenation check reject every other byte difference.

### F4 — P1 — established: `tailwindcss.compile()` is not the production CSS pipeline

(a) The plan calls a direct `tailwindcss.compile()` result “the actual cascade the browser receives”. The application instead builds through `@tailwindcss/vite` in [`vite.config.ts`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/vite.config.ts:345>). That plugin uses Vite’s resolver, enables URL rewriting, scans actual candidates and runs build-only optimization. Vite itself inlines imports and rebases URLs between imported files. [Vite documents both behaviours](https://vite.dev/guide/features.html#import-inlining-and-rebasing).

Consequently, a direct-compiler diff can be empty while the production resolver, URL rewriter or optimizer produces different output. Stage 2 also omits `npm run build`, despite the authoritative acceptance contract saying builds matter for CSS changes.

The before-output’s persistence is unspecified too; without an immutable pre-cut artifact, “before/after diff” can silently become two post-cut compilations.

(b) Replace the compiled-output and Stage 2 completion wording with:

> **Capture two immutable baselines before the first cut**, labelled with the source SHA: the core Tailwind compilation for diagnosis, and the CSS emitted by `npm run build:client`, which exercises `@tailwindcss/vite`, Vite resolution, URL rebasing and production optimization. Refuse comparison if either baseline is missing or was produced from the post-cut SHA.
>
> After extraction, require both comparisons to be equivalent, run `npm run build`, and run the browser pass against the built preview. The direct `compile()` result is supporting evidence; only the Vite build artifact is called the CSS the production browser receives.

### F5 — P1 — reasoned: a fifteenth artefact mode can still be activation-half-wired

(a) Suppose the fifteenth mode is `research`, backed by a generated artefact. Its author can add `research: null` to the proposed total `MODE_TARGET`, fill the existing label/policy/dock/presentation rows, and stop. Typecheck passes without:

- adding an `AutoRunTarget`;
- arming the Dock press;
- calling `useAutoRun`;
- adding a positive case to `modes-that-start-themselves.test.tsx`.

That existing test explicitly covers the modes already named, not future modes. The proposed one-row mutation proves only that a current positive case remains covered.

The nullable map also misrepresents Diagram: it does start work, but dynamically through `armActivationForDiagram`; `null` conflates “free/no activation” with “activation delegated elsewhere”.

(b) Replace Stage 4 item 1 and its activation mutation with:

> **Activation is a total tagged decision, not `target | null`:**
>
> `Record<Mode, { kind: "fixed"; target: AutoRunTarget } | { kind: "delegated"; owner: string } | { kind: "none"; reason: string }>`
>
> Fixed modes arm their target through this table. Diagram and modes whose sub-view owns activation use `delegated`, naming that seam; genuinely free or reader-input-first modes use `none`.
>
> Add an independently written total activation expectation to `modes-that-start-themselves.test.tsx`. Drive every mode through the real Dock/shell; require the expected POST for fixed modes, dedicated positive coverage for delegated modes, and no POST for deliberate `none` modes. Mutation-check a fixed row, a delegated arm and a newly added fixture mode.

### F6 — P1 — reasoned: the presentation expectation type permits the omission it is meant to catch

(a) `Record<Mode, { band: string | null; says: string | null }>` permits both:

```ts
research: { band: ".mode-band.research", says: null }
research: { band: null, says: null }
```

The first passes over an empty band shell; the second passes over an entirely omitted controller. Comments do not make those states impossible.

Even a non-null string can be vacuous if read through raw `textContent`. The existing [`BAND_SAYS` explanation](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/public-network-trace.test.tsx:826>) records the concrete precedent: Outline’s visible list could be deleted while five `aria-hidden` measuring copies retained the expected text.

(b) Replace Stage 4 item 2 with:

> Define `NO_BAND_MODES = ["plain", "hierarchy"] as const`. The independently written band table is total over `Exclude<Mode, typeof NO_BAND_MODES[number]>` and every row requires `{ where: string; says: string }`; neither field is nullable or empty. A genuinely new bandless mode requires a deliberate edit to `NO_BAND_MODES`.
>
> Use a non-empty fixture for every real controller and assert a body literal unique to that fixture, scoped to the exact band. Read only accessible content, excluding `[hidden]`, `[aria-hidden="true"]` and screen-reader/measurement copies. Mutation-check by deleting the visible body while leaving the band wrapper, heading and hidden measuring copies intact; the test must go red.
>
> Plain must assert readable article prose and no band. Hierarchy must assert a real gist-column value and no band.

### F7 — P2 — established: presentation is not currently “nothing”

(a) [`new-mode.md`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/docs/project/new-mode.md:29>) already lists `BAND_SAYS` among the total, compiler-checked tables. Adding a fifteenth `Mode` already makes that test file fail typecheck. What is absent is **owner/controller presentation coverage**, not a presentation compile tripwire altogether.

This matters because the plan otherwise risks claiming a new compile guarantee while only adding runtime coverage for the owner branch.

(b) Replace the Stage 4 table row and documentation instruction with:

> | Presentation | Visitor `BAND_SAYS` is already total; owner/controller presentation is untested | **compile tripwire exists; owner behaviour missing** |
>
> Update `new-mode.md` to distinguish the existing visitor-presentation total from the new owner/controller surface test. Do not describe presentation as newly compiler-checked; describe the deliverable as making the existing compile decision exercise the real owner controller.

### F8 — P2 — established: the `no-raw-nul-bytes` migration target is stale

(a) [`tests/no-raw-nul-bytes.test.ts`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/no-raw-nul-bytes.test.ts:76>) no longer has a hard-coded file list. It derives all tracked and unignored files from Git. `src/web/styles.css` appears only in its coverage witnesses. Migrating it to a stylesheet helper would narrow a deliberately repository-wide test, while the stated completion condition “no test … naming `styles.css` as a path” would encourage removing a legitimate witness.

(b) Replace that part of Stage 1 with:

> Do not migrate `no-raw-nul-bytes.test.ts` to the stylesheet helper; it remains Git-derived and repository-wide. Update its witnesses to retain `src/web/styles.css` as the import-only entry and add one extracted child stylesheet. Stage 1 is complete when no semantic CSS test reads only `styles.css` expecting all rules to be physically present.

The nested-layer concern is resolved: the current Tailwind 4.3.3 probe did preserve `layer(app)` through four levels. The test-file compile concern is also resolved: this repo’s `npm run typecheck` wrapper explicitly covers every `.ts`/`.tsx`, including tests. No repository files were changed.