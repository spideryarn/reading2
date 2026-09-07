## Verdict

**Refuse as written.** The two pilot migrations themselves preserve their current DOM, but `ModeSurface` still has one empty-head bug and the acceptance evidence is materially incomplete.

No P0/P1 findings.

## Findings

### F15 — P2 — Empty React nodes can still create an empty header

**Established.** [ModeSurface.tsx:142](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/ModeSurface.tsx:142) excludes only `false`, `null`, and `undefined`.

`true` is also rendered by React as nothing, but produces:

```html
<div class="band-head"></div>
```

I confirmed this with React 19 server rendering. Empty strings and empty arrays also produce empty headers. This contradicts the adjacent “all four of React’s nothing values” comment and leaves the same positional/CSS hazard as the fixed `false` case.

At minimum, exclude both booleans and add a red/green `head={true}` case. Decide explicitly whether empty strings/collections should count as absent.

### F16 — P2 — The acceptance oracle misses exactly the DOM changes it claims to prevent

**Established.** The test’s lookup and comparison at [mode-surface-changes-no-markup.test.tsx:112](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:112) and [mode-surface-changes-no-markup.test.tsx:177](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:177) still pass if:

- `ModeSurface` adds an outer wrapper or siblings around the `<aside>`, because `band()` searches anywhere beneath `host`.
- It inserts text nodes, because `el.children` ignores them. In a flex container, such text can create an anonymous flex item.
- It adds `style={{ padding: "1px" }}` or any other extra aside attribute. Only `class` and `aria-label` are compared.
- Chat’s header contents or child element tags change while retaining the same classes.

The outer host structure, complete aside attribute set, and `childNodes` need checking—not only descendant element classes.

### F17 — P2 — The claimed branch coverage and baseline provenance are not present

**Established.** Search is mounted only as owner + words + populated at [mode-surface-changes-no-markup.test.tsx:236](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:236). Chat is mounted only with an open conversation at [mode-surface-changes-no-markup.test.tsx:299](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:299).

Missing are:

- Search visitor, meaning, error, saved/loading/empty/stale shapes.
- Chat list, loading, failed-load, empty, panel-error, live, and dictation shapes.

The companion baseline itself records only Search/words and Chat/open ([baseline:25](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-baseline.md:25), [baseline:142](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-baseline.md:142)). It does not record the labels or Remember shape; the test acknowledges Remember was not measured. Therefore its statement that every expected literal came from that baseline is false.

The literals are not dynamically derived from the new implementation, which is good, but they are incomplete and partly transcribed from old source rather than the named baseline.

### F18 — P2 — The passthrough type admits props incompatible with the component contract

**Established.** [ModeSurface.tsx:73](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/ModeSurface.tsx:73) retains `dangerouslySetInnerHTML` while `children` is required. A completely type-valid call with both reaches React and throws:

> Can only set one of `children` or `props.dangerouslySetInnerHTML`.

It also retains `role`, so `role="presentation"` can remove the landmark semantics the component says it owns.

Omit at least `dangerouslySetInnerHTML`; omit `role` too if “labelled complementary landmark” is genuinely invariant.

The spread order is otherwise correct. Keeping `{...rest}` before `ref`, `className`, and `aria-label` prevents runtime spread escapes from overriding owned props. Moving it after would be worse. `id`, `style`, and event handlers are ordinary passthroughs; `style` can alter geometry, but that is necessarily caller-owned if style forwarding is required.

### F19 — P3 — The Outline rationale describes code that does not exist

**Established.** [ModeSurface.tsx:63](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/ModeSurface.tsx:63) says `OutlinePanel` writes padding and two custom properties onto the band. The actual band at [OutlinePanel.tsx:307](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/OutlinePanel.tsx:307) writes only its class, label, ref, and `data-outline-rung`. Padding and custom properties come from [outline-mode.css:31](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/styles/outline-mode.css:31).

The component can nevertheless carry everything Outline actually needs:

```tsx
<ModeSurface
  feature="outln"
  label="Outline"
  ref={panelRef}
  data-outline-rung={rung}
>
```

The comments should describe that real seam.

## Confirmed sound

**Established from the scoped pre/post diff:**

- Search preserves every conditional expression and direct-child order across owner/visitor and meaning/words branches.
- Chat preserves its error-before-body order, open/list branches, `chat remember` class, labels, `ArmedDelete` key, and keyed `Conversation`.
- Live and dictation are descendants of `Conversation`/`Composer`; the surface migration does not rearrange them.
- The extra React fragments introduce no DOM.
- Keeping `Conversation` whole in `children` is right.
- Search passing no `head` is right.
- `FeatureBoundary` remains raw.
- There is no viewport code.
- The remaining bands and `VisitorBand` can adopt this interface without structural wrappers.

Verification: the targeted 9 tests pass, and all three TypeScript projects pass when the checker is invoked without the sandbox-blocked `tsx` IPC launcher. The full aggregate check could not produce a meaningful verdict here because the sandbox prevents its build output writes and database access.