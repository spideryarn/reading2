# Review: reveal-then-commit for the shelf's action row on touch

Reviewing a finished change to a TypeScript + React 19 app (Spideryarn, a reading tool). Be
adversarial and concrete — I want defects, not praise. Where you are unsure, say so and say what you
would check.

## The ask

> fix the touch behaviour, then push
>
> — the product owner, 2026-09-05

The touch behaviour is what a previous change left open. The homepage shelf's article cards each
carry a row of five action buttons (Edit title, Re-fetch and rebuild, Open the original, Copy link,
Archive). Each now has a rich Floating UI tooltip card explaining what it does. On a touch screen
the row is visible (`hover-none:opacity-100`) and **the tap that opens the card also performs the
action** — Open leaves the page, Archive removes the card, Edit opens the editor. Five controls a
finger can press and cannot read.

## What was done

**First tap reveals the control's card; second tap on the same control commits.** A mouse is
unchanged. This is an existing app gesture, already used by the spine's bands (`Spine.tsx`
§ `bandPress`) and the glossary hover card (`useHoverCard.ts` § `onCommit`); `docs/project/touch.md`
now lists all four users.

Three decisions I want attacked:

1. **The gesture is a single `onClickCapture` on the row `<div>`, not five per-control handlers.**
   Capture runs before any control's own click, so a reveal cancels the press with
   `preventDefault()` + `stopPropagation()`. The reason it is not per-control: two of the five can be
   an `IconButton` that **swallows its own click** when drawn unavailable (it is `aria-disabled`
   rather than natively `disabled`, so that its tooltip stays reachable), so an injected `onClick`
   would never run — and those are exactly the controls whose card is worth reading. One of the five
   is an `<a>` whose default is to navigate.

   Is the capture-phase `stopPropagation()` actually sufficient to stop React's own dispatch to the
   child's `onClick`, and to stop Floating UI's reference props on the trigger? Is the
   `preventDefault()` enough to stop the anchor navigating in every browser? Is there an ordering
   problem with `useDismiss`'s document-level `pointerdown` (which fires before `click`) — could it
   null the state before my handler reads it, and does the `useCallback([armed])` closure see a
   stale value?

2. **The tooltips become controlled, and one `armed` state serves five of them inside one
   `<TooltipGroup>`.** That is the exact shape of a previous outage
   (`docs/postmortems/260828g-spine-hover-cards.md`): `useDelayGroup` calls `onOpenChange(false)` on
   every *other* member the instant one opens, and `useHover`'s close timer fires 90ms behind the
   pointer without checking who is open by then. The close is therefore identity-guarded:

   ```ts
   onOpenChange={(v) => onArm((prev) => (v ? { id, byTouch: false } : prev?.id === id ? null : prev))}
   ```

   Are there other routes into `onOpenChange(false)` this does not cover? Is there a route to
   `onOpenChange(true)` that would wrongly set `byTouch: false` and suppress the "Tap again" line —
   or worse, a route by which the card opens *before* the click and makes the first tap commit?
   I am specifically worried about `useFocus`: a tap focuses a button, and focus fires before click.
   I believe `useFocus` is `visibleOnly` and ignores pointer-induced focus, but I have not proved it.

3. **`pointerType` is read from the press, not from the device** (`(hover: none)` describes the UA's
   *primary* pointer, so hybrids get it wrong in both directions). A click with no pointer at all —
   keyboard Enter, a synthetic click — takes the "commit" branch. Right call?

## Also review

- **The copy.** The card gains a `tap` slot reading "Tap again to do it.", shown only when a finger
  opened the card AND a second tap would do something. Is that the right rule and the right words?
- Anything about the `data-action` attribute + `closest()` identification that could misfire.
- Whether `actionAt`'s narrowing against `KEYS` is worth it or is ceremony.

## What I checked

- `npm run typecheck` clean.
- 11 new cases in `tests/shelf-action-touch.test.tsx`, plus the 14 existing in
  `tests/shelf-action-tooltips.test.tsx`, all green.
- **Both mutations proved:** removing the identity guard turns **9 of 11** red (the delay group nulls
  `armed` immediately after a reveal, so even the touch cases fail); disabling the reveal branch
  turns 6 of 11 red.
