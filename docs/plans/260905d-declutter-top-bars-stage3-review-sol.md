# Stage 3 code review — the header row loses its height, not its element

GPT Sol (`gpt-5.6-sol`, effort high), 2026-09-05, on the working tree of
[260905d](260905d-declutter-the-reading-view-top-bars.md) § Stage 3. The prompt is
[`...-stage3-review-prompt.md`](260905d-declutter-top-bars-stage3-review-prompt.md); Sol's answer is
reproduced verbatim below, with what was done about each finding first.

**Verdict: refuse**, two established P1s, no P0s. Both accepted, both fixed, each red first.
Neither is in the part of the stage the plan was about — the head, the offset, the aim tint and the
pills all passed static inspection and the browser pass. Both are in the *address* work, which the
plan had not anticipated at all and which stage 3 grew into.

## Dispositions

| | Finding | Disposition |
|---|---|---|
| F1 | Stale `localStorage` restores `?text=0` after boot, walking past the rewrite | **Accepted.** Moving `text` to `NEVER_REMEMBERED` governs what gets *written*; a browser's storage outlives any version of that list, and a restore runs from a layout effect after `settleAddress`. Fixed in **`restoredHref`**, not Sol's `readLastView`: that is the pure function, which is where this file deliberately puts its decisions so each can be watched failing, and it needs no `localStorage` stub to test. Filtering the stored query through `rememberableSearch` on the way *out* also makes it general — the next parameter to leave `REMEMBERED` is safe without anybody remembering this happened. |
| F2 | A duplicate `text` pair decides strandedness, where `nuqs` reads only the first | **Accepted.** `?mode=hierarchy&text=1&text=0` was read as stranded while the client had `text=1` and the prose on screen — a reader moved out of Hierarchy on the strength of a pair nothing else will ever look at. The sharp part is that `liftStrandedText` *already documents* first-match semantics for `mode` in the same function; `text` was the parameter that had not been given the treatment. `hidesProse` now asks the first `text` pair only, and the removal stays `.some()` — deciding and removing are two questions, and only the first is about which pair wins. |

**What Sol could not check**, and said so rather than guessing: the suspected residual height on the
zero-height `<th>` — Chrome would not start under its sandbox. A browser pass answered it
afterwards: `thead th`, `thead tr` and `thead` all measure **exactly 0**, with `overflow: hidden`
and `padding: 0px`. The panels sit flush under the bar, `.controls` bottom and `.ctx-panel` top both
`265.6875`.

## The review, verbatim

## Verdict: refuse

Two established P1 address-settling defects remain. The first recreates the exact stranded state this stage is intended to eliminate.

### F1 — P1, established: stale last-view data restores `text=0` after settling

(a) `readLastView()` returns the stored query unchanged at [last-view.ts:273](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/last-view.ts:273), and `restoredHref()` appends those raw pairs at [last-view.ts:252](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/last-view.ts:252). The restoration happens in the layout effect at [last-view.ts:337](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/last-view.ts:337), after boot-time `settleAddress`.

Therefore a reader with legacy storage containing `?mode=hierarchy&text=0` follows this path:

```text
boot settleAddress("/read/x", "")                 → no rewrite
restore stored "?mode=hierarchy&text=0"           → /read/x?mode=hierarchy&text=0
next passive save strips text=0 from storage      → too late for the current address
```

I reproduced the function-level sequence. This contradicts the behavioural claim at [url-state.md:167](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/project/url-state.md:167) that moving `text` to `NEVER_REMEMBERED` prevents stored state walking past the rewrite.

(b) Filter stored state through the current remembering policy when reading it:

```ts
export function readLastView(slug: string): string | null {
  try {
    const stored = window.localStorage.getItem(KEY_PREFIX + slug);
    return stored === null ? null : rememberableSearch(stored);
  } catch {
    return null;
  }
}
```

That turns legacy `?mode=hierarchy&text=0` into `?mode=hierarchy` before restoration.

### F2 — P1, established: duplicate `text` parameters use the wrong occurrence

(a) `hidesProse()` uses `some()` at [read-address.ts:196](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/read-address.ts:196), so any `text=0` pair hides prose. The actual client parameter at [params.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/params.ts:114) uses nuqs/`URLSearchParams.get`, whose first-value semantics are already explicitly acknowledged for `mode` at [router.ts:967](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/router.ts:967).

Concrete failure:

```text
?mode=hierarchy&text=1&text=0

client text value: 1
settleAddress:     rewrites to outline because it sees the later text=0
server readMode:   also reports outline
```

The ignored later pair should still be removed, but it must not decide whether the address is stranded.

(b) Make `hidesProse` inspect the first `text` value, while retaining a separate “anything to remove” check:

```ts
// src/read-address.ts
export function hidesProse(search: string): boolean {
  const params = new URLSearchParams(queryPairs(search).join("&"));
  return params.get("text") === "0";
}
```

```ts
// src/web/router.ts
function liftStrandedText(at: Address): Address {
  const pairs = queryPairs(at.search);
  if (!pairs.some(isTextOffPair)) return at;

  let stranded =
    new URLSearchParams(at.search).get("mode") === "hierarchy" &&
    hidesProse(at.search);

  // Existing rewriting/removal loop follows unchanged.
```

## Other checks

The focused suites passed: 7 files, 92 tests. They do not cover either sequence above.

By static inspection, the implementation otherwise honours the earlier review: the semantic `<thead>` remains, the geometry hooks remain, `stickyOffset()` retains the safe-area floor, `memo(TableView)` is intact, and the aim selector reaches both cells and context panels. Its specificity also prevents the later background shorthands from silently clearing the tint.

I could not establish the suspected browser-specific residual height: Chrome could not start under the environment’s socket sandbox, so that remains unverified rather than a finding. No repository files were changed.