- The tests assert on `aria-describedby` rather than on `[role="tooltip"]` nodes, because
  `useTransitionStyles` keeps a closing card mounted for its 80ms exit — counting nodes fails on the
  animation and passes on the bug.

## What I have NOT checked at review time

Real-browser touch. A browser pass driving CDP `Input.dispatchTouchEvent` is running separately —
`touch.md` records that synthetic events once agreed with a build that was broken on every touch
device for a week. Tell me what you expect it to find.

## Files

Scoped diff for `src/web/ShelfEntry.tsx`, `src/web/Tooltip.tsx` and `src/web/styles.css` below. Read
`tests/shelf-action-touch.test.tsx`, `src/web/Tooltip.tsx`, `src/web/IconButton.tsx`,
`src/web/Spine.tsx` § `bandPress`, and `docs/postmortems/260828g-spine-hover-cards.md` in the repo as
needed.
diff --git a/src/web/ShelfEntry.tsx b/src/web/ShelfEntry.tsx
index 22872183..e279f93b 100644
--- a/src/web/ShelfEntry.tsx
+++ b/src/web/ShelfEntry.tsx
@@ -10,7 +10,14 @@
  *
  * See docs/project/library.md § What you can do to a card.
  */
-import { useCallback, useState, type ReactElement } from "react";
+import {
+  useCallback,
+  useState,
+  type Dispatch,
+  type MouseEvent as ReactMouseEvent,
+  type ReactElement,
+  type SetStateAction,
+} from "react";
 import {
   Archive,
   Check,
@@ -431,6 +438,9 @@ const TIPS = {
  * Tooltip.tsx § `keepSide` gives about rows specifically — without it a card
  * too wide to centre is thrown onto the cross axis and lands on top of the very
  * buttons the reader is about to hover.
+ *
+ * **And on a finger, the first tap reads a control and the second presses it**
+ * — `pressCapture` below. docs/project/touch.md § Reveal, then commit.
  */
 export function Actions({
   entry,
@@ -444,6 +454,68 @@ export function Actions({
   const [copied, setCopied] = useState(false);
   const [rerunning, setRerunning] = useState(false);
 
+  /**
+   * Which control's card is open, and whether a finger opened it.
+   *
+   * **One piece of state for five controlled tooltips, which is the shape that
+   * took the spine's hover cards away for a day.** Once a tooltip is
+   * controlled, every route Floating UI has to `onOpenChange(false)` becomes a
+   * route into this value — `useDelayGroup` closes every *other* member the
+   * instant one opens, and `useHover`'s close timer fires 90ms behind the
+   * pointer without asking who is open by then. So the close is guarded by
+   * identity in `ActionTip`, and that guard is the whole reason this is safe:
+   * docs/postmortems/260828g-spine-hover-cards.md, whose last paragraph names
+   * this exact situation as the one to watch for.
+   *
+   * `byTouch` decides only whether the card says "tap again" — a mouse reader
+   * is already being told everything by hovering.
+   */
+  const [armed, setArmed] = useState<{ id: ActionKey; byTouch: boolean } | null>(null);
+
+  /**
+   * **The whole touch gesture, in one handler on the row.**
+   *
+   * Capture phase, so it runs *before* the control's own click and can cancel
+   * the press outright — which is what makes one handler enough for five
+   * controls that are not alike. Two of them can be an `IconButton` that
+   * swallows its own click (IconButton.tsx § `disabled`), and one of them is an
+   * `<a>` whose default is to navigate; a per-control design would need a hole
+   * punched in the first and a `preventDefault` threaded through the second.
+   * Here the button goes on refusing its own click and the anchor never sees
+   * the event at all.
+   *
+   * **`pointerType`, not a media query.** `(hover: none)` describes the UA's
+   * *primary* pointer, so a touchscreen laptop would jump on the first tap and
+   * a tablet with a mouse plugged in would need two clicks — both hybrids, both
+   * common, both wrong. This is a fact about *this press*. That is
+   * `bandPress`'s own second version (Spine.tsx), on GPT Sol's correction of
+   * 2026-08-27; optional-chained the same way, because a synthetic click — a
+   * test, an extension — carries no pointer, and the safe reading of "no
+   * pointer" is "not a finger", which presses.
+   *
+   * A mouse therefore takes the `commit` branch every time and the event passes
+   * through untouched, so nothing about pointer behaviour changes.
+   */
+  const pressCapture = useCallback(
+    (e: ReactMouseEvent<HTMLDivElement>) => {
+      const id = actionAt(e.target);
+      if (!id) return;
+      const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
+      /* `armed?.id !== id` rather than `armed === null`, so a finger moving
+         along the row re-reveals rather than firing at whatever it lands on —
+         the row can be read by walking it. Spine.tsx § `bandPress`. */
+      if (touch && armed?.id !== id) {
+        e.preventDefault();
+        e.stopPropagation();
+        setArmed({ id, byTouch: true });
+        return;
+      }
+      // Committing: the card has been read, so it goes, and the press runs.
+      setArmed(null);
+    },
+    [armed],
+  );
+
   const copy = useCallback(() => {
     const url = new URL(readHref(entry.slug), window.location.origin).toString();
     /* Caught, because `writeText` rejects for real reasons — a page without
@@ -517,15 +589,24 @@ export function Actions({
        hover, so without it these buttons stayed invisible AND hit-testable —
        controls you cannot see but can press by accident. Caught by a
        cross-family review, 2026-08-26. */
-    <div className="tw:relative tw:flex tw:shrink-0 tw:items-center tw:gap-0.5 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100">
+    <div
+      className="tw:relative tw:flex tw:shrink-0 tw:items-center tw:gap-0.5 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100"
+      onClickCapture={pressCapture}
+    >
       <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
-        <ActionTip tip={TIPS.edit}>
-          <IconButton label="Edit title" titled={false} onClick={onEdit}>
+        <ActionTip id="edit" armed={armed} onArm={setArmed} tip={TIPS.edit} commits>
+          <IconButton label="Edit title" data-action="edit" titled={false} onClick={onEdit}>
             <Pencil size={14} />
           </IconButton>
         </ActionTip>
 
-        <ActionTip tip={hasWebUrl ? TIPS.rerun : entry.url ? TIPS.rerunNotWeb : TIPS.rerunNoUrl}>
+        <ActionTip
+          id="rerun"
+          armed={armed}
+          onArm={setArmed}
+          tip={hasWebUrl ? TIPS.rerun : entry.url ? TIPS.rerunNotWeb : TIPS.rerunNoUrl}
+          commits={hasWebUrl}
+        >
           {/* **The name says which of the two absences this is**, and not merely
               that there is one. A screen reader gets no card, so the parenthesis
               is the only place the reason reaches it — and a name reading "no
@@ -533,6 +614,7 @@ export function Actions({
               follow, contradicts the card beside it. GPT Sol, 2026-09-05. */}
           <IconButton
             label={rerunLabel(entry, hasWebUrl, rerunning)}
+            data-action="rerun"
             titled={false}
             onClick={() => void rerun()}
             disabled={!hasWebUrl || rerunning}
@@ -541,7 +623,13 @@ export function Actions({
           </IconButton>
         </ActionTip>
 
-        <ActionTip tip={hasWebUrl ? TIPS.open : entry.url ? TIPS.openNotWeb : TIPS.openNoUrl}>
+        <ActionTip
+          id="open"
+          armed={armed}
+          onArm={setArmed}
+          tip={hasWebUrl ? TIPS.open : entry.url ? TIPS.openNotWeb : TIPS.openNoUrl}
+          commits={hasWebUrl}
+        >
           {hasWebUrl ? (
             <a
               href={entry.url}
@@ -550,6 +638,7 @@ export function Actions({
               // of the reader's articles linked to it.
               rel="noopener noreferrer"
               aria-label="Open the original page"
+              data-action="open"
               /* An `<a>` wearing the button's clothes, so the row does not have a
                  gap in it where the one link sits. Kept in step with `IconButton`
                  by hand — a shared helper would have to take an element
@@ -569,6 +658,7 @@ export function Actions({
                   ? "Open the original page (the recorded address is not a web page)"
                   : "Open the original page (no address recorded)"
               }
+              data-action="open"
               titled={false}
               disabled
             >
@@ -582,8 +672,19 @@ export function Actions({
             over a shelf that knows perfectly well which articles are shared —
             `visibility` is on the entry precisely so the shelf can tell.
             GPT Sol, 2026-09-05. */}
-        <ActionTip tip={entry.visibility === "public" ? TIPS.copyShared : TIPS.copy}>
-          <IconButton label={copied ? "Copied" : "Copy link"} titled={false} onClick={copy}>
+        <ActionTip
+          id="copy"
+          armed={armed}
+          onArm={setArmed}
+          tip={entry.visibility === "public" ? TIPS.copyShared : TIPS.copy}
+          commits
+        >
+          <IconButton
+            label={copied ? "Copied" : "Copy link"}
+            data-action="copy"
+            titled={false}
+            onClick={copy}
+          >
             {copied ? <Check size={14} className="tw:text-highlight" /> : <Copy size={14} />}
           </IconButton>
         </ActionTip>
@@ -597,9 +698,10 @@ export function Actions({
             word for *this cannot be undone* and undoing it is the whole design
             (docs/project/library.md § Archive, and Undo is the confirmation).
             The card now says the same thing in a sentence. */}
-        <ActionTip tip={TIPS.archive}>
+        <ActionTip id="archive" armed={armed} onArm={setArmed} tip={TIPS.archive} commits>
           <IconButton
             label="Archive"
+            data-action="archive"
             titled={false}
             onClick={() => void shelf.archive(entry.slug)}
           >
@@ -624,6 +726,27 @@ function rerunLabel(entry: LibraryEntry, hasWebUrl: boolean, rerunning: boolean)
     : "Re-fetch and rebuild (no address recorded)";
 }
 
+/** The five controls, named. The `data-action` on each trigger carries one. */
+export type ActionKey = "edit" | "rerun" | "open" | "copy" | "archive";
+
+const KEYS: readonly string[] = ["edit", "rerun", "open", "copy", "archive"];
+
+/**
+ * Which control the finger landed on, from wherever inside it the event started
+ * — usually the `<svg>`, sometimes its `<path>`.
+ *
+ * Read off the DOM rather than from React identity because there is one handler
+ * for the row rather than one per control (`pressCapture`), and `closest` is
+ * what turns a point into a control. Narrowed against `KEYS` rather than cast:
+ * the attribute is a string as far as the DOM is concerned, and a typo in the
+ * JSX should fail here rather than become an `ActionKey` nothing matches.
+ */
+function actionAt(target: EventTarget | null): ActionKey | null {
+  if (!(target instanceof Element)) return null;
+  const found = target.closest("[data-action]")?.getAttribute("data-action");
+  return found && KEYS.includes(found) ? (found as ActionKey) : null;
+}
+
 /**
  * One card, in the placement the whole row shares.
  *
@@ -631,12 +754,33 @@ function rerunLabel(entry: LibraryEntry, hasWebUrl: boolean, rerunning: boolean)
  * on a dense row — above it is the window edge or the row before, and below it
  * is this article's own body, which is the thing the reader is least surprised
  * to have covered for a moment.
+ *
+ * **Controlled, and that is the risky part.** The card has to survive a tap and
+ * outlive the `mouseleave` a tap synthesises, which needs an owner of "which
+ * card is open" outside the tooltip — so `Actions` holds one `armed` for all
+ * five. See its docstring, and the postmortem it cites, for what that costs.
  */
 function ActionTip({
+  id,
+  armed,
+  onArm,
   tip,
+  commits,
   children,
 }: {
+  id: ActionKey;
+  armed: { id: ActionKey; byTouch: boolean } | null;
+  onArm: Dispatch<SetStateAction<{ id: ActionKey; byTouch: boolean } | null>>;
   tip: { head: string; what: string; how: string };
+  /**
+   * Whether a second tap would actually do anything.
+   *
+   * False for a control drawn unavailable, and then the card says nothing about
+   * tapping again — the first tap has already given the reader everything this
+   * control has, and inviting a second press that is designed to be refused is
+   * worse than silence.
+   */
+  commits: boolean;
   children: ReactElement<Record<string, unknown>>;
 }) {
   return (
@@ -644,7 +788,29 @@ function ActionTip({
       placement="bottom"
       keepSide
       className="tip-soon"
-      content={<ControlTip head={tip.head} what={tip.what} how={tip.how} />}
+      open={armed?.id === id}
+      /**
+       * **A close only counts from the control that is actually open.**
+       *
+       * `onOpenChange(false)` is not a statement that this tooltip was open:
+       * `useDelayGroup` fires it at every *other* member the moment one opens,
+       * and `useHover`'s close timer fires it 90ms after the pointer left,
+       * by which time the card it would close may be a neighbour's. Unguarded,
+       * with one state behind five triggers, the row's cards would flicker and
+       * vanish — which is precisely what happened to the spine's fifty:
+       * docs/postmortems/260828g-spine-hover-cards.md, and this is its fix.
+       */
+      onOpenChange={(v: boolean) =>
+        onArm((prev) => (v ? { id, byTouch: false } : prev?.id === id ? null : prev))
+      }
+      content={
+        <ControlTip
+          head={tip.head}
+          what={tip.what}
+          how={tip.how}
+          tap={commits && armed?.id === id && armed.byTouch ? "Tap again to do it." : undefined}
+        />
+      }
     >
       {children}
     </Tooltip>
diff --git a/src/web/Tooltip.tsx b/src/web/Tooltip.tsx
index 98a52908..68e7b8e0 100644
--- a/src/web/Tooltip.tsx
+++ b/src/web/Tooltip.tsx
@@ -297,6 +297,7 @@ export function ControlTip({
   what,
   drawn,
   how,
+  tap,
 }: {
   head: string;
   state?: string | undefined;
@@ -311,6 +312,23 @@ export function ControlTip({
    */
   drawn?: string | undefined;
   how: string;
+  /**
+   * **"Tap again to do it"**, and only ever that shape.
+   *
+   * A card opened by a *finger* is the one case where the reader has pressed
+   * the control and it has not done anything — reveal, then commit
+   * (docs/project/touch.md). Nothing else on the card says so, and a control
+   * that appears to have been pressed and ignored reads as broken.
+   *
+   * The caller decides when to pass it, and both halves of that decision are
+   * the spine's, made for the same reasons (Spine.tsx § `showTapHint`): only
+   * when a finger opened the card — saying "tap again" to somebody holding a
+   * mouse is noise — and only where a second tap would actually do something.
+   *
+   * Last in the card, because it is the only line that is about the *gesture*
+   * rather than the control.
+   */
+  tap?: string | undefined;
 }) {
   return (
     <>
@@ -319,6 +337,7 @@ export function ControlTip({
       <p>{what}</p>
       {drawn && <p className="tip-soon-drawn">{drawn}</p>}
       <p className="tip-soon-how">{how}</p>
+      {tap && <p className="tip-soon-tap">{tap}</p>}
     </>
   );
 }
diff --git a/src/web/styles.css b/src/web/styles.css
index 22abfa08..b80060dd 100644
--- a/src/web/styles.css
+++ b/src/web/styles.css
@@ -3795,14 +3795,20 @@ td.text.has-hit[data-hues="8"] {
   line-height: 1.45;
   color: var(--ink-soft);
 }
-/* What that project learned the hard way — the part worth carrying. Set apart
-   so it doesn't read as more of the description.
+/* Two footers, one treatment, because they sit in the same place and mean the
+   same kind of thing — an aside under the description rather than more of it.
+
+   `learned` is what that project learned the hard way; `tap` is "tap again to
+   do it", which a card opened by a finger has to say and no other card does
+   (Tooltip.tsx § `ControlTip.tap`, docs/project/touch.md). One rule rather than
+   two identical ones: if they ever need to differ, split it then.
 
    Selector written as `.tip-soon p.tip-soon-learned` rather than the class on
    its own so it outranks `.tip-soon p` above without an `!important`. Same
    result, and the next person to add a rule here inherits a specificity ladder
    they can reason about rather than one they have to escalate past. */
-.tip-soon p.tip-soon-learned {
+.tip-soon p.tip-soon-learned,
+.tip-soon p.tip-soon-tap {
   padding-top: 0.35rem;
   border-top: 1px solid var(--rule);
   color: var(--ink-faint);
